# ZkVanguard ZKP Engine

Post-quantum ZK-STARK proof generation and verification engine.

## Overview

This repository contains the zero-knowledge proof system for ZkVanguard:

- **True STARK Protocol** - AIR (Algebraic Intermediate Representation) + FRI
- **Quantum Resistance** - NIST P-521 certified prime (521-bit security)
- **No Trusted Setup** - Transparent proofs
- **CUDA Acceleration** - Optional GPU acceleration

## Architecture

`
zkp/
├── core/
│   ├── true_stark.py      # Real STARK implementation
│   ├── zk_system.py       # Enhanced privacy features
│   └── stark_compat.py    # Backward compatibility
├── api/
│   └── server.py          # REST API for proof generation
├── cli/
│   ├── generate_proof.py  # CLI proof generation
│   └── verify_proof.py    # CLI verification
└── tests/
    └── test_stark.py      # Python tests

zk/
├── prover/
│   └── ProofGenerator.ts  # TypeScript wrapper
└── verifier/
    └── ProofValidator.ts  # TypeScript wrapper
`

## Usage

### Generate Proof
`ash
python zkp/cli/generate_proof.py --input data.json --output proof.json
`

### Verify Proof
`ash
python zkp/cli/verify_proof.py --proof proof.json
`

### API Server
`ash
python zkp/api/server.py
# POST /generate-proof, GET /verify-proof
`

## Security

- Post-quantum secure (resistant to Shor's algorithm)
- 521-bit prime field for maximum security
- Formal verification available

## License

Apache License 2.0

## Related Repositories

- [ZkVanguard](https://github.com/ZkVanguard/ZkVanguard) - Main application
- [contracts-evm](https://github.com/ZkVanguard/contracts-evm) - Solidity contracts
- [contracts-sui](https://github.com/ZkVanguard/contracts-sui) - Move contracts
- [ai-agents](https://github.com/ZkVanguard/ai-agents) - AI agent swarm
