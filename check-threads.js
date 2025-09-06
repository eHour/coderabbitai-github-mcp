const { graphql } = require('@octokit/graphql');
require('dotenv').config();

const graphqlClient = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

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
            path
            line
            comments(first: 1) {
              nodes {
                author {
                  login
                }
                body
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;

(async () => {
  try {
    const response = await graphqlClient(query, {
      owner: 'eHour',
      name: 'coderabbitai-github-mcp',
      number: 1
    });
    
    const threads = response.repository.pullRequest.reviewThreads.nodes;
    console.log('Total threads:', threads.length);
    
    const unresolved = threads.filter(t => !t.isResolved);
    console.log('Unresolved threads:', unresolved.length);
    
    // Show all unresolved threads
    let coderabbitCount = 0;
    for (const thread of unresolved) {
      const author = thread.comments.nodes[0]?.author?.login || 'unknown';
      if (author.includes('coderabbit')) {
        coderabbitCount++;
        console.log('\n--- CODERABBIT THREAD #' + coderabbitCount + ' ---');
        console.log('Author:', author);
        console.log('Path:', thread.path);
        console.log('Line:', thread.line);
        console.log('Outdated:', thread.isOutdated);
        console.log('Thread ID:', thread.id);
        console.log('Created:', thread.comments.nodes[0]?.createdAt);
        console.log('Body preview:');
        console.log((thread.comments.nodes[0]?.body || '').substring(0, 400));
      }
    }
    
    if (coderabbitCount === 0) {
      console.log('\nNo unresolved CodeRabbit threads found');
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (err.status === 401) {
      console.error('Token issue - check if GITHUB_TOKEN is loaded correctly');
    }
  }
})();