# RWAI v3 without direct administrator mint

This project has the same Hardhat/deployment layout as the supplied vendor v3.
The token's only executable change is removal of direct administrator mint and
its related state/getter, event and unused error. See AUDIT_NOTES.txt.

## Install and compile

Use a Node.js version supported by the locked Hardhat toolchain.

```bash
npm ci --ignore-scripts
npm run compile
```

Compiler: Solidity 0.8.22, optimizer 200 runs, viaIR=true, EVM target paris.
The exact audit input is verify/RWAIOFT.input.json, containing all 56 production
sources. It also sets metadata.useLiteralContent=true. Use that exact Standard
JSON input when reproducing the compiled artifact supplied for the new audit.
The vendor Hardhat/deployment configuration is preserved in this package.

Token source SHA-256:
b0a8e0cae6efdd6a86ce2714d2597095662f64974a76a45f9c12a3296695e528

## Deployment inputs

Copy .env.example to .env only in your private signing environment. Do not share
wallet keys or commit .env. Use either PRIVATE_KEY or MNEMONIC; if both are set,
the unchanged vendor configuration gives MNEMONIC priority.

Set ADMIN explicitly on every chain. It is the initial owner and LayerZero
delegate, and receives the constructor's 1B RWAI on native chain 56 or 97.
Other chains start with zero constructor supply. Ownership transfer does not
move the previous ADMIN's token balance. Verify that the intended multisig is
actually deployed and controllable on that chain.

Optional RPC/Endpoint overrides are commented out in the example. Leaving them
as empty strings would override the vendor's default values and may cause errors.
Always verify the official local Endpoint, native chain ID and Endpoint EID.
The deployment script checks Endpoint code existence, not official authenticity.

## Deploy

The original commands remain available for the user's own controlled deployment:

```bash
npm run deploy_testnet
npm run deploy_mainnet
```

No deployment, ownership renouncement or live transaction was performed when
preparing this package. contracts/RWAIOFT.sol is the only production contract.

## Configure before public use

1. Verify the deployed code, constructor arguments, owner, pendingOwner, Endpoint
   delegate, initial balances and supply against the deployment plan.
2. Set and verify both directions' message libraries, DVNs, confirmations,
   Executor and enforced gas options. Do not leave unintended protocol defaults.
3. Independently review both remote token addresses and their mint/upgrade/admin
   rights. Register reciprocal peers only after the final check. Existing v3
   peers cannot be replaced or deleted, even by the owner.
4. Test real small round trips and failed-receive recovery before public use.
5. Keep the owner if future direct peer additions are needed. Renouncement is
   irreversible and is NOT an automatic final step. Direct mint is already absent.

## Audit and regression evidence

audit/ contains the exact compiled ABI/bytecode, change diff, test scripts and
final regression results. The test fixture is NOT a production deployment source.
There is no old vendor audit PDF presented as approval for this modified code.

To reproduce the exact Standard JSON build, obtain the official compiler JS:
https://binaries.soliditylang.org/wasm/soljson-v0.8.22+commit.4fc1097e.js
SHA-256: 92d283c545395b91a656fa1ec94d567a464bca55aebcdbb99debf42b43026845

```bash
node audit/tools/recompile.cjs /absolute/path/to/soljson-v0.8.22+commit.4fc1097e.js
node audit/tools/run-local-tests.cjs /absolute/path/to/soljson-v0.8.22+commit.4fc1097e.js
```

These commands use root node_modules, load no .env and run local mock-based tests
only. They do not broadcast transactions. See AUDIT_NOTES.txt for scope and limits.
