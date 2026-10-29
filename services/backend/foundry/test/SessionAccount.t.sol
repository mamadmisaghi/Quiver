// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Base} from "./Base.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPool} from "../src/MockPool.sol";
import {SessionAccount} from "../src/SessionAccount.sol";

contract SessionAccountTest is Base {
    function test_labelledUnaudited() public view { assertEq(acct.AUDIT_STATUS(), "UNAUDITED"); }
    function test_positiveSwapSucceeds() public {
        uint256 before = nvda.balanceOf(address(acct));
        _exec(skPk, sk, address(pool), _usdgSwap(500e6));
        assertGt(nvda.balanceOf(address(acct)), before);
        assertEq(usdg.balanceOf(address(acct)), 9_500e6);
        assertEq(acct.nonces(sk), 1); assertEq(acct.nonces(sk2), 0);
    }
    function test_transferDenied() public {
        _expect(_e(SessionAccount.TargetDenied.selector), skPk, sk, address(usdg), abi.encodeCall(MockERC20.transfer, (attacker, 1_000e6)));
    }
    function test_approveDenied() public {
        _expect(_e(SessionAccount.TargetDenied.selector), skPk, sk, address(usdg), abi.encodeCall(MockERC20.approve, (attacker, type(uint256).max)));
    }
    function test_nonAllowlistedTargetDenied() public {
        MockPool evil = new MockPool(usdg, nvda);
        _expect(_e(SessionAccount.TargetDenied.selector), skPk, sk, address(evil), _usdgSwap(100e6));
    }
    function test_recipientMustBeSelf() public {
        _expect(_e(SessionAccount.RecipientNotSelf.selector), skPk, sk, address(pool), _swap(address(usdg), 100e6, 1e18, attacker));
    }
    function test_overPerTxCap() public {
        _expect(_e(SessionAccount.OverTxCap.selector), skPk, sk, address(pool), _usdgSwap(1_000e6 + 1));
    }
    function test_overWindowCapThenRollsOff() public {
        _exec(skPk, sk, address(pool), _usdgSwap(1_000e6));
        _exec(skPk, sk, address(pool), _usdgSwap(1_000e6));
        _expect(_e(SessionAccount.OverWindowCap.selector), skPk, sk, address(pool), _usdgSwap(600e6));
        vm.warp(block.timestamp + 1 days - 1); fUsdg.push(1e8, block.timestamp); fNvda.push(200e8, block.timestamp);
        _expect(_e(SessionAccount.OverWindowCap.selector), skPk, sk, address(pool), _usdgSwap(600e6)); // still inside 24h
        vm.warp(block.timestamp + 1);
        _exec(skPk, sk, address(pool), _usdgSwap(600e6));
    }
    function test_regrantDoesNotResetWindow() public {
        _exec(skPk, sk, address(pool), _usdgSwap(1_000e6)); _exec(skPk, sk, address(pool), _usdgSwap(1_000e6));
        vm.prank(owner); _grantUsdg(sk, 1_000e6, 2_500e6);
        _expect(_e(SessionAccount.OverWindowCap.selector), skPk, sk, address(pool), _usdgSwap(600e6));
    }
    function test_expired() public {
        vm.warp(block.timestamp + 7 days + 1);
        _expect(_e(SessionAccount.Expired.selector), skPk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_revoked() public {
        vm.prank(owner); acct.revoke(sk);
        _expect(_e(SessionAccount.Revoked.selector), skPk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_unknownKeyDenied() public {
        (address k, uint256 pk) = makeAddrAndKey("stranger");
        _expect(_e(SessionAccount.NoSession.selector), pk, k, address(pool), _usdgSwap(100e6));
    }
    function test_wrongSignerForKeyDenied() public {
        _expect(_e(SessionAccount.BadSig.selector), sk2Pk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_replayDenied() public {
        bytes memory d = _usdgSwap(100e6); uint256 dl = block.timestamp + 60; bytes memory sig = _sign(skPk, sk, address(pool), d, dl);
        acct.executeAsSession(sk, address(pool), d, dl, sig);
        vm.expectRevert(SessionAccount.BadSig.selector); acct.executeAsSession(sk, address(pool), d, dl, sig);
    }
    function test_deadlineEnforced() public {
        bytes memory d = _usdgSwap(100e6); uint256 dl = block.timestamp + 60; bytes memory sig = _sign(skPk, sk, address(pool), d, dl);
        vm.warp(dl + 1);
        vm.expectRevert(SessionAccount.SigExpired.selector); acct.executeAsSession(sk, address(pool), d, dl, sig);
        vm.expectRevert(SessionAccount.BadSig.selector); acct.executeAsSession(sk, address(pool), d, dl + 100, sig); // deadline is signed
    }
    function test_onlyOwnerAdmin() public {
        address[] memory t = new address[](1); uint128[] memory a = new uint128[](1);
        vm.prank(attacker); vm.expectRevert(SessionAccount.NotOwner.selector); acct.grant(attacker, type(uint64).max, 0, t, a, a);
        vm.prank(sk); vm.expectRevert(SessionAccount.NotOwner.selector); acct.ownerCall(address(usdg), abi.encodeCall(MockERC20.transfer, (attacker, 1)));
        vm.prank(attacker); vm.expectRevert(SessionAccount.NotOwner.selector); acct.setFeed(address(usdg), attacker, 1);
    }
    function test_grantRejectsPastExpiryAndBadParams() public {
        address[] memory t = new address[](1); t[0] = address(usdg); uint128[] memory a = new uint128[](1); a[0] = 1e6;
        vm.startPrank(owner);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(sk, uint64(block.timestamp), BPS, t, a, a);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(sk, uint64(block.timestamp - 1), BPS, t, a, a);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(sk, uint64(block.timestamp + 1), 1_001, t, a, a);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(sk, uint64(block.timestamp + 1), BPS, new address[](0), new uint128[](0), new uint128[](0));
        vm.stopPrank();
    }
    function test_slippageGuardInPool() public {
        _expect(bytes(""), skPk, sk, address(pool), _swap(address(usdg), 100e6, type(uint256).max, address(acct)));
    }
    function test_staleOracleFailsClosed() public {
        vm.warp(block.timestamp + 1 days + 1);
        _expect(abi.encodeWithSelector(SessionAccount.OracleStale.selector, address(usdg)), skPk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_strictDecoderRejectsTrailingBytes() public {
        _expect(_e(SessionAccount.BadCalldata.selector), skPk, sk, address(pool), abi.encodePacked(_usdgSwap(100e6), uint256(1)));
    }
    function test_strictDecoderRejectsDirtyAddress() public {
        bytes memory d = _usdgSwap(100e6); d[4] = 0x01; // high bytes of tokenIn word set
        _expect(bytes(""), skPk, sk, address(pool), d);
    }
    function test_allowRejectsMismatchedDecoder() public {
        vm.prank(owner); vm.expectRevert(SessionAccount.BadGrant.selector); acct.allow(address(usdg), MockERC20.transfer.selector, SessionAccount.Kind.SwapExactInV1);
    }
}
