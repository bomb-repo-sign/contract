TEST FIXTURES ONLY - NOT PRODUCTION CONTRACTS

Run from the project root after npm ci --ignore-scripts:
node audit/tools/run-local-tests.cjs /absolute/path/to/soljson-v0.8.22+commit.4fc1097e.js

The wrapper compiles verify/RWAIOFT.input.json exactly, verifies production
creation/runtime bytecode against audit/build/RWAIOFT.json, and runs isolated
in-process Hardhat chains 56, 97 and 1. No .env or remote network is used.
ReviewEndpoint.sol deliberately permits trusted-message injection to demonstrate
remaining bridge trust risk. It is excluded from the production compiler input.
