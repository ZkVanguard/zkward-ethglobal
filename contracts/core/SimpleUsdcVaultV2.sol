// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleUsdcVaultV2
 * @notice SimpleUsdcVault + EIP-2612 depositWithPermit path.
 *
 * Backward-compatible with V1's ABI (same deposit/withdraw signatures,
 * same events, same share math) so the frontend + subgraph stay
 * unchanged. Adds ONE function:
 *
 *   depositWithPermit(amount, deadline, v, r, s)
 *
 * The user signs a permit message OFF-CHAIN (no popup for a tx, just a
 * signature). The vault calls permit() then transferFrom() in one on-chain
 * tx. Net UX: one signature + one tx-confirmation popup (or zero
 * confirmation for embedded wallets like Privy) instead of the classic
 * approve+deposit two-popup flow.
 *
 * Requires the deposit token to implement EIP-2612 (IERC20Permit).
 * MockERC20Permit (this repo) does. Circle's real USDC also does.
 */
contract SimpleUsdcVaultV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable depositToken;
    uint256 public totalShares;
    uint256 public memberCount;

    mapping(address => uint256) public sharesOf;

    event Deposited(address indexed member, uint256 amount, uint256 shares);
    event Withdrawn(address indexed member, uint256 shares, uint256 amount);

    error ZeroAmount();
    error InsufficientShares();

    constructor(address _depositToken) Ownable(msg.sender) {
        require(_depositToken != address(0), "zero deposit token");
        depositToken = IERC20(_depositToken);
    }

    // ─── Views ──────────────────────────────────────────────────────────
    function totalAssets() public view returns (uint256) {
        return depositToken.balanceOf(address(this));
    }

    function getPoolStats()
        external
        view
        returns (
            uint256 _totalShares,
            uint256 _totalNAV,
            uint256 _memberCount,
            uint256 _sharePrice,
            uint256[4] memory _allocations
        )
    {
        _totalShares = totalShares;
        _totalNAV = totalAssets();
        _memberCount = memberCount;
        _sharePrice = totalShares == 0 ? 1e6 : (_totalNAV * 1e6) / totalShares;
        _allocations = [uint256(10000), 0, 0, 0];
    }

    function getMemberCount() external view returns (uint256) {
        return memberCount;
    }

    // ─── Internal share math ───────────────────────────────────────────
    function _pullAndMint(uint256 amount) internal returns (uint256 shares) {
        uint256 before = totalAssets();
        depositToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualDeposit = totalAssets() - before;

        shares = (actualDeposit * (totalShares + 1)) / (before + 1);
        require(shares > 0, "zero shares");

        if (sharesOf[msg.sender] == 0) {
            memberCount += 1;
        }
        sharesOf[msg.sender] += shares;
        totalShares += shares;

        emit Deposited(msg.sender, actualDeposit, shares);
    }

    // ─── Mutations ──────────────────────────────────────────────────────

    /// @notice Classic two-tx flow: approve() first, then deposit().
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        return _pullAndMint(amount);
    }

    /// @notice Single-tx flow: permit signature + deposit atomically.
    /// The user signs the permit message off-chain (EIP-2612); the vault
    /// consumes it here. `owner` is implicit (msg.sender) — enforces
    /// that the signer is the one depositing.
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        // Best-effort permit — if it reverts because a prior permit
        // already covered the allowance (e.g. user retried after a
        // failed deposit but before the permit expired), fall through
        // to the transferFrom which will succeed on existing allowance.
        try IERC20Permit(address(depositToken)).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        ) {} catch {}
        return _pullAndMint(amount);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (sharesOf[msg.sender] < shares) revert InsufficientShares();

        uint256 assets = totalAssets();
        amount = (shares * (assets + 1)) / (totalShares + 1);
        require(amount > 0, "zero payout");

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        if (sharesOf[msg.sender] == 0) {
            memberCount -= 1;
        }

        depositToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, shares, amount);
    }

    function members(address who)
        external
        view
        returns (
            uint256 shares,
            uint256 depositedUSD,
            uint256 withdrawnUSD,
            uint256 joinTime
        )
    {
        shares = sharesOf[who];
        depositedUSD = 0;
        withdrawnUSD = 0;
        joinTime = 0;
    }
}
