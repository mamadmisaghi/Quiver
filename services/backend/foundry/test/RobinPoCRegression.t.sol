// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Base} from "./Base.sol";
import {SessionAccount} from "../src/SessionAccount.sol";

/// Robin's QA PoCs (qa/poc/RobinPoC.t.sol, gate on a1b0510) ported to the v2 API.
/// Each test now asserts the exploit FAILS.
contract RobinPoCRegression is Base {
    function _t0() internal pure override returns (uint256) { return 1_800_000_000 - (1_800_000_000 % 1 days) + 1 days - 60; } // 60s before UTC midnight

    /// P1 cap unit confusion: tokenIn not on the session allowlist is rejected; caps are per token in that token's units.
    function test_regression_capUnitConfusion() public {
        _expect(_e(SessionAccount.TokenNotAllowed.selector), skPk, sk, address(pool), _swap(address(nvda), 999e6, 1, address(acct)));
        // owner grants NVDA with 18-dec caps; USDG is no longer allowlisted for this key, so its balance cannot be swept
        address[] memory t = new address[](1); t[0] = address(nvda); uint128[] memory a = new uint128[](1); a[0] = 5e18; uint128[] memory b = new uint128[](1); b[0] = 12e18;
        vm.prank(owner); acct.grant(sk, uint64(block.timestamp + 7 days), BPS, t, a, b);
        _expect(_e(SessionAccount.TokenNotAllowed.selector), skPk, sk, address(pool), _swap(address(usdg), 10_000e6, 1e18, address(acct)));
        assertEq(usdg.balanceOf(address(acct)), 10_000e6);
    }
    /// P1 minOut=0 rejected; minOut below oracle floor (1% bps) rejected.
    function test_regression_minOutZeroRejected() public {
        _expect(_e(SessionAccount.MinOutZero.selector), skPk, sk, address(pool), _swap(address(usdg), 1_000e6, 0, address(acct)));
        _expect(bytes(""), skPk, sk, address(pool), _swap(address(usdg), 1_000e6, 1, address(acct))); // MinOutBelowFloor(floor)
        uint256 floor = uint256(1_000e6) * 1e8 * 1e18 * 1e8 / (200e8 * 1e6 * 1e8) * (10_000 - BPS) / 10_000; // 4.95 NVDA
        _expect(abi.encodeWithSelector(SessionAccount.MinOutBelowFloor.selector, floor), skPk, sk, address(pool), _swap(address(usdg), 1_000e6, floor - 1, address(acct)));
        _exec(skPk, sk, address(pool), _swap(address(usdg), 1_000e6, floor, address(acct)));
    }
    /// P2 midnight double spend: rolling 24h window holds across UTC midnight.
    function test_regression_midnightDoubleSpend() public {
        _exec(skPk, sk, address(pool), _usdgSwap(800e6)); _exec(skPk, sk, address(pool), _usdgSwap(800e6)); _exec(skPk, sk, address(pool), _usdgSwap(800e6));
        vm.warp(block.timestamp + 120);
        _expect(_e(SessionAccount.OverWindowCap.selector), skPk, sk, address(pool), _usdgSwap(800e6));
        assertEq(acct.spentInWindow(sk, address(usdg)), 2_400e6);
    }
    /// P2 global nonce grief: key1 activity no longer invalidates key2's pre-signed tx.
    function test_regression_perKeyNonce() public {
        bytes memory d = _usdgSwap(100e6); uint256 dl = block.timestamp + 60; bytes memory sig2 = _sign(sk2Pk, sk2, address(pool), d, dl);
        _exec(skPk, sk, address(pool), _usdgSwap(101e6));
        acct.executeAsSession(sk2, address(pool), d, dl, sig2);
        assertEq(acct.nonces(sk), 1); assertEq(acct.nonces(sk2), 1);
    }
    /// P2 malleable signature (s' = n - s, v flipped) rejected (OZ ECDSA low-s).
    function test_regression_malleableSigRejected() public {
        bytes memory d = _usdgSwap(100e6); uint256 dl = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(skPk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", acct.digest(sk, address(pool), d, dl))));
        bytes memory mal = abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(SessionAccount.BadSig.selector); acct.executeAsSession(sk, address(pool), d, dl, mal);
        acct.executeAsSession(sk, address(pool), d, dl, abi.encodePacked(r, s, v)); // canonical one still works
    }
    /// Sanity (kept): replay blocked.
    function test_replayBlocked() public {
        bytes memory d = _usdgSwap(100e6); uint256 dl = block.timestamp + 60; bytes memory sig = _sign(skPk, sk, address(pool), d, dl);
        acct.executeAsSession(sk, address(pool), d, dl, sig);
        vm.expectRevert(); acct.executeAsSession(sk, address(pool), d, dl, sig);
    }
    /// Sanity (kept): revoked / expired / non-allowlisted / recipient!=self all revert.
    function test_guards() public {
        _expect(_e(SessionAccount.RecipientNotSelf.selector), skPk, sk, address(pool), _swap(address(usdg), 100e6, 1e18, attacker));
        _expect(_e(SessionAccount.TargetDenied.selector), skPk, sk, address(usdg), abi.encodeWithSignature("transfer(address,uint256)", attacker, 1));
        vm.prank(owner); acct.revoke(sk);
        _expect(_e(SessionAccount.Revoked.selector), skPk, sk, address(pool), _usdgSwap(100e6));
        vm.warp(block.timestamp + 8 days);
        _expect(_e(SessionAccount.Expired.selector), sk2Pk, sk2, address(pool), _usdgSwap(100e6));
    }
}
