# oc-stats

A colorful usage, cost and latency dashboard for [OpenCode](https://opencode.ai)'s terminal UI.

```
/stats
```

It reads OpenCode's own usage history through the running server and shows it in three
clickable tabs: **Overview**, **Projects** and **Performance**. A compact **Stats** panel in
the session sidebar keeps the current range's cost, tokens and tool health one glance away.
No telemetry, no external service, no database writes.

## Install

Clone it into your global OpenCode plugins directory:

```bash
git clone https://github.com/rbhgaston/oc-stats.git ~/.config/opencode/plugins/oc-stats
```

Then make sure the plugin is listed in `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    "./plugins/oc-stats"
  ]
}
```

OpenCode also discovers plugins under `<global-config>/plugins/`, so the `cli.json` entry is
only needed if your setup does not pick it up automatically.

Restart the TUI (or run `/reload`), then type `/stats`.

Requires OpenCode 2.2.5 or newer.

## What you get

### Overview

- Cost, input/output/reasoning tokens, cache read/write, cached input %, cache savings.
- Sessions, subagents, prompts, steps, active days and streak.
- Heatmap switchable between **cost**, **tokens** and **steps**.
- Daily sparkline, top models, previous-period comparison.

### Projects

- Sortable project table: sessions, cost, tokens, average cost per session, wall time,
  p50 call latency, last activity.
- Click a project to fold/unfold its sessions.
- Click a session to expand: wall/busy/idle time, prompts, steps, tool calls and errors,
  token split, cost, cache savings, TTFT, call latency, output speed, slowest calls,
  recent messages and subagents.
- Open the selected session directly with `o` or the `open session` line.

### Performance

- TTFT, model call duration, full step duration, output tokens/sec and tool duration.
- Per-project comparison table.
- Slowest model calls and slowest tool calls, with wait/execution split.
- Session time split: wall, busy and idle.

### Sidebar

- A compact `Stats` panel in the session sidebar, built from a couple of cheap stats requests.
- Colored section rules keep **Session**, **Project** and **Range** visually separate.
- Ordered from local to global: the current session first (cost, billed input, output, and a
  cached-share bar with the cached count and percentage), then the current project's cost,
  then the selected range's cost, tokens/cache hit, tool calls/error rate, streak, sessions
  and a daily-steps sparkline.
- `Input` is the billed input only; cache reads are shown separately, so cached tokens often
  look larger than input. The bar shows the cached share of the real input total.
- Ranges: `24h`, `7d`, `30d`, `90d`, `all`.
- Click `Stats` to fold or unfold the panel, click the range next to it to cycle, or click
  `open /stats` for the full dashboard.

## Keys

| key | action |
| --- | --- |
| `1` / `2` / `3` | Overview / Projects / Performance |
| `tab` / `shift+tab` | next / previous tab |
| `↑` `↓` | move in Projects, scroll elsewhere |
| `enter` / `space` | fold or unfold the selected project/session |
| `←` / `→` | collapse / expand |
| `o` | open the selected session |
| `[` / `]` | previous / next range |
| `c` | cycle heatmap metric (cost / tokens / steps) |
| `r` | refresh |
| `esc` | close |

Tabs, ranges, metric options, project headers, session rows and sort headers are clickable.
The mouse wheel scrolls the content.

## Data and privacy

The plugin talks only to the OpenCode server it is attached to, using the same client the TUI
uses. It does not send anything anywhere else, has no analytics, and does not read the
database directly.

It reads:

- `experimental.session.stats` — totals, per-model usage, tool reliability, daily activity
- `project.list` — project names and paths
- `session.list` — per-session cost and token totals
- `message.list` — completed assistant calls, TTFT, step durations, tool calls
- `model.list` — token prices for cache-savings estimates

Project names, session titles, model names and paths are displayed locally in your terminal.
They are not included in this repository or sent to the author.

Messages are fetched lazily for sessions touched in the selected range, four requests at a
time. Only completed assistant calls are counted.

## Metric notes

- **TTFT** = `time.streamed − time.created`.
- **Model call duration** = time until the model hands off to its first tool call.
- **Step duration** = the full assistant step, including tool calls.
- Percentiles exclude calls over 10 minutes so idle gaps do not distort them.
- Cache savings use the current model catalog prices and estimate what the cached tokens
  would have cost at the full input rate.
- OpenRouter credit balance is not included; use the quota plugin for account limits.

## Files

```
package.json  package metadata and ./tui export
tui.tsx       command, dialog, tabs, interaction
sidebar.tsx   the compact Stats panel in the session sidebar
data.ts       OpenCode API reads and aggregation
format.ts     display formatting
```

## License

MIT. See [LICENSE](LICENSE).
