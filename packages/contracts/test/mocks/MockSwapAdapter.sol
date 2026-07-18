// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";

/// @dev Oracle-priced swap for tests. Prices are USD with 1e18 scale. The adapter
/// holds its own liquidity (mint tokens to it in the test). `feeBps` shaves the
/// output to simulate slippage so `minAmountOut` reverts can be exercised.
contract MockSwapAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public priceUsd18; // token => USD price, 1e18 scale
    uint256 public feeBps;

    function setPrice(address token, uint256 price) external {
        priceUsd18[token] = price;
    }

    function setFeeBps(uint256 f) external {
        feeBps = f;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 pIn = priceUsd18[tokenIn];
        uint256 pOut = priceUsd18[tokenOut];
        require(pIn > 0 && pOut > 0, "no price");
        uint256 dIn = IERC20Metadata(tokenIn).decimals();
        uint256 dOut = IERC20Metadata(tokenOut).decimals();
        uint256 out = (amountIn * pIn * (10 ** dOut)) / ((10 ** dIn) * pOut);
        return (out * (10_000 - feeBps)) / 10_000;
    }

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external returns (uint256 amountOut) {
        amountOut = quote(tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "slippage");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }
}
