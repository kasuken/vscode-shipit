
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { CopilotSdkService, getCopilotService } from '../copilotSdk';
import { getTaskStatsAsync, getAllTasksAsync, getUserStoriesForTaskAsync, readUserStoriesAsync, writeUserStoriesAsync } from '../fileUtils';
import { TaskRunner } from '../taskRunner';
import { CountdownTimer } from '../timerManager';
import { LoopOrchestrator } from '../orchestrator';
import { ShipItStatusBar } from '../statusBar';
import { IShipItUI, TaskCompletion, UserStoryStatus } from '../types';

suite('ShipIt workflow regressions', () => {
    let root: string;
    let orchestrator: LoopOrchestrator | undefined;
    let statusBar: ShipItStatusBar | undefined;

    setup(async () => {
        root = vscode.workspace.workspaceFolders![0].uri.fsPath;
        assert.ok(path.basename(root).startsWith('shipit-tests-'), 'Tests require a disposable workspace');
        await fs.mkdir(path.join(root, '.shipit'), { recursive: true });
    });

    teardown(async () => {
        await orchestrator?.stopLoop();
        orchestrator = undefined;
        statusBar?.dispose();
        mock.restoreAll();
        await fs.rm(path.join(root, '.shipit'), { recursive: true, force: true });
    });

    test('failed execution leaves the story pending', async () => {
        await writeUserStoriesAsync('## Task: Greeting\n\n- [ ] Add greeting\n');
        mock.method(getCopilotService(), 'sendPrompt', async () => ({
            success: false, error: '401 unauthorized'
        }));
        assert.equal(await new TaskRunner().triggerUserStoryImplementation('Add greeting', 'Greeting'), false);
        assert.equal(await readUserStoriesAsync(), '## Task: Greeting\n\n- [ ] Add greeting\n');
    });

    test('story lookup does not include tasks with a shared prefix', async () => {
        await writeUserStoriesAsync('## Task: Greeting extended\n- [ ] Extended story\n\n## Task: Greeting\n- [ ] Base story\n');
        const stories = await getUserStoriesForTaskAsync('Greeting');
        assert.deepEqual(stories.map(story => story.description), ['Base story']);
    });

    test('completion updates only the matching story in its parent task', async () => {
        await writeUserStoriesAsync('## Task: Other\n- [ ] Add tests\n\n## Task: Greeting\n- [~] Add tests\n');
        mock.method(getCopilotService(), 'sendPrompt', async () => ({ success: true, response: 'Done' }));
        assert.equal(await new TaskRunner().triggerUserStoryImplementation('Add tests', 'Greeting'), true);
        assert.equal(await readUserStoriesAsync(), '## Task: Other\n- [ ] Add tests\n\n## Task: Greeting\n- [x] Add tests\n');
    });

    test('stopping a countdown settles its pending promise', async () => {
        const timer = new CountdownTimer();
        const pending = timer.start(60, () => {});
        timer.stop();
        await pending;
        assert.equal(timer.isActive(), false);
    });

    test('loop advances when a story finishes before file watcher delivery', async () => {
        await fs.writeFile(path.join(root, '.shipit', 'PRD.md'), '- [ ] Greeting\n');
        await writeUserStoriesAsync('## Task: Greeting\n- [ ] Add greeting\n');
        mock.method(getCopilotService(), 'sendPrompt', async () => ({ success: true, response: 'Done' }));
        // Make the review delay deterministic without relying on filesystem event timing.
        mock.method(CountdownTimer.prototype, 'start', async () => {});
        let status = '';
        const ui: IShipItUI = {
            updateStatus(value: string) { status = value; },
            updateCountdown() {}, updateHistory(_history: TaskCompletion[]) {},
            updateSessionTiming() {}, updateStats() {}, refresh() {},
            addLog() {}, showPrdGenerating() {}
        };
        statusBar = new ShipItStatusBar();
        orchestrator = new LoopOrchestrator(statusBar);
        orchestrator.setSidebarView(ui);
        await orchestrator.startLoop();
        assert.equal(status, 'idle');
        assert.equal((await getUserStoriesForTaskAsync('Greeting'))[0].status, UserStoryStatus.COMPLETE);
        assert.match(await fs.readFile(path.join(root, '.shipit', 'PRD.md'), 'utf8'), /- \[x\] Greeting/);
    });

    test('completion callback errors fail the operation', async () => {
        const service = new CopilotSdkService();
        mock.method(service, 'sendPrompt', async () => ({ success: true, response: 'Done' }));
        assert.equal(await service.executeTask('sample', {
            onComplete: () => { throw new Error('Progress write failed'); }
        }), false);
    });

    test('stop cancels active execution without completing the story', async () => {
        await fs.writeFile(path.join(root, '.shipit', 'PRD.md'), '- [ ] Greeting\n');
        await writeUserStoriesAsync('## Task: Greeting\n- [ ] Add greeting\n');
        let finish!: (value: { success: boolean }) => void;
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        mock.method(getCopilotService(), 'sendPrompt', () => {
            started();
            return new Promise<{ success: boolean }>(resolve => { finish = resolve; });
        });
        statusBar = new ShipItStatusBar();
        orchestrator = new LoopOrchestrator(statusBar);
        const running = orchestrator.startLoop();
        await ready;
        await orchestrator.stopLoop();
        finish({ success: true });
        await running;
        assert.equal((await getUserStoriesForTaskAsync('Greeting'))[0].status, UserStoryStatus.PENDING);
        assert.equal((await getTaskStatsAsync()).completed, 0);
    });

    test('pause and resume do not duplicate the active request', async () => {
        await fs.writeFile(path.join(root, '.shipit', 'PRD.md'), '- [ ] Greeting\n');
        await writeUserStoriesAsync('## Task: Greeting\n- [ ] Add greeting\n');
        let finish!: (value: { success: boolean }) => void;
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const send = mock.method(getCopilotService(), 'sendPrompt', () => {
            started();
            return new Promise<{ success: boolean }>(resolve => { finish = resolve; });
        });
        mock.method(CountdownTimer.prototype, 'start', async () => {});
        statusBar = new ShipItStatusBar();
        orchestrator = new LoopOrchestrator(statusBar);
        const running = orchestrator.startLoop();
        await ready;
        orchestrator.pauseLoop();
        await orchestrator.runSingleStep();
        finish({ success: true });
        // Let the in-flight request settle while paused.
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal((await getTaskStatsAsync()).completed, 0);
        orchestrator.resumeLoop();
        await running;
        assert.equal(send.mock.callCount(), 1);
        assert.equal((await getTaskStatsAsync()).completed, 1);
    });

    test('command activation opens the sidebar and creates a manual PRD', async () => {
        const extension = vscode.extensions.getExtension('emanuelebartolesi.shipit');
        assert.ok(extension);
        await extension.activate();
        // Model discovery is tested separately with the real SDK in the opt-in smoke test.
        mock.method(getCopilotService(), 'getAvailableModels', async () => [{ id: 'test', name: 'Test model' }]);
        await vscode.commands.executeCommand('shipit.showPanel');
        await vscode.commands.executeCommand('shipit.createManualPrd');
        assert.equal((await getTaskStatsAsync()).pending, 6);
        assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(root, '.shipit', 'PRD.md'));
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('stop during retry backoff prevents another attempt', async () => {
        const service = new CopilotSdkService();
        const send = mock.method(service, 'sendPrompt', async () => ({ success: false, error: '429 rate limit' }));
        let completed = false;
        service.setProgressHandler(message => {
            if (message.startsWith('Retrying')) { void service.abort(); }
        });
        assert.equal(await service.executeTask('sample', {
            retryDelayMs: 60000, onComplete: () => { completed = true; }
        }), false);
        assert.equal(send.mock.callCount(), 1);
        assert.equal(completed, false);
    });
});

if (process.env.SHIPIT_LIVE_TESTS === '1') {
    suite('ShipIt live SDK smoke', () => {
        test('generates PRD and stories then implements a working module', async function () {
            this.timeout(300000);
            const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
            const bar = new ShipItStatusBar();
            const loop = new LoopOrchestrator(bar);
            loop.setSettings({ ...loop.getSettings(), userStoriesCountPerTask: 1 });
            try {
                const models = await getCopilotService().getAvailableModels();
                assert.ok(models.length > 0, 'At least one model must be enabled');
                const model = models[0].id;
                console.log(`Live smoke test model: ${model}`);
                const config = vscode.workspace.getConfiguration('shipit');
                for (const key of ['prdGeneration', 'userStoriesGeneration', 'taskImplementation']) {
                    await config.update(`models.${key}`, model, vscode.ConfigurationTarget.Workspace);
                }
                await fs.mkdir(path.join(root, '.shipit'), { recursive: true });
                await fs.writeFile(path.join(root, '.shipit', 'project_description.md'),
                    'This is a disposable smoke test. Create a PRD with exactly ONE checkbox task: ' +
                    'Implement greet.js with module.exports = greet, a function returning "Hello, <name>!". ' +
                    'Use only built-in Node.js modules. Do not install packages, access the network, commit, ' +
                    'or read/write outside this workspace. Do not implement it yet.'
                );
                await vscode.commands.executeCommand('shipit.showPanel');
                await vscode.commands.executeCommand('shipit.generatePrd');
                const tasks = await getAllTasksAsync();
                assert.equal(tasks.length, 1);
                await loop.generateAllUserStories();
                assert.equal((await getUserStoriesForTaskAsync(tasks[0].description)).length, 1);
                await vscode.commands.executeCommand('shipit.start');
                assert.deepEqual(await getTaskStatsAsync(), { total: 1, completed: 1, pending: 0 });
                const greet: unknown = require(path.join(root, 'greet.js'));
                assert.ok(typeof greet === 'function', 'greet.js must export the greeting function');
                assert.equal(greet('ShipIt'), 'Hello, ShipIt!');
                assert.equal(greet(''), 'Hello, !');
                assert.match(await fs.readFile(path.join(root, '.shipit', 'progress.txt'), 'utf8'), /Completed/);
                await fs.appendFile(path.join(root, '.shipit', 'PRD.md'),
                    '\n- [ ] Create farewell.js with module.exports = name => "Goodbye, " + name + "!"; ' +
                    'do not install packages, access the network, commit, or access files outside this workspace.\n');
                await vscode.commands.executeCommand('shipit.next');
                assert.deepEqual(await getTaskStatsAsync(), { total: 2, completed: 2, pending: 0 });
                const farewell: unknown = require(path.join(root, 'farewell.js'));
                assert.ok(typeof farewell === 'function', 'farewell.js must export a function');
                assert.equal(farewell('ShipIt'), 'Goodbye, ShipIt!');
            } finally {
                await loop.dispose();
                bar.dispose();
            }
        });
    });
}
