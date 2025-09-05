import { loadConfig } from './dist/config/loader.js';
import { GitHubAPIAgent } from './dist/agents/github-api.js';
import { MessageBus } from './dist/lib/message-bus.js';

const config = loadConfig();
const messageBus = new MessageBus();
const agent = new GitHubAPIAgent(messageBus, config);

async function test() {
  // Get all threads (resolved and unresolved)
  const result = await agent.listReviewThreads('eHour/coderabbitai-github-mcp', 1, false, 1, 100);
  console.log('\nTotal threads:', result.totalCount);
  
  // Filter for coderabbitai
  const coderabbitThreads = result.threads.filter(t => 
    t.author.login === 'coderabbitai[bot]' || t.author.login === 'coderabbitai'
  );
  
  const unresolvedCR = coderabbitThreads.filter(t => !t.isResolved);
  
  console.log('CodeRabbit threads:', coderabbitThreads.length);
  console.log('Unresolved CodeRabbit threads:', unresolvedCR.length);
  
  if (unresolvedCR.length > 0) {
    console.log('\nUnresolved threads:');
    unresolvedCR.forEach((t, i) => {
      console.log(`\n${i+1}. Path: ${t.path}, Line: ${t.line}`);
      console.log('   Body preview:', t.body.substring(0, 100) + '...');
      console.log('   ID:', t.id);
    });
  }
  
  // Check for non-coderabbit unresolved
  const unresolvedOther = result.threads.filter(t => 
    !t.isResolved && t.author.login !== 'coderabbitai[bot]' && t.author.login !== 'coderabbitai'
  );
  
  if (unresolvedOther.length > 0) {
    console.log('\nOther unresolved threads:');
    unresolvedOther.forEach((t, i) => {
      console.log(`${i+1}. Author: ${t.author.login}, Path: ${t.path}`);
      console.log('   Body preview:', t.body.substring(0, 80) + '...');
    });
  }
  
  // Also check the most recent threads
  console.log('\nMost recent 5 threads:');
  result.threads.slice(0, 5).forEach(t => {
    console.log(`- ${t.author.login}: ${t.isResolved ? 'RESOLVED' : 'OPEN'} at ${t.path}`);
  });
}

test().catch(console.error);