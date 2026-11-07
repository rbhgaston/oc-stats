/** @jsxImportSource @opentui/solid */
/**
 * The oc-stats panel in the session sidebar.
 *
 * It is intentionally cheap: a `experimental.session.stats` request for the selected range,
 * one more for the previous range, and one scoped to the current project. No message fetching.
 * The full `/stats` window remains the place for projects, sessions and latency detail.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import {
  dayKey,
  loadPriceMap,
  loadSidebarSummary,
  projectLabel,
  sessionCostSplit,
  totalTokens,
  type CostSplit,
  type Range,
  type SidebarSummary,
} from "./data"
import { delta, pad, pct, tokens as fmtTokens, truncate, usd } from "./format"

const RANGES: Range[] = ["24h", "7d", "30d", "90d", "all"]
const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
/** Columns the panel uses until it knows its real width. */
const DEFAULT_WIDTH = 36

function nextRange(range: Range): Range {
  const index = RANGES.indexOf(range)
  return RANGES[(index + 1) % RANGES.length]
}

function sparkline(values: number[]): string {
  if (values.length === 0) return ""
  const max = Math.max(1, ...values)
  return values
    .map((value) => SPARKS[Math.min(SPARKS.length - 1, Math.round((value / max) * (SPARKS.length - 1)))])
    .join("")
}

/** The last `days` daily step counts, filling days the server did not report with zero. */
function recentSteps(activity: Array<{ date: string; steps: number }>, days: number): number[] {
  const byDay = new Map(activity.map((item) => [item.date, item.steps]))
  const values: number[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(cursor)
    day.setDate(cursor.getDate() - offset)
    values.push(byDay.get(dayKey(day.getTime())) ?? 0)
  }
  return values
}

function Row(props: {
  theme: any
  label: string
  value: string
  note?: string
  color?: any
  noteColor?: any
}) {
  return (
    <text wrapMode="none" selectable={false}>
      <span fg={props.theme.text.muted}>{pad(props.label, 8)}</span>
      <span fg={props.color ?? props.theme.text.base}>{props.value}</span>
      <Show when={props.note}>
        <span fg={props.noteColor ?? props.theme.text.muted}>{`  ${props.note}`}</span>
      </Show>
    </text>
  )
}

/** A section title with a colored rule, so session/project/range read as separate blocks. */
function Header(props: {
  theme: any
  label: string
  color: any
  note?: string
  noteColor?: any
  width: number
  onPress?: () => void
}) {
  const left = () => (props.note ? `${props.label} ${props.note} ` : `${props.label} `)
  const rule = () => "─".repeat(Math.max(0, props.width - left().length))
  return (
    <text wrapMode="none" selectable={false} onMouseDown={props.onPress}>
      <span fg={props.color} attributes={TextAttributes.BOLD}>{props.label}</span>
      <Show when={props.note}>
        <span fg={props.noteColor ?? props.theme.text.muted}>{` ${props.note}`}</span>
      </Show>
      <span fg={props.theme.text.muted}>{` ${rule()}`}</span>
    </text>
  )
}

/** Split `width` cells across `values` so the rounded parts add up to exactly `width`. */
function splitCells(values: number[], total: number, width: number): number[] {
  if (width <= 0 || total <= 0) return values.map(() => 0)
  const raw = values.map((value) => (value / total) * width)
  const cells = raw.map((value) => Math.floor(value))
  const remaining = width - cells.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (let index = 0; index < remaining; index += 1) cells[order[index % order.length].index] += 1
  return cells
}

