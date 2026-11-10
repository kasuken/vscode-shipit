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

The extension provides a sidebar control panel with real-time status and automatic retry logic for transient errors. It waits for each SDK request to finish before advancing, then verifies the generated files.

## Features

- **Autonomous Task Loop** - Continuously works through your PRD until complete
- **User Stories Workflow** - Breaks complex tasks into smaller, implementable pieces
- **Sidebar Control Panel** - Full control and real-time progress from VS Code Activity Bar
- **Smart Progress Tracking** - Verifies completed SDK requests and updates task and story checkboxes
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
- **Node.js 20+** (for development)
- **Active GitHub Copilot subscription**

> [!TIP]
> For Copilot CLI setup, see the [GitHub documentation](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli).

### 1. Generate a PRD from Description

Fastest way to get started:

1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Run **ShipIt: Generate PRD from Description**
3. Write your description in the opened `.shipit/project_description.md` file and save it
4. Run **ShipIt: Generate PRD from Description** again to create `.shipit/PRD.md`
5. Choose enabled models in the sidebar settings, then run **ShipIt: Start Loop**

Open the project as a trusted VS Code workspace. ShipIt executes Copilot tools that can edit files and run commands. The SDK includes its CLI runtime; the separate Copilot Chat extension is not required.

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
| ShipIt: Pause Loop | - | Let the active request finish; pause before the next step |
| ShipIt: Resume Loop | - | Resume from pause |
| ShipIt: Run Single Step | - | Execute just the next task |
| ShipIt: Generate PRD from Description | - | Create PRD.md from text |
| ShipIt: Generate All User Stories | - | Generate stories for all tasks |
| ShipIt: View Logs | - | Open the output log |
| ShipIt: Open Control Panel | - | Focus the ShipIt sidebar |

**Stop** aborts the active SDK request and cancels retries. A failed or cancelled request does not mark its story complete. Files already edited by Copilot are not rolled back; review them before restarting.

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
| `shipit.prompt.customTemplate` | (empty) | Custom prompt template for tasks |
| `shipit.prompt.customPrdGenerationTemplate` | (empty) | Custom PRD generation template |
| `shipit.models.prdGeneration` | `gpt-5.2` | PRD generation model |
| `shipit.models.userStoriesGeneration` | `gpt-5.2` | Story generation model |
| `shipit.models.taskImplementation` | `gpt-5-mini` | Task and story implementation model |

Model availability depends on your account and organization policy. Choose an enabled model from the sidebar if a configured model is shown as unavailable. ShipIt reports discovery failures instead of presenting an unverified fallback list.

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
├── fileWatchers.ts       # Workspace activity monitoring
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
- Trust the workspace if VS Code shows Restricted Mode; reload the window after enabling trust if activation previously failed.
- Ensure Copilot CLI is installed: `copilot --version`
- Verify authentication: `copilot auth status`
- Check VS Code version is 1.93+

### Tasks not progressing
- Check the Activity Log for errors
- Verify PRD.md format (tasks must be `- [ ]`)
- Ensure workspace has write permissions
- Check that the configured models are enabled for your account
- After a failed request, fix the reported error and start again; incomplete work is not skipped

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
- **Node.js 20+** - For development; the extension uses VS Code's embedded runtime
- **Active GitHub Copilot subscription** - Required for API access

## Known Limitations

- Requires Copilot CLI (SDK is in Technical Preview)
- Works best with clear, well-structured PRDs
- Large PRDs may take longer to process
- Direct task implementation must update the PRD checkbox; ShipIt reports an error if it does not

## Development and Testing

```bash
npm ci
npm test
```

The test runner launches a real VS Code extension host in a temporary workspace. The default suite uses deterministic SDK responses and does not make paid model requests. Set `VSCODE_EXECUTABLE_PATH` to an installed VS Code executable to avoid downloading another copy.

For an opt-in end-to-end smoke test with real Copilot requests (requires authentication and consumes Copilot usage):

```powershell
$env:SHIPIT_LIVE_TESTS = '1'
npm test -- --grep 'ShipIt live SDK smoke'
Remove-Item Env:SHIPIT_LIVE_TESTS
```

This test selects an enabled model in the temporary workspace only, generates a PRD and one user story, runs the loop and a single step, and checks both generated modules' behavior. It does not change your global model settings.

Press **F5** to launch the extension interactively. Use a disposable, trusted project when testing autonomous implementation.

## Contributing

Contributions are welcome! Please feel free to:
- Report bugs or request features via issues
- Submit pull requests with improvements
- Share your workflows and best practices

## License

MIT - See [LICENSE](LICENSE) for details

---
