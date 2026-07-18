// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";
import {BasketRouter} from "../../src/BasketRouter.sol";

/// @dev Malicious adapter: tries to re-enter the router mid-swap. The router's
/// nonReentrant guard must make the outer call revert.
contract ReentrantAdapter is ISwapAdapter {
    BasketRouter public router;
    address public token;

    function set(BasketRouter r, address t) external {
        router = r;
        token = t;
    }

    function swapExactIn(address, address, uint256, uint256, address) external returns (uint256) {
        BasketRouter.BuyLeg[] memory legs = new BasketRouter.BuyLeg[](1);
        legs[0] = BasketRouter.BuyLeg({token: token, stableIn: 1, minTokenOut: 0});
        router.buyBasket(legs, type(uint256).max); // must revert (ReentrancyGuard)
        return 0;
    }
}
