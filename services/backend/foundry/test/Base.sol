// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPool} from "../src/MockPool.sol";
import {MockAggregator} from "../src/MockAggregator.sol";
import {SessionAccount} from "../src/SessionAccount.sol";

/// Shared fixture: USDG(6) / NVDA(18) pool at 200 USDG per NVDA, USD feeds $1 / $200, 1% max slippage.
abstract contract Base is Test {
    MockERC20 usdg; MockERC20 nvda; MockPool pool; SessionAccount acct; MockAggregator fUsdg; MockAggregator fNvda;
    address owner = makeAddr("owner"); address attacker = makeAddr("attacker");
    uint256 skPk; address sk; uint256 sk2Pk; address sk2;
    bytes4 constant SWAP = MockPool.swapExactIn.selector;
    uint16 constant BPS = 100;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _t0() internal virtual returns (uint256) { return 1_800_000_000; }
    function setUp() public virtual {
        vm.warp(_t0());
        (sk, skPk) = makeAddrAndKey("sk1"); (sk2, sk2Pk) = makeAddrAndKey("sk2"); // in-EVM throwaway keys, never on disk
        usdg = new MockERC20("Test USDG", "tUSDG", 6); nvda = new MockERC20("Test NVDA", "tNVDA", 18);
        pool = new MockPool(usdg, nvda);
        usdg.mint(address(this), 1_000_000e6); nvda.mint(address(this), 5_000e18);
        usdg.approve(address(pool), type(uint256).max); nvda.approve(address(pool), type(uint256).max);
        pool.addLiquidity(1_000_000e6, 5_000e18);
        fUsdg = new MockAggregator("USDG / USD"); fNvda = new MockAggregator("NVDA / USD");
        fUsdg.push(1e8, block.timestamp); fNvda.push(200e8, block.timestamp);
        acct = new SessionAccount(owner);
        usdg.mint(address(acct), 10_000e6); nvda.mint(address(acct), 40e18);
        vm.startPrank(owner);
        acct.ownerCall(address(usdg), abi.encodeCall(MockERC20.approve, (address(pool), type(uint256).max)));
        acct.ownerCall(address(nvda), abi.encodeCall(MockERC20.approve, (address(pool), type(uint256).max)));
        acct.allow(address(pool), SWAP, SessionAccount.Kind.SwapExactInV1);
        acct.setFeed(address(usdg), address(fUsdg), 1 days); acct.setFeed(address(nvda), address(fNvda), 1 days);
        _grantUsdg(sk, 1_000e6, 2_500e6); _grantUsdg(sk2, 1_000e6, 2_500e6);
        vm.stopPrank();
    }
    function _grantUsdg(address key, uint128 perTx, uint128 win) internal {
        address[] memory t = new address[](1); t[0] = address(usdg);
        uint128[] memory a = new uint128[](1); a[0] = perTx; uint128[] memory b = new uint128[](1); b[0] = win;
        acct.grant(key, uint64(block.timestamp + 7 days), BPS, t, a, b);
    }
    function _swap(address tokenIn, uint256 amt, uint256 minOut, address to) internal view returns (bytes memory) {
        return abi.encodeCall(MockPool.swapExactIn, (tokenIn, amt, minOut, to, block.timestamp + 60));
    }
    /// minOut = the on-chain oracle floor ($1 USDG -> $200 NVDA, minus 1%)
    function _usdgSwap(uint256 amt) internal view returns (bytes memory) { return _swap(address(usdg), amt, amt * 1e12 / 200 * (10_000 - BPS) / 10_000, address(acct)); }
    function _sign(uint256 pk, address key, address t, bytes memory d, uint256 dl) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", acct.digest(key, t, d, dl))));
        return abi.encodePacked(r, s, v);
    }
    function _exec(uint256 pk, address key, address t, bytes memory d) internal returns (bytes memory) {
        uint256 dl = block.timestamp + 120; return acct.executeAsSession(key, t, d, dl, _sign(pk, key, t, d, dl));
    }
    function _expect(bytes memory err, uint256 pk, address key, address t, bytes memory d) internal {
        uint256 dl = block.timestamp + 120; bytes memory sig = _sign(pk, key, t, d, dl);
        if (err.length == 0) vm.expectRevert(); else vm.expectRevert(err);
        acct.executeAsSession(key, t, d, dl, sig);
    }
    function _e(bytes4 s) internal pure returns (bytes memory) { return abi.encodePacked(s); }
}
