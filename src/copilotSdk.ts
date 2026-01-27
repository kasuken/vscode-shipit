import * as vscode from 'vscode';
import { logError, logInfo } from './logger';

// Use any types to avoid ESM/CJS import issues with the Copilot SDK
// The SDK is an ESM module that we load dynamically
 
let CopilotClientClass: any = null;

async function loadSdk(): Promise<any> {
    if (!CopilotClientClass) {
        // Dynamic import of ESM module
        const sdk = await import('@github/copilot-sdk');
        CopilotClientClass = sdk.CopilotClient;
    }
    return CopilotClientClass;
}

/**
 * Get the workspace root folder path
 */
function getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }
    return undefined;
}

/**
 * Delay execution for a specified time
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, baseDelayMs: number): number {
    // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // 0-1000ms jitter
    return Math.min(exponentialDelay + jitter, 60000); // Cap at 60 seconds
}

export interface CopilotSdkOptions {
    model?: string;
    streaming?: boolean;
    systemMessage?: string;
    timeout?: number; // Timeout in milliseconds (default: 300000 = 5 minutes)
    onComplete?: () => void | Promise<void>; // Callback when task completes successfully
    maxRetries?: number; // Maximum number of retries on failure (default: 3)
    retryDelayMs?: number; // Initial delay between retries in ms (default: 2000, uses exponential backoff)
    continueOnError?: boolean; // If true, call onComplete even on final failure (default: true for user stories)
}

export type CopilotProgressHandler = (message: string, isComplete: boolean) => void;

/**
 * CopilotSdkService manages the Copilot SDK client and sessions
 * This replaces the old chat-based integration with the SDK approach
 */
export class CopilotSdkService {
     
    private client: any = null;
     
    private currentSession: any = null;
    private isStarted = false;
    private progressHandler: CopilotProgressHandler | null = null;

    /**
     * Set the progress handler for streaming updates
     */
    setProgressHandler(handler: CopilotProgressHandler): void {
        this.progressHandler = handler;
    }

    /**
     * Start the Copilot client
     */
    async start(): Promise<boolean> {
        if (this.isStarted && this.client) {
            return true;
        }

        try {
            // Dynamically load the ESM SDK module
            const ClientClass = await loadSdk();
            
            const workspaceRoot = getWorkspaceRoot();
            logInfo(`Starting Copilot SDK with workspace: ${workspaceRoot || 'none'}`);
            
            this.client = new ClientClass({
                autoStart: true,
                autoRestart: true,
                logLevel: 'debug', // Enable debug logging
                cwd: workspaceRoot, // Set working directory to workspace
                useStdio: true // Use stdio for better compatibility
            });

            await this.client.start();
            this.isStarted = true;
            
            // Test the connection with a ping
            try {
                const pong = await this.client.ping('test');
                logInfo(`Copilot SDK connection verified: ${pong.message}`);
            } catch (pingError) {
                logError('Ping failed - connection may not be working', pingError);
            }
            
            logInfo('Copilot SDK client started successfully');
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('Failed to start Copilot SDK client', error);
            
            // Show helpful error message
            const action = await vscode.window.showErrorMessage(
                `ShipIt: Failed to start Copilot SDK. Make sure GitHub Copilot CLI is installed and you're authenticated. Error: ${errorMessage}`,
                'Install Copilot CLI',
                'Dismiss'
            );
            
            if (action === 'Install Copilot CLI') {
                vscode.env.openExternal(vscode.Uri.parse('https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli'));
            }
            
            return false;
        }
    }

    /**
     * Stop the Copilot client and clean up
     */
    async stop(): Promise<void> {
        try {
            if (this.currentSession) {
                await this.currentSession.destroy();
                this.currentSession = null;
            }
            
            if (this.client && this.isStarted) {
                await this.client.stop();
                this.isStarted = false;
                this.client = null;
            }
            
            logInfo('Copilot SDK client stopped');
        } catch (error) {
            logError('Error stopping Copilot SDK client', error);
        }
    }

    /**
     * Create a new session with the given options
     */
     
    private async createSession(options: CopilotSdkOptions = {}): Promise<any | null> {
        if (!this.client || !this.isStarted) {
            const started = await this.start();
            if (!started) {
                return null;
            }
        }

        try {
            // Destroy previous session if exists
            if (this.currentSession) {
                try {
                    await this.currentSession.destroy();
                } catch {
                    // Ignore errors destroying old session
                }
                this.currentSession = null;
            }

            // Create session config
             
            const sessionConfig: any = {
                model: options.model || 'gpt-4.1',
                streaming: options.streaming !== false,
                // Auto-approve all tool operations for autonomous workflow
                onPermissionRequest: async () => {
                    logInfo('Auto-approving tool permission request');
                    return { kind: 'approved' };
                }
            };

            // Add system message if provided
            if (options.systemMessage) {
                sessionConfig.systemMessage = {
                    content: options.systemMessage
                };
            }

            this.currentSession = await this.client.createSession(sessionConfig);
            logInfo(`Created new Copilot session with model: ${sessionConfig.model}`);
            
            return this.currentSession;
        } catch (error) {
            logError('Failed to create Copilot session', error);
            return null;
        }
    }

