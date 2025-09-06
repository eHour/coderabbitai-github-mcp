import { Octokit } from '@octokit/rest';
import { loadConfig } from './dist/config/loader.js';

const config = loadConfig();
const octokit = new Octokit({
  auth: config.github.token,
});

async function checkReviewComments() {
  console.log('Fetching PR review comments (inline code comments)...\n');
  
  // Get review comments on the PR (these are the inline code comments)
  const reviewComments = await octokit.paginate(
    octokit.pulls.listReviewComments,
    {
      owner: 'eHour',
      repo: 'coderabbitai-github-mcp',
      pull_number: 1,
      per_page: 100,
    }
  );
  
  console.log(`Found ${reviewComments.length} review comments total\n`);
  
  // Filter for unresolved CodeRabbit comments  
  const coderabbitComments = reviewComments.filter(c => 
    (c.user?.login === 'coderabbitai' || 
     c.user?.login === 'coderabbitai[bot]' ||
     c.user?.type === 'Bot' && c.user?.login?.includes('coderabbit'))
  );
  
  console.log(`CodeRabbit review comments: ${coderabbitComments.length}\n`);
  
  // Group by in_reply_to_id to find threads
  const threads = {};
  coderabbitComments.forEach(comment => {
    const threadId = comment.in_reply_to_id || comment.id;
    if (!threads[threadId]) {
      threads[threadId] = [];
    }
    threads[threadId].push(comment);
  });
  
  console.log(`Unique threads: ${Object.keys(threads).length}\n`);
  
  // Check for recent/active comments
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let recentCount = 0;
  
  Object.entries(threads).forEach(([threadId, comments]) => {
    const mostRecent = comments.sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    )[0];
    
    if (new Date(mostRecent.created_at) > oneDayAgo) {
      recentCount++;
      console.log(`Thread at ${mostRecent.path}:${mostRecent.line || mostRecent.original_line}:`);
      console.log(`  Latest comment: ${mostRecent.created_at}`);
      console.log(`  Body preview: ${mostRecent.body?.substring(0, 100)}...`);
      console.log(`  URL: ${mostRecent.html_url}`);
      console.log('');
    }
  });
  
  if (recentCount > 0) {
    console.log(`\n⚠️  Found ${recentCount} CodeRabbit review comment threads updated in the last 24 hours`);
  }
}

checkReviewComments().catch(console.error);