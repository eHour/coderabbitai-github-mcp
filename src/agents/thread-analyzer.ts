import picomatch from 'picomatch';
import { MessageBus } from '../lib/message-bus.js';
import { StateManager } from '../lib/state-manager.js';
import { Logger } from '../lib/logger.js';
import { 
  Config, 
  ReviewThread, 
  ValidationResult, 
  AnalysisResult 
} from '../types/index.js';

export class ThreadAnalyzerAgent {
  private logger: Logger;

  constructor(
    private workerId: number,
    private messageBus: MessageBus,
    _stateManager: StateManager,
    private config: Config
  ) {
    this.logger = new Logger(`Analyzer-${workerId}`);

    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    this.messageBus.subscribe(`analyzer-${this.workerId}`, async (message) => {
      if (message.type === 'ANALYZE_THREAD') {
        const result = await this.analyzeThread(
          message.payload.thread,
          message.payload.repo,
          message.payload.prNumber
        );
        this.messageBus.respond(message, result);
      }
    });
  }

  async analyzeThread(
    thread: ReviewThread,
    _repo: string,
    _prNumber: number
  ): Promise<AnalysisResult> {
    // Extract comment preview for better visibility
    const lines = thread.body.split('\n');
    const noiseRe = /^(?:#|```|⚠️|🛠️|🐛|🔒|⚡|📚)/u;
    const suggestionLine = lines.find((line) => {
      const t = line.trim();
      return t && !noiseRe.test(t);
    }) || '';
    const preview = suggestionLine.replace(/[*_`]/g, '').trim().substring(0, 100);
    const location = thread.path ? `${thread.path}:${thread.line || '?'}` : 'no file';
    
    this.logger.info(`\n${'='.repeat(60)}`);
    this.logger.info(`ANALYZING THREAD: ${thread.id}`);
    this.logger.info(`📁 Location: ${location}`);
    this.logger.info(`💬 Comment: "${preview}${suggestionLine.length > 100 ? '...' : ''}"`);
    
    try {
      // Extract the CodeRabbit suggestion
      const suggestion = this.extractSuggestion(thread);
      
      // First, try heuristics
      const heuristicResult = this.applyHeuristics(suggestion, thread);
      if (heuristicResult) {
        this.logger.info(`✅ Heuristic Result: ${String(heuristicResult.result).toUpperCase()}`);
        this.logger.info(`   Reason: ${heuristicResult.reasoning}`);
        this.logger.info(`   Confidence: ${(heuristicResult.confidence * 100).toFixed(0)}%`);
        return heuristicResult;
      }

      // Default to needs review if no heuristic match
      return {
        threadId: thread.id,
        result: ValidationResult.NEEDS_REVIEW,
        confidence: 0.5,
        reasoning: 'No validation method available',
      };
    } catch (error) {
      this.logger.error(`Failed to analyze thread ${thread.id}`, error);
      return {
        threadId: thread.id,
        result: ValidationResult.UNPATCHABLE,
        confidence: 0,
        reasoning: 'Analysis failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private extractSuggestion(thread: ReviewThread): {
    type: string;
    description: string;
    code?: string;
    file?: string;
    line?: number;
    startLine?: number;
    committableSuggestion?: string;
    aiPrompt?: string;
  } {
    const body = thread.body ?? '';
    
    // Extract suggestion type from emoji or text (case-insensitive)
    const lc = body.toLowerCase();
    let type = 'suggestion';
    if (body.includes('🛠️') || body.includes('🔧') || lc.includes('refactor')) type = 'refactor';
    else if (body.includes('🐛') || lc.includes('bug')) type = 'bug';
    else if (body.includes('⚠️') || lc.includes('warning')) type = 'warning';
    else if (body.includes('🔒') || lc.includes('security') || lc.includes('vulnerability')) type = 'security';
    else if (body.includes('⚡') || lc.includes('perf') || lc.includes('performance')) type = 'performance';
    
    // Extract code blocks
    const codeMatches = body.match(/```[\s\S]*?```/g) || [];
    const code = codeMatches[0];
    
    // Extract committable suggestion if present
    const committableMatch = body.match(/📝?\s*Committable suggestion[\s\S]*?```[\s\S]*?```/);
    const committableSuggestion = committableMatch ? 
      committableMatch[0].match(/```[\s\S]*?```/)?.[0] : undefined;
    
    // Extract AI prompt if present
    const aiPromptMatch = body.match(/🤖?\s*Prompt for AI Agents[\s\S]*$/);
    const aiPrompt = aiPromptMatch ? aiPromptMatch[0] : undefined;
    
    return {
      type,
      description: body,
      code,
      file: thread.path,
      line: thread.line,
      startLine: thread.startLine,
      committableSuggestion,
      aiPrompt,
    };
  }

  private applyHeuristics(
    suggestion: ReturnType<typeof this.extractSuggestion>,
    thread: ReviewThread
  ): AnalysisResult | null {
    const { autoAccept, autoReject } = this.config.validation;
    
    // Check auto-accept patterns
    for (const pattern of autoAccept) {
      if (this.matchesPattern(suggestion, pattern)) {
        return {
          threadId: thread.id,
          result: ValidationResult.VALID,
          confidence: 1.0,
          reasoning: `Matches auto-accept pattern: ${pattern}`,
          patch: this.generatePatchFromSuggestion(suggestion),
        };
      }
    }
    
    // Check auto-reject patterns
    for (const pattern of autoReject) {
      if (this.matchesPattern(suggestion, pattern)) {
        return {
          threadId: thread.id,
          result: ValidationResult.INVALID,
          confidence: 1.0,
          reasoning: `Matches auto-reject pattern: ${pattern}`,
        };
      }
    }
    
    // Check for generated/binary files
    if (suggestion.file) {
      const rejectExtensions = ['.min.js', '.bundle.js', '.map', '.lock'];
      if (rejectExtensions.some(ext => suggestion.file!.endsWith(ext))) {
        return {
          threadId: thread.id,
          result: ValidationResult.INVALID,
          confidence: 1.0,
          reasoning: 'Generated or binary file',
        };
      }
    }
    
    // Security issues are always valid
    if (suggestion.type === 'security' || 
        suggestion.description.toLowerCase().includes('security') ||
        suggestion.description.toLowerCase().includes('vulnerability')) {
      const patch = this.generatePatchFromSuggestion(suggestion);
      return {
        threadId: thread.id,
        result: patch ? ValidationResult.VALID : ValidationResult.NEEDS_REVIEW,
        confidence: 0.9,
        reasoning: 'Security/critical issue',
        patch,
      };
    }
    
    // Bug fixes are usually valid
    if (suggestion.type === 'bug') {
      const patch = this.generatePatchFromSuggestion(suggestion);
      return {
        threadId: thread.id,
        result: patch ? ValidationResult.VALID : ValidationResult.NEEDS_REVIEW,
        confidence: 0.8,
        reasoning: 'Bug fix suggestion',
        patch,
      };
    }
    
    // Performance improvements are usually valid
    if (suggestion.type === 'performance') {
      const patch = this.generatePatchFromSuggestion(suggestion);
      return {
        threadId: thread.id,
        result: patch ? ValidationResult.VALID : ValidationResult.NEEDS_REVIEW,
        confidence: 0.7,
        reasoning: 'Performance improvement',
        patch,
      };
    }
    
    // If we have a committable suggestion, it's likely valid
    if (suggestion.committableSuggestion) {
      const patch = this.generatePatchFromSuggestion(suggestion);
      if (patch) {
        return {
          threadId: thread.id,
          result: ValidationResult.VALID,
          confidence: 0.75,
          reasoning: 'Has committable suggestion with generated patch',
          patch,
        };
      }
    }
    
    // If we have an AI prompt, CodeRabbit thinks it needs fixing
    if (suggestion.aiPrompt) {
      const patch = this.generatePatchFromSuggestion(suggestion);
      if (patch) {
        return {
          threadId: thread.id,
          result: ValidationResult.VALID,
          confidence: 0.65,
          reasoning: 'Has AI prompt indicating actionable suggestion',
          patch,
        };
      }
    }
    
    return null;
  }

  private matchesPattern(
    suggestion: ReturnType<typeof this.extractSuggestion>,
    pattern: string
  ): boolean {
    // Use safe glob matching to prevent ReDoS
    if (pattern.includes('*')) {
      const isMatch = (s: string | undefined) =>
        !!s && picomatch.isMatch(s, pattern, { nocase: true });
      return isMatch(suggestion.type) ||
             isMatch(suggestion.description) ||
             isMatch(suggestion.file);
    }
    
    return suggestion.type.includes(pattern) || 
           suggestion.description.includes(pattern) ||
           (suggestion.file?.includes(pattern) ?? false);
  }

  private generatePatchFromSuggestion(
    suggestion: ReturnType<typeof this.extractSuggestion>
  ): string | undefined {
    // First check if we have a committable suggestion
    if (suggestion.committableSuggestion) {
      return this.createPatchFromCommittable(suggestion);
    }
    
    // Check if the code block contains a diff
    if (suggestion.code?.includes('```diff')) {
      return suggestion.code
        .replace(/```diff\n?/, '')
        .replace(/```$/, '')
        .trim();
    }
    
    // Try to create a patch from the visual diff format (- and + lines)
    if (suggestion.code && (suggestion.code.includes('- ') || suggestion.code.includes('+ '))) {
      return this.createPatchFromVisualDiff(suggestion);
    }
    
    return undefined;
  }

  private createPatchFromCommittable(
    suggestion: ReturnType<typeof this.extractSuggestion>
  ): string | undefined {
    if (!suggestion.file || !suggestion.committableSuggestion) {
      return undefined;
    }

    // Extract the code from the committable suggestion
    const newCode = suggestion.committableSuggestion
      .replace(/```[\w]*\n?/, '')
      .replace(/```$/, '')
      .trim();

    // Create a unified diff header
    const fileName = suggestion.file;
    const startLine = Math.max(1, suggestion.startLine ?? suggestion.line ?? 1);
    const newLines = newCode.split('\n');
    const newCount = Math.max(1, newLines.length);
    const oldCount = newCount; // best-effort; without context we assume replacement of same length
    
    // Build a simple unified diff
    // Note: This is a simplified version. In production, you'd want to:
    // 1. Fetch the actual file content
    // 2. Calculate proper line numbers
    // 3. Generate accurate context lines
    const patch = [
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      `@@ -${startLine},${oldCount} +${startLine},${newCount} @@`,
      ...newLines.map(line => `+${line}`)
    ].join('\n');

    return patch;
  }

  private createPatchFromVisualDiff(
    suggestion: ReturnType<typeof this.extractSuggestion>
  ): string | undefined {
    if (!suggestion.file || !suggestion.code) {
      return undefined;
    }

    // Extract lines from the code block
    const codeContent = suggestion.code
      .replace(/```[\w]*\n?/, '')
      .replace(/```$/, '')
      .trim();

    const lines = codeContent.split('\n');
    const removedLines: string[] = [];
    const addedLines: string[] = [];
    const contextLines: string[] = [];

    // Parse the visual diff format
    for (const line of lines) {
      if (line.startsWith('- ') || line.startsWith('-\t')) {
        removedLines.push(line.substring(2));
      } else if (line.startsWith('+ ') || line.startsWith('+\t')) {
        addedLines.push(line.substring(2));
      } else if (!line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('@@')) {
        // Context line (neither + nor -)
        contextLines.push(line);
      }
    }

    if (removedLines.length === 0 && addedLines.length === 0) {
      return undefined;
    }

    // Build unified diff
    const fileName = suggestion.file;
    const startLine = suggestion.startLine || suggestion.line || 1;
    const removedCount = Math.max(1, removedLines.length + contextLines.length);
    const addedCount = Math.max(1, addedLines.length + contextLines.length);

    const patch = [
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      `@@ -${startLine},${removedCount} +${startLine},${addedCount} @@`,
      ...contextLines.map(line => ` ${line}`),
      ...removedLines.map(line => `-${line}`),
      ...addedLines.map(line => `+${line}`)
    ].join('\n');

    return patch;
  }
}