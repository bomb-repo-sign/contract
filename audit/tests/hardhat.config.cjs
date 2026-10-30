// Local-only test configuration; no dotenv, wallet secrets or remote RPC URLs.
const path = require('path');
const { dependency } = require('./runtime.cjs');
dependency('@nomicfoundation/hardhat-ethers');
const chainId = Number(process.env.RWAI_TEST_CHAIN_ID || 56);
if (![56, 97, 1].includes(chainId)) throw new Error('Only local test chain IDs 56, 97 and 1 are supported.');
module.exports = {
  defaultNetwork: 'hardhat',
  networks: { hardhat: { chainId } },
  paths: { root: __dirname, sources: path.join(__dirname, 'unused-sources'), tests: path.join(__dirname, 'unused-tests'), artifacts: path.join(__dirname, 'hh-artifacts'), cache: path.join(__dirname, 'hh-cache') },
  solidity: { version: '0.8.22' }
};
