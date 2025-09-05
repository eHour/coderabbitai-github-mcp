import { GitHubAPIAgent } from './dist/agents/github-api.js';
import { MessageBus } from './dist/lib/message-bus.js';

const config = {
  github: { token: process.env.GITHUB_TOKEN },
  dry_run: false
};

const messageBus = new MessageBus();
const agent = new GitHubAPIAgent(messageBus, config);

async function test() {
  const result = await agent.listReviewThreads('eHour/coderabbitai-github-mcp', 1, false, 1, 10);
  console.log('Total threads:', result.totalCount);
  console.log('Threads found:', result.threads.length);
  
  // Check for any coderabbitai[bot] threads
  const botThreads = result.threads.filter(t => 
    t.author.login === 'coderabbitai[bot]' && !t.isResolved
  );
  console.log('Unresolved coderabbitai[bot] threads:', botThreads.length);
  
  result.threads.forEach((thread, i) => {
    if (!thread.isResolved || thread.author.login.includes('coderabbit')) {
      console.log(`\n${i+1}. Thread:`, {
        id: thread.id.substring(0, 20) + '...',
        author: thread.author.login,
        isResolved: thread.isResolved,
        path: thread.path,
        bodyPreview: thread.body.substring(0, 80) + '...'
      });
    }
  });
}

test().catch(console.error);