/** The session's spend split by output, billed input and cached tokens, as one stacked bar. */
function CostBar(props: { theme: any; width: number; split: CostSplit }) {
  const colors = () => [
    props.theme.text.feedback.warning.base,
    props.theme.hue.accent[500],
    props.theme.text.feedback.success.base,
  ]
  const values = () => [props.split.output, props.split.input, props.split.cached]
  const cells = () => Math.max(8, props.width - 8)
  const parts = () => splitCells(values(), props.split.total, cells())
  const share = (value: number) => (props.split.total > 0 ? value / props.split.total : 0)
  return (
    <box flexDirection="column">
      <text wrapMode="none" selectable={false}>
        <span fg={props.theme.text.muted}>{pad("Spend", 8)}</span>
        <Show
          when={props.split.total > 0}
          fallback={<span fg={props.theme.text.muted}>{"░".repeat(cells())}</span>}
        >
          <For each={parts()}>
            {(count, index) => <span fg={colors()[index()]}>{"█".repeat(count)}</span>}
          </For>
        </Show>
      </text>
      <text wrapMode="none" selectable={false}>
        <span fg={props.theme.text.muted}>{"        "}</span>
        <span fg={colors()[0]}>{`out ${pct(share(values()[0]))}`}</span>
        <span fg={props.theme.text.muted}>{" · "}</span>
        <span fg={colors()[1]}>{`in ${pct(share(values()[1]))}`}</span>
        <span fg={props.theme.text.muted}>{" · "}</span>
        <span fg={colors()[2]}>{`cache ${pct(share(values()[2]))}`}</span>
      </text>
    </box>
  )
}

