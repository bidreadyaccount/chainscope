// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Swap adapter the router calls to execute one leg of a basket.
/// @notice The router holds `amountIn` of `tokenIn` and approves the adapter for it.
/// An implementation pulls `amountIn` from `msg.sender` (the router) via
/// `transferFrom`, performs the swap, sends the output to `to`, and MUST revert if
/// the output is below `minAmountOut`. This is the seam between the router and a
/// concrete DEX (Uniswap, etc.); the mock used in tests implements it directly.
interface ISwapAdapter {
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external returns (uint256 amountOut);
}
