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
      if (message.type !== 'APPLY_PATCH') return;
      try {
        await this.applyPatch(message.payload);
        this.messageBus.respond(message, { success: true });
      } catch (error) {
        this.logger.error('Failed to apply patch', error);
        this.messageBus.respond(message, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
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
    
    // Get real path of base directory for traversal checks
    const baseReal = await fs.realpath(this.workDir);
    
    // For new files, we need to handle missing target files properly
    let targetReal: string;
    try {
      // Try to get real path of the target file (works for existing files)
      targetReal = await fs.realpath(resolvedPath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        // File doesn't exist - get real path of parent directory
        const parentDir = path.dirname(resolvedPath);
        let parentReal: string;
        try {
          parentReal = await fs.realpath(parentDir);
        } catch (parentErr: any) {
          if (parentErr?.code === 'ENOENT') {
            // Parent doesn't exist either - we'll need to create it
            // Find the first existing ancestor
            let currentPath = parentDir;
            let existingAncestor = '';
            while (currentPath !== path.dirname(currentPath)) {
              try {
                existingAncestor = await fs.realpath(currentPath);
                break;
              } catch {
                currentPath = path.dirname(currentPath);
              }
            }
            if (!existingAncestor) {
              existingAncestor = baseReal;
            }
            parentReal = path.join(existingAncestor, path.relative(currentPath, parentDir));
          } else {
            throw new Error(`Cannot resolve parent directory for: ${actualFilePath} - ${parentErr.message}`);
          }
        }
        // Compute intended target path
        targetReal = path.join(parentReal, path.basename(resolvedPath));
      } else {
        throw err;
      }
    }
    
    // Check for path traversal
    const relPath = path.relative(baseReal, targetReal);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      throw new Error(`Path traversal detected: ${actualFilePath} would write outside project directory`);
    }
    
    // Check that no path component between baseReal and target is a symlink
    // This prevents writing through symlinks even if the final destination is valid
    const pathComponents = relPath.split(path.sep).filter(Boolean);
    let currentCheckPath = baseReal;
    for (const component of pathComponents) {
      currentCheckPath = path.join(currentCheckPath, component);
      try {
        const stat = await fs.lstat(currentCheckPath);
        if (stat.isSymbolicLink()) {
          throw new Error(
            `Refusing to write through symlink at: ${currentCheckPath} while writing to ${actualFilePath}`
          );
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          // ENOENT is fine - means we're creating a new path
          if (err.message?.includes('Refusing to write through symlink')) {
            throw err; // Re-throw our own error
          }
          throw new Error(`Error checking path component ${currentCheckPath}: ${err.message}`);
        }
        // Path doesn't exist yet, which is fine for new files
        break;
      }
    }
    
    // Read current file content (treat ENOENT as new file)
    let currentContent = '';
    try {
      currentContent = await fs.readFile(targetReal, 'utf-8');
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
    
    // Apply the patch
    const patchedContent = this.applyUnifiedDiff(currentContent, patchStr);
    
    // Ensure directory exists (create if needed)
    const targetDir = path.dirname(targetReal);
    await fs.mkdir(targetDir, { recursive: true });
    
    // Final check: make sure target is not a symlink (for existing files)
    try {
      const st = await fs.lstat(targetReal);
      if (st.isSymbolicLink()) {
        throw new Error(`Refusing to write to symlink: ${actualFilePath}`);
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err; // ok if file doesn't exist yet
    }
    
    // Write the patched content to the resolved target path
    await fs.writeFile(targetReal, patchedContent);
    
    this.logger.info(`Applied patch to ${actualFilePath}`);
  }

  private extractFilePathFromPatch(patchStr: string): string | null {
    // Extract file path from unified diff headers; ignore device paths and pick first valid
    const m1 = patchStr.match(/^---\s+(?:a\/)?([^\s]+)/m);
    const m2 = patchStr.match(/^\+\+\+\s+(?:b\/)?([^\s]+)/m);
    const candidates = [m1?.[1], m2?.[1]]
      .filter(Boolean)
      .map(s => (s as string).trim().replace(/^"(.*)"$/, '$1'));
    for (const p of candidates) {
      // Ignore special device paths
      if (p === '/dev/null' || p === 'dev/null' || p.toUpperCase() === 'NUL') continue;
      return p;
    }
    return null;
  }

  private applyUnifiedDiff(original: string, patchStr: string): string {
    const patched = diff.applyPatch(original, patchStr);
    if (patched === false) {
      throw new Error('Failed to apply patch');
    }
    return patched;
  }

  // Removed custom applyHunk; rely on diff.applyPatch

  async commitLocally(
    _repo: string,
    _prNumber: number,
    message: string
  ): Promise<string> {
    if (this.config.dry_run) {
      this.logger.dryRun('commit locally', { message });
      return 'dry-run-sha';
    }

    this.logger.info('Committing changes locally');
    
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
      
      this.logger.info(`Committed locally: ${commitSha}`);
      return commitSha;
      
    } catch (error) {
      this.logger.error('Failed to commit', error);
      throw error;
    }
  }

  async pushChanges(
    _repo: string,
    _prNumber: number
  ): Promise<void> {
    if (this.config.dry_run) {
      this.logger.dryRun('push changes', {});
      return;
    }

    this.logger.info('Pushing changes to remote');
    
    try {
      await this.git.push();
      this.logger.info('Successfully pushed changes');
    } catch (error) {
      this.logger.error('Failed to push', error);
      throw error;
    }
  }

  async commitAndPush(
    repo: string,
    prNumber: number,
    message: string
  ): Promise<string> {
    const commitSha = await this.commitLocally(repo, prNumber, message);
    await this.pushChanges(repo, prNumber);
    return commitSha;
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