    /**
     * Send a prompt to Copilot and wait for completion
     * Returns true if successful, false otherwise
     */
    async sendPrompt(
        prompt: string,
        options: CopilotSdkOptions = {}
    ): Promise<{ success: boolean; response?: string; error?: string }> {
        try {
            // Check prompt size (warn if very large)
            const MAX_SAFE_PROMPT_SIZE = 100000; // ~100KB characters
            if (prompt.length > MAX_SAFE_PROMPT_SIZE) {
                logError(`Warning: Prompt is very large (${prompt.length} chars). This may cause API errors.`, null);
                vscode.window.showWarningMessage(`ShipIt: Prompt is ${Math.round(prompt.length / 1000)}KB which may exceed model limits. Consider reducing PRD/user stories size.`);
            }
            
            logInfo(`Sending prompt to Copilot (${prompt.length} chars, model: ${options.model || 'default'})`);
            logInfo(`Prompt preview: ${prompt.substring(0, 200)}...`);
            
            const session = await this.createSession(options);
            if (!session) {
                return { success: false, error: 'Failed to create session' };
            }
            
            logInfo(`Session created: ${session.sessionId}`);

            let fullResponse = '';
            let deltaBuffer = '';

            // Set up event handler for streaming
             
            const unsubscribe = session.on((event: any) => {
                switch (event.type) {
                    case 'assistant.message_delta':
                        // Streaming chunk
                        if (event.data?.deltaContent) {
                            deltaBuffer += event.data.deltaContent;
                            this.progressHandler?.(deltaBuffer, false);
                        }
                        break;
                        
                    case 'assistant.message':
                        // Final complete message
                        if (event.data?.content) {
                            fullResponse = event.data.content;
                            logInfo('Received assistant message');
                        }
                        break;
                        
                    case 'session.idle':
                        this.progressHandler?.('', true);
                        logInfo('Session idle - task complete');
                        break;
                    
                    case 'tool.execution_start':
                        // Tool is starting to execute (e.g., file edit, bash command)
                        logInfo(`Tool starting: ${event.data?.toolName || 'unknown'}`);
                        this.progressHandler?.(`Running: ${event.data?.toolName || 'tool'}...`, false);
                        break;
                    
                    case 'tool.execution_complete':
                        logInfo(`Tool completed: ${event.data?.toolCallId || 'unknown'}`);
                        break;
                    
                    case 'tool.execution_progress':
                        // Tool progress update
                        if (event.data?.message) {
                            logInfo(`Tool progress: ${event.data.message}`);
                        }
                        break;
                        
                    case 'session.error':
                        logError('Session error', event.data);
                        break;
                        
                    default:
                        // Log other event types for debugging
                        if (event.type) {
                            logInfo(`Event: ${event.type}`);
                        }
                }
            });

            try {
                // Send and wait for completion (with configurable timeout)
                const timeout = options.timeout || 300000; // Default 5 minutes for complex tasks
                const result = await session.sendAndWait({ prompt }, timeout);
                
                // Get the response content
                if (result?.data?.content) {
                    fullResponse = result.data.content;
                } else if (deltaBuffer) {
                    fullResponse = deltaBuffer;
                }

                return { success: true, response: fullResponse };
            } finally {
                unsubscribe();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('Error sending prompt to Copilot', error);
            
            // Provide more context for common errors
            let detailedError = errorMessage;
            if (errorMessage.includes('invalid_request_body') || errorMessage.includes('400')) {
                detailedError = `${errorMessage}. Possible causes: prompt too large (${prompt.length} chars), invalid characters, or malformed request. Try reducing PRD/user stories content.`;
            }
            
            return { success: false, error: detailedError };
        }
    }

    /**
     * Execute a task using Copilot (main workflow)
     * Includes retry logic with exponential backoff
     * Calls the onComplete callback when task finishes (successfully or after all retries if continueOnError)
     */
    async executeTask(prompt: string, options: CopilotSdkOptions = {}): Promise<boolean> {
        const maxRetries = options.maxRetries ?? 3;
        const baseDelayMs = options.retryDelayMs ?? 2000;
        const continueOnError = options.continueOnError ?? true; // Default: continue workflow even on error
        
        let lastError: string | undefined;
        let success = false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                const backoffDelay = getBackoffDelay(attempt - 1, baseDelayMs);
                logInfo(`Retry attempt ${attempt}/${maxRetries} after ${Math.round(backoffDelay)}ms delay...`);
                this.progressHandler?.(`Retrying (${attempt}/${maxRetries})...`, false);
                await delay(backoffDelay);
                
                // Try to restart the client before retry
                try {
                    await this.stop();
                    await this.start();
                    logInfo('Copilot client restarted for retry');
                } catch (restartError) {
                    logError('Failed to restart client for retry', restartError);
                }
            }

            const result = await this.sendPrompt(prompt, {
                streaming: true,
                ...options
            });

            if (result.success) {
                success = true;
                break;
            }

            lastError = result.error;
            logError(`Copilot task attempt ${attempt + 1} failed: ${lastError}`, null);
            
            // Check if error is retryable
            if (!this.isRetryableError(lastError)) {
                logInfo('Error is not retryable, stopping retry attempts');
                break;
            }
        }

