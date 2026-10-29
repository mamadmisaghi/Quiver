// M3.6 (Sage): copy of qa/poc/RobinV2.t.sol. Changes: setUp raises slippageCapBps to 10% explicitly (Robin's grants use
// 300 / 1000 bps); the three P2 FINDING tests are inverted into regressions for the M3.6 fixes. Everything else is unchanged.
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPool} from "../src/MockPool.sol";
import {MockAggregator} from "../src/MockAggregator.sol";
import {SessionAccount} from "../src/SessionAccount.sol";
/// Robin's independent v2 suite (local only). Names: test_v1Port_* = old attack now blocked; test_new_* = new probes.
contract RobinV2 is Test {
    MockERC20 usdg; MockERC20 nvda; MockPool pool; SessionAccount acct; MockAggregator fU; MockAggregator fN;
    address owner = makeAddr("owner"); uint256 kPk; address k; uint256 k2Pk; address k2;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    function setUp() public {
        vm.warp(1_800_000_000 - (1_800_000_000 % 1 days) + 1 days - 60); // 60s before UTC midnight
        (k, kPk) = makeAddrAndKey("rk1"); (k2, k2Pk) = makeAddrAndKey("rk2");
        usdg = new MockERC20("U", "U", 6); nvda = new MockERC20("N", "N", 18); pool = new MockPool(usdg, nvda);
        usdg.mint(address(this), 1_000_000e6); nvda.mint(address(this), 5_000e18);
        usdg.approve(address(pool), type(uint256).max); nvda.approve(address(pool), type(uint256).max);
        pool.addLiquidity(1_000_000e6, 5_000e18);
        acct = new SessionAccount(owner); usdg.mint(address(acct), 10_000e6); nvda.mint(address(acct), 40e18);
        fU = new MockAggregator("U"); fN = new MockAggregator("N"); fU.push(1e8, block.timestamp); fN.push(200e8, block.timestamp);
        vm.startPrank(owner);
        acct.ownerCall(address(usdg), abi.encodeCall(MockERC20.approve, (address(pool), type(uint256).max)));
        acct.ownerCall(address(nvda), abi.encodeCall(MockERC20.approve, (address(pool), type(uint256).max)));
        acct.allow(address(pool), MockPool.swapExactIn.selector, SessionAccount.Kind.SwapExactInV1);
        acct.setFeed(address(usdg), address(fU), 3600); acct.setFeed(address(nvda), address(fN), 3600);
        acct.setSlippageCap(1_000); // M3.6: explicit owner opt-in above the 100 bps default
        _grant(k, 1_000e6, 2_500e6); _grant(k2, 1_000e6, 2_500e6);
        vm.stopPrank();
    }
    function _grant(address key, uint128 tx_, uint128 win) internal {
        address[] memory t = new address[](1); t[0] = address(usdg);
        uint128[] memory a = new uint128[](1); a[0] = tx_; uint128[] memory b = new uint128[](1); b[0] = win;
        acct.grant(key, uint64(block.timestamp + 7 days), 300, t, a, b);
    }
    function _sw(address tIn, uint256 amt, uint256 minOut) internal view returns (bytes memory) {
        return abi.encodeCall(MockPool.swapExactIn, (tIn, amt, minOut, address(acct), block.timestamp + 60));
    }
    function _okMin(uint256 usdAmt) internal view returns (uint256) { return pool.quote(address(usdg), usdAmt) * 99 / 100; }
    function _sig(uint256 pk, address key, bytes memory d, uint256 dl) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", acct.digest(key, address(pool), d, dl))));
        return abi.encodePacked(r, s, v);
    }
    function _x(uint256 pk, address key, bytes memory d) internal { uint256 dl = block.timestamp + 60; acct.executeAsSession(key, address(pool), d, dl, _sig(pk, key, d, dl)); }
    function _xr(bytes memory err, uint256 pk, address key, bytes memory d) internal { uint256 dl = block.timestamp + 60; bytes memory s = _sig(pk, key, d, dl); if (err.length == 0) vm.expectRevert(); else vm.expectRevert(err); acct.executeAsSession(key, address(pool), d, dl, s); }
    function _refresh() internal { fU.push(1e8, block.timestamp); fN.push(200e8, block.timestamp); }

    // ---- v1 PoCs ported by hand ----
    function test_v1Port_capUnitConfusion_blocked() public { // NVDA not in allowlist; USDG > perTx
        _xr(abi.encodeWithSelector(SessionAccount.TokenNotAllowed.selector), kPk, k, _sw(address(nvda), 999e6, 1));
        _xr(abi.encodeWithSelector(SessionAccount.OverTxCap.selector), kPk, k, _sw(address(usdg), 10_000e6, 1));
        assertEq(usdg.balanceOf(address(acct)), 10_000e6);
    }
    function test_v1Port_minOutZero_blocked() public { _xr(abi.encodeWithSelector(SessionAccount.MinOutZero.selector), kPk, k, _sw(address(usdg), 1_000e6, 0)); }
    function test_v1Port_minOutBelowFloor_blocked() public { _xr("", kPk, k, _sw(address(usdg), 1_000e6, 1)); }
    function test_v1Port_midnightDoubleSpend_blocked() public {
        for (uint i; i < 3; i++) _x(kPk, k, _sw(address(usdg), 800e6, _okMin(800e6)));
        vm.warp(block.timestamp + 120); _refresh();
        _xr(abi.encodeWithSelector(SessionAccount.OverWindowCap.selector), kPk, k, _sw(address(usdg), 800e6, _okMin(800e6)));
        vm.warp(block.timestamp + 1 days); _refresh(); _x(kPk, k, _sw(address(usdg), 800e6, _okMin(800e6))); // rolls off after 24h
    }
    function test_v1Port_crossKeyNonce_isolated() public {
        bytes memory d = _sw(address(usdg), 100e6, _okMin(100e6)); uint256 dl = block.timestamp + 60; bytes memory s2 = _sig(k2Pk, k2, d, dl);
        _x(kPk, k, _sw(address(usdg), 101e6, _okMin(101e6)));
        acct.executeAsSession(k2, address(pool), d, dl, s2); // still valid
    }
    function test_v1Port_malleable_rejected() public {
        bytes memory d = _sw(address(usdg), 100e6, _okMin(100e6)); uint256 dl = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(kPk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", acct.digest(k, address(pool), d, dl))));
        vm.expectRevert(SessionAccount.BadSig.selector);
        acct.executeAsSession(k, address(pool), d, dl, abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27)));
    }
    function test_v1Port_replay_blocked() public {
        bytes memory d = _sw(address(usdg), 100e6, _okMin(100e6)); uint256 dl = block.timestamp + 60; bytes memory s = _sig(kPk, k, d, dl);
        acct.executeAsSession(k, address(pool), d, dl, s); vm.expectRevert(SessionAccount.BadSig.selector); acct.executeAsSession(k, address(pool), d, dl, s);
    }
    // ---- new probes ----
    function test_new_staleOracleFailsClosed() public { vm.warp(block.timestamp + 3601); _xr("", kPk, k, _sw(address(usdg), 100e6, 1e18)); }
    function test_new_tokenOutOracleMissingFailsClosed() public { vm.prank(owner); acct.setFeed(address(nvda), address(0), 0); _xr("", kPk, k, _sw(address(usdg), 100e6, 1e18)); }
    function test_new_negativeAndFutureOracleFailsClosed() public {
        fN.push(-1, block.timestamp); _xr("", kPk, k, _sw(address(usdg), 100e6, 1e18));
        fN.push(200e8, block.timestamp + 10); _xr("", kPk, k, _sw(address(usdg), 100e6, 1e18));
    }
    function test_new_deadlinePassedRejected() public {
        bytes memory d = _sw(address(usdg), 100e6, _okMin(100e6)); uint256 dl = block.timestamp + 5; bytes memory s = _sig(kPk, k, d, dl);
        vm.warp(block.timestamp + 6); _refresh(); vm.expectRevert(SessionAccount.SigExpired.selector); acct.executeAsSession(k, address(pool), d, dl, s);
    }
    function test_new_deadlineTamperRejected() public {
        bytes memory d = _sw(address(usdg), 100e6, _okMin(100e6)); uint256 dl = block.timestamp + 5; bytes memory s = _sig(kPk, k, d, dl);
        vm.expectRevert(SessionAccount.BadSig.selector); acct.executeAsSession(k, address(pool), d, dl + 1000, s);
    }
    function test_new_trailingBytesAndDirtyAddressRejected() public {
        _xr(abi.encodeWithSelector(SessionAccount.BadCalldata.selector), kPk, k, abi.encodePacked(_sw(address(usdg), 100e6, _okMin(100e6)), uint256(0)));
        bytes memory d = _sw(address(usdg), 100e6, _okMin(100e6)); d[4] = 0x01; // dirty high bits of tokenIn
        _xr("", kPk, k, d);
    }
    function test_new_sigForKeyUsedByOtherKeyRejected() public { _xr(abi.encodeWithSelector(SessionAccount.BadSig.selector), k2Pk, k, _sw(address(usdg), 100e6, _okMin(100e6))); }
    function test_new_grantGuards() public {
        address[] memory t = new address[](2); t[0] = address(usdg); t[1] = address(usdg); uint128[] memory a = new uint128[](2); a[0] = 1; a[1] = 1;
        vm.startPrank(owner);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(k, uint64(block.timestamp + 1), 300, t, a, a); // dup token
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(k, uint64(block.timestamp), 300, new address[](0), new uint128[](0), new uint128[](0));
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.allow(address(pool), bytes4(0xa9059cbb), SessionAccount.Kind.SwapExactInV1);
        vm.stopPrank();
        vm.expectRevert(SessionAccount.NotOwner.selector); acct.setFeed(address(usdg), address(1), 1);
    }
    function test_new_regrantCannotResetWindow() public {
        _x(kPk, k, _sw(address(usdg), 1_000e6, _okMin(1_000e6))); _x(kPk, k, _sw(address(usdg), 1_000e6, _okMin(1_000e6)));
        vm.prank(owner); _grant(k, 1_000e6, 2_500e6);
        _xr(abi.encodeWithSelector(SessionAccount.OverWindowCap.selector), kPk, k, _sw(address(usdg), 600e6, _okMin(600e6)));
    }
    /// M3.6 regression (was FINDING P2): maxAge is bounded to [60s, 24h]; uint32.max and 0 are refused.
    function test_new_ownerCanDisableStaleness() public {
        vm.startPrank(owner);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fN), type(uint32).max);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fN), 24 hours + 1);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fN), 59);
        acct.setFeed(address(nvda), address(fN), 60); acct.setFeed(address(nvda), address(fN), 24 hours);
        vm.stopPrank();
    }
    /// FINDING (P2, design): 10% max slippage per tx -> sandwich extraction bounded at ~bps*windowCap per 24h.
    function test_new_maxSlippageTenPercentAccepted() public {
        address[] memory t = new address[](1); t[0] = address(usdg); uint128[] memory a = new uint128[](1); a[0] = 1_000e6;
        vm.prank(owner); acct.grant(k, uint64(block.timestamp + 1 days), 1_000, t, a, a);
        uint256 fl = (1_000e6 * uint256(1e8) * 1e18 * 1e8) / (200e8 * 1e6 * 1e8) * 9_000 / 10_000;
        _x(kPk, k, _sw(address(usdg), 1_000e6, fl)); // minOut 10% under oracle accepted
    }
    /// M3.6 regression (was dust DoS): min notional per swap = ceil(windowCap/64), so dust swaps revert and the
    /// 64-entry log always reaches windowCap before it can fill.
    function test_new_spendLogDoS() public {
        address[] memory t = new address[](1); t[0] = address(usdg); uint128[] memory a = new uint128[](1); a[0] = 1_000e6; uint128[] memory b = new uint128[](1); b[0] = 100_000e6;
        vm.prank(owner); vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(k, uint64(block.timestamp + 7 days), 300, t, a, b); // windowCap > 64*perTx
        b[0] = 50_000e6; vm.prank(owner); acct.grant(k, uint64(block.timestamp + 7 days), 300, t, a, b);
        uint256 w = 50_000e6; uint256 minSpend = (w + 63) / 64;
        _xr(abi.encodeWithSelector(SessionAccount.BelowMinSpend.selector, minSpend), kPk, k, _sw(address(usdg), 1e6, _okMin(1e6)));
        _x(kPk, k, _sw(address(usdg), minSpend, _okMin(minSpend)));
    }
}
