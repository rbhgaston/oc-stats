/** @jsxImportSource @opentui/solid */
/**
 * oc-stats: a native usage dashboard for OpenCode.
 *
 * `/oc_stats` (or the command palette) opens a window with three tabs:
 * Overview, Projects and Performance. Everything is read from OpenCode's own
 * API through context.client; no database access and no server plugin.
 */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import {
  dayKey,
  loadDashboard,
  percentile,
  totalTokens,
  type Call,
  type Dashboard,
  type Metric,
  type ProjectData,
  type Range,
  type SessionData,
  type SortKey,
  type ToolCall,
} from "./data"
import {
  date,
  dateTime,
  delta,
  duration,
  pad,
  pct,
  shortModel,
  tokens as fmtTokens,
  truncate,
  usd,
} from "./format"
import { StatsSidebar } from "./sidebar"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "performance", label: "Performance" },
] as const
type TabID = (typeof TABS)[number]["id"]

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "all", label: "all" },
]

const METRICS: Array<{ id: Metric; label: string }> = [
  { id: "cost", label: "cost" },
  { id: "tokens", label: "tokens" },
  { id: "steps", label: "steps" },
]

const DAY_MS = 86_400_000
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const CELLS = ["·", "░", "▒", "▓", "█"]
const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/** Approximate room inside the dialog for content: xlarge is 116, minus its and our padding. */
function useContentWidth() {
  const dimensions = useTerminalDimensions()
  return () => Math.max(40, Math.min(116, dimensions().width - 2) - 10)
}

function shortProvider(model: any): string {
  const label = shortModel(model)
  return label.length > 26 ? truncate(label, 26) : label
}

function metricValue(bucket: any, metric: Metric): number {
  if (!bucket) return 0
  if (metric === "cost") return bucket.cost ?? 0
  if (metric === "tokens") return bucket.tokens ?? 0
  return bucket.steps ?? 0
}

function formatMetric(value: number, metric: Metric): string {
  if (metric === "cost") return usd(value)
  if (metric === "tokens") return fmtTokens(value)
  return String(Math.round(value))
}

function weekColumns(d: Dashboard, metric: Metric) {
  const to = new Date(d.window.to)
  to.setHours(0, 0, 0, 0)
  let from = d.window.from > 0 ? d.window.from : to.getTime() - 26 * 7 * DAY_MS
  from = Math.max(from, to.getTime() - 26 * 7 * DAY_MS)
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const mondayOffset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - mondayOffset)
  const weeks: Array<Array<{ key: string; value: number }>> = []
  for (let at = start.getTime(); at <= to.getTime(); at += 7 * DAY_MS) {
    const week: Array<{ key: string; value: number }> = []
    for (let day = 0; day < 7; day += 1) {
      const key = dayKey(at + day * DAY_MS)
      week.push({ key, value: metricValue(d.daily[key], metric) })
    }
    weeks.push(week)
  }
  return weeks
}

function sparkline(d: Dashboard, metric: Metric): string {
  const end = new Date(d.window.to)
  end.setHours(0, 0, 0, 0)
  const days: number[] = []
  for (let index = 29; index >= 0; index -= 1) {
    const at = end.getTime() - index * DAY_MS
    days.push(metricValue(d.daily[dayKey(at)], metric))
  }
  const max = Math.max(...days, 1)
  return days
    .map((value) => {
      if (value <= 0) return " "
      const level = Math.min(SPARKS.length - 1, Math.max(0, Math.ceil((value / max) * SPARKS.length) - 1))
      return SPARKS[level]
    })
    .join("")
}

function projectAverage(project: ProjectData): number {
  return project.cost / Math.max(1, project.roots.length)
}

const LATENCY_MAX_MS = 10 * 60 * 1000

function stableCalls(calls: Call[]): Call[] {
  return calls.filter((call) => call.duration <= LATENCY_MAX_MS)
}

function projectP50(project: ProjectData): number | undefined {
  return percentile(stableCalls(project.calls).map((call) => call.duration), 0.5)
}

function projectP95(project: ProjectData): number | undefined {
  return percentile(stableCalls(project.calls).map((call) => call.duration), 0.95)
}

function projectTtftP50(project: ProjectData): number | undefined {
  return percentile(stableCalls(project.calls).map((call) => call.ttft).filter((value): value is number => value !== undefined), 0.5)
}

function projectSpeedP50(project: ProjectData): number | undefined {
  return percentile(stableCalls(project.calls).map((call) => call.outputSpeed).filter((value): value is number => value !== undefined), 0.5)
}

function sortProjects(projects: ProjectData[], key: SortKey): ProjectData[] {
  const list = [...projects]
  switch (key) {
    case "name":
      list.sort((a, b) => a.name.localeCompare(b.name))
      break
    case "sessions":
      list.sort((a, b) => b.roots.length - a.roots.length)
      break
    case "tokens":
      list.sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens))
      break
    case "avg":
      list.sort((a, b) => projectAverage(b) - projectAverage(a))
      break
    case "wall":
      list.sort((a, b) => b.wall - a.wall)
      break
    case "p50":
      list.sort((a, b) => (projectP50(b) ?? 0) - (projectP50(a) ?? 0))
      break
    case "last":
      list.sort((a, b) => b.lastActive - a.lastActive)
      break
    default:
      list.sort((a, b) => b.cost - a.cost)
  }
  return list
}

function StatText(props: {
  label: string
  value: string
  labelWidth?: number
  valueWidth?: number
  theme: any
  accent?: any
}) {
  return (
    <text wrapMode="none" selectable={false}>
      <span style={{ fg: props.theme.text.muted }}>{pad(props.label, props.labelWidth ?? 14)}</span>
      <span style={{ fg: props.accent ?? props.theme.text.base }}>{pad(props.value, props.valueWidth ?? 14)}</span>
    </text>
  )
}

function Section(props: { title: string; theme: any; children: any; right?: any }) {
  return (
    <box flexDirection="column" marginTop={2}>
      <box flexDirection="row" flexShrink={0} paddingBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={props.theme.hue.accent[500]}>{props.title}</text>
        <box flexGrow={1} />
        {props.right}
      </box>
      {props.children}
    </box>
  )
}

