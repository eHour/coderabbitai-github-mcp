import picomatch from 'picomatch';
import { Logger } from '../lib/logger.js';
import { ValidationResult } from '../types/index.js';
export class ThreadAnalyzerAgent {
    workerId;
    messageBus;
    config;
    logger;
    constructor(workerId, messageBus, _stateManager, config) {
        this.workerId = workerId;
        this.messageBus = messageBus;
        this.config = config;
        this.logger = new Logger(`Analyzer-${workerId}`);
        this.setupMessageHandlers();
    }
    setupMessageHandlers() {
        this.messageBus.subscribe(`analyzer-${this.workerId}`, async (message) => {
            if (message.type === 'ANALYZE_THREAD') {
                const result = await this.analyzeThread(message.payload.thread, message.payload.repo, message.payload.prNumber);
                this.messageBus.respond(message, result);
            }
        });
    }
    async analyzeThread(thread, _repo, _prNumber) {
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
        }
        catch (error) {
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
    extractSuggestion(thread) {
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
    applyHeuristics(suggestion, thread) {
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
            if (rejectExtensions.some(ext => suggestion.file.endsWith(ext))) {
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
    matchesPattern(suggestion, pattern) {
        // Use safe glob matching to prevent ReDoS
        if (pattern.includes('*')) {
            const isMatch = (s) => !!s && picomatch.isMatch(s, pattern, { nocase: true });
            return isMatch(suggestion.type) ||
                isMatch(suggestion.description) ||
                isMatch(suggestion.file);
        }
        return suggestion.type.includes(pattern) ||
            suggestion.description.includes(pattern) ||
            (suggestion.file?.includes(pattern) ?? false);
    }
    generatePatchFromSuggestion(suggestion) {
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
//# sourceMappingURL=thread-analyzer.js.map