export function StatsSidebar(props: {
  ctx: any
  sessionID: string
  state: { open: boolean; range: Range }
  update: (fn: (draft: any) => void) => unknown
  openStats: () => void
}) {
  const theme = () => props.ctx.theme
  const [summary, setSummary] = createSignal<SidebarSummary>()
  const [project, setProject] = createSignal<SidebarSummary>()
  const [error, setError] = createSignal("")
  const [width, setWidth] = createSignal(DEFAULT_WIDTH)
  const [prices, setPrices] = createSignal<Map<string, any>>(new Map())
  let alive = true
  let request = 0

  const session = () => {
    try {
      return props.ctx.data?.session?.get?.(props.sessionID)
    } catch {
      return undefined
    }
  }

  async function load() {
    const id = ++request
    const projectID = session()?.projectID
    try {
      const [global, scoped] = await Promise.all([
        loadSidebarSummary(props.ctx.client, props.state.range, { previous: true }),
        projectID
          ? loadSidebarSummary(props.ctx.client, props.state.range, {
              project: projectID,
              previous: false,
            }).catch(() => undefined)
          : Promise.resolve(undefined),
      ])
      if (!alive || id !== request) return
      setSummary(global)
      setProject(scoped)
      setError("")
    } catch (cause: any) {
      if (!alive || id !== request) return
      setError(cause?.message ?? String(cause))
    }
  }

  onCleanup(() => {
    alive = false
    request += 1
  })

  // Reload when the range or the session changes, and every minute otherwise.
  createEffect(() => {
    props.state.range
    props.sessionID
    session()?.projectID
    void load()
  })

  onMount(() => {
    void loadPriceMap(props.ctx.client).then((value) => {
      if (alive) setPrices(value)
    })
    const timer = setInterval(() => void load(), 60_000)
    onCleanup(() => clearInterval(timer))
  })

  const sessionCost = () => Number(session()?.cost ?? 0)
  const sessionInput = () => Number(session()?.tokens?.input ?? 0)
  const sessionOutput = () => Number(session()?.tokens?.output ?? 0)
  const sessionCached = () => Number(session()?.tokens?.cache?.read ?? 0)
  const sessionCacheWrite = () => Number(session()?.tokens?.cache?.write ?? 0)
  const sessionCacheHit = () => {
    const read = sessionCached()
    const total = read + sessionInput() + sessionCacheWrite()
    return total > 0 ? read / total : 0
  }
  const split = createMemo(() => sessionCostSplit(session(), prices()))
  const projectName = () => {
    try {
      const projectID = session()?.projectID
      const value = projectID ? props.ctx.data?.project?.get?.(projectID) : undefined
      return truncate(projectLabel(value ?? { canonical: session()?.directory }), 16)
    } catch {
      return "project"
    }
  }
  const toolErrorRate = () => {
    const tools = summary()?.tools
    return tools && tools.calls > 0 ? tools.failed / tools.calls : 0
  }
  const spark = createMemo(() =>
    sparkline(recentSteps(summary()?.activity ?? [], Math.max(8, Math.min(20, width() - 9)))),
  )
  const costNote = () => {
    const previous = summary()?.previous?.cost
    if (previous === undefined) return undefined
    return delta(summary()!.cost, previous)
  }
  const costNoteColor = () => {
    const previous = summary()?.previous?.cost
    if (previous === undefined) return theme().text.muted
    return summary()!.cost <= previous ? theme().text.feedback.success.base : theme().text.feedback.warning.base
  }
  const errorNoteColor = () =>
    toolErrorRate() > 0.05 ? theme().text.feedback.error.base : theme().text.muted

  function toggle() {
    void props.update((draft: any) => {
      draft.open = !draft.open
    })
  }

  function cycleRange() {
    void props.update((draft: any) => {
      draft.range = nextRange(draft.range as Range)
    })
  }

  return (
    <box
      flexDirection="column"
      onSizeChange={function (this: any) {
        const measured = this.width
        if (measured > 0) queueMicrotask(() => setWidth(measured))
      }}
    >
      <box flexDirection="row" flexShrink={0}>
        <text wrapMode="none" selectable={false} onMouseDown={toggle}>
          <b fg={theme().hue.accent[500]}>Stats</b>
        </text>
        <text wrapMode="none" selectable={false} fg={theme().text.muted} onMouseDown={toggle}>
          {props.state.open ? " ▾" : " ▸"}
        </text>
      </box>

      <Show when={!props.state.open}>
        <text wrapMode="none" selectable={false} fg={theme().text.muted}>
          {summary()
            ? `${usd(sessionCost())} session · ${usd(summary()!.cost)} ${props.state.range}`
            : "…"}
        </text>
      </Show>

      <Show when={props.state.open}>
        <Show when={error()}>
          <text wrapMode="word" selectable={false} fg={theme().text.feedback.error.base}>
            {`Stats unavailable: ${error()}`}
          </text>
        </Show>
        <Show when={summary()} fallback={<text fg={theme().text.muted}>Loading stats…</text>}>
          <Header
            theme={theme()}
            label="Session"
            color={theme().hue.accent[500]}
            width={width()}
          />
          <Row theme={theme()} label="Cost" value={usd(sessionCost())} color={theme().text.feedback.success.base} />
          <Row theme={theme()} label="Input" value={fmtTokens(sessionInput())} note="billed" />
          <Row theme={theme()} label="Output" value={fmtTokens(sessionOutput())} />
          <Row
            theme={theme()}
            label="Cached"
            value={fmtTokens(sessionCached())}
            note={pct(sessionCacheHit())}
            color={theme().hue.accent[500]}
          />
          <CostBar theme={theme()} width={width()} split={split()} />

          <Show when={project()}>
            <Header
              theme={theme()}
              label="Project"
              color={theme().text.feedback.warning.base}
              note={projectName()}
              width={width()}
            />
            <Row
              theme={theme()}
              label="Cost"
              value={usd(project()!.cost)}
              color={theme().text.feedback.success.base}
            />
          </Show>

          <Header
            theme={theme()}
            label="Range"
            color={theme().text.feedback.success.base}
            note={props.state.range}
            noteColor={theme().text.action.primary.selected}
            width={width()}
            onPress={cycleRange}
          />
          <Row
            theme={theme()}
            label="Cost"
            value={usd(summary()!.cost)}
            note={costNote()}
            noteColor={costNoteColor()}
            color={theme().text.feedback.success.base}
          />
          <Row
            theme={theme()}
            label="Tokens"
            value={fmtTokens(totalTokens(summary()!.tokens))}
            note={`cache ${pct(summary()!.cacheHit)}`}
            color={theme().hue.accent[500]}
          />
          <Row
            theme={theme()}
            label="Tools"
            value={fmtTokens(summary()!.tools.calls)}
            note={`${pct(toolErrorRate())} err`}
            noteColor={errorNoteColor()}
          />
          <Row
            theme={theme()}
            label="Streak"
            value={`${summary()!.streak}d`}
            note={`${summary()!.sessions + summary()!.subagents} sess`}
          />
          <text wrapMode="none" selectable={false}>
            <span fg={theme().text.muted}>{pad("Steps", 8)}</span>
            <span fg={theme().hue.accent[500]}>{spark() || "—"}</span>
          </text>
        </Show>
        <text
          wrapMode="none"
          selectable={false}
          fg={theme().text.action.primary.selected}
          onMouseUp={props.openStats}
        >
          open /stats ↗
        </text>
      </Show>
    </box>
  )
}
