// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {DeployTestPool} from "../script/DeployTestPool.s.sol";

/// M5.22 / M2: the testnet deploy script runs in-process (nothing broadcast, nothing signed).
contract DeployTestPoolTest is Test {
    DeployTestPool s; address lp = makeAddr("lp"); address user = makeAddr("user");
    function setUp() public { s = new DeployTestPool(); vm.warp(1_800_000_000); }

    function test_deploysOn46630_andSwaps() public {
        vm.chainId(46630); DeployTestPool.Out memory o = s.deploy(lp, 100);
        assertEq(o.pool.reserve0(), 20_000e6); assertEq(o.pool.reserve1(), 100e18);
        assertEq(o.usdg.symbol(), "tUSDG"); assertEq(o.nvda.decimals(), 18);
        (, int256 px,,,) = o.fNvda.latestRoundData(); assertEq(px, 200e8);
        o.usdg.mint(user, 1_000e6);
        vm.startPrank(user); o.usdg.approve(address(o.pool), type(uint256).max);
        uint256 q = o.pool.quote(address(o.usdg), 1_000e6); uint256 out = o.pool.swapExactIn(address(o.usdg), 1_000e6, q, user, block.timestamp); vm.stopPrank();
        assertEq(out, q); assertGt(out, 4.7e18); assertLt(out, 5e18); assertEq(o.nvda.balanceOf(user), out);
    }
    function test_deploysOnAnvil() public { vm.chainId(31337); s.deploy(lp, 1); }
    function test_refusesMainnet4663() public { vm.chainId(4663); vm.expectRevert(bytes("DeployTestPool: testnet 46630 / anvil only")); s.deploy(lp, 100); }
    function test_refusesEthMainnet() public { vm.chainId(1); vm.expectRevert(bytes("DeployTestPool: testnet 46630 / anvil only")); s.deploy(lp, 100); }
    function test_seedBounds() public { vm.chainId(46630); vm.expectRevert(bytes("seed")); s.deploy(lp, 0); }
}
