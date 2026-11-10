import * as vscode from "vscode";
import { logError, logInfo } from "./logger";
import { setTimeout as delay } from "node:timers/promises";
import type { CopilotClient, CopilotSession, SessionConfig } from "@github/copilot-sdk" with { "resolution-mode": "import" };
import { getWorkspaceRoot } from "./fileUtils";

let CopilotClientClass: typeof CopilotClient | null = null;

async function loadSdk(): Promise<typeof CopilotClient> {
  if (!CopilotClientClass) {
    // Dynamic import of ESM module
    const sdk = await import("@github/copilot-sdk");
    CopilotClientClass = sdk.CopilotClient;
  }
  return CopilotClientClass;
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
}

export type CopilotProgressHandler = (
  message: string,
  isComplete: boolean,
) => void;

/**
 * CopilotSdkService manages the Copilot SDK client and sessions
 * This replaces the old chat-based integration with the SDK approach
 */
export class CopilotSdkService {
  private client: CopilotClient | null = null;

  private currentSession: CopilotSession | null = null;
  private isStarted = false;
  private starting: Promise<boolean> | null = null;
  private executionAbort: AbortController | null = null;
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
    if (this.starting) { return this.starting; }
    this.starting = this.startClient();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startClient(): Promise<boolean> {
    try {
      // Dynamically load the ESM SDK module
      const ClientClass = await loadSdk();

      const workspaceRoot = getWorkspaceRoot();
      logInfo(
        `Starting Copilot SDK with workspace: ${workspaceRoot || "none"}`,
      );

      this.client = new ClientClass({
        autoStart: true,
        autoRestart: true,
        logLevel: "debug", // Enable debug logging
        cwd: workspaceRoot ?? undefined,
        useStdio: true, // Use stdio for better compatibility
        // The SDK launches its bundled CLI using process.execPath (Electron in VS Code).
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });

      await this.client.start();
      const pong = await this.client.ping("test");
      logInfo(`Copilot SDK connection verified: ${pong.message}`);
      this.isStarted = true;

      logInfo("Copilot SDK client started successfully");
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logError("Failed to start Copilot SDK client", error);
      await this.stop();

      // Show helpful error message
      void vscode.window.showErrorMessage(
        `ShipIt: Failed to start Copilot SDK. Make sure GitHub Copilot CLI is installed and you're authenticated. Error: ${errorMessage}`,
        "Install Copilot CLI",
        "Dismiss",
      ).then(action => {
        if (action === "Install Copilot CLI") {
          void vscode.env.openExternal(
            vscode.Uri.parse("https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"),
          );
        }
      });

      return false;
    }
  }

