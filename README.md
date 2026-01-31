# OpenClaw GitHub App

AI-powered bot for your GitHub repositories — powered by Claude, running on GitHub Actions.

## What is this?

OpenClaw GitHub App is an AI assistant that lives in your GitHub repository. It responds to mentions, helps with issues and PRs, and can run periodic heartbeat checks to keep your project healthy.

## Architecture

- **GitHub Actions** — Runs on your repository's Actions infrastructure (free for public repos)
- **Actions Cache API** — Persists memory and state between runs
- **Cron Schedules** — Periodic heartbeat checks (configurable)
- **Event Triggers** — Responds to issues, PRs, mentions, and comments

## Features

- **Heartbeat** — Periodic check-ins to review open issues, PRs, and repo health
- **Mentions** — Responds when @mentioned in issues or PRs
- **Issue Support** — Helps triage, label, and respond to issues
- **PR Reviews** — Can provide feedback on pull requests
- **Memory** — Remembers context between interactions via GitHub Cache

## Installation

### 1. Add the workflow

Create `.github/workflows/openclaw.yml` in your repository:

```yaml
name: OpenClaw Bot

on:
  issues:
    types: [opened, edited, labeled]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, edited, labeled, synchronize]
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  openclaw:
    runs-on: ubuntu-latest
    steps:
      - uses: offloadmywork/openclaw-github-app@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 2. Add your Anthropic API key

Go to your repository Settings → Secrets and variables → Actions → New repository secret:
- Name: `ANTHROPIC_API_KEY`
- Value: Your Anthropic API key (get one at https://console.anthropic.com/)

### 3. Trigger the workflow

The bot will now respond to:
- New issues and PRs
- Comments mentioning the bot
- Scheduled heartbeats (every 6 hours by default)

You can also manually trigger it from the Actions tab.

## Development

```bash
npm install
npm run build
npm run typecheck
```

## License

MIT
