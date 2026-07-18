// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";

/// @title BasketRouter — non-custodial one-click buy / sell / rebalance of a basket.
/// @notice Executes a plan produced off-chain by the ChainScope trade planner. The
/// router NEVER holds funds between transactions: within a single call it pulls the
/// caller's tokens/stablecoin, swaps through a configured adapter, and settles the
/// results straight back to the caller (leftover stablecoin is refunded). It cannot
/// move a user's funds without their ERC-20 approval, and it holds no keys.
///
/// Guardrails: every traded token must be registered by the operator (`allowedToken`)
/// so the router can't be pointed at an arbitrary/malicious token; an optional user
/// allowlist gates access where eligibility rules require it (e.g. tokenized-stock
/// restrictions); each leg carries its own `minOut` (slippage) and the whole call a
/// `deadline`; and it is reentrancy-guarded and pausable.
contract BasketRouter is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    /// @dev Buy `token` with `stableIn` stablecoin, requiring at least `minTokenOut`.
    struct BuyLeg {
        address token;
        uint256 stableIn;
        uint256 minTokenOut;
    }

    /// @dev Sell `tokenIn` of `token`, requiring at least `minStableOut` stablecoin.
    struct SellLeg {
        address token;
        uint256 tokenIn;
        uint256 minStableOut;
    }

    /// The stablecoin every basket is priced/settled in (e.g. USDC). Immutable.
    IERC20 public immutable stablecoin;
    /// The DEX adapter the router swaps through. Operator-settable.
    ISwapAdapter public adapter;
    /// When true, only allowlisted users may trade (eligibility gate).
    bool public userAllowlistEnabled;
    /// Tokens the operator has registered as tradable.
    mapping(address => bool) public allowedToken;
    /// Users cleared to trade when the allowlist is enabled.
    mapping(address => bool) public allowedUser;

    event Bought(address indexed user, address indexed token, uint256 stableIn, uint256 tokenOut);
    event Sold(address indexed user, address indexed token, uint256 tokenIn, uint256 stableOut);
    event Rebalanced(address indexed user, uint256 cashIn, uint256 stableRefunded, uint256 sells, uint256 buys);
    event AdapterSet(address indexed adapter);
    event TokenAllowed(address indexed token, bool allowed);
    event UserAllowlistEnabled(bool enabled);
    event UserAllowed(address indexed user, bool allowed);

    error Empty();
    error Expired();
    error NoAdapter();
    error TokenNotAllowed(address token);
    error NotEligible(address user);
    error ZeroAmount();

    constructor(IERC20 stablecoin_, ISwapAdapter adapter_) Ownable(msg.sender) {
        require(address(stablecoin_) != address(0), "stablecoin=0");
        stablecoin = stablecoin_;
        adapter = adapter_;
        emit AdapterSet(address(adapter_));
    }

    // --------------------------------------------------------------------- admin

    function setAdapter(ISwapAdapter a) external onlyOwner {
        adapter = a;
        emit AdapterSet(address(a));
    }

    function setTokenAllowed(address token, bool ok) public onlyOwner {
        allowedToken[token] = ok;
        emit TokenAllowed(token, ok);
    }

    function setTokensAllowed(address[] calldata tokens, bool ok) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) setTokenAllowed(tokens[i], ok);
    }

    function setUserAllowlistEnabled(bool enabled) external onlyOwner {
        userAllowlistEnabled = enabled;
        emit UserAllowlistEnabled(enabled);
    }

    function setUserAllowed(address user, bool ok) external onlyOwner {
        allowedUser[user] = ok;
        emit UserAllowed(user, ok);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    modifier eligible() {
        if (userAllowlistEnabled && !allowedUser[msg.sender]) revert NotEligible(msg.sender);
        _;
    }

    // ----------------------------------------------------------------------- buy

    /// @notice Spend `stableIn` per leg on the target tokens, delivered to the caller.
    function buyBasket(BuyLeg[] calldata legs, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        eligible
        returns (uint256 totalStableIn)
    {
        _preflight(deadline, legs.length);
        for (uint256 i; i < legs.length; ++i) totalStableIn += legs[i].stableIn;
        if (totalStableIn == 0) revert ZeroAmount();

        stablecoin.safeTransferFrom(msg.sender, address(this), totalStableIn);
        ISwapAdapter a = adapter;
        for (uint256 i; i < legs.length; ++i) {
            BuyLeg calldata leg = legs[i];
            if (!allowedToken[leg.token]) revert TokenNotAllowed(leg.token);
            if (leg.stableIn == 0) revert ZeroAmount();
            stablecoin.forceApprove(address(a), leg.stableIn);
            uint256 out = a.swapExactIn(address(stablecoin), leg.token, leg.stableIn, leg.minTokenOut, msg.sender);
            emit Bought(msg.sender, leg.token, leg.stableIn, out);
        }
        stablecoin.forceApprove(address(a), 0);
        _refundStable(); // return any un-spent stablecoin; router holds nothing after
    }

    // ---------------------------------------------------------------------- sell

    /// @notice Sell `tokenIn` per leg back to stablecoin, delivered to the caller.
    function sellBasket(SellLeg[] calldata legs, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        eligible
        returns (uint256 totalStableOut)
    {
        _preflight(deadline, legs.length);
        ISwapAdapter a = adapter;
        for (uint256 i; i < legs.length; ++i) {
            SellLeg calldata leg = legs[i];
            if (!allowedToken[leg.token]) revert TokenNotAllowed(leg.token);
            if (leg.tokenIn == 0) revert ZeroAmount();
            IERC20 tok = IERC20(leg.token);
            tok.safeTransferFrom(msg.sender, address(this), leg.tokenIn);
            tok.forceApprove(address(a), leg.tokenIn);
            uint256 out = a.swapExactIn(leg.token, address(stablecoin), leg.tokenIn, leg.minStableOut, msg.sender);
            tok.forceApprove(address(a), 0);
            totalStableOut += out;
            emit Sold(msg.sender, leg.token, leg.tokenIn, out);
        }
    }

    // ------------------------------------------------------------------ rebalance

    /// @notice Rebalance in one call: run every sell to stablecoin, then fund the buys
    /// from those proceeds plus optional `cashInStable`, delivering bought tokens to the
    /// caller and refunding any leftover stablecoin. Atomic — all legs succeed or none do.
    function rebalance(
        SellLeg[] calldata sells,
        BuyLeg[] calldata buys,
        uint256 cashInStable,
        uint256 deadline
    ) external nonReentrant whenNotPaused eligible returns (uint256 stableRefunded) {
        if (block.timestamp > deadline) revert Expired();
        if (sells.length + buys.length == 0) revert Empty();
        if (address(adapter) == address(0)) revert NoAdapter();
        ISwapAdapter a = adapter;

        if (cashInStable > 0) stablecoin.safeTransferFrom(msg.sender, address(this), cashInStable);

        for (uint256 i; i < sells.length; ++i) {
            SellLeg calldata leg = sells[i];
            if (!allowedToken[leg.token]) revert TokenNotAllowed(leg.token);
            if (leg.tokenIn == 0) revert ZeroAmount();
            IERC20 tok = IERC20(leg.token);
            tok.safeTransferFrom(msg.sender, address(this), leg.tokenIn);
            tok.forceApprove(address(a), leg.tokenIn);
            // Proceeds accrue to the router to fund the buys below.
            uint256 out = a.swapExactIn(leg.token, address(stablecoin), leg.tokenIn, leg.minStableOut, address(this));
            tok.forceApprove(address(a), 0);
            emit Sold(msg.sender, leg.token, leg.tokenIn, out);
        }

        for (uint256 i; i < buys.length; ++i) {
            BuyLeg calldata leg = buys[i];
            if (!allowedToken[leg.token]) revert TokenNotAllowed(leg.token);
            if (leg.stableIn == 0) revert ZeroAmount();
            stablecoin.forceApprove(address(a), leg.stableIn);
            uint256 out = a.swapExactIn(address(stablecoin), leg.token, leg.stableIn, leg.minTokenOut, msg.sender);
            emit Bought(msg.sender, leg.token, leg.stableIn, out);
        }
        stablecoin.forceApprove(address(a), 0);

        stableRefunded = _refundStable();
        emit Rebalanced(msg.sender, cashInStable, stableRefunded, sells.length, buys.length);
    }

    // ------------------------------------------------------------------ internal

    function _preflight(uint256 deadline, uint256 n) internal view {
        if (block.timestamp > deadline) revert Expired();
        if (n == 0) revert Empty();
        if (address(adapter) == address(0)) revert NoAdapter();
    }

    /// Return any stablecoin the router is holding to the caller (should be ~0).
    function _refundStable() internal returns (uint256 bal) {
        bal = stablecoin.balanceOf(address(this));
        if (bal > 0) stablecoin.safeTransfer(msg.sender, bal);
    }
}
