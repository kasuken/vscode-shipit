import * as vscode from 'vscode';
import { getConfig } from './config';
import { getWorkspaceRoot, readPRDAsync } from './fileUtils';

export type PrdChangeCallback = (newContent: string) => void;
export type ActivityCallback = () => void;
export type PrdCreatedCallback = () => void;

/**
 * Watches the PRD file for changes
 */
export class PrdWatcher {
    private watcher: vscode.FileSystemWatcher | null = null;
    private disposables: vscode.Disposable[] = [];
    private lastContent: string = '';
    private callback: PrdChangeCallback | null = null;
    private enabled: boolean = false;

    /**
     * Start watching the PRD file
     */
    start(initialContent: string, callback: PrdChangeCallback): void {
        this.dispose();

        const root = getWorkspaceRoot();
        const config = getConfig();
        if (!root) { return; }

        this.lastContent = initialContent;
        this.callback = callback;

        const pattern = new vscode.RelativePattern(root, config.files.prdPath);
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        const changeDisposable = this.watcher.onDidChange(async () => {
            if (!this.enabled) { return; }

            const newContent = await readPRDAsync() || '';
            if (newContent !== this.lastContent) {
                this.lastContent = newContent;
                this.callback?.(newContent);
            }
        });
        this.disposables.push(changeDisposable);
    }

    enable(): void {
        this.enabled = true;
    }

    disable(): void {
        this.enabled = false;
    }

    updateContent(content: string): void {
        this.lastContent = content;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
        this.enabled = false;
    }
}

/**
 * Watches for any file activity in the workspace
 */
export class ActivityWatcher {
    private watcher: vscode.FileSystemWatcher | null = null;
    private disposables: vscode.Disposable[] = [];
    private callback: ActivityCallback | null = null;

    /**
     * Start watching for file activity
     */
    start(callback: ActivityCallback): void {
        this.dispose();

        const root = getWorkspaceRoot();
        if (!root) { return; }

        this.callback = callback;

        const pattern = new vscode.RelativePattern(root, '**/*');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        const onActivity = () => {
            this.callback?.();
        };

        this.disposables.push(this.watcher.onDidChange(onActivity));
        this.disposables.push(this.watcher.onDidCreate(onActivity));
        this.disposables.push(this.watcher.onDidDelete(onActivity));
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
    }
}

/**
 * Watches for PRD file creation
 */
export class PrdCreationWatcher {
    private watcher: vscode.FileSystemWatcher | null = null;
    private disposables: vscode.Disposable[] = [];
    private callback: PrdCreatedCallback | null = null;
    private enabled: boolean = false;

    /**
     * Start watching for PRD creation
     */
    start(callback: PrdCreatedCallback): void {
        this.dispose();

        const root = getWorkspaceRoot();
        const config = getConfig();
        if (!root) { return; }

        this.callback = callback;
        this.enabled = true;

        const pattern = new vscode.RelativePattern(root, config.files.prdPath);
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        const onPrdCreated = async () => {
            if (!this.enabled) { return; }

            const prd = await readPRDAsync();
            if (prd && prd.trim()) {
                this.enabled = false;
                this.callback?.();
            }
        };

        this.disposables.push(this.watcher.onDidCreate(onPrdCreated));
        this.disposables.push(this.watcher.onDidChange(onPrdCreated));
    }

    disable(): void {
        this.enabled = false;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
        this.enabled = false;
    }
}

/**
 * Manages all file watchers
 */
export class FileWatcherManager {
    readonly prdWatcher = new PrdWatcher();
    readonly activityWatcher = new ActivityWatcher();
    readonly prdCreationWatcher = new PrdCreationWatcher();

    dispose(): void {
        this.prdWatcher.dispose();
        this.activityWatcher.dispose();
        this.prdCreationWatcher.dispose();
    }
}
