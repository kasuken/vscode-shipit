# Changelog

## [3.0.0] - 2026-02-05

### New Features
- Beautifully redesigned sidebar UI with modern card-based layout, improved controls, and collapsible sections for a more intuitive workflow.
- Model selection dropdowns now display friendly model names (e.g., "GPT-4o", "Claude Sonnet 4") instead of raw IDs.
- The extension now retrieves available models from the Copilot SDK using the most accurate method, filtering for enabled models and showing their names.
- Manual PRD creation workflow: users can now write a PRD manually or generate one with AI, with both options available in the UI.
- File-based project description workflow: PRD and related files are consistently created in the `.shipit/` folder.
- Real-time progress bar, animated status indicators, and improved feedback during PRD and user story generation.
- Enhanced user feedback: notifications and action buttons after PRD/user story generation.

### Bug Fixes
- Fixed model discovery to use the correct SDK method and filter out disabled models.
- Resolved issues with PRD path configuration and ensured all prompts use the correct file locations.
- Reduced log noise by making reasoning events silent and summarizing at completion.
- Improved reliability of manual PRD creation and file handling.

### Configuration Changes
- Model selection settings now expect model IDs, but display names in the UI for clarity.
- All file paths for PRD, user stories, and progress logs are now consistently configurable and default to the `.shipit/` folder.

## [2.0.0] - 2026-01-27

### New Features
- Added a **Settings** section in the sidebar panel to choose which model to use per operation:
  - PRD generation
  - User stories generation
  - Task/user story implementation
- Retrieves the available model list from the Copilot SDK (with a safe fallback list if unavailable)

### Bug Fixes
- Improved cancellation handling by supporting aborting the current Copilot SDK session
- Hardened model discovery to gracefully handle SDKs that do not expose `getModels()`

### Configuration Changes
- Added model selection settings:
	- `shipit.models.prdGeneration` (default: `gpt-5.2`)
	- `shipit.models.userStoriesGeneration` (default: `gpt-5.2`)
	- `shipit.models.taskImplementation` (default: `gpt-5-mini`)

### Acknowledgments
- Built on top of GitHub Copilot (Copilot CLI + `github.copilot-chat`) and the Copilot SDK

## [1.0.0] - 2026-01-25

### New Features
- Autonomous “task loop” that reads a PRD checklist and iterates until all tasks are complete
- Activity Bar sidebar control panel with Start/Stop/Pause/Resume plus a single-step mode
- PRD generator command to create a structured task list from a natural-language description
- User stories workflow: generate per-task stories in `.shipit/userstories.md`, then implement stories one-by-one
- Progress logging with timestamps in `.shipit/progress.txt`
- Copilot SDK integration with streaming, retry/backoff, and automatic tool permission approval for autonomous runs
- Inactivity detection with recovery actions (continue waiting, retry, skip, stop)

### Bug Fixes
- Improved completion detection with file watching plus a periodic fallback check
- Safer prompt construction (sanitization and guardrails for overly large prompts)
- Removed outdated prompt placeholders and deprecated templates/commands during the transition to the SDK-based workflow

### Documentation Updates
- Expanded README with prerequisites (Copilot CLI), end-to-end workflow, architecture overview, and troubleshooting
- Added/updated extension branding assets (logo and screenshots)

### Configuration Changes
- Added settings to customize file locations:
	- `shipit.files.prdPath` (default: `.shipit/PRD.md`)
	- `shipit.files.progressPath` (default: `.shipit/progress.txt`)
- Added settings to override prompts:
	- `shipit.prompt.customTemplate`
	- `shipit.prompt.customPrdGenerationTemplate`

### Acknowledgments
- Built on top of GitHub Copilot (requires the Copilot CLI and the `github.copilot-chat` extension)
- Thanks to everyone who tested early versions and provided feedback

### License Information
- MIT License (see [LICENSE](LICENSE))

