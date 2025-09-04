import { simpleGit, SimpleGit } from 'simple-git';
import * as diff from 'diff';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Logger } from '../lib/logger.js';
import { Config, PatchRequest } from '../types/index.js';

export class CodePatcherAgent {
  private logger = new Logger('CodePatcher');
  private git: SimpleGit;
  private workDir: string;

  constructor(
    private messageBus: MessageBus,
    _stateManager: StateManager,
    private config: Config
  ) {
    this.workDir = process.cwd();
    this.git = simpleGit(this.workDir);
    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    this.messageBus.subscribe('code-patcher', async (message) => {
      if (message.type === 'APPLY_PATCH') {
        const result = await this.applyPatch(message.payload);
        this.messageBus.respond(message, result);
      }
    });
  }

  async applyBatch(
    _repo: string,
    _prNumber: number,
    patches: PatchRequest[]
  ): Promise<{ success: boolean; applied: string[]; failed: string[] }> {
    this.logger.info(`Applying batch of ${patches.length} patches`);
    
    const result = {
      success: true,
      applied: [] as string[],
      failed: [] as string[],
    };

    // Apply patches sequentially to avoid conflicts
    for (const patchReq of patches) {
      try {
        await this.applyPatch(patchReq);
        result.applied.push(patchReq.threadId);
      } catch (error) {
        this.logger.error(`Failed to apply patch for thread ${patchReq.threadId}`, error);
        result.failed.push(patchReq.threadId);
        result.success = false;
      }
    }

    this.logger.info(`Applied ${result.applied.length}/${patches.length} patches`);
    return result;
  }

  private async applyPatch(patchRequest: PatchRequest): Promise<void> {
    if (this.config.dry_run) {
      this.logger.dryRun('apply patch', {
        threadId: patchRequest.threadId,
        file: patchRequest.filePath,
      });
      return;
    }

    const { filePath, patch: patchStr } = patchRequest;
    
    // Parse the patch to extract file path if not provided
    const actualFilePath = filePath || this.extractFilePathFromPatch(patchStr);
    if (!actualFilePath) {
      throw new Error('Could not determine file path from patch');
    }

    const fullPath = path.join(this.workDir, actualFilePath);
    const resolvedPath = path.resolve(fullPath);
    
    // Prevent path traversal attacks
    if (!resolvedPath.startsWith(path.resolve(this.workDir))) {
      throw new Error(`Path traversal detected: ${actualFilePath}`);
    }
    
    // Read current file content
    const currentContent = await fs.readFile(fullPath, 'utf-8');
    
    // Apply the patch
    const patchedContent = this.applyUnifiedDiff(currentContent, patchStr);
    
    // Write the patched content back
    await fs.writeFile(fullPath, patchedContent);
    
    this.logger.info(`Applied patch to ${actualFilePath}`);
  }

  private extractFilePathFromPatch(patchStr: string): string | null {
    // Extract file path from unified diff header
    const match = patchStr.match(/^--- a?\/(.+)$/m) || 
                  patchStr.match(/^\+\+\+ b?\/(.+)$/m);
    return match ? match[1] : null;
  }

  private applyUnifiedDiff(original: string, patchStr: string): string {
    // Parse and apply unified diff
    const patches = diff.parsePatch(patchStr);
    
    if (patches.length === 0) {
      throw new Error('Invalid patch format');
    }

    let result = original;
    
    for (const patch of patches) {
      for (const hunk of patch.hunks || []) {
        result = this.applyHunk(result, hunk);
      }
    }

    return result;
  }

  private applyHunk(content: string, hunk: any): string {
    const lines = content.split('\n');
    const startLine = hunk.oldStart - 1; // Convert to 0-based index
    
    // Remove old lines and add new lines
    const toRemove = hunk.oldLines;
    const newLines: string[] = [];
    
    for (const change of hunk.lines) {
      if (change.startsWith('+')) {
        newLines.push(change.substring(1));
      }
    }
    
    // Apply the changes
    lines.splice(startLine, toRemove, ...newLines);
    
    return lines.join('\n');
  }

  async commitAndPush(
    _repo: string,
    _prNumber: number,
    message: string
  ): Promise<string> {
    if (this.config.dry_run) {
      this.logger.dryRun('commit and push', { message });
      return 'dry-run-sha';
    }

    this.logger.info('Committing and pushing changes');
    
    try {
      // Stage all changes
      await this.git.add('.');
      
      // Commit with message
      await this.git.commit(message);
      
      // Get the commit SHA
      const log = await this.git.log({ n: 1 });
      const commitSha = log.latest?.hash;
      
      if (!commitSha) {
        throw new Error('Could not get commit SHA');
      }
      
      // Push to remote
      await this.git.push();
      
      this.logger.info(`Committed and pushed ${commitSha}`);
      return commitSha;
      
    } catch (error) {
      this.logger.error('Failed to commit and push', error);
      throw error;
    }
  }

  async revertCommit(_repo: string, commitSha: string): Promise<void> {
    if (this.config.dry_run) {
      this.logger.dryRun('revert commit', { commitSha });
      return;
    }

    this.logger.info(`Reverting commit ${commitSha}`);
    
    try {
      // Revert the commit
      await this.git.revert(commitSha, ['--no-edit']);
      
      // Push the revert
      await this.git.push();
      
      this.logger.info(`Reverted commit ${commitSha}`);
    } catch (error) {
      this.logger.error('Failed to revert commit', error);
      throw error;
    }
  }

  async checkoutBranch(branchName: string, baseBranch?: string): Promise<void> {
    if (this.config.dry_run) {
      this.logger.dryRun('checkout branch', { branchName, baseBranch });
      return;
    }

    try {
      if (baseBranch) {
        // Create new branch from base
        await this.git.checkoutBranch(branchName, baseBranch);
      } else {
        // Just checkout existing branch
        await this.git.checkout(branchName);
      }
      
      this.logger.info(`Checked out branch ${branchName}`);
    } catch (error) {
      this.logger.error('Failed to checkout branch', error);
      throw error;
    }
  }

  async ensureCleanWorkingDirectory(): Promise<boolean> {
    const status = await this.git.status();
    
    if (!status.isClean()) {
      this.logger.warn('Working directory is not clean', {
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
      });
      return false;
    }
    
    return true;
  }
}