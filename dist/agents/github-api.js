import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import { Logger } from '../lib/logger.js';
export class GitHubAPIAgent {
    messageBus;
    config;
    logger = new Logger('GitHubAPI');
    graphqlClient;
    restClient;
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
        this.setupMessageHandlers();
    }
    setupMessageHandlers() {
        this.messageBus.subscribe('github-api', async (message) => {
            this.logger.debug(`Received message: ${message.type}`);
        });
    }
    async getPRMeta(repo, prNumber) {
        this.logger.info(`Fetching PR metadata for ${repo}#${prNumber}`);
        const [owner, name] = repo.split('/');
        const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            number
            title
            state
            isDraft
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
        const pr = response.repository.pullRequest;
        return {
            number: pr.number,
            title: pr.title,
            state: pr.state.toLowerCase(),
            isDraft: pr.isDraft,
            baseRef: pr.baseRefName,
            headRef: pr.headRefName,
            headRefOid: pr.headRefOid,
        };
    }
    async listReviewThreads(repo, prNumber, onlyUnresolved = true) {
        this.logger.info(`Fetching review threads for ${repo}#${prNumber}`);
        const [owner, name] = repo.split('/');
        const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                isOutdated
                isCollapsed
                path
                line
                startLine
                comments(first: 50) {
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
        const response = await this.graphqlClient(query, {
            owner,
            name,
            number: prNumber,
        });
        const threads = response.repository.pullRequest.reviewThreads.nodes;
        // Filter and transform threads
        const result = [];
        for (const thread of threads) {
            if (onlyUnresolved && thread.isResolved) {
                continue;
            }
            if (thread.isOutdated || thread.isCollapsed) {
                continue;
            }
            const comments = thread.comments.nodes;
            if (comments.length === 0) {
                continue;
            }
            result.push({
                id: thread.id,
                isResolved: thread.isResolved,
                path: thread.path,
                line: thread.line,
                startLine: thread.startLine,
                body: comments[0].body, // First comment is the main review comment
                author: {
                    login: comments[0].author?.login || 'unknown',
                },
                createdAt: comments[0].createdAt,
                comments: comments.map((c) => ({
                    id: c.id,
                    body: c.body,
                    author: {
                        login: c.author?.login || 'unknown',
                    },
                    createdAt: c.createdAt,
                })),
            });
        }
        this.logger.info(`Found ${result.length} ${onlyUnresolved ? 'unresolved ' : ''}review threads`);
        return result;
    }
    async postComment(repo, prNumber, threadId, body) {
        if (!body.startsWith('@coderabbitai')) {
            body = `@coderabbitai ${body}`;
        }
        if (this.config.dry_run) {
            this.logger.dryRun('post comment', { repo, prNumber, threadId, body });
            return;
        }
        this.logger.info(`Posting comment to thread ${threadId}`);
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
        await this.graphqlClient(mutation, {
            threadId,
            body,
        });
    }
    async resolveThread(repo, prNumber, threadId) {
        if (this.config.dry_run) {
            this.logger.dryRun('resolve thread', { repo, prNumber, threadId });
            return;
        }
        this.logger.info(`Resolving thread ${threadId}`);
        const mutation = `
      mutation($threadId: ID!) {
        resolvePullRequestReviewThread(input: {
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
    }
    async waitForCheckRuns(repo, commitSha, maxAttempts = 60, waitInterval = 10000) {
        const [owner, name] = repo.split('/');
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
        const result = hasChecks ? 'timeout' : 'no_checks_found';
        this.logger.warn(`Check runs ${result}`);
        return result;
    }
    async getCheckRunsUrl(repo, prNumber, commitSha) {
        return `https://github.com/${repo}/pull/${prNumber}/checks?sha=${commitSha}`;
    }
}
//# sourceMappingURL=github-api.js.map