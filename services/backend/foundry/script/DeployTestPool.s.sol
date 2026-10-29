// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPool} from "../src/MockPool.sol";
import {MockAggregator} from "../src/MockAggregator.sol";

/// @notice M2 unblock (V1–V5 workaround): deploy OUR OWN test venue on Robinhood Chain TESTNET 46630 (or anvil 31337).
/// TEST-ONLY tokens (anyone can mint, no value): tUSDG (6) and tNVDA (18, a test stand-in, NOT a Robinhood Stock Token),
/// one MockPool at 200 tUSDG per tNVDA, and two MockAggregator feeds ($1 / $200). Refuses every other chain (incl. mainnet 4663).
///
/// No private key is read by this script. The signer comes from forge's own wallet flags, chosen by the operator:
///   forge script script/DeployTestPool.s.sol --rpc-url $TESTNET_RPC_URL --sender $DEPLOYER_ADDRESS --ledger --broadcast
///   forge script ... --account <encrypted keystore name> --broadcast        (cast wallet import; password prompt)
/// Dry run (no broadcast, nothing signed):  forge script script/DeployTestPool.s.sol --rpc-url $TESTNET_RPC_URL --sender $DEPLOYER_ADDRESS
contract DeployTestPool is Script {
    uint256 constant TESTNET = 46630; uint256 constant ANVIL = 31337;
    struct Out { MockERC20 usdg; MockERC20 nvda; MockPool pool; MockAggregator fUsdg; MockAggregator fNvda; }

    function run() external returns (Out memory o) {
        // Seed size (whole units) is configurable; defaults keep the pool tiny. Not a secret.
        uint256 seedNvda = vm.envOr("TEST_POOL_SEED_NVDA", uint256(100));
        o = deploy(msg.sender, seedNvda);
        console2.log("chainId", block.chainid);
        console2.log("tUSDG", address(o.usdg)); console2.log("tNVDA", address(o.nvda)); console2.log("pool", address(o.pool));
        console2.log("feed tUSDG/USD", address(o.fUsdg)); console2.log("feed tNVDA/USD", address(o.fNvda));
    }

    function deploy(address lp, uint256 seedNvda) public returns (Out memory o) {
        require(block.chainid == TESTNET || block.chainid == ANVIL, "DeployTestPool: testnet 46630 / anvil only");
        require(seedNvda > 0 && seedNvda <= 10_000, "seed");
        vm.startBroadcast(lp);
        o.usdg = new MockERC20("Quiver Test USDG (no value)", "tUSDG", 6);
        o.nvda = new MockERC20("Quiver Test NVDA (no value)", "tNVDA", 18);
        o.pool = new MockPool(o.usdg, o.nvda);
        o.fUsdg = new MockAggregator("tUSDG / USD (test)"); o.fNvda = new MockAggregator("tNVDA / USD (test)");
        o.fUsdg.push(1e8, block.timestamp); o.fNvda.push(200e8, block.timestamp);
        o.usdg.mint(lp, seedNvda * 200e6); o.nvda.mint(lp, seedNvda * 1e18);
        o.usdg.approve(address(o.pool), type(uint256).max); o.nvda.approve(address(o.pool), type(uint256).max);
        o.pool.addLiquidity(seedNvda * 200e6, seedNvda * 1e18);
        vm.stopBroadcast();
    }
}
