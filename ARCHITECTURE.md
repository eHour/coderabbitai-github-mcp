# CodeRabbit MCP Server - Technical Architecture

## Overview

The CodeRabbit MCP Server is built on the Model Context Protocol (MCP), implementing a parallel agent architecture for automated PR review resolution. This document details the system design, component interactions, and implementation patterns.

## Core Architecture

### System Design Pattern

The server uses a **Multi-Agent System (MAS)** with parallel processing capabilities:

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Server Layer                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Orchestrator Agent                    │    │
│  │         (Central Coordination)                   │    │
│  └────────────┬───────────────┬────────────────────┘    │
│               │               │                          │
│     ┌─────────▼──────┐ ┌─────▼──────────┐              │
│     │  Worker Pool   │ │  Message Bus    │              │
│     │  ┌──────────┐  │ │  (Event-Driven) │              │
│     │  │Analyzer 1│  │ └────────┬─────────┘              │
│     │  │Analyzer 2│  │          │                        │
│     │  │    ...   │  │ ┌────────▼─────────┐              │
│     │  │Analyzer N│  │ │  State Manager   │              │
│     │  └──────────┘  │ │  (Thread-Safe)   │              │
│     └────────────────┘ └──────────────────┘              │
│                                                          │
│  ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐    │
│  │ GitHub   │ │  Code   │ │ Monitor │ │    Git    │    │
│  │   API    │ │ Patcher │ │  Agent  │ │  Manager  │    │
│  └──────────┘ └─────────┘ └─────────┘ └──────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. MCP Server Foundation (`src/server.ts`)

The entry point implementing the MCP specification:

```typescript
class CodeRabbitMCPServer {
  - Registers MCP tools
  - Handles tool invocations
  - Manages agent lifecycle
  - Routes messages via MessageBus
}
```

**Key Responsibilities:**
- Protocol compliance with MCP specification
- Tool registration and request handling
- Agent initialization and dependency injection

### 2. Agent System

#### 2.1 Orchestrator Agent (`src/agents/orchestrator.ts`)

The central coordinator implementing the **Mediator Pattern**:

```typescript
class OrchestratorAgent {
  - Coordinates multi-agent workflow
  - Manages iteration cycles
  - Handles batch operations
  - Implements retry logic
}
```

**Workflow Management:**
1. Pre-flight validation (PR status check)
2. Thread collection and distribution
3. Parallel analysis coordination
4. Batch fix application
5. CI/CD synchronization
6. Result aggregation

#### 2.2 Thread Analyzer Agents (`src/agents/thread-analyzer.ts`)

Worker agents for parallel thread processing:

```typescript
class ThreadAnalyzerAgent {
  - Validates CodeRabbit findings
  - Applies heuristic rules
  - Integrates LLM validation
  - Generates fix proposals
}
```

**Validation Strategy:**
```
Input Thread
    │
    ├─> Heuristic Rules (Fast Path)
    │     ├─> Auto-Accept Patterns
    │     ├─> Auto-Reject Patterns
    │     └─> Security/Critical Detection
    │
    └─> LLM Validation (Intelligent Path)
          ├─> Confidence Scoring
          ├─> Context Analysis
          └─> Fix Generation
```

#### 2.3 GitHub API Agent (`src/agents/github-api.ts`)

Centralized GitHub interaction layer:

```typescript
class GitHubAPIAgent {
  - GraphQL client for review threads
  - REST client for check runs
  - Rate limit management
  - Pagination handling
}
```

**API Strategy:**
- **GraphQL**: Review threads, comments, resolution (required for thread state)
- **REST**: Check runs, general PR data (simpler for basic operations)

#### 2.4 Code Patcher Agent (`src/agents/code-patcher.ts`)

Sequential patch application to prevent conflicts:

```typescript
class CodePatcherAgent {
  - Applies unified diffs
  - Manages git operations
  - Handles commit/push
  - Implements rollback
}
```

**Safety Measures:**
- Path traversal protection
- Working directory validation
- Atomic operations
- Conflict detection