        if (!success) {
            const errorMsg = `Copilot task failed after ${maxRetries + 1} attempts: ${lastError}`;
            logError(errorMsg, null);
            vscode.window.showWarningMessage(`ShipIt: ${errorMsg}. Continuing to next task...`);
            
            // If continueOnError is true, still call onComplete to continue the workflow
            if (continueOnError && options.onComplete) {
                try {
                    logInfo('Calling onComplete despite error (continueOnError=true)');
                    await options.onComplete();
                    logInfo('Task completion callback executed (after error)');
                } catch (error) {
                    logError('Error in task completion callback', error);
                }
            }
            
            return false;
        }

        // Call the onComplete callback on success
        if (options.onComplete) {
            try {
                await options.onComplete();
                logInfo('Task completion callback executed');
            } catch (error) {
                logError('Error in task completion callback', error);
            }
        }

        return true;
    }

    /**
     * Check if an error is retryable
     */
    private isRetryableError(error: string | undefined): boolean {
        if (!error) return true;
        
        const errorLower = error.toLowerCase();
        
        // Retryable errors (network, timeout, temporary issues)
        const retryablePatterns = [
            'timeout',
            'timed out',
            'econnreset',
            'econnrefused',
            'enotfound',
            'network',
            'socket hang up',
            'service unavailable',
            '503',
            '502',
            '500',
            'internal server error',
            'rate limit',
            '429',
            'temporarily',
            'connection',
            'enetunreach'
        ];
        
        // Non-retryable errors (auth, invalid input, etc.)
        const nonRetryablePatterns = [
            'unauthorized',
            '401',
            'bad request',
            '400',
            'forbidden',
            '403',
            'not found',
            '404',
            'invalid',
            'malformed',
            'authentication',
            'invalid_request_body'
        ];
        
        // Check for non-retryable first
        for (const pattern of nonRetryablePatterns) {
            if (errorLower.includes(pattern)) {
                return false;
            }
        }
        
        // Check for retryable patterns
        for (const pattern of retryablePatterns) {
            if (errorLower.includes(pattern)) {
                return true;
            }
        }
        
        // Default: retry unknown errors
        return true;
    }

    /**
     * Check if the client is running
     */
    isRunning(): boolean {
        return this.isStarted && this.client !== null;
    }

    /**
     * Get the current session (if any)
     */
     
    getCurrentSession(): any | null {
        return this.currentSession;
    }

    /**
     * Get available models from the Copilot SDK
     * Returns a list of model IDs that can be used
     */
    async getAvailableModels(): Promise<string[]> {
        if (!this.client || !this.isStarted) {
            const started = await this.start();
            if (!started) {
                // Return default models if client can't start
                return getDefaultModels();
            }
        }

        try {
            // Try to get models from the SDK client
            if (this.client && typeof this.client.getModels === 'function') {
                const models = await this.client.getModels();
                if (models && Array.isArray(models) && models.length > 0) {
                    return models.map((m: any) => typeof m === 'string' ? m : m.id || m.name);
                }
            }
            
            // If SDK doesn't provide models, return defaults
            logInfo('SDK getModels not available, using default models');
            return getDefaultModels();
        } catch (error) {
            logError('Failed to get models from SDK', error);
            return getDefaultModels();
        }
    }

    /**
     * Abort the current operation
     */
    async abort(): Promise<void> {
        if (this.currentSession) {
            try {
                await this.currentSession.abort();
                logInfo('Copilot operation aborted');
            } catch (error) {
                logError('Error aborting Copilot operation', error);
            }
        }
    }
}

/**
 * Get default available models
 * These are common Copilot/OpenAI models that are typically available
 */
function getDefaultModels(): string[] {
    return [
        'gpt-4.1',
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4.5-preview',
        'gpt-5.2',
        'gpt-5-mini',
        'claude-sonnet-4',
        'o3',
        'o4-mini'
    ];
}

// Singleton instance
let copilotService: CopilotSdkService | null = null;

/**
 * Get the singleton Copilot SDK service instance
 */
export function getCopilotService(): CopilotSdkService {
    if (!copilotService) {
        copilotService = new CopilotSdkService();
    }
    return copilotService;
}

/**
 * Dispose the Copilot SDK service
 */
export async function disposeCopilotService(): Promise<void> {
    if (copilotService) {
        await copilotService.stop();
        copilotService = null;
    }
}
