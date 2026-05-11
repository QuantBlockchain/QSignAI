# Contributing

Thanks for your interest in contributing to Telegram Photo Wall!

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Follow the [Local Development Guide](docs/local-development.md) to set up your environment
4. Create a feature branch from `main`

## Development Workflow

```bash
# Install dependencies
npm install
cd photo-wall && npm install && cd ..

# Run locally (requires AWS credentials + deployed stack)
./scripts/setup-local-env.sh
cd photo-wall && npm run dev

# Build before submitting
cd photo-wall && npm run build && cd ..

# Lint & type-check
cd photo-wall && npx tsc --noEmit && cd ..
```

## Pull Request Process

1. Create a descriptive branch name (e.g., `feat/video-support`, `fix/webhook-timeout`)
2. Make focused, atomic commits with clear messages
3. Ensure `npm run build` succeeds without errors
4. Update documentation if you change API interfaces or add features
5. Open a PR against `main` with:
   - Summary of what changed and why
   - Test plan (how you verified it works)
   - Screenshots for UI changes

## Code Style

- TypeScript strict mode
- No hardcoded secrets or credentials
- Sanitize all user input (see `src/lib/sanitize.ts`)
- Environment-specific config via environment variables, not code

## Architecture Decisions

- All secrets live in AWS Secrets Manager, never in environment variables or code
- Telegram webhook validation is mandatory (secret token header check)
- Admin endpoints require Bearer token authentication
- Photos are stored in S3 with pre-signed URLs for access
- Quantum signatures use AWS Braket SV1 with local crypto fallback

## Reporting Issues

- Use GitHub Issues for bugs and feature requests
- Include steps to reproduce for bugs
- Include expected vs actual behavior

## Security

If you discover a security vulnerability, please do NOT open a public issue. Instead, email the maintainers directly.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
