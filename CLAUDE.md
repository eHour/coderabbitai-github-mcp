# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
```bash
npm run build        # Compile TypeScript to dist/
npm run dev         # Run in development with hot reload (tsx watch)
npm run start       # Run compiled server from dist/
npm run cli        # Run CLI in development mode (tsx)
```

### Code Quality
```bash
npm run lint        # ESLint for src/**/*.ts
npm run typecheck   # TypeScript type checking (noEmit)
npm test           # Run Jest tests
```

### Running the Tool
```bash
# Process a PR (after building)
npx mcp-coderabbit run --repo owner/name --pr 123

# Dry run mode (preview without changes)
npx mcp-coderabbit run --repo owner/name --pr 123 --dry-run

# With custom settings
npx mcp-coderabbit run --repo owner/name --pr 123 --max-iterations 5 --max-workers 8 --verbose

# MCP server mode
npx mcp-coderabbit server
```

## Architecture Overview

This is a **Model Context Protocol (MCP)** server implementing a **Multi-Agent System** for automated CodeRabbit PR review resolution.

### Core Agent Architecture

The system coordinates multiple specialized agents through a message bus:

1. **OrchestratorAgent** (`src/agents/orchestrator.ts`): Central coordinator managing the entire workflow
   - Coordinates iteration cycles and batch operations
   - Routes tool invocations to appropriate agents
   - Implements retry logic and error recovery

2. **ThreadAnalyzerAgent** (`src/agents/thread-analyzer.ts`): Worker agents for parallel validation
   - Run in a worker pool for concurrent processing
   - Apply heuristic rules and optional LLM validation
   - Generate fix proposals with confidence scoring

3. **GitHubAPIAgent** (`src/agents/github-api.ts`): Centralized GitHub interaction
   - GraphQL for review threads (required for thread state management)
   - REST for check runs and basic PR operations
   - Handles rate limiting and pagination

4. **CodePatcherAgent** (`src/agents/code-patcher.ts`): Sequential patch application
   - Applies unified diffs with conflict prevention
   - Manages git operations (commit/push/revert)
   - Implements safety measures (path validation, atomic operations)

5. **MonitorAgent** (`src/agents/monitor.ts`): Asynchronous CI/CD monitoring
   - Polls check run status
   - Tracks CodeRabbit responses
   - Generates progress reports

### Core Infrastructure

- **MessageBus** (`src/lib/message-bus.ts`): Event-driven inter-agent communication using publish-subscribe pattern
- **StateManager** (`src/lib/state-manager.ts`): Thread-safe state management with mutex for atomic updates
- **WorkerPool** (`src/lib/worker-pool.ts`): Manages parallel thread analyzer instances with queue-based distribution
- **Logger** (`src/lib/logger.ts`): Structured logging with thread-specific context

### Workflow Pipeline

1. **Pre-flight**: Validate PR status and working directory
2. **Thread Collection**: Fetch unresolved CodeRabbit comments via GitHub GraphQL
3. **Parallel Analysis**: Distribute threads to worker pool for concurrent validation
4. **Sequential Patching**: Apply validated fixes one by one to avoid conflicts
5. **CI Synchronization**: Wait for checks to pass before proceeding
6. **Resolution**: Resolve threads on success or revert on failure

### Key Design Patterns

- **Mediator Pattern**: OrchestratorAgent coordinates without direct agent coupling
- **Worker Pool Pattern**: Bounded parallelism for thread analysis
- **Mutex Pattern**: StateManager ensures thread-safe operations
- **Publish-Subscribe**: MessageBus enables loose coupling between agents

## Configuration

The system uses layered configuration (CLI args > env vars > config file > defaults):

- `coderabbit-mcp.json`: Local configuration file
- Environment variables: `GITHUB_TOKEN` (required), `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (optional for LLM validation)
- CLI arguments override all other settings

## TypeScript Configuration

- **Strict mode** enabled with all strict checks
- **ES2022** target with Node16 module resolution
- **ESM modules** (type: "module" in package.json)
- All imports must use `.js` extensions (even for `.ts` files)

## Important Notes

- The project uses **unified diff format** for patch application
- **GraphQL is required** for thread state management (REST API doesn't support thread resolution)
- Patches are applied **sequentially** to prevent conflicts
- The system implements **automatic rollback** if CI fails after pushing fixes
- Worker pool size is configurable (default 5, max 20) based on API rate limits