#### 2.5 Monitor Agent (`src/agents/monitor.ts`)

Asynchronous monitoring for CI/CD and updates:

```typescript
class MonitorAgent {
  - Polls CI check runs
  - Tracks CodeRabbit responses
  - Generates progress reports
}
```

## Core Infrastructure

### 3. Message Bus (`src/lib/message-bus.ts`)

Event-driven communication implementing **Publish-Subscribe Pattern**:

```typescript
class MessageBus extends EventEmitter {
  - Asynchronous message passing
  - Request-response correlation
  - Message logging (circular buffer)
  - Error propagation
}
```

**Message Flow:**
```
Agent A                  MessageBus                Agent B
   │                          │                        │
   ├──send(message)──────────>│                        │
   │                          ├──emit(target)─────────>│
   │                          │                        ├─> handler()
   │                          │<──respond(result)──────┤
   │<──────result─────────────┤                        │
```

### 4. State Manager (`src/lib/state-manager.ts`)

Thread-safe state management with **Mutex Pattern**:

```typescript
class StateManager {
  - Atomic state updates
  - Batch operations
  - State subscriptions
  - Statistics tracking
}
```

**State Lifecycle:**
```
pending -> processing -> pushed -> resolved
                     |-> rejected
                     |-> needs_review
                     |-> ci_failed
```

### 5. Worker Pool (`src/lib/worker-pool.ts`)

Resource pooling for parallel execution:

```typescript
class WorkerPool<T> {
  - Dynamic worker allocation
  - Queue management
  - Load balancing
  - Graceful degradation
}
```

**Concurrency Control:**
- Bounded parallelism (configurable max workers)
- Queue-based task distribution
- Worker reuse for efficiency

## Data Flow Architecture

### Request Processing Pipeline

```
CLI Request
    │
    ▼
MCP Server (Tool Invocation)
    │
    ▼
Orchestrator.run()
    │
    ├──> GitHub API: Fetch PR & Threads
    │
    ├──> Parallel Analysis Phase
    │    ├──> Worker 1: Thread A
    │    ├──> Worker 2: Thread B
    │    └──> Worker N: Thread N
    │
    ├──> Sequential Patch Phase
    │    └──> Code Patcher: Apply fixes
    │
    ├──> Git Operations
    │    └──> Commit & Push
    │
    ├──> CI Monitoring Phase
    │    └──> Monitor: Wait for checks
    │
    └──> Resolution Phase
         ├──> Success: Resolve threads
         └──> Failure: Revert & notify
```

## Security Architecture

### Defense in Depth

1. **Input Validation Layer**
   - CLI argument validation
   - Repository format verification
   - PR number range checking

2. **Path Security**
   - Path traversal prevention
   - Working directory isolation
   - Resolved path validation

3. **Pattern Matching Safety**
   - ReDoS protection via regex escaping
   - Bounded pattern complexity
   - Timeout mechanisms

4. **API Security**
   - Token validation at startup
   - Permission verification
   - Rate limit compliance

## Performance Optimizations

### 1. Parallel Processing

```typescript
// Configurable parallelism
const PARALLEL_FACTORS = {
  maxAnalyzers: 5,      // Thread analysis concurrency
  batchSize: 10,        // Fixes per commit
  threadTimeout: 30000  // Individual timeout
};
```

### 2. Memory Management

- **Circular Buffer**: Message log capped at 10,000 entries
- **Lazy Loading**: Files read only when needed
- **Stream Processing**: Large diffs processed incrementally

### 3. Network Optimization

- **Batch Operations**: Multiple fixes per commit
- **Connection Reuse**: Shared API clients
- **Pagination**: Efficient handling of large result sets

## Error Handling Strategy

### Hierarchical Error Recovery

```
Level 1: Component Internal
  └─> Try-catch with local recovery
  
Level 2: Agent Boundary  
  └─> Error propagation via MessageBus
  
Level 3: Orchestrator
  └─> Retry logic with backoff
  
Level 4: System Level
  └─> Graceful degradation
      └─> State preservation
          └─> User notification
```

