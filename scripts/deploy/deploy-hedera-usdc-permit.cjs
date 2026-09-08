/**
 * Deploy Hedera-testnet USDC-with-permit + SimpleUsdcVaultV2 in one shot.
 *
 * V2 upgrade: adds EIP-2612 permit to the USDC mock + a depositWithPermit
 * path on the vault → single-popup deposits from Privy embedded wallets.
 * Old V1 pool (0xe7E6…9A9) stays live but gets deprecated in the frontend.
 *
 * Steps:
 *   1. Deploy MockERC20Permit as "USD Coin" (USDC, 6 decimals).
 *   2. Mint 10,000 USDC to the deployer.
 *   3. Deploy SimpleUsdcVaultV2 pointing at the new USDC.
 *   4. Print a machine-readable block ready to paste into
 *      lib/contracts/addresses.ts (HEDERA_CONTRACT_ADDRESSES.testnet).
 *
 * Prereq:
 *   PRIVATE_KEY — deployer wallet with ≥0.5 HBAR
 *
 * Run:
 *   npx hardhat run scripts/deploy/deploy-hedera-usdc-permit.cjs --network hedera-testnet
 */

const { ethers } = require('hardhat');

const NETWORK_NAME = 'Hedera Testnet';
const CHAIN_ID = 296;

const USDC_NAME = 'USD Coin';
const USDC_SYMBOL = 'USDC';
const USDC_DECIMALS = 6;
const MINT_HUMAN_UNITS = 10_000;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`   HEDERA USDC + VAULT V2 (permit) — ${NETWORK_NAME}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Deployer:', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance :', ethers.formatEther(balance), 'HBAR');
  if (balance < ethers.parseEther('0.5')) {
    throw new Error('Deployer needs ≥0.5 HBAR');
  }

  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Expected chainId ${CHAIN_ID}, got ${network.chainId}`);
  }

  // Hedera Hashio min gas price is ~350 gwei. Old deploys used 20000 gwei
  // × 15M gas = 300 HBAR max per tx — too aggressive; drains the deployer
  // wallet's headroom even though actual cost is < 1 HBAR. Cap at 700 gwei
  // × 5M gas = 3.5 HBAR max, plenty for a MockERC20 or vault deploy.
  // Hashio min gas price fluctuates (was 1110 gwei at deploy time); use
  // 1500 gwei for headroom. 5M gas × 1500 gwei = 7.5 HBAR max per tx.
  const feeOverrides = {
    gasLimit: 5_000_000,
    maxFeePerGas: ethers.parseUnits('1500', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
    type: 2,
  };

  // ─── Step 1: Deploy USDC-with-permit ─────────────────────────────────
  console.log('\n🪙  Deploying MockERC20Permit as USDC...');
  const MockERC20Permit = await ethers.getContractFactory('MockERC20Permit');
  const usdc = await MockERC20Permit.deploy(USDC_NAME, USDC_SYMBOL, USDC_DECIMALS, feeOverrides);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log('   USDC :', usdcAddress);

  // Sanity: DOMAIN_SEPARATOR must be non-zero (permit setup went through)
  const domainSeparator = await usdc.DOMAIN_SEPARATOR();
  console.log('   DOMAIN_SEPARATOR:', domainSeparator);
  if (domainSeparator === ethers.ZeroHash) {
    throw new Error('DOMAIN_SEPARATOR is zero — permit initialisation failed');
  }

  // ─── Step 2: Mint test USDC to deployer ───────────────────────────────
  const mintAmount = ethers.parseUnits(String(MINT_HUMAN_UNITS), USDC_DECIMALS);
  console.log(`\n💰 Minting ${MINT_HUMAN_UNITS.toLocaleString()} USDC to deployer...`);
  const mintTx = await usdc.mint(deployer.address, mintAmount, feeOverrides);
  await mintTx.wait();
  const deployerUsdc = await usdc.balanceOf(deployer.address);
  console.log('   Deployer USDC:', ethers.formatUnits(deployerUsdc, USDC_DECIMALS));

  // ─── Step 3: Deploy SimpleUsdcVaultV2 ─────────────────────────────────
  console.log('\n🏦 Deploying SimpleUsdcVaultV2...');
  const Vault = await ethers.getContractFactory('SimpleUsdcVaultV2');
  const vault = await Vault.deploy(usdcAddress, feeOverrides);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log('   Vault:', vaultAddress);

  // ─── Step 4: Sanity ──────────────────────────────────────────────────
  const readToken = await vault.depositToken();
  if (readToken.toLowerCase() !== usdcAddress.toLowerCase()) {
    throw new Error('depositToken mismatch');
  }
  console.log('   ✓ vault.depositToken == USDC');

  // ─── Output block ─────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   DONE — paste into lib/contracts/addresses.ts');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(JSON.stringify({
    chain: 'hedera',
    network: 'testnet',
    chainId: CHAIN_ID,
    deployer: deployer.address,
    usdc: usdcAddress,
    usdcDecimals: USDC_DECIMALS,
    communityPool: vaultAddress,
    mintedToDeployer: MINT_HUMAN_UNITS,
    permitEnabled: true,
    hashscanUsdc: `https://hashscan.io/testnet/contract/${usdcAddress}`,
    hashscanVault: `https://hashscan.io/testnet/contract/${vaultAddress}`,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
