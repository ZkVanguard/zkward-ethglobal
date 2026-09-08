// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title MockERC20Permit
 * @notice MockERC20 + EIP-2612 permit — enables single-popup vault deposits.
 *
 * Adds signature-based approval (approve without an on-chain tx). Paired
 * with SimpleUsdcVaultV2.depositWithPermit(), a deposit becomes ONE tx
 * from the user's wallet (the vault calls permit + deposit atomically).
 *
 * The mint/burn helpers are unchanged from MockERC20 for faucet + demo
 * compatibility.
 */
contract MockERC20Permit is ERC20, ERC20Permit {
    uint8 private _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
