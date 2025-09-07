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

For development/testing, you can run the orchestrator directly:

```bash
npx mcp-coderabbit test --repo owner/name --pr 123
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

// Apply the fix (applies and commits locally; push + resolve happen in batch at the end)
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
// 2. Commits with the provided message (local only)
// Finalization (push + resolve) occurs automatically after all threads are processed

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
npx mcp-coderabbit start
```

This starts the MCP server that can be used by MCP clients (uses stdio transport by default).

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
     "args": ["start"],
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
- `autoAccept`: Patterns for auto-accepting suggestions (uses glob patterns)
- `autoReject`: Patterns for auto-rejecting suggestions (uses glob patterns)
- `conventions`: Path to coding standards document (for documentation only)

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
- `coderabbit_workflow_apply` - Apply fix and commit locally (batch push/resolve happens at workflow end)
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

The thread analyzer uses heuristic-based validation:

### Automatic Acceptance
- Security vulnerabilities (detected by keywords)
- Critical bugs (marked as "critical" by CodeRabbit)
- Matches auto-accept patterns (glob patterns)

### Automatic Rejection
- Generated/minified files (*.min.js, *.bundle.js, *.map, *.lock)
- Binary files
- Matches auto-reject patterns (glob patterns)

### Manual Review Required
- No heuristic match found
- Ambiguous suggestions
- Complex refactoring suggestions

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
npx mcp-coderabbit test --repo owner/name --pr 123 --verbose
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