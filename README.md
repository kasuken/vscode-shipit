# PilotFlow - Autonomous PRD Development

**PilotFlow** runs AI coding agents in a loop. It reads a PRD (Product Requirements Document), picks tasks, implements them one at a time using GitHub Copilot Agent Mode, and continues until everything is done.

> ⚠️ **EXPERIMENTAL** - This extension relies on internal VS Code workbench commands (`workbench.action.chat.newEditSession`, `workbench.action.chat.open`) that are not part of the official public API. These commands may change or be removed in any VS Code update.

## Features

- **Sidebar Control Panel** - Full control from the Activity Bar with real-time status
- **Autonomous Task Execution** - Automatically works through your PRD task list
- **Copilot Agent Mode Integration** - Sends tasks to Copilot with full project context
- **Progress Tracking** - Visual status bar and sidebar show progress and current task
- **File Watching** - Automatically detects when Copilot marks tasks complete in PRD.md
- **Inactivity Detection** - Prompts you if Copilot seems stuck
- **PRD Generation** - Describe what you want to build and PilotFlow creates the task list
- **Progress Log** - Maintains a progress.txt file with completed work history

## How It Works

1. **Read PRD.md** - PilotFlow finds and parses your PRD file
2. **Find next unchecked task** - Identifies the next `- [ ]` item
3. **Send task to Copilot** - Opens Copilot Agent Mode with the task and context
4. **Copilot implements** - Copilot Agent Mode works on the task
5. **Detect completion** - PilotFlow watches for PRD.md changes (task marked `[x]`)
6. **Countdown & continue** - After a brief countdown, PilotFlow starts the next task
7. **Repeat** - Loop continues until all tasks are done

## Quick Start

### Generate a PRD from a Description
1. Run **"PilotFlow: Generate PRD from Description"** from the Command Palette
2. Describe what you want to build
3. Copilot creates PRD.md with a structured task list
4. Run **"PilotFlow: Start Loop"** to begin autonomous development

### Use an Existing PRD
1. Create a `.pilotflow/PRD.md` file in your workspace:
   ```markdown
   # My Project

   ## Tasks
   - [ ] Set up project structure with dependencies
   - [ ] Create core data models and types
   - [ ] Implement main application logic
   - [ ] Add user interface and styling
   - [ ] Write tests and documentation
   ```
2. Run **"PilotFlow: Start Loop"** from the Command Palette

## Task Format

PilotFlow recognizes these checkbox formats:
- `- [ ]` - Pending task (will be executed)
- `- [x]` - Completed task (skipped)
- `- [~]` - In progress task (will be executed)
- `- [!]` - Blocked task (skipped)

## Commands

| Command | Description |
|---------|-------------|
| `PilotFlow: Open Control Panel` | Show status and quick actions |
| `PilotFlow: Start Loop` | Start processing tasks from the PRD |
| `PilotFlow: Stop Loop` | Stop the current execution |
| `PilotFlow: Pause Loop` | Pause execution (can resume) |
| `PilotFlow: Resume Loop` | Resume paused execution |
| `PilotFlow: Run Single Step` | Execute just the next task |
| `PilotFlow: Generate PRD from Description` | Create PRD.md from a description |
| `PilotFlow: View Logs` | Open the PilotFlow output channel |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pilotflow.files.prdPath` | `.pilotflow/PRD.md` | Path to the PRD file |
| `pilotflow.files.progressPath` | `.pilotflow/progress.txt` | Path to the progress log file |
| `pilotflow.prompt.customTemplate` | (empty) | Custom prompt template for tasks |
| `pilotflow.prompt.customPrdGenerationTemplate` | (empty) | Custom PRD generation template |

### Custom Prompt Templates

You can customize the prompts sent to Copilot using these placeholders:
- `{{task}}` - The current task description
- `{{prd}}` - Full PRD.md contents
- `{{progress}}` - Progress log contents
- `{{requirements}}` - Requirement steps
- `{{workspace}}` - Workspace path

## Status Bar

PilotFlow adds a status bar item showing:
- **$(rocket) PilotFlow** - Idle, click to open control panel
- **$(sync~spin) PilotFlow: Running #N** - Processing task N
- **$(watch) PilotFlow: Waiting** - Waiting for Copilot to complete
- **$(debug-pause) PilotFlow: Paused** - Loop paused

## Sidebar

Click the **🚀 PilotFlow** icon in the Activity Bar to open the sidebar control panel:

- **Progress Stats** - See completed/pending tasks and current iteration
- **Countdown Timer** - Visual countdown before next task starts
- **Current Task** - Shows what's being worked on
- **Control Buttons** - Start, Stop, Pause, Resume, Single Step, Generate PRD
- **Task List** - View all tasks with their status (pending/complete/blocked)
- **Activity Log** - Real-time log of PilotFlow operations

## Requirements

- VS Code 1.93 or later
- GitHub Copilot Chat extension installed and authenticated

## Architecture

```
src/
├── extension.ts        # Main entry point
├── orchestrator.ts     # Main loop orchestration
├── taskRunner.ts       # Task execution logic
├── sidebarProvider.ts  # Sidebar webview provider
├── fileUtils.ts        # PRD parsing and file operations
├── fileWatchers.ts     # File change detection
├── timerManager.ts     # Countdown and inactivity timers
├── copilotIntegration.ts  # Copilot command integration
├── promptBuilder.ts    # Prompt construction
├── statusBar.ts        # Status bar UI
├── uiManager.ts        # UI coordination
├── config.ts           # Configuration handling
├── logger.ts           # Logging utilities
└── types.ts            # TypeScript interfaces
```

## Tips

- Write clear, actionable task descriptions
- Keep tasks to 5-6 per PRD (each runs as a separate agent request)
- Start each task with a verb (Create, Add, Implement, Configure, etc.)
- The prompt instructs Copilot to update PRD.md when done - this triggers the next task

## License

MIT
