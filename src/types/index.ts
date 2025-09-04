export interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: ReviewComment[];
  path?: string;
  line?: number;
  startLine?: number;
  body: string;
  author: {
    login: string;
  };
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  createdAt: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  isDraft: boolean;
  baseRef: string;
  headRef: string;
  headRefOid: string;
}

export enum ValidationResult {
  VALID = 'valid',
  INVALID = 'invalid',
  NEEDS_REVIEW = 'needs_review',
  UNPATCHABLE = 'unpatchable'
}

export interface AnalysisResult {
  threadId: string;
  result: ValidationResult;
  confidence: number;
  reasoning: string;
  patch?: string;
  error?: string;
}

export interface ThreadState {
  threadId: string;
  status: 'pending' | 'processing' | 'pushed' | 'resolved' | 'rejected' | 'needs_review' | 'ci_failed';
  attempts: number;
  commitSha?: string;
  lastError?: string;
  ciRunUrl?: string;
}

export interface AgentMessage {
  id: string;
  type: 'ANALYZE_THREAD' | 'APPLY_PATCH' | 'POST_COMMENT' | 'CHECK_CI' | 'RESOLVE_THREAD' | 'CODERABBIT_UPDATE' | 'RESPONSE';
  source: string;
  target: string;
  payload: any;
  correlationId: string;
  timestamp: Date;
}

export interface PatchRequest {
  threadId: string;
  filePath: string;
  patch: string;
  lineNumber?: number;
}

export interface Config {
  parallelism: {
    maxAnalyzers: number;
    threadTimeout: number;
    batchSize: number;
  };
  rateLimit?: {
    maxRequestsPerHour: number;
    maxRequestsPerMinute: number;
    maxConcurrent: number;
    backoffMultiplier: number;
    maxBackoffMs: number;
  };
  validation: {
    llm?: {
      provider: 'openai' | 'anthropic';
      model: string;
      temperature: number;
      confidenceThreshold: number;
    };
    autoAccept: string[];
    autoReject: string[];
    conventions?: string;
  };
  ci: {
    waitTimeout: number;
    checkInterval: number;
  };
  github: {
    token: string;
    owner?: string;
    repo?: string;
  };
  dry_run: boolean;
  max_iterations: number;
}

export type CheckRunConclusion = 'success' | 'failure' | 'timeout' | 'no_checks_found';