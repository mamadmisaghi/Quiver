// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {MockERC20} from "./MockERC20.sol";

/// @notice TEST-ONLY constant-product pool (x*y=k, 0.30% fee), Uniswap-v2 style. Local anvil only.
contract MockPool {
    MockERC20 public immutable token0; MockERC20 public immutable token1;
    uint256 public reserve0; uint256 public reserve1;
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);
    constructor(MockERC20 t0, MockERC20 t1) { token0 = t0; token1 = t1; }
    function addLiquidity(uint256 a0, uint256 a1) external {
        token0.transferFrom(msg.sender, address(this), a0); token1.transferFrom(msg.sender, address(this), a1);
        reserve0 += a0; reserve1 += a1;
    }
    function quote(address tokenIn, uint256 amountIn) public view returns (uint256) {
        (uint256 rIn, uint256 rOut) = tokenIn == address(token0) ? (reserve0, reserve1) : (reserve1, reserve0);
        uint256 inFee = amountIn * 997;
        return (inFee * rOut) / (rIn * 1000 + inFee);
    }
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to, uint256 deadline) external returns (uint256 out) {
        require(block.timestamp <= deadline, "deadline");
        require(tokenIn == address(token0) || tokenIn == address(token1), "token");
        out = quote(tokenIn, amountIn);
        require(out >= minOut, "slippage");
        bool zeroIn = tokenIn == address(token0);
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        (zeroIn ? token1 : token0).transfer(to, out);
        if (zeroIn) { reserve0 += amountIn; reserve1 -= out; } else { reserve1 += amountIn; reserve0 -= out; }
        emit Swap(msg.sender, tokenIn, amountIn, out, to);
    }
}
