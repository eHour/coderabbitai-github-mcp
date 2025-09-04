#!/usr/bin/env tsx

import { spawn } from 'child_process';
import * as readline from 'readline';

/**
 * Test script to interact with the MCP server like Claude Code would
 */

const server = spawn('npm', ['start'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd()
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let requestId = 1;

// Handle server output
server.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      if (line.startsWith('{')) {
        const response = JSON.parse(line);
        console.log('\n📥 Response:', JSON.stringify(response, null, 2));
      }
    }
  } catch (e) {
    // Not JSON, probably log output
    console.log('📝 Server log:', data.toString());
  }
});

server.stderr.on('data', (data) => {
  console.error('❌ Server error:', data.toString());
});

// Send a request to the server
function sendRequest(method: string, params: any = {}) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params
  };
  
  console.log('\n📤 Request:', JSON.stringify(request, null, 2));
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Interactive menu
function showMenu() {
  console.log('\n=== MCP Server Test Menu ===');
  console.log('1. List available tools');
  console.log('2. Get CodeRabbit threads');
  console.log('3. Check rate limit status');
  console.log('4. Apply validated fix (dry run)');
  console.log('5. Run orchestrator (internal validation)');
  console.log('6. Run orchestrator (external validation)');
  console.log('q. Quit');
  console.log('========================\n');
  
  rl.question('Choose option: ', (answer) => {
    switch(answer) {
      case '1':
        sendRequest('tools/list');
        setTimeout(showMenu, 1000);
        break;
        
      case '2':
        rl.question('Enter repo (owner/name): ', (repo) => {
          rl.question('Enter PR number: ', (pr) => {
            sendRequest('tools/call', {
              name: 'get_coderabbit_threads',
              arguments: { repo, prNumber: parseInt(pr) }
            });
            setTimeout(showMenu, 2000);
          });
        });
        break;
        
      case '3':
        sendRequest('tools/call', {
          name: 'get_rate_limit_status',
          arguments: {}
        });
        setTimeout(showMenu, 1000);
        break;
        
      case '4':
        console.log('Enter fix details:');
        rl.question('Repo: ', (repo) => {
          rl.question('PR number: ', (prNumber) => {
            rl.question('Thread ID: ', (threadId) => {
              rl.question('File path: ', (filePath) => {
                const diffString = `--- a/${filePath}
+++ b/${filePath}
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;
                sendRequest('tools/call', {
                  name: 'apply_validated_fix',
                  arguments: {
                    repo,
                    prNumber: parseInt(prNumber),
                    threadId,
                    filePath,
                    diffString,
                    commitMessage: 'Test fix'
                  }
                });
                setTimeout(showMenu, 2000);
              });
            });
          });
        });
        break;
        
      case '5':
        rl.question('Enter repo: ', (repo) => {
          rl.question('Enter PR number: ', (pr) => {
            sendRequest('tools/call', {
              name: 'run_orchestrator',
              arguments: {
                repo,
                prNumber: parseInt(pr),
                dryRun: true,
                validationMode: 'internal'
              }
            });
            setTimeout(showMenu, 3000);
          });
        });
        break;
        
      case '6':
        rl.question('Enter repo: ', (repo) => {
          rl.question('Enter PR number: ', (pr) => {
            sendRequest('tools/call', {
              name: 'run_orchestrator',
              arguments: {
                repo,
                prNumber: parseInt(pr),
                dryRun: true,
                validationMode: 'external'
              }
            });
            setTimeout(showMenu, 3000);
          });
        });
        break;
        
      case 'q':
        console.log('Shutting down...');
        server.kill();
        process.exit(0);
        break;
        
      default:
        console.log('Invalid option');
        showMenu();
    }
  });
}

// Start the interactive session
console.log('🚀 Starting MCP Server Test...\n');
setTimeout(() => {
  showMenu();
}, 2000);

// Handle exit
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.kill();
  process.exit(0);
});