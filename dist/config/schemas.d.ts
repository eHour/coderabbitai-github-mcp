import { z } from 'zod';
export declare const ConfigSchema: z.ZodObject<{
    parallelism: z.ZodObject<{
        maxAnalyzers: z.ZodDefault<z.ZodNumber>;
        threadTimeout: z.ZodDefault<z.ZodNumber>;
        batchSize: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxAnalyzers: number;
        threadTimeout: number;
        batchSize: number;
    }, {
        maxAnalyzers?: number | undefined;
        threadTimeout?: number | undefined;
        batchSize?: number | undefined;
    }>;
    rateLimit: z.ZodOptional<z.ZodObject<{
        maxRequestsPerHour: z.ZodDefault<z.ZodNumber>;
        maxRequestsPerMinute: z.ZodDefault<z.ZodNumber>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
        backoffMultiplier: z.ZodDefault<z.ZodNumber>;
        maxBackoffMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxRequestsPerHour: number;
        maxRequestsPerMinute: number;
        maxConcurrent: number;
        backoffMultiplier: number;
        maxBackoffMs: number;
    }, {
        maxRequestsPerHour?: number | undefined;
        maxRequestsPerMinute?: number | undefined;
        maxConcurrent?: number | undefined;
        backoffMultiplier?: number | undefined;
        maxBackoffMs?: number | undefined;
    }>>;
    validation: z.ZodObject<{
        autoAccept: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        autoReject: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        conventions: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        autoAccept: string[];
        autoReject: string[];
        conventions?: string | undefined;
    }, {
        autoAccept?: string[] | undefined;
        autoReject?: string[] | undefined;
        conventions?: string | undefined;
    }>;
    ci: z.ZodObject<{
        waitTimeout: z.ZodDefault<z.ZodNumber>;
        checkInterval: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        waitTimeout: number;
        checkInterval: number;
    }, {
        waitTimeout?: number | undefined;
        checkInterval?: number | undefined;
    }>;
    github: z.ZodObject<{
        token: z.ZodString;
        owner: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        token: string;
        owner?: string | undefined;
        repo?: string | undefined;
    }, {
        token: string;
        owner?: string | undefined;
        repo?: string | undefined;
    }>;
    dry_run: z.ZodDefault<z.ZodBoolean>;
    max_iterations: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    validation: {
        autoAccept: string[];
        autoReject: string[];
        conventions?: string | undefined;
    };
    parallelism: {
        maxAnalyzers: number;
        threadTimeout: number;
        batchSize: number;
    };
    ci: {
        waitTimeout: number;
        checkInterval: number;
    };
    github: {
        token: string;
        owner?: string | undefined;
        repo?: string | undefined;
    };
    dry_run: boolean;
    max_iterations: number;
    rateLimit?: {
        maxRequestsPerHour: number;
        maxRequestsPerMinute: number;
        maxConcurrent: number;
        backoffMultiplier: number;
        maxBackoffMs: number;
    } | undefined;
}, {
    validation: {
        autoAccept?: string[] | undefined;
        autoReject?: string[] | undefined;
        conventions?: string | undefined;
    };
    parallelism: {
        maxAnalyzers?: number | undefined;
        threadTimeout?: number | undefined;
        batchSize?: number | undefined;
    };
    ci: {
        waitTimeout?: number | undefined;
        checkInterval?: number | undefined;
    };
    github: {
        token: string;
        owner?: string | undefined;
        repo?: string | undefined;
    };
    rateLimit?: {
        maxRequestsPerHour?: number | undefined;
        maxRequestsPerMinute?: number | undefined;
        maxConcurrent?: number | undefined;
        backoffMultiplier?: number | undefined;
        maxBackoffMs?: number | undefined;
    } | undefined;
    dry_run?: boolean | undefined;
    max_iterations?: number | undefined;
}>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type ConfigOutput = z.output<typeof ConfigSchema>;
export declare const GitHubToolInputSchema: z.ZodObject<{
    repo: z.ZodString;
    prNumber: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    repo: string;
    prNumber: number;
}, {
    repo: string;
    prNumber: number;
}>;
export declare const ReviewThreadSchema: z.ZodObject<{
    id: z.ZodString;
    isResolved: z.ZodBoolean;
    comments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        author: z.ZodObject<{
            login: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            login: string;
        }, {
            login: string;
        }>;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        body: string;
        author: {
            login: string;
        };
        createdAt: string;
    }, {
        id: string;
        body: string;
        author: {
            login: string;
        };
        createdAt: string;
    }>, "many">;
    path: z.ZodOptional<z.ZodString>;
    line: z.ZodOptional<z.ZodNumber>;
    startLine: z.ZodOptional<z.ZodNumber>;
    body: z.ZodString;
    author: z.ZodObject<{
        login: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        login: string;
    }, {
        login: string;
    }>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    isResolved: boolean;
    comments: {
        id: string;
        body: string;
        author: {
            login: string;
        };
        createdAt: string;
    }[];
    body: string;
    author: {
        login: string;
    };
    createdAt: string;
    path?: string | undefined;
    line?: number | undefined;
    startLine?: number | undefined;
}, {
    id: string;
    isResolved: boolean;
    comments: {
        id: string;
        body: string;
        author: {
            login: string;
        };
        createdAt: string;
    }[];
    body: string;
    author: {
        login: string;
    };
    createdAt: string;
    path?: string | undefined;
    line?: number | undefined;
    startLine?: number | undefined;
}>;
export declare const PullRequestSchema: z.ZodObject<{
    number: z.ZodNumber;
    title: z.ZodString;
    state: z.ZodEnum<["open", "closed", "merged"]>;
    isDraft: z.ZodBoolean;
    baseRef: z.ZodString;
    headRef: z.ZodString;
    headRefOid: z.ZodString;
}, "strip", z.ZodTypeAny, {
    number: number;
    title: string;
    state: "open" | "closed" | "merged";
    isDraft: boolean;
    baseRef: string;
    headRef: string;
    headRefOid: string;
}, {
    number: number;
    title: string;
    state: "open" | "closed" | "merged";
    isDraft: boolean;
    baseRef: string;
    headRef: string;
    headRefOid: string;
}>;
export declare const AnalysisResultSchema: z.ZodObject<{
    threadId: z.ZodString;
    result: z.ZodEnum<["valid", "invalid", "needs_review", "unpatchable"]>;
    confidence: z.ZodNumber;
    reasoning: z.ZodString;
    patch: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    threadId: string;
    result: "valid" | "invalid" | "needs_review" | "unpatchable";
    confidence: number;
    reasoning: string;
    error?: string | undefined;
    patch?: string | undefined;
}, {
    threadId: string;
    result: "valid" | "invalid" | "needs_review" | "unpatchable";
    confidence: number;
    reasoning: string;
    error?: string | undefined;
    patch?: string | undefined;
}>;
export declare const CheckRunSchema: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    status: z.ZodEnum<["queued", "in_progress", "completed"]>;
    conclusion: z.ZodNullable<z.ZodEnum<["action_required", "cancelled", "failure", "neutral", "success", "skipped", "stale", "timed_out"]>>;
    html_url: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "queued" | "in_progress" | "completed";
    id: number;
    name: string;
    conclusion: "action_required" | "cancelled" | "failure" | "neutral" | "success" | "skipped" | "stale" | "timed_out" | null;
    html_url: string;
}, {
    status: "queued" | "in_progress" | "completed";
    id: number;
    name: string;
    conclusion: "action_required" | "cancelled" | "failure" | "neutral" | "success" | "skipped" | "stale" | "timed_out" | null;
    html_url: string;
}>;
//# sourceMappingURL=schemas.d.ts.map