### Failure Modes

1. **Partial Success**: Apply successful fixes, skip failures
2. **CI Failure**: Automatic revert with notification
3. **API Limits**: Exponential backoff with jitter
4. **Crash Recovery**: State persistence (planned enhancement)

## Configuration Architecture

### Layered Configuration

```
Priority (Highest to Lowest):
1. CLI Arguments
2. Environment Variables  
3. Local Config File (coderabbit-mcp.json)
4. Default Values
```

### Configuration Schema

```typescript
interface Config {
  parallelism: {
    maxAnalyzers: number;    // 1-20 workers
    threadTimeout: number;   // ms per thread
    batchSize: number;       // fixes per commit
  };
  validation: {
    llm?: {                  // Optional AI validation
      provider: 'openai' | 'anthropic';
      model: string;
      temperature: number;
      confidenceThreshold: number;
    };
    autoAccept: string[];    // Pattern whitelist
    autoReject: string[];    // Pattern blacklist
  };
  ci: {
    waitTimeout: number;     // Max CI wait time
    checkInterval: number;   // Poll frequency
  };
}
```

## Extension Points

### Plugin Architecture (Future)

The system is designed for extensibility:

1. **Custom Validators**: Implement `IValidator` interface
2. **Additional Agents**: Register via MessageBus
3. **Alternative Git Backends**: Implement `IGitManager`
4. **Different CI Systems**: Extend `MonitorAgent`

### Tool Integration

MCP tools can be added by:

1. Implementing tool handler in appropriate agent
2. Registering in `server.ts` tool list
3. Adding to `OrchestratorAgent.executeTool()`

## Testing Strategy

### Test Pyramid

```
        /\
       /  \   E2E Tests (CLI -> GitHub)
      /────\
     /      \  Integration Tests (Agent interactions)
    /────────\
   /          \ Unit Tests (Individual components)
  /────────────\
```

### Key Test Scenarios

1. **Security**: Path traversal, ReDoS, injection attempts
2. **Concurrency**: Race conditions, deadlocks, state consistency
3. **Failure**: Network errors, API limits, malformed data
4. **Performance**: Large PRs, many threads, memory limits

## Deployment Architecture

### Container-Ready Design

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY dist/ dist/
COPY package*.json ./
RUN npm ci --production
CMD ["node", "dist/server.js"]
```

### Environment Requirements

- Node.js 18+ (ES2022 support)
- Git CLI available
- Network access to GitHub API
- Write permissions in working directory

## Monitoring & Observability

### Structured Logging

```typescript
logger.thread(threadId, message, {
  action: 'validate',
  result: 'valid',
  confidence: 0.95,
  duration: 1234
});
```

### Metrics Collection Points

1. **Performance**: Thread processing time, API latency
2. **Success Rate**: Fixes applied vs reverted
3. **Resource Usage**: Memory, worker utilization
4. **Error Tracking**: Failure types and frequencies

## Future Enhancements

### Planned Improvements

1. **State Persistence**: SQLite for crash recovery
2. **Webhook Support**: Real-time PR updates
3. **Distributed Mode**: Multi-instance coordination
4. **Caching Layer**: Reduce API calls
5. **Web UI**: Progress dashboard

### Architectural Evolution

```
Current: Standalone CLI Tool
    ↓
Phase 1: Persistent State
    ↓
Phase 2: Service Mode (long-running)
    ↓
Phase 3: Distributed System
    ↓
Future: Platform Integration
```

## Contributing

### Architecture Principles

When extending the system:

1. **Maintain Agent Boundaries**: Keep responsibilities clear
2. **Use MessageBus**: All inter-agent communication
3. **Thread Safety**: Always use StateManager mutex
4. **Error Recovery**: Implement at appropriate level
5. **Performance**: Consider parallelism impact

### Code Standards

- TypeScript strict mode
- Explicit error handling
- Comprehensive logging
- Security-first design
- Test coverage > 80%

---

*This architecture enables reliable, scalable, and maintainable automation of CodeRabbit PR review resolution while maintaining security and performance.*