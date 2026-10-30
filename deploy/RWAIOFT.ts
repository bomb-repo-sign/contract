import type { DeployFunction } from 'hardhat-deploy/types'

const LZ_ENDPOINT_MAINNET = '0x1a44076050125825900e736c501f859c50fE728c'
const LZ_ENDPOINT_TESTNET = '0x6EDCE65403992e310A62460808c4b910D972f10f'
const TESTNETS = new Set([97, 11155111, 421614, 84532, 11155420])

const deploy: DeployFunction = async ({ getNamedAccounts, getChainId, deployments, network, ethers }) => {
    const { deployer } = await getNamedAccounts()
    if (!deployer) throw new Error('no deployer, set PRIVATE_KEY or MNEMONIC in .env')

    const chainId = Number(await getChainId())
    const endpoint = process.env.LZ_ENDPOINT ?? (TESTNETS.has(chainId) ? LZ_ENDPOINT_TESTNET : LZ_ENDPOINT_MAINNET)

    if (chainId === 56 && !process.env.ADMIN) throw new Error('set ADMIN (multisig) before deploying to BNB mainnet')
    const admin = process.env.ADMIN || deployer
    if (!ethers.isAddress(admin)) throw new Error(`ADMIN is not an address: ${admin}`)
    if ((await ethers.provider.getCode(endpoint)) === '0x') throw new Error(`no endpoint code at ${endpoint}`)

    console.log(`network  ${network.name} (${chainId})`)
    console.log(`endpoint ${endpoint}`)
    console.log(`admin    ${admin}${chainId === 56 || chainId === 97 ? '  <- receives 1,000,000,000 RWAI' : ''}`)

    const { address } = await deployments.deploy('RWAIOFT', {
        from: deployer,
        args: [endpoint, admin],
        log: true,
    })

    console.log(`RWAIOFT  ${address}`)
}

deploy.tags = ['RWAIOFT']

export default deploy
