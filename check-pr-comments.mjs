import { Octokit } from '@octokit/rest';
import { loadConfig } from './dist/config/loader.js';

const config = loadConfig();
const octokit = new Octokit({
  auth: config.github.token,
});

async function checkComments() {
  console.log('Fetching PR comments (not review threads)...\n');
  
  // Get issue comments on the PR
  const { data: comments } = await octokit.issues.listComments({
    owner: 'eHour',
    repo: 'coderabbitai-github-mcp',
    issue_number: 1,
  });
  
  console.log(`Found ${comments.length} PR comments total\n`);
  
  // Filter for CodeRabbit comments
  const coderabbitComments = comments.filter(c => 
    c.user?.login === 'coderabbitai' || 
    c.user?.login === 'coderabbitai[bot]' ||
    c.user?.type === 'Bot' && c.user?.login?.includes('coderabbit')
  );
  
  console.log(`CodeRabbit comments: ${coderabbitComments.length}\n`);
  
  coderabbitComments.forEach((comment, i) => {
    console.log(`${i + 1}. Comment by ${comment.user?.login}:`);
    console.log(`   Created: ${comment.created_at}`);
    console.log(`   Updated: ${comment.updated_at}`);
    console.log(`   URL: ${comment.html_url}`);
    console.log(`   Body preview: ${comment.body?.substring(0, 150)}...`);
    console.log(`   Has reactions: ${comment.reactions?.total_count > 0}`);
    console.log('');
  });
  
  // Check for recent comments (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentComments = coderabbitComments.filter(c => 
    new Date(c.created_at) > oneDayAgo
  );
  
  if (recentComments.length > 0) {
    console.log(`\n⚠️  Found ${recentComments.length} CodeRabbit comments from the last 24 hours`);
    console.log('These are regular PR comments, not code review threads.');
    console.log('They cannot be resolved via the review thread API.\n');
  }
}

checkComments().catch(console.error);