function Option(props: { active: boolean; label: string; theme: any; run: () => void }) {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      backgroundColor={props.active ? props.theme.background.raised.high : undefined}
      onMouseUp={props.run}
    >
      <text
        wrapMode="none"
        selectable={false}
        fg={props.active ? props.theme.text.action.primary.selected : props.theme.text.muted}
        attributes={props.active ? TextAttributes.BOLD : TextAttributes.NONE}
      >
        {props.label}
      </text>
    </box>
  )
}

function Tab(props: { active: boolean; label: string; theme: any; run: () => void }) {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      backgroundColor={props.active ? props.theme.background.raised.high : undefined}
      onMouseUp={props.run}
    >
      <text
        wrapMode="none"
        selectable={false}
        fg={props.active ? props.theme.text.action.primary.selected : props.theme.text.muted}
        attributes={props.active ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.NONE}
      >
        {props.label}
      </text>
    </box>
  )
}

function Hints(props: { items: Array<[string, string]>; theme: any }) {
  return (
    <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
      <For each={props.items}>
        {([key, label]) => (
          <text wrapMode="none" selectable={false}>
            <span style={{ fg: props.theme.hue.accent[500], bold: true }}>{key}</span>
            <span style={{ fg: props.theme.text.muted }}>{` ${label}`}</span>
          </text>
        )}
      </For>
    </box>
  )
}

function SortLabel(props: { active: boolean; label: string; theme: any; run: () => void }) {
  return (
    <text
      wrapMode="none"
      selectable={false}
      fg={props.active ? props.theme.text.action.primary.selected : props.theme.text.muted}
      attributes={props.active ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.NONE}
      onMouseUp={props.run}
    >
      {props.label}
    </text>
  )
}

