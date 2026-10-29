// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Base} from "./Base.sol";
import {SessionAccount} from "../src/SessionAccount.sol";

/// TEST-ONLY feeds: an incomplete round (answeredInRound < roundId) and an L2 sequencer uptime feed.
contract IncompleteFeed { uint8 public constant decimals = 8;
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (5, 200e8, block.timestamp, block.timestamp, 4); } }
contract SequencerFeed { int256 public status; uint256 public startedAt;
    function set(int256 s, uint256 t) external { status = s; startedAt = t; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (1, status, startedAt, startedAt, 1); } }

/// M3.6 regressions for Robin's gate on 19e4ba1 (feed bounds, round completeness, sequencer, slippage cap, min notional).
contract M36Test is Base {
    function _ts(address key, uint16 bps) internal {
        address[] memory t = new address[](1); t[0] = address(usdg); uint128[] memory a = new uint128[](1); a[0] = 1_000e6;
        acct.grant(key, uint64(block.timestamp + 1 days), bps, t, a, a);
    }
    function test_setFeedBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fNvda), 0);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fNvda), 59);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fNvda), 1 days + 1);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(fNvda), type(uint32).max);
        vm.expectRevert(SessionAccount.BadFeed.selector); acct.setFeed(address(nvda), address(0), 60);
        acct.setFeed(address(nvda), address(fNvda), 60); acct.setFeed(address(nvda), address(fNvda), 1 days);
        acct.setFeed(address(nvda), address(0), 0); vm.stopPrank(); // clear -> fail closed
        _expect(abi.encodeWithSelector(SessionAccount.OracleMissing.selector, address(nvda)), skPk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_incompleteRoundFailsClosed() public {
        IncompleteFeed f = new IncompleteFeed(); vm.prank(owner); acct.setFeed(address(nvda), address(f), 3600);
        _expect(abi.encodeWithSelector(SessionAccount.OracleStale.selector, address(nvda)), skPk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_zeroUpdatedAtFailsClosed() public {
        fNvda.push(200e8, 0); // MockAggregator refuses round reads with time 0 -> revert, fail closed
        _expect("", skPk, sk, address(pool), _usdgSwap(100e6));
    }
    function test_sequencerDownAndGrace() public {
        SequencerFeed s = new SequencerFeed(); s.set(1, block.timestamp - 7200);
        vm.prank(owner); acct.setSequencerFeed(address(s), 3600);
        _expect(abi.encodeWithSelector(SessionAccount.SequencerDown.selector), skPk, sk, address(pool), _usdgSwap(100e6));
        s.set(0, block.timestamp - 60); // just back up: still in grace
        _expect(abi.encodeWithSelector(SessionAccount.SequencerDown.selector), skPk, sk, address(pool), _usdgSwap(100e6));
        s.set(0, block.timestamp - 3601); _exec(skPk, sk, address(pool), _usdgSwap(100e6));
        vm.prank(owner); vm.expectRevert(SessionAccount.BadFeed.selector); acct.setSequencerFeed(address(s), 0);
        vm.prank(owner); acct.setSequencerFeed(address(0), 0); // disable (L1 / local)
    }
    function test_slippageCapDefault100UnlessOwnerRaises() public {
        assertEq(acct.slippageCapBps(), 100);
        vm.startPrank(owner);
        _ts(sk, 100);
        vm.expectRevert(SessionAccount.BadGrant.selector); _ts(sk, 101);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.setSlippageCap(1_001);
        vm.expectRevert(SessionAccount.BadGrant.selector); acct.setSlippageCap(0);
        acct.setSlippageCap(300); _ts(sk, 300);
        vm.expectRevert(SessionAccount.BadGrant.selector); _ts(sk, 301);
        vm.stopPrank();
        vm.prank(attacker); vm.expectRevert(SessionAccount.NotOwner.selector); acct.setSlippageCap(1_000);
    }
    function test_minNotionalPerSwap() public {
        // fixture: windowCap 2,500 USDG -> min swap ceil(2500e6/64) = 39.0625 USDG
        uint256 m = (uint256(2_500e6) + 63) / 64;
        _expect(abi.encodeWithSelector(SessionAccount.BelowMinSpend.selector, m), skPk, sk, address(pool), _usdgSwap(m - 1));
        _exec(skPk, sk, address(pool), _usdgSwap(m));
        address[] memory t = new address[](1); t[0] = address(usdg); uint128[] memory a = new uint128[](1); a[0] = 10e6; uint128[] memory b = new uint128[](1); b[0] = 641e6;
        vm.prank(owner); vm.expectRevert(SessionAccount.BadGrant.selector); acct.grant(sk2, uint64(block.timestamp + 1 days), 100, t, a, b); // windowCap > 64 * perTx
    }
}
