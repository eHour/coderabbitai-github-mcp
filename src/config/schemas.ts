import { z } from 'zod';

export const ConfigSchema = z.object({
  parallelism: z.object({
    maxAnalyzers: z.number().min(1).max(20).default(5),
    threadTimeout: z.number().min(5000).default(30000),
    batchSize: z.number().min(1).max(50).default(10),
  }),
  rateLimit: z.object({
    maxRequestsPerHour: z.number().min(1).default(50),
    maxRequestsPerMinute: z.number().min(1).default(10),
    maxConcurrent: z.number().min(1).default(3),
    backoffMultiplier: z.number().min(1).default(2),
    maxBackoffMs: z.number().min(1000).default(300000),
  }).optional(),
  validation: z.object({
    llm: z
      .object({
        provider: z.enum(['openai', 'anthropic']),
        model: z.string(),
        temperature: z.number().min(0).max(1).default(0.2),
        confidenceThreshold: z.number().min(0).max(1).default(0.7),
      })
      .optional(),
    autoAccept: z.array(z.string()).default([]),
    autoReject: z.array(z.string()).default([]),
    conventions: z.string().optional(),
  }),
  ci: z.object({
    waitTimeout: z.number().min(30000).default(600000), // 10 minutes
    checkInterval: z.number().min(5000).default(10000), // 10 seconds
  }),
  github: z.object({
    token: z.string().min(1, 'GitHub token is required'),
    owner: z.string().optional(),
    repo: z.string().optional(),
  }),
  dry_run: z.boolean().default(false),
  max_iterations: z.number().min(1).max(10).default(3),
});

export type ConfigInput = z.input<typeof ConfigSchema>;
export type ConfigOutput = z.output<typeof ConfigSchema>;

export const GitHubToolInputSchema = z.object({
  repo: z
    .string()
    .trim()
    .regex(/^[^/]+\/[^/]+$/, 'Repository must be in owner/name format')
    .describe('Repository in format owner/name'),
  prNumber: z.number().int().positive().describe('Pull request number'),
});

export const ReviewThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      author: z.object({
        login: z.string(),
      }),
      createdAt: z.string(),
    })
  ),
  path: z.string().optional(),
  line: z.number().optional(),
  startLine: z.number().optional(),
  body: z.string(),
  author: z.object({
    login: z.string(),
  }),
  createdAt: z.string(),
});

export const PullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  baseRef: z.string(),
  headRef: z.string(),
  headRefOid: z.string(),
});

export const AnalysisResultSchema = z.object({
  threadId: z.string(),
  result: z.enum(['valid', 'invalid', 'needs_review', 'unpatchable']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  patch: z.string().optional(),
  error: z.string().optional(),
});

export const CheckRunSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed']),
  conclusion: z
    .enum([
      'action_required',
      'cancelled',
      'failure',
      'neutral',
      'success',
      'skipped',
      'stale',
      'timed_out',
    ])
    .nullable(),
  html_url: z.string(),
});