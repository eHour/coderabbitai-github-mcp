import { graphql } from '@octokit/graphql';
import { loadConfig } from './dist/config/loader.js';

const config = loadConfig();
const graphqlClient = graphql.defaults({
  headers: {
    authorization: `token ${config.github.token}`,
  },
});

async function debugThreads() {
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            totalCount
            nodes {
              id
              isResolved
              isOutdated
              isCollapsed
              path
              line
              comments(first: 10) {
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

  const response = await graphqlClient(query, {
    owner: 'eHour',
    name: 'coderabbitai-github-mcp',
    number: 1,
  });

  const threads = response?.repository?.pullRequest?.reviewThreads?.nodes || [];
  console.log('Total threads from GraphQL:', threads.length);
  
  const coderabbitThreads = threads.filter(t => {
    const firstComment = t.comments?.nodes?.[0];
    return firstComment?.author?.login === 'coderabbitai' || 
           firstComment?.author?.login === 'coderabbitai[bot]';
  });
  
  console.log('CodeRabbit threads:', coderabbitThreads.length);
  console.log('\nThread states:');
  
  const states = {
    resolved: 0,
    unresolved: 0,
    outdated: 0,
    collapsed: 0,
    current: 0
  };
  
  coderabbitThreads.forEach(t => {
    if (t.isResolved) states.resolved++;
    if (!t.isResolved) states.unresolved++;
    if (t.isOutdated) states.outdated++;
    if (t.isCollapsed) states.collapsed++;
    if (!t.isOutdated && !t.isCollapsed) states.current++;
  });
  
  console.log(states);
  
  // Show unresolved threads
  const unresolvedCR = coderabbitThreads.filter(t => !t.isResolved);
  console.log('\nUnresolved CodeRabbit threads:', unresolvedCR.length);
  
  if (unresolvedCR.length > 0) {
    unresolvedCR.forEach(t => {
      console.log('\nUnresolved thread:', t.path + ':' + t.line);
      console.log('  Outdated:', t.isOutdated);
      console.log('  Collapsed:', t.isCollapsed);
      console.log('  Body:', t.comments?.nodes?.[0]?.body?.substring(0, 100));
    });
  }
  
  // Check for threads that are resolved but not outdated
  const resolvedNotOutdated = coderabbitThreads.filter(t => t.isResolved && !t.isOutdated);
  console.log('\n\nResolved but not outdated:', resolvedNotOutdated.length);
  if (resolvedNotOutdated.length > 0) {
    console.log('These might be visible in UI:');
    resolvedNotOutdated.forEach(t => {
      console.log(`  ${t.path}:${t.line}`);
    });
  }
}

debugThreads().catch(console.error);