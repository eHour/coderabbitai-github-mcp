# CodeRabbit MCP Server

An MCP (Model Context Protocol) server that enables AI assistants to interact with CodeRabbit PR review comments on GitHub. This tool bridges the gap between CodeRabbit's automated reviews and AI-powered resolution.

## Features

- 🔍 **Review Thread Management**: Fetch, analyze, and respond to CodeRabbit review comments
- 🤖 **Intelligent Validation**: Validate suggestions using AI before applying fixes
- ✅ **Automated Resolution**: Apply fixes, commit, push, and resolve threads in one workflow
- 💬 **Interactive Challenges**: Challenge invalid suggestions with explanations
- 📊 **Workflow Tracking**: Step-by-step progress through validation and resolution
- 🔧 **Flexible Integration**: Use individual tools or complete workflows

## Architecture

The MCP server provides tools for:

- **GitHub Integration**: Fetch PR metadata, review threads, post comments, resolve threads
- **Git Operations**: Checkout branches, apply patches, commit and push changes
- **Validation**: Analyze CodeRabbit suggestions before applying
- **Workflow Management**: Guided step-by-step resolution process
- **Rate Limiting**: Built-in rate limit management for GitHub API

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

#### Fine-grained PAT (Recommended)
- **Contents**: Read and Write
- **Pull requests**: Read and Write  
- **Actions**: Read (required for GraphQL API and CI/CD status)
- **Metadata**: Read (automatically included)

#### Classic PAT
- Scope: `repo` (full control)

#### GitHub App
- Repository permissions:
  - **Contents**: Read/Write
  - **Pull requests**: Read/Write
  - **Actions**: Read
  - **Checks**: Read (optional, for detailed CI status)
  - **Metadata**: Read

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

### Using with AI Assistants (Claude, etc.)

Once configured as an MCP server, AI assistants can use these tools:

```typescript
// Start the workflow
coderabbit_workflow_start(repo: "owner/name", prNumber: 123)

// Validate a suggestion
coderabbit_workflow_validate(
  repo: "owner/name",
  prNumber: 123,
  threadId: "PRRT_xxx",
  isValid: true,
  reason: "Correctly identifies missing null check"
)

// Apply the fix (this will apply, commit, push, and resolve in one call)
coderabbit_workflow_apply(
  repo: "owner/name",
  prNumber: 123,
  threadId: "PRRT_xxx",
  filePath: "src/file.ts",
  diffString: "@@ -10,3 +10,3 @@...",
  commitMessage: "fix: add null check as suggested"
)
// The tool automatically:
// 1. Applies the patch to the file
// 2. Commits with the provided message
// 3. Pushes to the remote branch
// 4. Resolves the GitHub review thread

// Or challenge if invalid
coderabbit_workflow_challenge(
  repo: "owner/name",
  prNumber: 123,
  threadId: "PRRT_xxx",
  reason: "This check is already performed in the parent function"
)
```

### MCP Server Mode

You can also run as a standalone MCP server:

```bash
npx mcp-coderabbit server
```

This starts the MCP server that can be used by MCP clients.

#### Global Installation in Claude Code

To install this MCP server globally in Claude Code so it's available in all your projects:

1. **Build and install globally from source:**
   ```bash
   # Clone the repository
   git clone https://github.com/your-org/mcp-coderabbit.git
   cd mcp-coderabbit
   
   # Install dependencies and build
   npm install
   npm run build
   
   # Create global symlink
   npm link
   ```

2. **Add to Claude Code configuration:**
   ```bash
   # Add the MCP server with environment variable
   claude mcp add-json coderabbit '{
     "command": "mcp-coderabbit",
     "args": ["server"],
     "env": {
       "GITHUB_TOKEN": "YOUR_GITHUB_TOKEN_HERE"
     }
   }' -s user
   ```

3. **Verify installation:**
   ```bash
   # Check that the server is configured and connected
   claude mcp list
   # Should show: coderabbit: mcp-coderabbit server - ✓ Connected
   ```

The server is now available globally in all your Claude Code projects. Replace `YOUR_GITHUB_TOKEN_HERE` with your actual GitHub Personal Access Token.

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

### Interactive Resolution (Recommended)
1. **Start Workflow**: `coderabbit_workflow_start` - Fetches first unresolved thread
2. **Validate**: Review the suggestion and decide if it's valid
3. **Record Decision**: `coderabbit_workflow_validate` - Record your validation
4. **Apply or Challenge**:
   - Valid: `coderabbit_workflow_apply` - Applies fix and commits locally
   - Invalid: `coderabbit_workflow_challenge` - Post explanation to PR
5. **Continue**: Workflow automatically advances to next thread
6. **Batch Completion**: When all threads are processed:
   - Pushes all commits at once (avoids rate limits)
   - Resolves all threads in batch
   
**Note**: To avoid CodeRabbit rate limits, fixes are committed locally during processing and pushed as a batch at the end. This prevents CodeRabbit from reviewing each commit individually.

### Manual Tools
- `get_coderabbit_threads` - Fetch CodeRabbit threads for review
- `apply_validated_fix` - Apply a specific fix after validation
- `github_post_review_comment` - Post comments (must start with @coderabbitai)
- `github_resolve_thread` - Resolve a thread after fixing

## Available MCP Tools

### Workflow Tools (Recommended)
- `coderabbit_workflow_start` - Start processing CodeRabbit threads
- `coderabbit_workflow_validate` - Record validation decision
- `coderabbit_workflow_apply` - Apply fix, commit, push, and resolve thread (all-in-one)
- `coderabbit_workflow_challenge` - Challenge invalid suggestion with explanation
- `coderabbit_workflow_status` - Get current workflow status and next thread

### Individual Tools
- `get_coderabbit_threads` - Fetch unresolved CodeRabbit threads
- `github_get_pr_meta` - Get PR metadata
- `github_list_review_threads` - List all review threads
- `github_post_review_comment` - Post a comment to a thread
- `github_resolve_thread` - Resolve a review thread
- `apply_validated_fix` - Apply a validated fix
- `get_rate_limit_status` - Check GitHub API rate limits

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