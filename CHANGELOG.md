# Change Log

All notable changes to the "pilotflow" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] - 2024

### Added
- **User Stories Workflow** - Tasks are now broken into 3-5 user stories for more granular implementation
- **User Stories File** - `.pilotflow/userstories.md` stores generated user stories per task
- **Sidebar User Stories Section** - View user stories grouped by task with completion progress
- **Two-tier Implementation** - Generate user stories → implement each one → mark task complete
- Sidebar control panel with real-time status
- PRD generation from natural language description
- Progress tracking in `.pilotflow/progress.txt`
- File watchers for automatic completion detection
- Inactivity detection with countdown timer
- Pause/Resume functionality
- Single-step execution mode

### Changed
- Default file location moved to `.pilotflow/` subfolder
- Simplified PRD template (removed Overview and Tech Stack sections)

## [Unreleased]

- Initial release