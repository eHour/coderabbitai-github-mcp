# CodeRabbit MCP Server

An MCP (Model Context Protocol) server that automates the resolution of CodeRabbit PR review comments using parallel agent architecture.

## Features

- 🚀 **Parallel Processing**: Analyzes multiple review threads simultaneously using worker pools
- 🤖 **Intelligent Validation**: Hybrid approach using heuristics and optional LLM validation
- 🔄 **CI/CD Integration**: Waits for CI checks before resolving threads
- 🛡️ **Safe Rollback**: Automatically reverts commits if CI fails
- 📊 **Progress Tracking**: Real-time monitoring of thread resolution status
- 🔍 **Dry Run Mode**: Preview actions without making changes

## Architecture

The system uses a parallel agent architecture with specialized agents:

- **Orchestrator Agent**: Coordinates all operations and manages workflow
- **Thread Analyzer Agents** (Pool): Validate CodeRabbit findings in parallel
- **Code Patcher Agent**: Applies fixes sequentially to avoid conflicts
- **GitHub API Agent**: Manages all GitHub GraphQL/REST API interactions
- **Monitor Agent**: Tracks CI status and polls for updates

## Installation

```bash
npm install -g mcp-coderabbit
```

Or run directly with npx:

```bash
npx mcp-coderabbit run --repo owner/name --pr 123
```

## Prerequisites

### GitHub Authentication

You need a GitHub token with appropriate permissions:

#### Fine-grained PAT
- Contents: Read and Write
- Pull requests: Read and Write
- Metadata: Read

#### Classic PAT
- Scope: `repo` (full control)

#### GitHub App
- Repository permissions: Contents (Read/Write), Pull requests (Read/Write), Metadata (Read)

Set your token as an environment variable:

```bash
export GITHUB_TOKEN=your_token_here
```

### Optional: LLM Configuration

For intelligent validation, configure an LLM provider:

```bash
# OpenAI
export OPENAI_API_KEY=your_key_here

# OR Anthropic
export ANTHROPIC_API_KEY=your_key_here
```

## Usage

### Basic Usage

```bash
# Process a specific PR
npx mcp-coderabbit run --repo owner/name --pr 123

# Dry run to preview actions
npx mcp-coderabbit run --repo owner/name --pr 123 --dry-run

# Custom settings
npx mcp-coderabbit run \
  --repo owner/name \
  --pr 123 \
  --max-iterations 5 \
  --max-workers 8 \
  --verbose
```

### CLI Options

- `--repo <repo>`: Repository in format owner/name (required)
- `--pr <number>`: Pull request number (required)
- `--max-iterations <n>`: Maximum processing iterations (default: 3)
- `--max-workers <n>`: Maximum parallel analyzers (default: 5)
- `--dry-run`: Preview actions without making changes
- `--verbose`: Enable verbose logging

### MCP Server Mode

You can also run as a standalone MCP server:

```bash
npx mcp-coderabbit server
```

This starts the MCP server that can be used by MCP clients.

#### Claude Desktop Configuration

To use with Claude Desktop app:

1. Copy the example configuration:
   ```bash
   cp claude_desktop_config.example.json claude_desktop_config.json
   ```

2. Edit `claude_desktop_config.json` and set your GitHub token:
   ```json
   {
     "mcpServers": {
       "coderabbit": {
         "command": "node",
         "args": ["./dist/server.js"],
         "env": {
           "GITHUB_TOKEN": "your_actual_token_here"
         }
       }
     }
   }
   ```

3. Add this configuration to your Claude Desktop settings

Note: The actual `claude_desktop_config.json` is gitignored to prevent accidental token commits.

## Configuration

Create a `coderabbit-mcp.json` file in your project root:

```json
{
  "parallelism": {
    "maxAnalyzers": 5,
    "threadTimeout": 30000,
    "batchSize": 10
  },
  "validation": {
    "llm": {
      "provider": "openai",
      "model": "gpt-4-turbo",
      "temperature": 0.2,
      "confidenceThreshold": 0.7
    },
    "autoAccept": [
      "security/*",
      "bug/*",
      "critical/*"
    ],
    "autoReject": [
      "*.min.js",
      "generated/*",
      "*.lock"
    ],
    "conventions": "./coding-standards.md"
  },
  "ci": {
    "waitTimeout": 600000,
    "checkInterval": 10000
  }
}
```

### Configuration Options

#### Parallelism
- `maxAnalyzers`: Number of parallel thread analyzers (1-20)
- `threadTimeout`: Timeout for analyzing a single thread (ms)
- `batchSize`: Maximum fixes to apply in one commit

#### Validation
- `llm`: Optional LLM configuration for intelligent validation
  - `provider`: "openai" or "anthropic"
  - `model`: Model name (e.g., "gpt-4-turbo")
  - `temperature`: LLM temperature (0-1)
  - `confidenceThreshold`: Minimum confidence to auto-apply (0-1)
- `autoAccept`: Patterns for auto-accepting suggestions
- `autoReject`: Patterns for auto-rejecting suggestions
- `conventions`: Path to coding standards document

#### CI
- `waitTimeout`: Maximum time to wait for CI checks (ms)
- `checkInterval`: How often to poll CI status (ms)

## Workflow

1. **Fetch PR Metadata**: Verify PR is open and not draft
2. **List Review Threads**: Get unresolved CodeRabbit comments
3. **Parallel Analysis**: Validate each finding concurrently
4. **Batch Fixes**: Apply all valid fixes in single commit
5. **CI Verification**: Wait for checks to pass
6. **Resolution**: Resolve threads or revert on failure
7. **Iteration**: Poll for updates and repeat

## Comment Templates

The tool uses specific templates when interacting with CodeRabbit:

- **Fix Applied**: `@coderabbitai Thanks. Applied the fix in commit {sha}`
- **Invalid Finding**: `@coderabbitai Thank you for the suggestion. We believe this is not valid because {reason}`
- **Needs Review**: `@coderabbitai This suggestion requires human review. Confidence: {percent}%`
- **CI Failed**: `@coderabbitai I attempted to apply the fix, but it failed CI. Reverted.`

## Decision Logic

### Automatic Acceptance
- Security vulnerabilities
- Critical bugs
- Matches auto-accept patterns

### Automatic Rejection
- Generated/minified files
- Binary files
- Matches auto-reject patterns

### LLM Validation
- When confidence > threshold: Apply fix
- When confidence < threshold: Request human review
- On error: Mark as unpatchable

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck
```

## Project Structure

```
src/
├── agents/           # Parallel agent implementations
├── lib/              # Core utilities
├── config/           # Configuration management
├── types/            # TypeScript definitions
├── server.ts         # MCP server entry point
└── cli.ts           # CLI entry point
```

## Troubleshooting

### Common Issues

1. **Authentication Error**: Ensure GITHUB_TOKEN is set correctly
2. **Working Directory Not Clean**: Commit or stash changes before running
3. **CI Timeout**: Increase `ci.waitTimeout` in configuration
4. **Rate Limiting**: Reduce `maxAnalyzers` to lower API usage

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
npx mcp-coderabbit run --repo owner/name --pr 123 --verbose
```

Set log file for persistent logging:

```bash
export LOG_FILE=coderabbit.log
```

## License

MIT

## Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

## Support

- Issues: [GitHub Issues](https://github.com/your-org/mcp-coderabbit/issues)
- Documentation: [Full Documentation](https://docs.your-org.com/mcp-coderabbit)

## Acknowledgments

Built with:
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
- [Octokit](https://github.com/octokit/octokit.js)
- [Simple Git](https://github.com/steveukx/git-js)