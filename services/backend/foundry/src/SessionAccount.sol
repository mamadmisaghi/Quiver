// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ECDSA} from "./vendor/ECDSA.sol";

interface IFeed { function decimals() external view returns (uint8); function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80); }
interface IDecimals { function decimals() external view returns (uint8); }
interface IPair { function token0() external view returns (address); function token1() external view returns (address); }

/// @title SessionAccount v2 (TEST MODEL of Quiver's session-key policy; local anvil only; UNAUDITED)
/// @notice UNAUDITED. Never deploy outside a local chain. Models the policy we will request from Alchemy
///         session keys (V8); it does not prove Alchemy's implementation enforces it.
///         M3.5 hardening (Robin QA gate on a1b0510):
///         - per-session tokenIn allowlist with per-token caps in TOKEN UNITS (no cross-token unit confusion)
///         - on-chain minOut floor: minOut > 0 and minOut >= oracle-implied out * (1 - maxSlippageBps)
///         - rolling 24h spend window (not a UTC-midnight bucket)
///         - per-key nonces; signed digest binds key, target, data, nonce and a deadline
///         - OpenZeppelin ECDSA.recover (rejects high-s / malleable signatures)
///         - grant rejects past expiries; strict per-selector decoders (exact calldata length)
contract SessionAccount {
    string public constant AUDIT_STATUS = "UNAUDITED";
    bytes32 public constant DIGEST_TAG = keccak256("QuiverSessionAccount.v2.execute");
    uint256 public constant WINDOW = 24 hours;
    uint256 public constant MAX_SPENDS_PER_WINDOW = 64;
    uint16 public constant MAX_SLIPPAGE_BPS_LIMIT = 1_000; // 10% hard ceiling (owner can raise slippageCapBps up to this)
    uint16 public constant DEFAULT_SLIPPAGE_CAP_BPS = 100;  // M3.6: 1% default cap on session maxSlippageBps
    uint32 public constant MIN_FEED_MAX_AGE = 60;           // M3.6: setFeed bounds
    uint32 public constant MAX_FEED_MAX_AGE = 24 hours;

    enum Kind { None, SwapExactInV1 } // SwapExactInV1 = swapExactIn(address,uint256,uint256,address,uint256) on a token0/token1 pair
    bytes4 public constant SWAP_EXACT_IN_V1 = bytes4(keccak256("swapExactIn(address,uint256,uint256,address,uint256)"));

    struct Session { uint64 expiry; uint16 maxSlippageBps; bool revoked; bool exists; }
    struct TokenCap { uint128 perTxCap; uint128 windowCap; bool allowed; }
    struct Spend { uint64 t; uint192 amount; }
    struct Feed { address feed; uint32 maxAge; }

    address public immutable owner;
    mapping(address => Session) public sessions;
    mapping(address => mapping(address => TokenCap)) public tokenCaps;   // key => tokenIn => caps (token units)
    mapping(address => address[]) internal capTokens;                      // key => tokens with caps (for re-grant cleanup)
    mapping(address => mapping(address => Spend[])) internal spends;       // key => tokenIn => spend log
    mapping(address => mapping(address => uint256)) internal spendHead;
    mapping(address => mapping(bytes4 => Kind)) public decoders;          // target => selector => decoder kind
    mapping(address => Feed) public feeds;                                 // token => USD feed (owner-set, verified off-chain)
    mapping(address => uint256) public nonces;                             // per session key
    /// M3.6: grants may not exceed this slippage; 100 bps unless the owner explicitly raises it (<= MAX_SLIPPAGE_BPS_LIMIT).
    uint16 public slippageCapBps = DEFAULT_SLIPPAGE_CAP_BPS;
    /// M3.6: optional L2 sequencer uptime feed (Chainlink: answer 0 = up, 1 = down). address(0) = not configured (L1 / local).
    address public sequencerFeed; uint32 public sequencerGrace;

    error NotOwner(); error NoSession(); error Expired(); error Revoked(); error TargetDenied(); error BadCalldata();
    error TokenNotAllowed(); error OverTxCap(); error OverWindowCap(); error TooManySpends(); error RecipientNotSelf();
    error MinOutZero(); error MinOutBelowFloor(uint256 floor); error OracleMissing(address token); error OracleStale(address token);
    error BadSig(); error SigExpired(); error BadGrant(); error CallFailed(bytes);
    error BadFeed(); error SequencerDown(); error BelowMinSpend(uint256 min);
    event SessionGranted(address key, uint64 expiry, uint16 maxSlippageBps);
    event SessionRevoked(address key);
    event SlippageCapSet(uint16 bps); event FeedSet(address token, address feed, uint32 maxAge); event SequencerFeedSet(address feed, uint32 grace);

    constructor(address o) { owner = o; }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    function grant(address key, uint64 expiry, uint16 maxSlippageBps, address[] calldata tokens, uint128[] calldata perTxCaps, uint128[] calldata windowCaps) external onlyOwner {
        if (key == address(0) || expiry <= block.timestamp || maxSlippageBps > slippageCapBps) revert BadGrant();
        if (tokens.length == 0 || tokens.length != perTxCaps.length || tokens.length != windowCaps.length) revert BadGrant();
        address[] storage old = capTokens[key];
        for (uint256 i; i < old.length; i++) delete tokenCaps[key][old[i]];
        delete capTokens[key];
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == address(0) || perTxCaps[i] == 0 || perTxCaps[i] > windowCaps[i] || uint256(perTxCaps[i]) * MAX_SPENDS_PER_WINDOW < windowCaps[i] || tokenCaps[key][tokens[i]].allowed) revert BadGrant();
            tokenCaps[key][tokens[i]] = TokenCap(perTxCaps[i], windowCaps[i], true);
            capTokens[key].push(tokens[i]);
        }
        // M3.6: windowCap <= 64 * perTxCap, so the per-swap minimum ceil(windowCap/64) never exceeds perTxCap
        // spend log is intentionally NOT cleared: re-granting cannot reset the rolling 24h window
        sessions[key] = Session(expiry, maxSlippageBps, false, true);
        emit SessionGranted(key, expiry, maxSlippageBps);
    }
    function revoke(address key) external onlyOwner { sessions[key].revoked = true; emit SessionRevoked(key); }
    function allow(address target, bytes4 sel, Kind kind) external onlyOwner {
        if (kind == Kind.SwapExactInV1 && sel != SWAP_EXACT_IN_V1) revert BadGrant();
        decoders[target][sel] = kind;
    }
    /// M3.6: maxAge bounded to [60s, 24h] so staleness can't be disabled (uint32.max) or made unusable (0).
    function setFeed(address token, address feed, uint32 maxAge) external onlyOwner {
        if (token == address(0)) revert BadFeed();
        if (feed == address(0)) { if (maxAge != 0) revert BadFeed(); delete feeds[token]; emit FeedSet(token, address(0), 0); return; } // clear: swaps fail closed (OracleMissing)
        if (maxAge < MIN_FEED_MAX_AGE || maxAge > MAX_FEED_MAX_AGE) revert BadFeed();
        feeds[token] = Feed(feed, maxAge); emit FeedSet(token, feed, maxAge);
    }
    /// M3.6: explicit owner opt-in to a slippage cap above the 1% default (hard ceiling 10%). Existing grants keep their bps.
    function setSlippageCap(uint16 bps) external onlyOwner { if (bps == 0 || bps > MAX_SLIPPAGE_BPS_LIMIT) revert BadGrant(); slippageCapBps = bps; emit SlippageCapSet(bps); }
    /// M3.6: L2 sequencer uptime feed; swaps fail closed while down and for `grace` seconds after it comes back. feed=0 disables.
    function setSequencerFeed(address feed, uint32 grace) external onlyOwner { if (feed != address(0) && (grace < MIN_FEED_MAX_AGE || grace > MAX_FEED_MAX_AGE)) revert BadFeed(); sequencerFeed = feed; sequencerGrace = grace; emit SequencerFeedSet(feed, grace); }
    /// owner-only arbitrary call (setup: approvals to the allowlisted pool, withdrawals by the user)
    function ownerCall(address target, bytes calldata data) external onlyOwner returns (bytes memory r) {
        bool ok; (ok, r) = target.call(data); if (!ok) revert CallFailed(r);
    }

    function digest(address key, address target, bytes calldata data, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(DIGEST_TAG, block.chainid, address(this), key, target, keccak256(data), nonces[key], deadline));
    }

    /// Session-key path. `sig` is a 65-byte EIP-191 signature over digest(key, target, data, deadline).
    function executeAsSession(address key, address target, bytes calldata data, uint256 deadline, bytes calldata sig) external returns (bytes memory ret) {
        if (block.timestamp > deadline) revert SigExpired();
        bytes32 h = digest(key, target, data, deadline);
        (address rec, ECDSA.RecoverError e,) = ECDSA.tryRecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)), sig);
        if (e != ECDSA.RecoverError.NoError || rec != key) revert BadSig();
        Session storage ss = sessions[key];
        if (!ss.exists) revert NoSession();
        if (ss.revoked) revert Revoked();
        if (block.timestamp > ss.expiry) revert Expired();
        if (data.length < 4) revert TargetDenied();
        Kind kind = decoders[target][bytes4(data[:4])];
        if (kind == Kind.SwapExactInV1) _checkSwapExactInV1(key, ss, target, data);
        else revert TargetDenied();
        nonces[key]++;
        bool ok; (ok, ret) = target.call(data); if (!ok) revert CallFailed(ret);
    }

    function _checkSwapExactInV1(address key, Session storage ss, address target, bytes calldata data) internal {
        if (data.length != 4 + 5 * 32) revert BadCalldata(); // strict: exact static layout, no trailing bytes
        (address tokenIn, uint256 amountIn, uint256 minOut, address to,) = abi.decode(data[4:], (address, uint256, uint256, address, uint256));
        if (to != address(this)) revert RecipientNotSelf();
        TokenCap memory cap = tokenCaps[key][tokenIn];
        if (!cap.allowed) revert TokenNotAllowed();
        if (amountIn == 0) revert BadCalldata();
        if (amountIn > cap.perTxCap) revert OverTxCap();
        if (minOut == 0) revert MinOutZero();
        // M3.6: minimum notional per swap = windowCap / MAX_SPENDS_PER_WINDOW (rounded up), so 64 log entries always
        // sum to >= windowCap: the spend log can never fill up before the cap is reached (no dust-swap self-DoS).
        uint256 minSpend = (uint256(cap.windowCap) + MAX_SPENDS_PER_WINDOW - 1) / MAX_SPENDS_PER_WINDOW;
        if (amountIn < minSpend) revert BelowMinSpend(minSpend);
        uint256 floor = _floor(tokenIn, _otherSide(target, tokenIn), amountIn, ss.maxSlippageBps);
        if (minOut < floor) revert MinOutBelowFloor(floor);
        _spend(key, tokenIn, amountIn, cap.windowCap);
    }
    function _otherSide(address pair, address tokenIn) internal view returns (address) {
        address t0 = IPair(pair).token0(); address t1 = IPair(pair).token1();
        if (tokenIn == t0) return t1; if (tokenIn == t1) return t0; revert TokenNotAllowed();
    }

    /// oracle-implied output * (1 - maxSlippageBps), using owner-set USD feeds (fail closed if missing/stale/non-positive)
    function _floor(address tokenIn, address tokenOut, uint256 amountIn, uint16 bps) internal view returns (uint256) {
        (uint256 pIn, uint8 fdIn) = _price(tokenIn); (uint256 pOut, uint8 fdOut) = _price(tokenOut);
        // out = amountIn * (pIn/10^fdIn) / (pOut/10^fdOut) * 10^dOut / 10^dIn  (checked math: overflow reverts = fail closed)
        uint256 num = amountIn * pIn * (10 ** IDecimals(tokenOut).decimals()) * (10 ** fdOut);
        uint256 den = pOut * (10 ** IDecimals(tokenIn).decimals()) * (10 ** fdIn);
        return (num / den) * (10_000 - bps) / 10_000;
    }
    function _price(address token) internal view returns (uint256, uint8) {
        Feed memory f = feeds[token];
        if (f.feed == address(0)) revert OracleMissing(token);
        _checkSequencer();
        (uint80 roundId, int256 a,, uint256 updatedAt, uint80 answeredInRound) = IFeed(f.feed).latestRoundData();
        // M3.6: round completeness (answeredInRound >= roundId, updatedAt != 0) on top of positivity and staleness
        if (a <= 0 || updatedAt == 0 || answeredInRound < roundId || updatedAt > block.timestamp || block.timestamp - updatedAt > f.maxAge) revert OracleStale(token);
        return (uint256(a), IFeed(f.feed).decimals());
    }
    function _checkSequencer() internal view {
        address sf = sequencerFeed; if (sf == address(0)) return;
        (, int256 down, uint256 startedAt,,) = IFeed(sf).latestRoundData();
        if (down != 0 || startedAt == 0 || block.timestamp - startedAt <= sequencerGrace) revert SequencerDown();
    }
    /// rolling 24h window: sum of spends with t > now - WINDOW
    function _spend(address key, address token, uint256 amount, uint128 windowCap) internal {
        Spend[] storage log = spends[key][token];
        uint256 head = spendHead[key][token];
        while (head < log.length && log[head].t + WINDOW <= block.timestamp) head++;
        spendHead[key][token] = head;
        if (log.length - head >= MAX_SPENDS_PER_WINDOW) revert TooManySpends();
        uint256 sum = amount;
        for (uint256 i = head; i < log.length; i++) sum += log[i].amount;
        if (sum > windowCap) revert OverWindowCap();
        log.push(Spend(uint64(block.timestamp), uint192(amount)));
    }
    function spentInWindow(address key, address token) external view returns (uint256 sum) {
        Spend[] storage log = spends[key][token];
        for (uint256 i = spendHead[key][token]; i < log.length; i++) if (log[i].t + WINDOW > block.timestamp) sum += log[i].amount;
    }
}
