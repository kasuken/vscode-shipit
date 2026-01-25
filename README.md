# ShipIt

[![GitHub Copilot](https://img.shields.io/badge/GitHub-Copilot%20SDK-blue?style=flat-square&logo=github)](https://github.com/features/copilot)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?style=flat-square&logo=visualstudiocode)](https://code.visualstudio.com)
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-007ACC?style=flat-square&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=emanuelebartolesi.shipit)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**ShipIt. Turn PRDs into shipped code.**

<div align='center'>
<img width="787" height="1127" alt="ShipIt" src="https://github.com/user-attachments/assets/aad5b973-4f3b-4d15-8156-62e741050dd1" />
</div>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#sidebar-control-panel">Sidebar</a> •
  <a href="#commands">Commands</a> •
  <a href="#demo">Demo</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#requirements">Requirements</a> •
  <a href="#troubleshooting">Troubleshooting</a>
</p>

Autonomous PRD development in VS Code. ShipIt reads your Product Requirements Document (PRD), breaks down tasks into manageable user stories, and autonomously implements them using GitHub Copilot.

> [!IMPORTANT]
> This extension requires the GitHub Copilot CLI to be installed and authenticated. See [Requirements](#requirements) for details.

## Overview

ShipIt is a VS Code extension that orchestrates the GitHub Copilot SDK to implement your PRD in a structured, autonomous workflow. Instead of manual implementation requests, you describe your project requirements in a PRD, and ShipIt handles the rest:

1. Reads tasks from your PRD
2. Generates focused user stories for each task
3. Implements each user story with Copilot
4. Tracks progress and automatically continues to the next task
5. Maintains a progress log of completed work

The extension provides a sidebar control panel with real-time status, file watching for progress tracking, and automatic error recovery with retry logic.

## Features

- **Autonomous Task Loop** - Continuously works through your PRD until complete
- **User Stories Workflow** - Breaks complex tasks into smaller, implementable pieces
- **Sidebar Control Panel** - Full control and real-time progress from VS Code Activity Bar
- **Smart Progress Tracking** - Watches files and automatically detects task completion
- **Error Recovery** - Built-in retry logic with exponential backoff for failed API calls
- **PRD Generation** - Create structured task lists from descriptions
- **Progress Logging** - Maintains a record of all completed work
- **Inactivity Detection** - Alerts you if Copilot seems stuck

## How It Works

```
┌─────────────────────────────────────────┐
│  1. Read PRD.md                         │
│     ↓                                   │
│  2. Get next unchecked task             │
│     ↓                                   │
│  3. Generate user stories               │
│     ↓                                   │
│  4. Implement each story with Copilot   │
│     ↓                                   │
│  5. Mark story complete [x]             │
│     ↓                                   │
│  6. All stories done? Mark task [x]     │
│     ↓                                   │
│  7. More tasks? Go to step 2            │
│     ↓                                   │
│  8. Done!                               │
└─────────────────────────────────────────┘
```

### Workflow Details

1. **Task Parsing** - ShipIt scans your `.shipit/PRD.md` for unchecked tasks (`- [ ]`)
2. **Story Generation** - For each task, Copilot generates 3-5 actionable user stories
3. **Story Implementation** - Each user story is sent to Copilot one at a time for focused implementation
4. **Automatic Progression** - When a story completes, the checkbox is automatically updated
5. **Task Completion** - Once all stories for a task are done, the task is marked complete
6. **Continuous Loop** - The process repeats for the next task until all are done

## Quick Start

### Prerequisites

Before starting, ensure you have:

- **VS Code 1.93+**
- **GitHub Copilot CLI** installed and authenticated
  ```bash
  copilot --version  # Verify installation
  ```
- **Node.js 18+** (for development)
- **Active GitHub Copilot subscription**

> [!TIP]
> For Copilot CLI setup, see the [GitHub documentation](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli).

### 1. Generate a PRD from Description

Fastest way to get started:

1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Run **ShipIt: Generate PRD from Description**
3. Describe your project (e.g., "A REST API for managing todo items with user authentication")
4. Copilot creates `.shipit/PRD.md` with structured tasks
5. Run **ShipIt: Start Loop** to begin implementation

### 2. Use an Existing PRD

If you have a PRD, create `.shipit/PRD.md` with task checkboxes:

```markdown
# My Project Name

## Tasks
- [ ] Set up project structure and dependencies
- [ ] Create core data models and types
- [ ] Implement main business logic
- [ ] Add user interface components
- [ ] Write tests and documentation
```

Then run **ShipIt: Start Loop** from the Command Palette.

## Sidebar Control Panel

Click the **📦** icon in VS Code's Activity Bar to open the ShipIt sidebar:

- **Progress Stats** - Completed, pending, and current iteration count
- **Current Task** - Shows both parent task and active user story with elapsed time
- **Control Buttons** - Start, Stop, Pause, Resume, Single Step
- **Task List** - View all tasks and their completion status
- **User Stories** - See user stories for each task with checkmarks
- **Activity Log** - Real-time log of ShipIt operations

## Commands

| Command | Keyboard | Description |
|---------|----------|-------------|
| ShipIt: Start Loop | - | Start autonomous implementation |
| ShipIt: Stop Loop | - | Stop the current loop |
| ShipIt: Pause Loop | - | Pause execution (can resume) |
| ShipIt: Resume Loop | - | Resume from pause |
| ShipIt: Run Single Step | - | Execute just the next task |
| ShipIt: Generate PRD from Description | - | Create PRD.md from text |
| ShipIt: Generate All User Stories | - | Generate stories for all tasks |
| ShipIt: View Logs | - | Open the output log |

## File Structure

ShipIt creates and manages files in the `.shipit/` directory:

```
.shipit/
├── PRD.md              # Product Requirements Document with tasks
├── userstories.md      # Generated user stories organized by task
└── progress.txt        # Log of completed work
```

### PRD.md Format

Tasks use standard markdown checkboxes:

```markdown
# Project Title

## Tasks
- [ ] Pending task (will be executed)
- [x] Completed task (skipped)
- [~] In progress task (will be executed)
- [!] Blocked task (skipped)
```

### User Stories Format

Auto-generated in `userstories.md`, organized by parent task:

```markdown
## Task: Set up project structure and dependencies

- [x] Initialize npm project and install dependencies
- [x] Configure TypeScript and build tools
- [ ] Set up ESLint and code formatting
- [ ] Create project directory structure

## Task: Create core data models

- [ ] Define TypeScript interfaces for domain models
- [ ] Create database schemas and migrations
```

## Demo

![shipit-hq](https://github.com/user-attachments/assets/f32542eb-e4ef-4adf-bf4c-bbdd5a206a2c)

## Configuration

Access settings via VS Code Settings (Cmd/Ctrl + ,) and search for "ShipIt":

| Setting | Default | Description |
|---------|---------|-------------|
| `shipit.files.prdPath` | `.shipit/PRD.md` | Path to the PRD file |
| `shipit.files.progressPath` | `.shipit/progress.txt` | Path to the progress log |
| `shipit.userStories.countPerTask` | `3` | Number of user stories per task (1-10) |
| `shipit.prompt.customTemplate` | (empty) | Custom prompt template for tasks |
| `shipit.prompt.customPrdGenerationTemplate` | (empty) | Custom PRD generation template |

### Custom Prompt Templates

Override default prompts using these placeholders:

- `{{task}}` - Current task description
- `{{prd}}` - Full PRD.md contents
- `{{progress}}` - Progress log contents
- `{{requirements}}` - Implementation requirements
- `{{workspace}}` - Workspace root path

## Architecture

```
src/
├── extension.ts          # VS Code extension entry point
├── orchestrator.ts       # Main loop orchestration engine
├── taskRunner.ts         # Task and user story execution
├── copilotSdk.ts         # Copilot SDK wrapper with retry logic
├── sidebarProvider.ts    # Sidebar webview UI
├── fileUtils.ts          # PRD parsing and file operations
├── fileWatchers.ts       # File change detection
├── promptBuilder.ts      # Prompt construction
├── config.ts             # Configuration handling
├── types.ts              # TypeScript interfaces
├── logger.ts             # Logging utilities
├── statusBar.ts          # Status bar UI
├── uiManager.ts          # UI coordination
└── timerManager.ts       # Countdown and inactivity timers
```

## Tips for Best Results

- **Write clear task descriptions** - Start each with a verb (Create, Add, Implement, Configure)
- **Keep PRDs manageable** - 5-6 tasks per PRD works well for focused implementation
- **Be specific about requirements** - Include technology choices and constraints
- **Monitor progress** - Check the sidebar and logs for any issues
- **Customize prompts if needed** - Adjust the custom template for your project style

## Troubleshooting

### Extension won't start
- Ensure Copilot CLI is installed: `copilot --version`
- Verify authentication: `copilot auth status`
- Check VS Code version is 1.93+

### Tasks not progressing
- Check the Activity Log for errors
- Verify PRD.md format (tasks must be `- [ ]`)
- Ensure workspace has write permissions

### API errors (400, 429, 500)
- The extension includes automatic retry logic with exponential backoff
- Check VS Code Output panel for details
- Verify your Copilot subscription is active

### Copilot seems stuck
- ShipIt alerts after 60 seconds of inactivity
- Check the sidebar for current activity
- Click **Stop** and review the logs
- Try running a **Single Step** to debug

## Status Bar Indicators

| Status | Icon | Meaning |
|--------|------|---------|
| Idle | 📦 | ShipIt ready, click to open panel |
| Running | 🔄 | Processing task #N |
| Waiting | ⏱️ | Waiting for Copilot to complete |
| Paused | ⏸️ | Execution paused |

## Requirements

- **VS Code 1.93+** - Modern webview and extension API support
- **GitHub Copilot CLI** - For Copilot SDK integration
  - [Installation guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
  - Run `copilot --version` to verify
- **Node.js 18+** - For runtime (included with VS Code)
- **Active GitHub Copilot subscription** - Required for API access

## Known Limitations

- Requires Copilot CLI (SDK is in Technical Preview)
- Works best with clear, well-structured PRDs
- Large PRDs may take longer to process
- Progress tracking depends on Copilot updating files correctly

## Contributing

Contributions are welcome! Please feel free to:
- Report bugs or request features via issues
- Submit pull requests with improvements
- Share your workflows and best practices

## License

MIT - See [LICENSE](LICENSE) for details

---