function KpiGrid(props: { d: Dashboard; theme: any }) {
  const d = props.d
  const t = d.totals
  const left = [
    ["Cost", usd(t.cost), "Sessions", `${t.sessions}${t.subagents ? ` +${t.subagents}` : ""}`],
    ["Input", fmtTokens(t.tokens.input), "Prompts", fmtTokens(t.prompts)],
    ["Output", fmtTokens(t.tokens.output), "Steps", fmtTokens(t.steps)],
    ["Reasoning", fmtTokens(t.tokens.reasoning), "Active days", String(t.activeDays)],
    ["Cache read", fmtTokens(t.tokens.cache.read), "Streak", `${t.streak}d`],
    ["Cache write", fmtTokens(t.tokens.cache.write), "Cache hit", pct(t.cacheHit)],
    ["Cache saved", usd(t.cacheSavings), "Tool calls", fmtTokens(t.tools)],
    ["Busy time", duration(t.busy), "Tool errors", String(t.toolErrors)],
  ] as Array<[string, string, string, string]>
  const valueColor = (label: string) => {
    if (label === "Cost" || label === "Cache saved") return props.theme.text.feedback.success.base
    if (label === "Tool errors") return props.theme.text.feedback.error.base
    if (label === "Busy time" || label === "Cache hit") return props.theme.hue.accent[500]
    return props.theme.text.base
  }
  return (
    <box flexDirection="row" flexShrink={0} marginTop={1} paddingLeft={1}>
      <box flexDirection="column" width={44}>
        <For each={left}>
          {([label, value, label2, value2], index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index() % 2 ? props.theme.background.raised.base : undefined}
            >
              <text wrapMode="none" selectable={false}>
                <span style={{ fg: props.theme.text.muted }}>{pad(label, 12)}</span>
                <span style={{ fg: valueColor(label) }}>{pad(value, 14)}</span>
                <span style={{ fg: props.theme.text.muted }}>{pad(label2, 12)}</span>
                <span style={{ fg: valueColor(label2) }}>{value2}</span>
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function Heatmap(props: { d: Dashboard; metric: Metric; setMetric: (metric: Metric) => void; theme: any }) {
  const weeks = createMemo(() => weekColumns(props.d, props.metric))
  const max = createMemo(() => {
    let maximum = 0
    for (const week of weeks()) {
      for (const cell of week) maximum = Math.max(maximum, cell.value)
    }
    return Math.max(maximum, 1)
  })
  const level = (value: number) => (value <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((value / max()) * 4))))
  const color = (value: number) => (value <= 0 ? props.theme.text.muted : props.theme.hue.accent[500])
  return (
    <box flexDirection="column" marginTop={2}>
      <box flexDirection="row" flexShrink={0} paddingBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={props.theme.hue.accent[500]}>Activity</text>
        <text fg={props.theme.text.muted}>{`  ${props.d.window.label}${props.d.window.days === 0 ? " · last 26 weeks" : ""} · click a metric or press c`}</text>
      </box>
      <box flexDirection="row" flexShrink={0} marginTop={0} gap={1}>
        <text fg={props.theme.text.muted}>shade</text>
        <For each={METRICS}>
          {(metric) => (
            <Option
              active={props.metric === metric.id}
              label={metric.label}
              theme={props.theme}
              run={() => props.setMetric(metric.id)}
            />
          )}
        </For>
        <text fg={props.theme.text.muted}>{`less `}</text>
        <text fg={props.theme.hue.accent[500]}>· ░ ▒ ▓ █</text>
        <text fg={props.theme.text.muted}>{` more`}</text>
      </box>
      <For each={WEEKDAYS}>
        {(weekday, row) => (
          <box flexDirection="row" flexShrink={0}>
            <text fg={props.theme.text.muted}>{pad(weekday, 4)}</text>
            <For each={weeks()}>
              {(week) => (
                <text fg={color(week[row()]?.value ?? 0)} selectable={false}>
                  {`${CELLS[level(week[row()]?.value ?? 0)]} `}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function Spark(props: { d: Dashboard; metric: Metric; theme: any }) {
  return (
    <box flexDirection="column" marginTop={2}>
      <text attributes={TextAttributes.BOLD} fg={props.theme.hue.accent[500]}>{`Daily ${props.metric}`}</text>
      <text fg={props.theme.hue.accent[500]} selectable={false}>{sparkline(props.d, props.metric)}</text>
      <text fg={props.theme.text.muted} wrapMode="none">last 30 days · <span style={{ fg: props.theme.text.feedback.success.base }}>{formatMetric(metricValue(props.d.daily[dayKey(props.d.window.to)], props.metric), props.metric)}</span> today</text>
    </box>
  )
}

function Comparison(props: { d: Dashboard; theme: any }) {
  const previous = props.d.previous
  if (!previous) return null
  const current = props.d.totals
  const costChange = current.cost - previous.cost
  return (
    <box flexDirection="column" marginTop={2}>
      <text attributes={TextAttributes.BOLD} fg={props.theme.hue.accent[500]}>Compared with the previous period</text>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: props.theme.text.muted }}>{pad("Cost", 12)}</span>
        <span style={{ fg: props.theme.text.feedback.success.base }}>{pad(`${usd(previous.cost)} → ${usd(current.cost)}`, 28)}</span>
        <span style={{ fg: costChange > 0 ? props.theme.text.feedback.warning.base : props.theme.text.feedback.success.base }}>{delta(current.cost, previous.cost)}</span>
      </text>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: props.theme.text.muted }}>{pad("Tokens", 12)}</span>
        <span style={{ fg: props.theme.text.base }}>{`${fmtTokens(previous.tokens)} → ${fmtTokens(totalTokens(current.tokens))}`}</span>
        <span style={{ fg: props.theme.hue.accent[500] }}>{`  ${delta(totalTokens(current.tokens), previous.tokens)}`}</span>
      </text>
      <text wrapMode="none" selectable={false}>
        <span style={{ fg: props.theme.text.muted }}>{pad("Prompts", 12)}</span>
        <span style={{ fg: props.theme.text.base }}>{`${fmtTokens(previous.prompts)} → ${fmtTokens(current.prompts)}`}</span>
        <span style={{ fg: props.theme.text.muted }}>{`  ${delta(current.prompts, previous.prompts)}`}</span>
      </text>
    </box>
  )
}

function ModelsTable(props: { d: Dashboard; theme: any }) {
  const models = props.d.models.slice(0, 10)
  const width = useContentWidth()
  const compact = () => width() < 84
  const [hovered, setHovered] = createSignal<string | undefined>()
  const [pinned, setPinned] = createSignal<string | undefined>()
  const full = () => hovered() ?? pinned()
  return (
    <Section title="Models" theme={props.theme}>
      <box paddingLeft={1}>
        <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
          {compact()
            ? `${pad("model", 26)}${pad("steps", 6)}${pad("tokens", 8)}cost`
            : `${pad("model", 41)}${pad("steps", 8)}${pad("tokens", 10)}${pad("cost", 9)}cache saved`}
        </text>
      </box>
      <Show when={models.length > 0} fallback={<text fg={props.theme.text.muted}>No model usage in this range.</text>}>
        <For each={models}>
          {(model, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                pinned() === model.label || hovered() === model.label
                  ? props.theme.background.raised.high
                  : index() % 2
                    ? props.theme.background.raised.base
                    : undefined
              }
            >
              <text
                wrapMode="none"
                selectable={false}
                onMouseOver={() => setHovered(model.label)}
                onMouseOut={() => setHovered(undefined)}
                onMouseUp={() => setPinned((current) => (current === model.label ? undefined : model.label))}
              >
                <span style={{ fg: props.theme.text.base }}>{compact() ? pad(truncate(model.label, 25), 26) : pad(truncate(model.label, 40), 41)}</span>
                <span style={{ fg: props.theme.hue.accent[500] }}>{pad(String(model.steps), compact() ? 6 : 8)}</span>
                <span style={{ fg: props.theme.text.base }}>{pad(fmtTokens(totalTokens(model.tokens)), compact() ? 8 : 10)}</span>
                <span style={{ fg: props.theme.text.feedback.success.base }}>{pad(usd(model.cost), 9)}</span>
                {!compact() ? <span style={{ fg: props.theme.text.feedback.success.base }}>{usd(model.cacheSavings)}</span> : null}
              </text>
            </box>
          )}
        </For>
      </Show>
      <Show when={models.length > 0}>
        <box paddingLeft={1} height={2} flexDirection="column">
          <Show
            when={full()}
            fallback={
              <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
                hover a model for its full name · click to pin
              </text>
            }
          >
            <text wrapMode="word" selectable={false} fg={props.theme.text.muted}>
              {`${compact() ? "full" : "full name"}  `}
              <span style={{ fg: props.theme.text.base }}>{full()}</span>
            </text>
          </Show>
        </box>
      </Show>
    </Section>
  )
}

function Overview(props: {
  d: Dashboard
  metric: Metric
  setMetric: (metric: Metric) => void
  theme: any
}) {
  return (
    <box flexDirection="column">
      <KpiGrid d={props.d} theme={props.theme} />
      <Heatmap d={props.d} metric={props.metric} setMetric={props.setMetric} theme={props.theme} />
      <Spark d={props.d} metric={props.metric} theme={props.theme} />
      <Comparison d={props.d} theme={props.theme} />
      <ModelsTable d={props.d} theme={props.theme} />
    </box>
  )
}

function ProjectHeader(props: { sort: SortKey; setSort: (key: SortKey) => void; theme: any; compact: boolean }) {
  return (
    <box flexDirection="row" flexShrink={0} marginTop={2} paddingLeft={1}>
      {props.compact ? (
        <>
          <SortLabel active={props.sort === "name"} label={pad("  Project", 23)} theme={props.theme} run={() => props.setSort("name")} />
          <SortLabel active={props.sort === "sessions"} label={pad("Sess", 5)} theme={props.theme} run={() => props.setSort("sessions")} />
          <SortLabel active={props.sort === "cost"} label={pad("Cost", 8)} theme={props.theme} run={() => props.setSort("cost")} />
          <SortLabel active={props.sort === "tokens"} label={pad("Tokens", 8)} theme={props.theme} run={() => props.setSort("tokens")} />
          <SortLabel active={props.sort === "wall"} label={pad("Wall", 9)} theme={props.theme} run={() => props.setSort("wall")} />
          <SortLabel active={props.sort === "p50"} label={pad("p50", 8)} theme={props.theme} run={() => props.setSort("p50")} />
          <SortLabel active={props.sort === "last"} label="Last" theme={props.theme} run={() => props.setSort("last")} />
        </>
      ) : (
        <>
          <SortLabel active={props.sort === "name"} label={pad("  Project", 29)} theme={props.theme} run={() => props.setSort("name")} />
          <SortLabel active={props.sort === "sessions"} label={pad("Sess", 5)} theme={props.theme} run={() => props.setSort("sessions")} />
          <SortLabel active={props.sort === "cost"} label={pad("Cost", 8)} theme={props.theme} run={() => props.setSort("cost")} />
          <SortLabel active={props.sort === "tokens"} label={pad("Tokens", 8)} theme={props.theme} run={() => props.setSort("tokens")} />
          <SortLabel active={props.sort === "avg"} label={pad("Avg", 7)} theme={props.theme} run={() => props.setSort("avg")} />
          <SortLabel active={props.sort === "wall"} label={pad("Wall", 9)} theme={props.theme} run={() => props.setSort("wall")} />
          <SortLabel active={props.sort === "p50"} label={pad("p50", 9)} theme={props.theme} run={() => props.setSort("p50")} />
          <SortLabel active={props.sort === "last"} label="Last" theme={props.theme} run={() => props.setSort("last")} />
        </>
      )}
    </box>
  )
}

function DetailLine(props: { text: string; theme: any; muted?: boolean; color?: any }) {
  return <text wrapMode="word" selectable={false} fg={props.color ?? (props.muted ? props.theme.text.muted : props.theme.text.base)}>{props.text}</text>
}

function SessionDetail(props: {
  session: SessionData
  project: ProjectData
  theme: any
  open: () => void
}) {
  const session = () => props.session
  const toolSummary = () => {
    const byName = new Map<string, { calls: number; errors: number; durations: number[] }>()
    for (const tool of session().tools) {
      const item = byName.get(tool.name) ?? { calls: 0, errors: 0, durations: [] }
      item.calls += 1
      if (tool.status === "error") item.errors += 1
      item.durations.push(tool.duration)
      byName.set(tool.name, item)
    }
    return [...byName.entries()]
      .map(([name, item]) => ({ name, ...item, p50: percentile(item.durations, 0.5) ?? 0 }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 6)
  }
  const children = () => props.project.children.filter((child) => child.parentID === session().id)
  const slow = () => [...session().calls].sort((a, b) => b.duration - a.duration).slice(0, 3)
  const recent = () => [...session().calls].sort((a, b) => b.end - a.end).slice(0, 5)
  const cacheHit = () => {
    const t = session().tokens
    return t.cache.read + t.input + t.cache.write > 0 ? t.cache.read / (t.cache.read + t.input + t.cache.write) : 0
  }
  return (
    <box
      flexDirection="column"
      marginTop={1}
      marginBottom={1}
      paddingLeft={3}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      border={["left"]}
      borderColor={props.theme.hue.accent[500]}
      backgroundColor={props.theme.background.raised.base}
    >
      <DetailLine theme={props.theme} muted text={`Time  wall ${duration(session().wall)} · busy ${duration(session().busy)} · idle ${duration(session().idle)} · last ${dateTime(session().updated)}`} />
      <DetailLine theme={props.theme} muted text={`Calls ${session().steps} · tools ${session().tools.length}${session().tools.filter((tool) => tool.status === "error").length ? ` (${session().tools.filter((tool) => tool.status === "error").length} errors)` : ""} · prompts ${session().prompts} · cache hit ${pct(cacheHit())}`} />
      <DetailLine theme={props.theme} text={`Tokens  in ${fmtTokens(session().tokens.input)} · out ${fmtTokens(session().tokens.output)} · reasoning ${fmtTokens(session().tokens.reasoning)} · cache read ${fmtTokens(session().tokens.cache.read)} · write ${fmtTokens(session().tokens.cache.write)}`} />
      <DetailLine theme={props.theme} color={props.theme.text.feedback.success.base} text={`Cost    ${usd(session().cost)} · cache saved ${usd(session().cacheSavings)} · session total ${usd(session().totalCost)}`} />
      <DetailLine theme={props.theme} color={props.theme.hue.accent[500]} text={`Latency TTFT p50 ${duration(percentile(stableCalls(session().calls).map((call) => call.ttft).filter((value): value is number => value !== undefined), 0.5))} · call p50 ${duration(percentile(stableCalls(session().calls).map((call) => call.duration), 0.5))} · output p50 ${percentile(stableCalls(session().calls).map((call) => call.outputSpeed).filter((value): value is number => value !== undefined), 0.5)?.toFixed(0) ?? "—"} tok/s`} />
      <Show when={toolSummary().length > 0}>
        <text fg={props.theme.text.muted} wrapMode="word" selectable={false}>Tools  {toolSummary().map((tool) => `${tool.name} ${tool.calls}${tool.errors ? `/${tool.errors}err` : ""} p50 ${duration(tool.p50)}`).join(" · ")}</text>
      </Show>
      <Show when={slow().length > 0}>
        <text fg={props.theme.hue.accent[500]} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>Slowest calls</text>
        <For each={slow()}>
          {(call) => (
            <text wrapMode="none" selectable={false}>
              <span style={{ fg: call.duration > 60_000 ? props.theme.text.feedback.warning.base : props.theme.text.muted }}>{`  ${pad(duration(call.duration), 8)}${pad(shortProvider(call.model), 28)}`}</span>
              <span style={{ fg: props.theme.text.base }}>{`${fmtTokens(call.tokens.output)} out  ${usd(call.cost)}`}</span>
            </text>
          )}
        </For>
      </Show>
      <Show when={recent().length > 0}>
        <text fg={props.theme.hue.accent[500]} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>Recent messages</text>
        <For each={recent()}>
          {(call) => (
            <text wrapMode="none" selectable={false}>
              <span style={{ fg: props.theme.text.muted }}>{`  ${pad(dateTime(call.end), 17)}`}</span>
              <span style={{ fg: props.theme.text.base }}>{`${pad(shortProvider(call.model), 27)}${pad(duration(call.duration), 8)}${pad(fmtTokens(totalTokens(call.tokens)), 8)}${usd(call.cost)}`}</span>
            </text>
          )}
        </For>
      </Show>
      <Show when={children().length > 0}>
        <text fg={props.theme.hue.accent[500]} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>Subagents</text>
        <For each={children()}>
          {(child) => (
            <text wrapMode="none" selectable={false}>
              <span style={{ fg: props.theme.text.muted }}>{`  ↳ ${pad(truncate(child.title, 42), 44)}`}</span>
              <span style={{ fg: props.theme.text.base }}>{`${usd(child.cost)}  ${fmtTokens(totalTokens(child.tokens))}`}</span>
            </text>
          )}
        </For>
      </Show>
      <text fg={props.theme.text.action.primary.selected} attributes={TextAttributes.BOLD} onMouseUp={props.open} selectable={false}>open session ↵</text>
    </box>
  )
}

function Projects(props: {
  d: Dashboard
  projects: ProjectData[]
  rows: Array<{ kind: "project"; project: ProjectData } | { kind: "session"; session: SessionData; project: ProjectData }>
  focus: number
  setFocus: (index: number) => void
  expanded: Record<string, boolean>
  toggleProject: (id: string) => void
  detail?: string
  toggleDetail: (id: string) => void
  openSession: (id: string) => void
  sort: SortKey
  setSort: (key: SortKey) => void
  theme: any
}) {
  const width = useContentWidth()
  const compact = () => width() < 100
  return (
    <box flexDirection="column">
      <ProjectHeader sort={props.sort} setSort={props.setSort} theme={props.theme} compact={compact()} />
      <Show when={props.projects.length > 0} fallback={<text fg={props.theme.text.muted}>No sessions in this range.</text>}>
        <For each={props.rows}>
          {(row, index) => {
            if (row.kind === "project") {
              const project = row.project
              const lit = () => props.focus === index()
              const p50 = projectP50(project)
              const line = compact()
                ? `${props.expanded[project.id] ? "▾" : "▸"} ${pad(truncate(project.name, 20), 21)}${pad(String(project.roots.length), 5)}${pad(usd(project.cost), 8)}${pad(fmtTokens(totalTokens(project.tokens)), 8)}${pad(duration(project.wall), 9)}${pad(duration(p50), 8)}${date(project.lastActive)}`
                : `${props.expanded[project.id] ? "▾" : "▸"} ${pad(truncate(project.name, 26), 27)}${pad(String(project.roots.length), 5)}${pad(usd(project.cost), 8)}${pad(fmtTokens(totalTokens(project.tokens)), 8)}${pad(usd(projectAverage(project)), 7)}${pad(duration(project.wall), 9)}${pad(duration(p50), 9)}${date(project.lastActive)}`
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  marginTop={index() > 0 ? 1 : 0}
                  backgroundColor={lit() ? props.theme.background.action.primary.focused : index() % 2 ? props.theme.background.raised.base : undefined}
                  onMouseUp={() => {
                    props.setFocus(index())
                    props.toggleProject(project.id)
                  }}
                >
                  <text fg={lit() ? props.theme.text.action.primary.focused : props.theme.text.base} wrapMode="none" selectable={false}>{line}</text>
                </box>
              )
            }
            const session = row.session
            const project = row.project
            const lit = () => props.focus === index()
            const line = compact()
              ? `  ${props.detail === session.id ? "▾" : "▸"} ${pad(truncate(session.title, 28), 30)}${pad(usd(session.cost), 8)}${pad(fmtTokens(totalTokens(session.tokens)), 8)}${pad(duration(session.wall), 9)}`
              : `  ${props.detail === session.id ? "▾" : "▸"} ${pad(truncate(session.title, 40), 42)}${pad(shortProvider(session.model), 27)}${pad(usd(session.cost), 8)}${pad(fmtTokens(totalTokens(session.tokens)), 8)}${pad(duration(session.wall), 9)}${date(session.updated)}`
            return (
              <box flexDirection="column">
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={lit() ? props.theme.background.action.primary.focused : index() % 2 ? props.theme.background.raised.base : undefined}
                  onMouseUp={() => {
                    props.setFocus(index())
                    props.toggleDetail(session.id)
                  }}
                >
                  <text fg={lit() ? props.theme.text.action.primary.focused : props.theme.text.base} wrapMode="none" selectable={false}>{line}</text>
                </box>
                <Show when={props.detail === session.id}>
                  <SessionDetail
                    session={session}
                    project={project}
                    theme={props.theme}
                    open={() => props.openSession(session.id)}
                  />
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

function PerformanceTable(props: { d: Dashboard; theme: any; openProject: (id: string) => void }) {
  const width = useContentWidth()
  const compact = () => width() < 100
  return (
    <Section title="Per project" theme={props.theme}>
      <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
        {compact()
          ? `${pad("Project", 22)}${pad("Calls", 6)}${pad("TTFT p50", 9)}${pad("Call p50", 9)}${pad("tok/s", 7)}Err`
          : `${pad("Project", 30)}${pad("Calls", 7)}${pad("TTFT p50", 10)}${pad("Call p50", 10)}${pad("Call p95", 10)}${pad("tok/s", 8)}${pad("Busy", 9)}${pad("Err", 4)}`}
      </text>
      <For each={props.d.projects}>
        {(project, index) => (
          <box
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={index() % 2 ? props.theme.background.raised.base : undefined}
            onMouseUp={() => props.openProject(project.id)}
          >
            <text fg={props.theme.text.base} wrapMode="none" selectable={false}>
              {compact()
                ? `${pad(truncate(project.name, 20), 22)}${pad(String(project.calls.length), 6)}${pad(duration(projectTtftP50(project)), 9)}${pad(duration(projectP50(project)), 9)}${pad(projectSpeedP50(project)?.toFixed(0) ?? "—", 7)}${project.tools.filter((tool) => tool.status === "error").length}`
                : `${pad(truncate(project.name, 28), 30)}${pad(String(project.calls.length), 7)}${pad(duration(projectTtftP50(project)), 10)}${pad(duration(projectP50(project)), 10)}${pad(duration(projectP95(project)), 10)}${pad(projectSpeedP50(project)?.toFixed(0) ?? "—", 8)}${pad(duration(project.busy), 9)}${project.tools.filter((tool) => tool.status === "error").length}`}
            </text>
          </box>
        )}
      </For>
    </Section>
  )
}

function SlowCalls(props: { d: Dashboard; theme: any; openSession: (id: string) => void }) {
  const width = useContentWidth()
  const compact = () => width() < 100
  return (
    <Section title="Slowest model calls" theme={props.theme}>
      <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
        {compact()
          ? `${pad("Duration", 9)}${pad("Project", 18)}${pad("Model", 24)}${pad("Out", 7)}Cost`
          : `${pad("Duration", 9)}${pad("Project", 24)}${pad("Session", 30)}${pad("Model", 28)}${pad("Out", 8)}Cost`}
      </text>
      <For each={props.d.slowestCalls.slice(0, 12)}>
        {(call, index) => (
          <box
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={index() % 2 ? props.theme.background.raised.base : undefined}
            onMouseUp={() => props.openSession(call.sessionID)}
          >
            <text fg={props.theme.text.base} wrapMode="none" selectable={false}>
              {compact()
                ? `${pad(duration(call.duration), 9)}${pad(truncate(call.projectName, 16), 18)}${pad(truncate(shortProvider(call.model), 22), 24)}${pad(fmtTokens(call.tokens.output), 7)}${usd(call.cost)}`
                : `${pad(duration(call.duration), 9)}${pad(truncate(call.projectName, 22), 24)}${pad(truncate(sessionTitle(props.d, call.sessionID), 28), 30)}${pad(truncate(shortProvider(call.model), 26), 28)}${pad(fmtTokens(call.tokens.output), 8)}${usd(call.cost)}`}
            </text>
          </box>
        )}
      </For>
    </Section>
  )
}

function SlowTools(props: { d: Dashboard; theme: any; openSession: (id: string) => void }) {
  const width = useContentWidth()
  const compact = () => width() < 100
  return (
    <Section title="Slowest tool calls" theme={props.theme}>
      <text fg={props.theme.text.muted} wrapMode="none" selectable={false}>
        {compact()
          ? `${pad("Duration", 9)}${pad("Tool", 11)}${pad("Project", 18)}Wait / exec`
          : `${pad("Duration", 9)}${pad("Tool", 14)}${pad("Project", 24)}${pad("Session", 32)}Wait / exec`}
      </text>
      <For each={props.d.slowestTools.slice(0, 12)}>
        {(tool, index) => (
          <box
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={index() % 2 ? props.theme.background.raised.base : undefined}
            onMouseUp={() => props.openSession(tool.sessionID)}
          >
            <text fg={props.theme.text.base} wrapMode="none" selectable={false}>
              {compact()
                ? `${pad(duration(tool.duration), 9)}${pad(truncate(tool.name, 9), 11)}${pad(truncate(tool.projectName, 16), 18)}${duration(tool.wait)} / ${duration(tool.execution)}`
                : `${pad(duration(tool.duration), 9)}${pad(truncate(tool.name, 12), 14)}${pad(truncate(tool.projectName, 22), 24)}${pad(truncate(sessionTitle(props.d, tool.sessionID), 30), 32)}${duration(tool.wait)} / ${duration(tool.execution)}`}
            </text>
          </box>
        )}
      </For>
    </Section>
  )
}

function sessionTitle(d: Dashboard, id: string): string {
  return d.sessions.find((session) => session.id === id)?.title ?? id
}

function Performance(props: { d: Dashboard; theme: any; openSession: (id: string) => void; openProject: (id: string) => void }) {
  const latency = props.d.latency
  return (
    <box flexDirection="column">
      <box flexDirection="column">
        <text attributes={TextAttributes.BOLD} fg={props.theme.hue.accent[500]}>Latency</text>
        <text wrapMode="word" selectable={false}>
          <span style={{ fg: props.theme.text.muted }}>{pad("TTFT", 16)}</span>
          <span style={{ fg: props.theme.text.base }}>{`p50 ${duration(latency.ttft.p50)} · p95 ${duration(latency.ttft.p95)} · p99 ${duration(latency.ttft.p99)} · ${latency.ttft.count} calls`}</span>
        </text>
        <text wrapMode="word" selectable={false}>
          <span style={{ fg: props.theme.text.muted }}>{pad("Call duration", 16)}</span>
          <span style={{ fg: props.theme.text.base }}>{`p50 ${duration(latency.duration.p50)} · p95 ${duration(latency.duration.p95)} · p99 ${duration(latency.duration.p99)} · ${latency.duration.count} calls`}</span>
        </text>
        <text wrapMode="word" selectable={false}>
          <span style={{ fg: props.theme.text.muted }}>{pad("Step duration", 16)}</span>
          <span style={{ fg: props.theme.text.base }}>{`p50 ${duration(latency.step.p50)} · p95 ${duration(latency.step.p95)} · p99 ${duration(latency.step.p99)} · includes tools`}</span>
        </text>
        <text wrapMode="word" selectable={false}>
          <span style={{ fg: props.theme.text.muted }}>{pad("Output speed", 16)}</span>
          <span style={{ fg: props.theme.text.base }}>{`p50 ${latency.outputSpeed.p50?.toFixed(0) ?? "—"} tok/s · p95 ${latency.outputSpeed.p95?.toFixed(0) ?? "—"} tok/s`}</span>
        </text>
        <text wrapMode="word" selectable={false}>
          <span style={{ fg: props.theme.text.muted }}>{pad("Tool duration", 16)}</span>
          <span style={{ fg: props.theme.text.base }}>{`p50 ${duration(latency.toolDuration.p50)} · p95 ${duration(latency.toolDuration.p95)} · ${latency.toolDuration.count} calls`}</span>
        </text>
        <text wrapMode="word" selectable={false}>
          <span style={{ fg: props.theme.text.muted }}>{pad("Session time", 16)}</span>
          <span style={{ fg: props.theme.text.base }}>{`wall ${duration(props.d.totals.wall)} · busy ${duration(props.d.totals.busy)} · idle ${duration(props.d.totals.idle)}`}</span>
        </text>
        <text fg={props.theme.text.muted} wrapMode="word">Output speed is higher-is-better; the rest are lower-is-better. Percentiles exclude calls over 10 minutes.</text>
      </box>
      <PerformanceTable d={props.d} theme={props.theme} openProject={props.openProject} />
      <SlowCalls d={props.d} theme={props.theme} openSession={props.openSession} />
      <SlowTools d={props.d} theme={props.theme} openSession={props.openSession} />
    </box>
  )
}

function StatsApp(props: { ctx: any }) {
  const ctx = props.ctx
  const theme = () => ctx.theme
  const dimensions = useTerminalDimensions()
  let rootRef: any
  let scrollRef: any

  const [saved, setSaved] = ctx.storage.store("ui", {
    initial: { tab: "overview", range: "30d", metric: "cost", sort: "cost" },
  })
  const [tab, setTab] = createSignal<TabID>(saved.tab as TabID)
  const [range, setRange] = createSignal<Range>(saved.range as Range)
  const [metric, setMetric] = createSignal<Metric>(saved.metric as Metric)
  const [sort, setSort] = createSignal<SortKey>(saved.sort as SortKey)
  const [data, setData] = createSignal<Dashboard | undefined>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [phase, setPhase] = createSignal("Loading usage")
  const [progress, setProgress] = createSignal("")
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [detail, setDetail] = createSignal<string | undefined>()
  const [focus, setFocus] = createSignal(0)
  let request = 0
  let alive = true

  onCleanup(() => {
    alive = false
    request += 1
  })

  async function load() {
    const id = ++request
    setLoading(true)
    setError("")
    setPhase("Loading usage")
    setProgress("")
    try {
      const result = await loadDashboard(ctx.client, range(), {
        onPhase: (value) => {
          if (alive && id === request) setPhase(value)
        },
        onProgress: (done, total) => {
          if (alive && id === request) setProgress(`${done}/${total} sessions`)
        },
      })
      if (!alive || id !== request) return
      setData(result)
      setPhase("Ready")
      if (detail() && !result.sessions.some((session) => session.id === detail())) setDetail(undefined)
    } catch (cause: any) {
      if (!alive || id !== request) return
      setError(cause?.message ?? String(cause))
    } finally {
      if (alive && id === request) setLoading(false)
    }
  }

  function chooseTab(next: TabID) {
    setTab(next)
    setFocus(0)
    void setSaved((draft) => {
      draft.tab = next
    })
  }

  function chooseRange(next: Range) {
    setRange(next)
    void setSaved((draft) => {
      draft.range = next
    })
    void load()
  }

  function chooseMetric(next: Metric) {
    setMetric(next)
    void setSaved((draft) => {
      draft.metric = next
    })
  }

  function chooseSort(next: SortKey) {
    setSort(next)
    void setSaved((draft) => {
      draft.sort = next
    })
  }

  function cycleTab(step: number) {
    const index = TABS.findIndex((item) => item.id === tab())
    chooseTab(TABS[(index + step + TABS.length) % TABS.length].id)
  }

  function cycleMetric() {
    const index = METRICS.findIndex((item) => item.id === metric())
    chooseMetric(METRICS[(index + 1) % METRICS.length].id)
  }

  function cycleRange(step: number) {
    const index = RANGES.findIndex((item) => item.id === range())
    chooseRange(RANGES[(index + step + RANGES.length) % RANGES.length].id)
  }

  function toggleProject(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  function toggleDetail(id: string) {
    setDetail((current) => (current === id ? undefined : id))
  }

  function openSession(id: string) {
    ctx.ui.dialog.clear()
    ctx.ui.router.navigate({ type: "session", sessionID: id })
  }

  function openProject(id: string) {
    chooseTab("projects")
    setExpanded((current) => ({ ...current, [id]: true }))
    const rows = projectRows()
    const index = rows.findIndex((row) => row.kind === "project" && row.project.id === id)
    if (index >= 0) setFocus(index)
  }

  const projects = createMemo(() => (data() ? sortProjects(data()!.projects, sort()) : []))
  const projectRows = createMemo(() => {
    if (!data() || tab() !== "projects") return [] as Array<{ kind: "project"; project: ProjectData } | { kind: "session"; session: SessionData; project: ProjectData }>
    const rows: Array<{ kind: "project"; project: ProjectData } | { kind: "session"; session: SessionData; project: ProjectData }> = []
    for (const project of projects()) {
      rows.push({ kind: "project", project })
      if (!expanded()[project.id]) continue
      const roots = [...project.roots].sort((a, b) => b.cost - a.cost)
      for (const session of roots) rows.push({ kind: "session", session, project })
    }
    return rows
  })

  createEffect(() => {
    const count = projectRows().length
    if (focus() >= count) setFocus(Math.max(0, count - 1))
  })

  function move(delta: number) {
    if (tab() === "projects") {
      const count = projectRows().length
      setFocus(Math.max(0, Math.min(count - 1, focus() + delta)))
      return
    }
    scrollRef?.scrollBy(delta)
  }

  function activate() {
    if (tab() !== "projects") return
    const row = projectRows()[focus()]
    if (!row) return
    if (row.kind === "project") toggleProject(row.project.id)
    else toggleDetail(row.session.id)
  }

  function collapse() {
    if (tab() !== "projects") return
    const row = projectRows()[focus()]
    if (!row) return
    if (row.kind === "project") {
      if (expanded()[row.project.id]) toggleProject(row.project.id)
    } else {
      setDetail(undefined)
    }
  }

  function expand() {
    if (tab() !== "projects") return
    const row = projectRows()[focus()]
    if (!row) return
    if (row.kind === "project") {
      if (!expanded()[row.project.id]) toggleProject(row.project.id)
    } else {
      setDetail(row.session.id)
    }
  }

  function openFocused() {
    if (tab() !== "projects") return
    const row = projectRows()[focus()]
    if (row?.kind === "session") openSession(row.session.id)
  }

  ctx.keymap.layer(() => ({
    mode: "global",
    priority: 1000,
    commands: [
      { bind: "escape", title: "Close stats", group: "Stats", run: () => ctx.ui.dialog.clear() },
      { bind: "tab", title: "Next tab", group: "Stats", run: () => cycleTab(1) },
      { bind: "shift+tab", title: "Previous tab", group: "Stats", run: () => cycleTab(-1) },
      { bind: "1", title: "Overview", group: "Stats", run: () => chooseTab("overview") },
      { bind: "2", title: "Projects", group: "Stats", run: () => chooseTab("projects") },
      { bind: "3", title: "Performance", group: "Stats", run: () => chooseTab("performance") },
      { bind: "r", title: "Refresh", group: "Stats", run: () => load() },
      { bind: "c", title: "Heatmap metric", group: "Stats", run: () => cycleMetric() },
      { bind: "[", title: "Previous range", group: "Stats", run: () => cycleRange(-1) },
      { bind: "]", title: "Next range", group: "Stats", run: () => cycleRange(1) },
      { bind: "o", title: "Open session", group: "Stats", run: () => openFocused() },
      { bind: "up", title: "Move up", group: "Stats", run: () => move(-1) },
      { bind: "down", title: "Move down", group: "Stats", run: () => move(1) },
      { bind: "pageup", title: "Page up", group: "Stats", run: () => scrollRef?.scrollBy(-(scrollRef.height || 1)) },
      { bind: "pagedown", title: "Page down", group: "Stats", run: () => scrollRef?.scrollBy(scrollRef.height || 1) },
      { bind: "return", title: "Toggle", group: "Stats", run: () => activate() },
      { bind: "space", title: "Toggle", group: "Stats", run: () => activate() },
      { bind: "left", title: "Collapse", group: "Stats", run: () => collapse() },
      { bind: "right", title: "Expand", group: "Stats", run: () => expand() },
    ],
  }))

  onMount(() => {
    void load()
    setTimeout(() => rootRef?.focus?.(), 20)
  })

  const height = () => Math.max(16, Math.min(40, dimensions().height - 6))

  return (
    <box
      ref={(element: any) => {
        rootRef = element
      }}
      flexDirection="column"
      height={height()}
      gap={1}
      paddingLeft={3}
      paddingRight={3}
      paddingTop={1}
      paddingBottom={1}
      onMouseDown={() => rootRef?.focus?.()}
    >
      <box flexDirection="row" flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme().hue.accent[500]}>Usage stats</text>
        <text fg={theme().text.muted}>{`  ${data()?.window.label ?? ""}`}</text>
        <box flexGrow={1} />
        <text fg={theme().text.action.primary.selected} attributes={TextAttributes.BOLD} onMouseUp={() => ctx.ui.dialog.clear()} selectable={false}>esc</text>
        <text fg={theme().text.muted}> close</text>
      </box>
      <box flexDirection="row" flexShrink={0} gap={1}>
        <For each={TABS}>
          {(item) => (
            <Tab active={tab() === item.id} label={item.label} theme={theme()} run={() => chooseTab(item.id)} />
          )}
        </For>
      </box>
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text fg={theme().text.muted}>Range</text>
        <For each={RANGES}>
          {(item) => (
            <Option active={range() === item.id} label={item.label} theme={theme()} run={() => chooseRange(item.id)} />
          )}
        </For>
        <box flexGrow={1} />
        <Show when={loading()}>
          <text fg={theme().text.feedback.warning.base}>{`${phase()}${progress() ? ` ${progress()}` : ""}`}</text>
        </Show>
      </box>
      <scrollbox
        ref={(element: any) => {
          scrollRef = element
        }}
        flexGrow={1}
      >
        <Show when={error()} fallback={
          <Show when={data()} keyed fallback={<text fg={theme().text.muted}>{`${phase()}${progress() ? ` · ${progress()}` : ""}…`}</text>}>
            {(current) => (
              <>
                <Show when={tab() === "overview"}>
                  <Overview d={current} metric={metric()} setMetric={chooseMetric} theme={theme()} />
                </Show>
                <Show when={tab() === "projects"}>
                  <Projects
                    d={current}
                    projects={projects()}
                    rows={projectRows()}
                    focus={focus()}
                    setFocus={setFocus}
                    expanded={expanded()}
                    toggleProject={toggleProject}
                    detail={detail()}
                    toggleDetail={toggleDetail}
                    openSession={openSession}
                    sort={sort()}
                    setSort={chooseSort}
                    theme={theme()}
                  />
                </Show>
                <Show when={tab() === "performance"}>
                  <Performance d={current} theme={theme()} openSession={openSession} openProject={openProject} />
                </Show>
              </>
            )}
          </Show>
        }>
          <text fg={theme().text.feedback.error.base}>{error()}</text>
        </Show>
      </scrollbox>
      <Hints
        theme={theme()}
        items={tab() === "projects"
          ? [
              ["tab", "next"],
              ["1/2/3", "tabs"],
              ["↑↓", "move"],
              ["enter", "fold"],
              ["o", "open"],
              ["←→", "collapse/expand"],
              ["[ ]", "range"],
              ["c", "metric"],
              ["r", "refresh"],
              ["esc", "close"],
            ]
          : [
              ["tab", "next"],
              ["1/2/3", "tabs"],
              ["↑↓", "scroll"],
              ["[ ]", "range"],
              ["c", "metric"],
              ["r", "refresh"],
              ["esc", "close"],
            ]}
      />
    </box>
  )
}

const plugin = Plugin.define({
  id: "oc-stats",
  setup(context) {
    const open = () => {
      context.ui.dialog.show(() => <StatsApp ctx={context} />)
      context.ui.dialog.set({ size: "xlarge", centered: true })
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "oc-stats.open",
          title: "Usage statistics",
          description: "Global, per-project and per-session usage, cost and latency",
          group: "Stats",
          palette: true,
          slash: { name: "oc_stats" },
          run: open,
        },
      ],
    }))

    // Storage is first read when the panel draws, matching how the reference quota plugin behaves.
    let sidebarStore: any
    const sidebar = () =>
      (sidebarStore ??= context.storage.store("sidebar", {
        initial: { open: true, range: "24h" as Range },
      }))
    const disposeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props: { sessionID: string }) => {
        const [state, update] = sidebar()
        return (
          <StatsSidebar
            ctx={context}
            sessionID={props.sessionID}
            state={state}
            update={update}
            openStats={open}
          />
        )
      },
    })
    return () => disposeSidebar()
  },
})

export default plugin
