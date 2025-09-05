import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import { Logger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rate-limiter.js';
export class GitHubAPIAgent {
    messageBus;
    config;
    logger = new Logger('GitHubAPI');
    graphqlClient;
    restClient;
    rateLimiter;
    constructor(messageBus, config) {
        this.messageBus = messageBus;
        this.config = config;
        this.graphqlClient = graphql.defaults({
            headers: {
                authorization: `token ${config.github.token}`,
            },
        });
        this.restClient = new Octokit({
            auth: config.github.token,
        });
        // Initialize rate limiter with config
        this.rateLimiter = new RateLimiter(config.rateLimit || {
            maxRequestsPerHour: 50,
            maxRequestsPerMinute: 10,
            maxConcurrent: 3,
            backoffMultiplier: 2,
            maxBackoffMs: 300000
        });
        this.setupMessageHandlers();
    }
    setupMessageHandlers() {
        this.messageBus.subscribe('github-api', async (message) => {
            this.logger.debug(`Received message: ${message.type}`);
        });
    }
    getRateLimitStatus() {
        return this.rateLimiter.getStatus();
    }
    parseRepo(repo) {
        const [owner, name] = repo.split('/');
        if (!owner || !name) {
            throw new Error(`Invalid repo "${repo}". Expected "owner/name".`);
        }
        return { owner, name };
    }
    async getPRMeta(repo, prNumber) {
        this.logger.info(`Fetching PR metadata for ${repo}#${prNumber}`);
        const { owner, name } = this.parseRepo(repo);
        const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            number
            title
            state
            isDraft
            merged
            baseRefName
            headRefName
            headRefOid
          }
        }
      }
    `;
        const response = await this.graphqlClient(query, {
            owner,
            name,
            number: prNumber,
        });
        const pr = response?.repository?.pullRequest;
        if (!pr) {
            throw new Error(`PR #${prNumber} not found or not accessible in ${repo}`);
        }
        return {
            number: pr.number,
            title: pr.title,
            state: pr.merged ? 'merged' : pr.state.toLowerCase(),
            isDraft: pr.isDraft,
            baseRef: pr.baseRefName,
            headRef: pr.headRefName,
            headRefOid: pr.headRefOid,
        };
    }
    async listReviewThreads(repo, prNumber, onlyUnresolved = true, page = 1, pageSize = 10) {
        this.logger.info(`Fetching review threads for ${repo}#${prNumber} (page ${page}, size ${pageSize})`);
        const { owner, name } = this.parseRepo(repo);
        // Constrain pageSize to reasonable limits
        pageSize = Math.min(Math.max(1, pageSize), 50);
        // We'll fetch all threads with pagination support
        // For now, fetching up to 100 threads total (can be extended with cursor pagination if needed)
        const query = `
      query($owner: String!, $name: String!, $number: Int!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: $first) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                isResolved
                isOutdated
                isCollapsed
                path
                line
                startLine
                commentsFirst: comments(first: 1) {
                  nodes {
                    id
                    body
                    author {
                      login
                    }
                    createdAt
                  }
                }
                commentsLast: comments(last: 1) {
                  nodes {
                    id
                    body
                    author {
                      login
                    }
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    `;
        // For simplicity, fetch up to 100 threads initially
        const response = await this.graphqlClient(query, {
            owner,
            name,
            number: prNumber,
            first: 100
        });
        const prNode = response?.repository?.pullRequest;
        if (!prNode) {
            this.logger.warn(`PR #${prNumber} not found or not accessible in ${repo}`);
            return { threads: [], totalCount: 0, hasMore: false };
        }
        const reviewThreads = prNode.reviewThreads ?? { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] };
        const threads = reviewThreads.nodes ?? [];
        // Diagnostic logging to debug thread detection
        this.logger.info(`Raw threads from GitHub API for PR #${prNumber}: ${threads.length} total`);
        threads.forEach((thread, index) => {
            const authorLogin = thread.commentsFirst?.nodes?.[0]?.author?.login || 'unknown';
            if (authorLogin.includes('coderabbit')) {
                this.logger.info(`  Thread ${index}: Author=${authorLogin}, isResolved=${thread.isResolved}, isOutdated=${thread.isOutdated}, path=${thread.path}`);
            }
        });
        // Filter and transform threads
        const result = [];
        for (const thread of threads) {
            if (onlyUnresolved && thread.isResolved) {
                continue;
            }
            // Skip collapsed threads but include outdated ones (they might still need resolution)
            if (thread.isCollapsed) {
                continue;
            }
            const rootComment = thread.commentsFirst?.nodes?.[0];
            const lastComment = thread.commentsLast?.nodes?.[0];
            if (!rootComment) {
                continue;
            }
            // Merge first and last comments, removing duplicates by ID
            const allComments = [];
            if (rootComment)
                allComments.push(rootComment);
            if (lastComment && lastComment.id !== rootComment.id)
                allComments.push(lastComment);
            result.push({
                id: thread.id,
                isResolved: thread.isResolved,
                path: thread.path,
                line: thread.line,
                startLine: thread.startLine,
                body: rootComment.body || '',
                author: {
                    login: rootComment.author?.login || 'unknown',
                },
                createdAt: rootComment.createdAt || '',
                comments: allComments.map((c) => ({
                    id: c.id,
                    body: c.body,
                    author: {
                        login: c.author?.login || 'unknown',
                    },
                    createdAt: c.createdAt,
                })),
            });
        }
        // Apply simple paging over filtered results
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const paged = result.slice(start, end);
        const hasMore = end < result.length || (reviewThreads.pageInfo?.hasNextPage === true);
        this.logger.info(`Returning ${paged.length}/${result.length} threads (page ${page}, size ${pageSize})`);
        return {
            threads: paged,
            totalCount: reviewThreads.totalCount,
            hasMore
        };
    }
    async postComment(repo, prNumber, threadId, body) {
        if (!body.startsWith('@coderabbitai')) {
            body = `@coderabbitai ${body}`;
        }
        if (this.config.dry_run) {
            this.logger.dryRun('post comment', { repo, prNumber, threadId, body });
            return { success: true };
        }
        // Rate limiting check - atomic acquire to prevent races
        await this.rateLimiter.acquire();
        let ok = false;
        this.logger.info(`Posting comment to thread ${threadId}`);
        try {
            const mutation = `
      mutation($threadId: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: {
          pullRequestReviewThreadId: $threadId,
          body: $body
        }) {
          comment {
            id
          }
        }
      }
    `;
            const response = await this.graphqlClient(mutation, {
                threadId,
                body,
            });
            ok = true;
            return {
                success: true,
                commentId: response.addPullRequestReviewThreadReply?.comment?.id
            };
        }
        catch (error) {
            // Check if it's a rate limit error
            const errorMessage = error.message || '';
            const rateLimitMatch = errorMessage.match(/wait (\d+) minutes? and (\d+) seconds?/i);
            if (rateLimitMatch) {
                const minutes = parseInt(rateLimitMatch[1] || '0', 10);
                const seconds = parseInt(rateLimitMatch[2] || '0', 10);
                this.rateLimiter.handleRateLimitError(minutes, seconds);
                this.logger.error(`GitHub rate limit: wait ${minutes}m ${seconds}s`);
            }
            throw error;
        }
        finally {
            this.rateLimiter.endRequest(ok);
        }
    }
    async resolveThread(repo, prNumber, threadId) {
        if (this.config.dry_run) {
            this.logger.dryRun('resolve thread', { repo, prNumber, threadId });
            return { success: true };
        }
        this.logger.info(`Resolving thread ${threadId}`);
        const mutation = `
      mutation($threadId: ID!) {
        resolveReviewThread(input: {
          threadId: $threadId
        }) {
          thread {
            id
            isResolved
          }
        }
      }
    `;
        await this.graphqlClient(mutation, {
            threadId,
        });
        return { success: true };
    }
    async waitForCheckRuns(repo, commitSha, maxAttempts = 60, waitInterval = 10000) {
        const { owner, name } = this.parseRepo(repo);
        let hasChecks = false;
        this.logger.info(`Waiting for check runs on ${commitSha}`);
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const { data } = await this.restClient.checks.listForRef({
                owner,
                repo: name,
                ref: commitSha,
            });
            if (!hasChecks && data.check_runs.length > 0) {
                hasChecks = true;
                this.logger.info(`Found ${data.check_runs.length} check runs`);
            }
            // Only check for completion if we know checks have been created
            if (hasChecks && data.check_runs.every(run => run.status === 'completed')) {
                const allSuccessful = data.check_runs.every(run => run.conclusion === 'success' ||
                    run.conclusion === 'skipped' ||
                    run.conclusion === 'neutral');
                const result = allSuccessful ? 'success' : 'failure';
                this.logger.info(`Check runs completed: ${result}`);
                return result;
            }
            this.logger.debug(`Attempt ${attempt + 1}/${maxAttempts}, waiting ${waitInterval}ms`);
            await new Promise(resolve => setTimeout(resolve, waitInterval));
        }
        const result = hasChecks ? 'timed_out' : null;
        this.logger.warn(`Check runs ${hasChecks ? 'timed out' : 'not found'}`);
        return result;
    }
    async getCheckRunsUrl(repo, prNumber, commitSha) {
        return `https://github.com/${repo}/pull/${prNumber}/checks?sha=${commitSha}`;
    }
}
//# sourceMappingURL=github-api.js.map