  /**
   * Stop the Copilot client and clean up
   */
  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.currentSession = null;
    this.isStarted = false;
    try {
      if (client) {
        const errors = await client.stop();
        for (const error of errors) { logError("Copilot cleanup failed", error); }
        if (errors.length > 0) { await client.forceStop(); }
      }

      logInfo("Copilot SDK client stopped");
    } catch (error) {
      logError("Error stopping Copilot SDK client", error);
    }
  }

  /**
   * Create a new session with the given options
   */

  private async createSession(
    options: CopilotSdkOptions = {},
  ): Promise<CopilotSession | null> {
    if (!this.client || !this.isStarted) {
      const started = await this.start();
      if (!started) {
        throw new Error("Copilot SDK could not start");
      }
    }

    try {
      // Destroy previous session if exists
      if (this.currentSession) {
        try {
          await this.currentSession.disconnect();
        } catch (error) {
          logError("Failed to disconnect previous session", error);
        }
        this.currentSession = null;
      }

      // Create session config

      const sessionConfig: SessionConfig = {
        model: options.model || "gpt-4.1",
        streaming: options.streaming !== false,
        workingDirectory: getWorkspaceRoot() ?? undefined,
        // Auto-approve all tool operations for autonomous workflow
        onPermissionRequest: async () => {
          logInfo("Auto-approving tool permission request");
          return { kind: "approved" };
        },
      };
      const availableModels = await this.getAvailableModels();
      if (!availableModels.some(model => model.id === sessionConfig.model)) {
        throw new Error(`Model "${sessionConfig.model}" is unavailable. Choose an enabled model in ShipIt settings.`);
      }

      // Add system message if provided
      if (options.systemMessage) {
        sessionConfig.systemMessage = {
          content: options.systemMessage,
        };
      }

      if (!this.client) { return null; }
      this.currentSession = await this.client.createSession(sessionConfig);
      logInfo(`Created new Copilot session with model: ${sessionConfig.model}`);

      return this.currentSession;
    } catch (error) {
      logError("Failed to create Copilot session", error);
      throw error;
    }
  }

  /**
   * Send a prompt to Copilot and wait for completion
   * Returns true if successful, false otherwise
   */
  async sendPrompt(
    prompt: string,
    options: CopilotSdkOptions = {},
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    try {
      // Check prompt size (warn if very large)
      const MAX_SAFE_PROMPT_SIZE = 100000; // ~100KB characters
      if (prompt.length > MAX_SAFE_PROMPT_SIZE) {
        logError(
          `Warning: Prompt is very large (${prompt.length} chars). This may cause API errors.`,
          null,
        );
        vscode.window.showWarningMessage(
          `ShipIt: Prompt is ${Math.round(prompt.length / 1000)}KB which may exceed model limits. Consider reducing PRD/user stories size.`,
        );
      }

      logInfo(
        `Sending prompt to Copilot (${prompt.length} chars, model: ${options.model || "default"})`,
      );
      logInfo(`Prompt preview: ${prompt.substring(0, 200)}...`);

      const session = await this.createSession(options);
      if (!session) {
        return { success: false, error: "Failed to create session" };
      }
      if (this.executionAbort?.signal.aborted) {
        return { success: false, error: "Operation cancelled" };
      }

      logInfo(`Session created: ${session.sessionId}`);

      let fullResponse = "";
      let deltaBuffer = "";
      let reasoningDeltaCount = 0;

      // Set up event handler for streaming

      const unsubscribe = session.on((event) => {
        switch (event.type) {
          case "assistant.message_delta":
            // Streaming chunk
            if (event.data?.deltaContent) {
              deltaBuffer += event.data.deltaContent;
              this.progressHandler?.(deltaBuffer, false);
            }
            break;

          case "assistant.message":
            // Final complete message
            if (event.data?.content) {
              fullResponse = event.data.content;
              logInfo("Received assistant message");
            }
            break;

          case "session.idle":
            this.progressHandler?.("", true);
            logInfo("Session idle - task complete");
            // Log reasoning delta count if any occurred
            if (reasoningDeltaCount > 0) {
              logInfo(`Processed ${reasoningDeltaCount} reasoning steps`);
            }
            break;

          case "tool.execution_start":
            // Tool is starting to execute (e.g., file edit, bash command)
            logInfo(`Tool starting: ${event.data?.toolName || "unknown"}`);
            this.progressHandler?.(
              `Running: ${event.data?.toolName || "tool"}...`,
              false,
            );
            break;

          case "tool.execution_complete":
            logInfo(`Tool completed: ${event.data?.toolCallId || "unknown"}`);
            break;

          case "tool.execution_progress":
            // Tool progress update
            if (event.data?.progressMessage) {
              logInfo(`Tool progress: ${event.data.progressMessage}`);
            }
            break;

          case "session.error":
            logError("Session error", event.data);
            break;

          case "assistant.reasoning_delta":
            // Count reasoning deltas but don't log each one (too noisy)
            reasoningDeltaCount++;
            break;

          default:
            // Log other significant event types (but filter out very noisy ones)
            if (
              event.type &&
              !event.type.includes("delta") &&
              !event.type.includes("progress")
            ) {
              logInfo(`Event: ${event.type}`);
            }
        }
      });

      try {
        // Send and wait for completion (with configurable timeout)
        const timeout = options.timeout || 300000; // Default 5 minutes for complex tasks
        const result = await session.sendAndWait({ prompt }, timeout);
        if (this.executionAbort?.signal.aborted) {
          return { success: false, error: "Operation cancelled" };
        }

        // Get the response content
        if (result?.data?.content) {
          fullResponse = result.data.content;
        } else if (deltaBuffer) {
          fullResponse = deltaBuffer;
        }

        return { success: true, response: fullResponse };
      } catch (error) {
        await session.abort();
        throw error;
      } finally {
        unsubscribe();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logError("Error sending prompt to Copilot", error);

      // Provide more context for common errors
      let detailedError = errorMessage;
      if (
        errorMessage.includes("invalid_request_body") ||
        errorMessage.includes("400")
      ) {
        detailedError = `${errorMessage}. Possible causes: prompt too large (${prompt.length} chars), invalid characters, or malformed request. Try reducing PRD/user stories content.`;
      }

      return { success: false, error: detailedError };
    }
  }

  /**
   * Execute a task using Copilot (main workflow)
   * Includes retry logic with exponential backoff
   * Calls onComplete only after a successful, uncancelled request.
   */
  async executeTask(
    prompt: string,
    options: CopilotSdkOptions = {},
  ): Promise<boolean> {
    if (this.executionAbort) {
      logError("A Copilot task is already running", null);
      return false;
    }
    const controller = new AbortController();
    this.executionAbort = controller;
    const maxRetries = options.maxRetries ?? 3;
    let attempts = 0;
    let lastError: string | undefined;
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (controller.signal.aborted) { return false; }
        if (attempt > 0) {
          this.progressHandler?.(`Retrying (${attempt}/${maxRetries})...`, false);
          await delay(getBackoffDelay(attempt - 1, options.retryDelayMs ?? 2000), undefined, { signal: controller.signal });
          await this.stop();
          if (controller.signal.aborted) { return false; }
        }
        attempts++;
        const result = await this.sendPrompt(prompt, { streaming: true, ...options });
        if (controller.signal.aborted) { return false; }
        if (result.success) {
          await options.onComplete?.();
          return true;
        }
        lastError = result.error;
        logError(`Copilot task attempt ${attempts} failed: ${lastError}`, null);
        if (!this.isRetryableError(lastError)) { break; }
      }
      vscode.window.showErrorMessage(`ShipIt: Copilot task failed after ${attempts} attempt(s): ${lastError}. Work remains incomplete.`);
      return false;
    } catch (error) {
      if (controller.signal.aborted) {
        logInfo("Copilot task cancelled");
      } else {
        logError("Copilot task or completion callback failed", error);
        vscode.window.showErrorMessage(`ShipIt: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    } finally {
      this.executionAbort = null;
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: string | undefined): boolean {
    if (!error) { return true; }

    const errorLower = error.toLowerCase();

    // Retryable errors (network, timeout, temporary issues)
    const retryablePatterns = [
      "timeout",
      "timed out",
      "econnreset",
      "econnrefused",
      "enotfound",
      "network",
      "socket hang up",
      "service unavailable",
      "503",
      "502",
      "500",
      "internal server error",
      "rate limit",
      "429",
      "temporarily",
      "connection",
      "enetunreach",
    ];

    // Non-retryable errors (auth, invalid input, etc.)
    const nonRetryablePatterns = [
      "unauthorized",
      "401",
      "bad request",
      "400",
      "forbidden",
      "403",
      "not found",
      "404",
      "invalid",
      "malformed",
      "authentication",
      "invalid_request_body",
      "is unavailable",
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

  getCurrentSession(): CopilotSession | null {
    return this.currentSession;
  }

  /**
   * Get available models from the Copilot SDK
   * Returns a list of model objects with id and name
   */
  async getAvailableModels(): Promise<Array<{id: string, name: string}>> {
    if (!this.client || !this.isStarted) {
      const started = await this.start();
      if (!started) {
        throw new Error("Copilot SDK could not start. Model list is unavailable.");
      }
    }

    try {
      // Try to get models from the SDK client
      if (!this.client) { throw new Error("Copilot SDK is not connected"); }
      const models = await this.client.listModels();
      if (models && Array.isArray(models) && models.length > 0) {
        // Filter to enabled models only and extract id and name
        const enabledModels = models
          .filter(m => !m.policy || m.policy.state === 'enabled')
          .map(m => ({
            id: m.id,
            name: m.name || m.id
          }))
          .filter(m => m.id);

        if (enabledModels.length > 0) {
          logInfo(`Retrieved ${enabledModels.length} enabled models from SDK`);
          return enabledModels;
        }
      }

      throw new Error("Copilot returned no enabled models");
    } catch (error) {
      logError("Failed to get models from SDK", error);
      throw error;
    }
  }

  /**
   * Abort the current operation
   */
  async abort(): Promise<void> {
    this.executionAbort?.abort();
    if (this.currentSession) {
      try {
        await this.currentSession.abort();
        logInfo("Copilot operation aborted");
      } catch (error) {
        logError("Error aborting Copilot operation", error);
      }
    }
  }
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
