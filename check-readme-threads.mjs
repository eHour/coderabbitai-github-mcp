import { graphql } from '@octokit/graphql';
import { loadConfig } from './dist/config/loader.js';

const config = loadConfig();
const graphqlClient = graphql.defaults({
  headers: {
    authorization: `token ${config.github.token}`,
  },
});

async function checkReadmeThreads() {
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
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
              comments(first: 5) {
                nodes {
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

  console.log('Fetching first 100 threads...');
  let allThreads = [];
  let cursor = null;
  let hasMore = true;
  
  // Fetch all pages
  while (hasMore) {
    const response = await graphqlClient(query, {
      owner: 'eHour',
      name: 'coderabbitai-github-mcp',
      number: 1,
      after: cursor,
    });
    
    const data = response?.repository?.pullRequest?.reviewThreads;
    if (!data) break;
    
    allThreads = allThreads.concat(data.nodes || []);
    hasMore = data.pageInfo?.hasNextPage || false;
    cursor = data.pageInfo?.endCursor;
    
    if (hasMore) {
      console.log(`Fetched ${allThreads.length}/${data.totalCount}, fetching more...`);
    }
  }
  
  console.log(`\nTotal threads fetched: ${allThreads.length}`);
  
  // Look for README threads
  const readmeThreads = allThreads.filter(t => 
    t.path === 'README.md' && 
    t.comments?.nodes?.[0]?.author?.login?.includes('coderabbit')
  );
  
  console.log(`\nREADME.md CodeRabbit threads: ${readmeThreads.length}`);
  
  if (readmeThreads.length === 0) {
    // Check if there are any README threads at all
    const anyReadmeThreads = allThreads.filter(t => t.path === 'README.md');
    console.log(`Total README.md threads (any author): ${anyReadmeThreads.length}`);
  }
  
  readmeThreads.forEach((t, i) => {
    console.log(`\n=== Thread ${i+1} ===`);
    console.log(`  Lines: ${t.startLine || '?'}-${t.line}`);
    console.log(`  Status: ${t.isResolved ? 'RESOLVED' : 'OPEN'}, ${t.isOutdated ? 'OUTDATED' : 'CURRENT'}, ${t.isCollapsed ? 'COLLAPSED' : 'VISIBLE'}`);
    
    const comment = t.comments?.nodes?.[0];
    const body = comment?.body || '';
    
    // Check for specific content
    if (body.includes('max-workers') || body.includes('--max-workers')) {
      console.log('  🎯 FOUND MAX-WORKERS COMMENT!');
    }
    if (body.includes('CLI Options')) {
      console.log('  📝 Contains CLI Options discussion');
    }
    
    console.log(`  Comment preview: ${body.substring(0, 150).replace(/\n/g, ' ')}...`);
    console.log(`  Created: ${comment?.createdAt}`);
  });
  
  // Also check for any thread mentioning max-workers
  console.log('\n\nSearching all threads for "max-workers" mentions...');
  const maxWorkersThreads = allThreads.filter(t => {
    const hasMaxWorkers = t.comments?.nodes?.some(c => 
      c.body?.includes('max-workers') || c.body?.includes('Maximum parallel analyzers')
    );
    return hasMaxWorkers;
  });
  
  console.log(`Found ${maxWorkersThreads.length} threads mentioning max-workers`);
  maxWorkersThreads.forEach(t => {
    console.log(`  - ${t.path}:${t.line} (${t.isResolved ? 'resolved' : 'open'}, ${t.isOutdated ? 'outdated' : 'current'})`);
  });
}

checkReadmeThreads().catch(console.error);