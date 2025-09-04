#!/usr/bin/env node

/**
 * CodeRabbit PR Review Resolver Agent
 * 
 * This agent automates the process of reviewing and resolving CodeRabbit PR comments.
 * It fetches unresolved threads, validates suggestions, applies fixes, and resolves threads.
 * 
 * Usage: claude agent:run coderabbit-resolver --repo owner/name --pr 123
 */

export const metadata = {
  name: 'coderabbit-resolver',
  version: '1.0.0',
  description: 'Automatically review and resolve CodeRabbit PR suggestions',
  author: 'CodeRabbit MCP Team',
  tags: ['automation', 'pr-review', 'coderabbit', 'github'],
  parameters: {
    repo: {
      type: 'string',
      description: 'Repository in format owner/name',
      required: true,
    },
    pr: {
      type: 'number', 
      description: 'Pull request number',
      required: true,
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview changes without applying them',
      default: false,
    },
    autoResolve: {
      type: 'boolean',
      description: 'Automatically resolve threads after fixes',
      default: true,
    },
    batchSize: {
      type: 'number',
      description: 'Number of threads to process at once',
      default: 5,
    },
  },
};

export async function run({ repo, pr, dryRun = false, autoResolve = true, batchSize = 5 }) {
  console.log(`🤖 CodeRabbit Resolver Agent`);
  console.log(`📍 Repository: ${repo}`);
  console.log(`📝 PR: #${pr}`);
  console.log(`🔧 Mode: ${dryRun ? 'Dry Run' : 'Live'}`);
  console.log(`✅ Auto-resolve: ${autoResolve}`);
  console.log('');

  const processedThreads = [];
  const skippedThreads = [];
  const failedThreads = [];
  let page = 1;
  let hasMore = true;

  // Main workflow
  while (hasMore) {
    console.log(`📥 Fetching threads (page ${page}, size ${batchSize})...`);
    
    // 1. Fetch CodeRabbit threads
    const threadsResponse = await callTool('mcp__coderabbit__get_coderabbit_threads', {
      repo,
      prNumber: pr,
      page,
      pageSize: batchSize,
    });

    if (!threadsResponse.threads || threadsResponse.threads.length === 0) {
      console.log('✅ No more threads to process!');
      break;
    }

    console.log(`📊 Found ${threadsResponse.threads.length} threads (Total: ${threadsResponse.totalCount})`);
    
    // 2. Process each thread
    for (const thread of threadsResponse.threads) {
      // Extract comment preview (first 80 chars of the actual suggestion)
      const commentLines = thread.body.split('\n');
      const suggestionLine = commentLines.find(line => line.trim() && !line.startsWith('#') && !line.includes('```')) || '';
      const preview = suggestionLine.replace(/[*_`]/g, '').trim().substring(0, 80);
      
      console.log(`\n${'='.repeat(70)}`);
      console.log(`📌 THREAD ${threadsResponse.threads.indexOf(thread) + 1}/${threadsResponse.threads.length}: ${thread.id}`);
      console.log(`${'='.repeat(70)}`);
      console.log(`📁 File: ${thread.path || 'N/A'}`);
      console.log(`📍 Line: ${thread.line || 'N/A'}`);
      console.log(`💬 Comment: "${preview}${suggestionLine.length > 80 ? '...' : ''}"`);
      
      // Extract the issue type from the body
      const issueType = detectIssueType(thread.body);
      console.log(`🏷️  Category: ${issueType}`);

      // Step 1: REVIEW - Validate the suggestion
      console.log(`\n📋 Step 1: REVIEW`);
      const validation = await validateSuggestion(thread, issueType);
      
      if (validation.isValid) {
        console.log(`   ✅ Review Result: ACCEPTED - ${validation.reason}`);
        
        if (!dryRun && thread.suggestion?.codeBlocks?.[0]) {
          try {
            // Step 2: FIX - Apply the changes
            console.log(`\n🔧 Step 2: FIX`);
            console.log(`   Extracting fix from suggestion...`);
            const fix = extractFixFromDiff(thread.suggestion.codeBlocks[0]);
            
            if (fix) {
              console.log(`   Applying patch to ${thread.path}...`);
              await applyFix(repo, pr, thread, fix);
              
              // Step 3: COMMIT - Create a commit
              console.log(`\n💾 Step 3: COMMIT`);
              console.log(`   Creating commit for thread ${thread.id}...`);
              
              // Step 4: PUSH - Push to remote
              console.log(`\n⬆️  Step 4: PUSH`);
              console.log(`   Pushing changes to remote...`);
              
              processedThreads.push(thread.id);
              
              // Step 5: RESOLVE - Mark thread as resolved
              if (autoResolve) {
                console.log(`\n✅ Step 5: RESOLVE`);
                console.log(`   Marking thread as resolved...`);
                await callTool('mcp__coderabbit__github_resolve_thread', {
                  repo,
                  prNumber: pr,
                  threadId: thread.id,
                });
                console.log(`   Thread successfully resolved!`);
              }
              
              // Step 6: NEXT - Move to next thread
              console.log(`\n➡️  Step 6: NEXT`);
              console.log(`   Moving to next thread...`);
            } else {
              console.log(`   ⚠️  Could not extract fix from suggestion`);
              console.log(`   Skipping to next thread...`);
              skippedThreads.push(thread.id);
            }
          } catch (error) {
            console.error(`\n❌ ERROR: Failed to process thread`);
            console.error(`   Details: ${error.message}`);
            failedThreads.push(thread.id);
          }
        } else if (dryRun) {
          console.log(`   🔍 [DRY RUN] Would follow flow: REVIEW → FIX → COMMIT → PUSH → RESOLVE`);
          processedThreads.push(thread.id);
        }
      } else {
        console.log(`   ❌ Review Result: REJECTED - ${validation.reason}`);
        
        if (!dryRun && validation.shouldComment) {
          // Post a comment explaining why we're not applying this
          console.log(`   💬 Posting dispute comment...`);
          await callTool('mcp__coderabbit__github_post_review_comment', {
            repo,
            prNumber: pr,
            threadId: thread.id,
            body: `@coderabbitai This suggestion was reviewed but not applied. Reason: ${validation.reason}`,
          });
        }
        
        skippedThreads.push(thread.id);
      }
    }

    hasMore = threadsResponse.hasMore;
    page++;
  }

  // 6. Summary report
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY REPORT');
  console.log('='.repeat(60));
  console.log(`✅ Processed: ${processedThreads.length} threads`);
  console.log(`⏭️  Skipped: ${skippedThreads.length} threads`);
  console.log(`❌ Failed: ${failedThreads.length} threads`);
  
  if (processedThreads.length > 0) {
    console.log('\n📝 Processed thread IDs:');
    processedThreads.forEach(id => console.log(`   - ${id}`));
  }
  
  if (failedThreads.length > 0) {
    console.log('\n❌ Failed thread IDs:');
    failedThreads.forEach(id => console.log(`   - ${id}`));
  }

  return {
    success: failedThreads.length === 0,
    processed: processedThreads,
    skipped: skippedThreads,
    failed: failedThreads,
  };
}

// Helper: Detect issue type from CodeRabbit comment
function detectIssueType(body) {
  if (body.includes('⚠️ Potential issue')) return 'potential-issue';
  if (body.includes('🛠️ Refactor suggestion')) return 'refactor';
  if (body.includes('🐛 Bug')) return 'bug';
  if (body.includes('🔒 Security')) return 'security';
  if (body.includes('⚡ Performance')) return 'performance';
  if (body.includes('📚 Documentation')) return 'documentation';
  return 'suggestion';
}

// Helper: Validate if a suggestion should be applied
async function validateSuggestion(thread, issueType) {
  // Auto-accept critical issues
  const autoAcceptTypes = ['bug', 'security', 'potential-issue'];
  if (autoAcceptTypes.includes(issueType)) {
    return {
      isValid: true,
      reason: `Auto-accepted ${issueType}`,
      shouldComment: false,
    };
  }

  // Auto-reject certain patterns
  const rejectPatterns = [
    /add.*comment/i,
    /add.*documentation/i,
    /add.*todo/i,
    /consider\s+using/i,
    /might\s+want\s+to/i,
  ];

  for (const pattern of rejectPatterns) {
    if (pattern.test(thread.body)) {
      return {
        isValid: false,
        reason: 'Subjective style suggestion',
        shouldComment: true,
      };
    }
  }

  // Check if it's a substantive code fix
  if (thread.suggestion?.codeBlocks?.length > 0) {
    const diff = thread.suggestion.codeBlocks[0];
    if (diff.includes('```diff')) {
      // It has actual code changes
      return {
        isValid: true,
        reason: 'Contains concrete code improvements',
        shouldComment: false,
      };
    }
  }

  // Default: skip non-critical suggestions
  return {
    isValid: false,
    reason: 'Non-critical suggestion without clear benefit',
    shouldComment: false,
  };
}

// Helper: Extract fix from diff block
function extractFixFromDiff(codeBlock) {
  if (!codeBlock || !codeBlock.includes('```diff')) {
    return null;
  }

  // Parse the diff to extract file path and changes
  const lines = codeBlock.split('\n');
  const additions = [];
  const deletions = [];
  
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions.push(line.substring(1));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions.push(line.substring(1));
    }
  }

  if (additions.length === 0 && deletions.length === 0) {
    return null;
  }

  return {
    additions: additions.join('\n'),
    deletions: deletions.join('\n'),
    raw: codeBlock,
  };
}

