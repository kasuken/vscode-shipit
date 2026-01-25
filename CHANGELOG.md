# Changelog

All notable changes to the **ShipIt** VS Code extension will be documented in this file.

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

