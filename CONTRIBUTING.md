# Contributing to LetsPay

Thank you for your interest in contributing to LetsPay! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- Rust (latest stable)
- Node.js and pnpm
- Soroban CLI
- Circom (for circuit development)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/FurtPay/LetsPay.git
   cd LetsPay
   ```

2. Install dependencies:
   ```bash
   # Install Rust dependencies
   cargo build

   # Install Node.js dependencies
   pnpm install
   ```

3. Build the circuits (if needed):
   ```bash
   cd circuits
   ./setup_ceremony.sh
   ```

## Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (see [Commit Guidelines](#commit-guidelines))
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## Project Structure

```
├── circuits/              # Circom zero-knowledge circuits
├── client/               # Next.js frontend application
├── contracts/            # Soroban smart contracts
│   ├── payroll_verifier/
│   └── salary_bracket_verifier/
├── deployments/          # Deployment scripts
├── docs/                 # Documentation
└── scripts/              # Utility scripts
```

## Testing

### Smart Contracts

```bash
# Test payroll verifier
cd contracts/payroll_verifier
cargo test

# Test salary bracket verifier
cd contracts/salary_bracket_verifier
cargo test
```

### Frontend

```bash
cd client
pnpm test
```

### Circuits

```bash
cd circuits
circom deposit_new.circom --r1cs --wasm --sym
```

## Commit Guidelines

- Use clear, descriptive commit messages
- Start with a verb (e.g., "Add", "Fix", "Update")
- Keep the first line under 50 characters
- Add more detail in the body if needed

Examples:
- `Add payroll verifier contract`
- `Fix income proof generation bug`
- `Update README with new features`

## Pull Request Process

1. Ensure your code follows the project's style guidelines
2. Write or update tests as needed
3. Update documentation if applicable
4. Ensure all tests pass
5. Update the CHANGELOG if relevant
6. Request review from maintainers

### PR Checklist

- [ ] Code follows project style
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] No merge conflicts

## Questions?

Feel free to open an issue for questions or discussion about potential contributions.
