# Autonomous macOS AI Bot

## Mission

Build an autonomous AI agent that runs continuously on a dedicated macOS user account and device. The agent should choose useful tasks, work on them independently, remember its state, and report progress.

The agent does not have literal free will. It should simulate independent behavior through goals, memory, planning, self-generated tasks, and scheduled execution.

## Core Requirements

- Run locally on macOS.
- Integrate with a locally hosted open-weight language model, such as an Ollama-compatible model.
- Start automatically when the bot user logs in or the Mac starts.
- Control the mouse and keyboard through macOS accessibility APIs.
- Capture screenshots and inspect visible application state.
- Maintain persistent memory across restarts.
- Create, prioritize, and complete its own tasks.
- Work continuously without requiring a prompt for every action.
- Maintain a heartbeat that records activity and detects stalled work.
- Recover gracefully after crashes or restarts.
- Keep an auditable log of decisions, actions, errors, and results.

## Recommended Architecture

### 1. Agent Controller

The controller owns the main loop:

1. Load the current state, goals, memory, and task queue.
2. Run the heartbeat check.
3. Observe the desktop and relevant workspace files.
4. Ask the local model to select or create a task.
5. Build a short plan with explicit actions.
6. Execute one action at a time.
7. Verify the result using screenshots, application state, or file checks.
8. Record the result and continue, pause, or recover.

The controller should have a bounded action budget per cycle so a faulty plan cannot run forever.

### 2. Local Model Adapter

Provide a small adapter interface so the model can be replaced without changing the agent loop.

The adapter should support:

- Prompting with the current task and observed state.
- Structured JSON responses for plans and actions.
- Configurable model name, temperature, and context size.
- Request timeouts and retry limits.
- Clear handling for malformed or unsafe model output.

The default implementation may communicate with a local Ollama server over its HTTP API.

### 3. Desktop Control

Use macOS-native automation, preferably through Python bindings for Quartz/CoreGraphics and the Accessibility API.

The desktop layer may provide:

- Current screen dimensions.
- Screenshots.
- Mouse movement, clicks, and scrolling.
- Keyboard input and shortcuts.
- Active application and window information where available.
- Opening an application or URL when explicitly allowed.

Every action should be logged before and after execution. The layer should reject coordinates, key sequences, or application targets that do not pass validation.

macOS permissions that may be required include Accessibility and Screen Recording. The setup documentation must explain how to grant them.

### 4. Task Manager

Store tasks persistently with fields such as:

- `id`
- `title`
- `description`
- `priority`
- `status`
- `created_at`
- `updated_at`
- `attempt_count`
- `last_error`
- `parent_task_id`
- `success_criteria`

The agent may generate tasks from its goals, but each task must have a reason, a success criterion, and a bounded scope. Tasks that repeatedly fail should be paused for review instead of retried indefinitely.

### 5. Memory

Use SQLite for structured state and Markdown files for human-readable records.

Store:

- Long-term goals.
- Completed tasks and outcomes.
- Important observations.
- Working preferences and constraints.
- Error patterns.
- Daily journals.

Memory should be searchable and should have size limits or periodic summarization so prompts do not grow without bound.

### 6. Heartbeat and Watchdog

The heartbeat should run at a configurable interval, for example every 1 to 5 minutes. It should record:

- Current task.
- Last action.
- Last successful verification.
- Time since meaningful progress.
- Recent errors.
- Current process health.
- Next planned action.

The watchdog should detect:

- No progress for a configured period.
- Repeated identical actions.
- Repeated model failures.
- Unexpected application state.
- Agent process termination.

When a problem is detected, the agent should stop the current task, save its state, attempt limited recovery, and create a diagnostic entry.

### 7. Scheduler and Startup

Use macOS `launchd` rather than a custom daemon.

The launch agent should:

- Start the bot when the dedicated user logs in.
- Restart it after an unexpected exit with backoff.
- Write stdout and stderr to log files.
- Use a working directory owned by the bot user.
- Avoid running as root.

Provide commands or an installer script to load, unload, inspect, and remove the launch agent.

## Permission and Safety Model

Even on a dedicated device, retain basic controls:

- A visible emergency stop or kill-switch file.
- A pause file that stops new actions while preserving state.
- A maximum action count per cycle.
- A maximum runtime per task.
- A restricted workspace directory.
- No root privileges.
- No deletion of files unless explicitly enabled.
- No purchases, credential use, account changes, or external messages by default.
- No handling of secrets in prompts or logs.
- Full audit logs for all desktop actions and model decisions.

The agent should check the pause and kill-switch state before every action, not only at the beginning of a cycle.

## Suggested Project Layout

```text
bot/
  bot.md
  pyproject.toml
  README.md
  src/
    agent/
      __init__.py
      main.py
      controller.py
      model.py
      desktop.py
      tasks.py
      memory.py
      heartbeat.py
      policy.py
      logging_config.py
  tests/
  workspace/
    goals.md
    journal/
    outputs/
    logs/
  launchd/
    com.local.autobot.plist
```

## Initial Implementation Milestones

### Milestone 1: Safe simulation

- Create the project and configuration system.
- Implement SQLite task and memory storage.
- Implement structured logging.
- Implement the heartbeat.
- Run the agent with simulated observations and actions only.

### Milestone 2: Local model integration

- Add the Ollama-compatible model adapter.
- Require structured JSON plans.
- Validate every generated action against a policy layer.
- Add model timeout and retry handling.

### Milestone 3: Read-only desktop observation

- Add screenshots and active-window observation.
- Save observation metadata without sending sensitive data externally.
- Test state verification without mouse or keyboard control.

### Milestone 4: Controlled desktop actions

- Add mouse and keyboard actions behind an explicit configuration flag.
- Require verification after each action.
- Add pause and kill-switch checks.
- Test with harmless tasks such as opening a text editor and typing into a bot-owned document.

### Milestone 5: Automatic startup and recovery

- Add the `launchd` configuration.
- Test startup, restart, pause, shutdown, and recovery behavior.
- Document permissions and operational commands.

## Development Rules

- Use Python 3.11 or newer.
- Prefer small modules with explicit interfaces.
- Keep model output separate from executable actions.
- Never execute arbitrary shell commands directly from model output.
- Use allowlists for applications, directories, and action types.
- Add tests for task state transitions, policy checks, heartbeat recovery, and malformed model responses.
- Make dry-run mode the default during development.
- Keep all generated files inside the bot workspace unless configured otherwise.

## Definition of Done

The first usable version is complete when the bot can:

1. Start automatically under the dedicated macOS user.
2. Connect to a local model.
3. Load goals and persistent tasks.
4. Choose a bounded task and create a plan.
5. Observe the desktop.
6. Perform approved mouse and keyboard actions.
7. Verify and log each action.
8. Update memory and task status.
9. Detect stalled work through the heartbeat.
10. Pause, recover, and restart without losing state.
11. Stop immediately when the kill switch is activated.
