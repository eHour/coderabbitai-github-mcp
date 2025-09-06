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
    const suggestionLine = lines.find(line => 
      line.trim() && 
      !line.startsWith('#') && 
      !line.includes('```') &&
      !line.match(/^[⚠️🛠️🐛🔒⚡📚]/u)
    ) || '';
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
  } {
    const body = thread.body;
    
    // Extract suggestion type (e.g., "Consider", "Suggestion", "Critical")
    const typeMatch = body.match(/^(?:\*\*)?(\w+)(?:\*\*)?:/);
    const type = typeMatch ? typeMatch[1].toLowerCase() : 'suggestion';
    
    // Extract code blocks
    const codeMatch = body.match(/```[\s\S]*?```/g);
    const code = codeMatch ? codeMatch[0] : undefined;
    
    return {
      type,
      description: body,
      code,
      file: thread.path,
      line: thread.line,
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
    if (suggestion.type === 'critical' || 
        suggestion.description.toLowerCase().includes('security') ||
        suggestion.description.toLowerCase().includes('vulnerability')) {
      return {
        threadId: thread.id,
        result: ValidationResult.VALID,
        confidence: 0.9,
        reasoning: 'Security/critical issue',
        patch: this.generatePatchFromSuggestion(suggestion),
      };
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
    if (!suggestion.code) {
      return undefined;
    }
    
    // Extract diff from code block if it's already a diff
    if (suggestion.code.includes('```diff')) {
      return suggestion.code
        .replace(/```diff\n?/, '')
        .replace(/```$/, '')
        .trim();
    }
    
    // Otherwise, try to generate a simple patch
    // This is a simplified version - real implementation would need more context
    return undefined;
  }
}