// Helper: Apply a fix to a file
async function applyFix(repo, pr, thread, fix) {
  // Use the MCP tool that handles the complete fix workflow
  const result = await callTool('apply_validated_fix', {
    repo: repo,
    prNumber: pr,
    threadId: thread.id,
    filePath: thread.path,
    diffString: fix.raw,
    commitMessage: `fix: apply CodeRabbit suggestion from thread ${thread.id.slice(-6)}`
  });
  
  return result;
}

// Helper: Call a tool using Claude's tool system
async function callTool(toolName, params) {
  // Map tool names to their full MCP names if needed
  const toolMap = {
    'get_coderabbit_threads': 'mcp__coderabbit__get_coderabbit_threads',
    'github_resolve_thread': 'mcp__coderabbit__github_resolve_thread',
    'github_post_review_comment': 'mcp__coderabbit__github_post_review_comment',
    'apply_validated_fix': 'mcp__coderabbit__apply_validated_fix',
    'github_get_pr_meta': 'mcp__coderabbit__github_get_pr_meta',
  };
  
  // Use mapped name if available, otherwise use as-is
  const actualToolName = toolMap[toolName] || toolName;
  
  console.log(`   🔧 Calling tool: ${actualToolName}`);
  
  try {
    // This uses Claude's actual tool-calling mechanism
    // When this agent runs in Claude Code, this will work
    const result = await useTool(actualToolName, params);
    return result;
  } catch (error) {
    console.error(`   ❌ Tool call failed: ${error.message}`);
    throw error;
  }
}

// Export for testing
export default { metadata, run };