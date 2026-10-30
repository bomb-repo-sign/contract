import 'dotenv/config'
import '@nomicfoundation/hardhat-ethers'
import 'hardhat-deploy'

import type { HardhatUserConfig } from 'hardhat/config'

const accounts = process.env.MNEMONIC
    ? { mnemonic: process.env.MNEMONIC }
    : process.env.PRIVATE_KEY
      ? [process.env.PRIVATE_KEY]
      : []

const config: HardhatUserConfig = {
    solidity: {
        version: '0.8.22',
        settings: {
            optimizer: { enabled: true, runs: 200 },
            viaIR: true,
            evmVersion: 'paris',
        },
    },
    networks: {
        bsc: { url: process.env.RPC_URL_BSC ?? 'https://bsc-dataseed.bnbchain.org', chainId: 56, accounts },
        bsctestnet: {
            url: process.env.RPC_URL_BSC_TESTNET ?? 'https://bsc-testnet-dataseed.bnbchain.org',
            chainId: 97,
            accounts,
        },
    },
    namedAccounts: {
        deployer: { default: 0 },
    },
}

export default config
