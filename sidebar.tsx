/** @jsxImportSource @opentui/solid */
/**
 * The oc-stats panel in the session sidebar.
 *
 * It is intentionally cheap: a `experimental.session.stats` request for the selected range,
 * one more for the previous range, and one scoped to the current project. No message fetching.
 * The full `/stats` window remains the place for projects, sessions and latency detail.
 */
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import {
  dayKey,
  loadSidebarSummary,
  projectLabel,
  totalTokens,
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
function Header(props: { theme: any; label: string; color: any; note?: string; width: number }) {
  const left = () => (props.note ? `${props.label} ${props.note} ` : `${props.label} `)
  const rule = () => "─".repeat(Math.max(0, props.width - left().length))
  return (
    <text wrapMode="none" selectable={false}>
      <span fg={props.color} attributes={TextAttributes.BOLD}>{props.label}</span>
      <Show when={props.note}>
        <span fg={props.theme.text.muted}>{` ${props.note}`}</span>
      </Show>
      <span fg={props.theme.text.muted}>{` ${rule()}`}</span>
    </text>
  )
}

/** A proportional bar: `filled` of `total` in accent, the rest dim. */
function BarRow(props: {
  theme: any
  label: string
  filled: number
  total: number
  width: number
  text: string
}) {
  const cells = () => Math.max(6, Math.min(18, props.width - 10 - props.text.length))
  const on = () => {
    if (props.total <= 0) return 0
    return Math.max(0, Math.min(cells(), Math.round((props.filled / props.total) * cells())))
  }
  const empty = () => cells() - on()
  return (
    <text wrapMode="none" selectable={false}>
      <span fg={props.theme.text.muted}>{pad(props.label, 8)}</span>
      <span fg={props.theme.hue.accent[500]}>{"█".repeat(on())}</span>
      <span fg={props.theme.text.muted}>{"░".repeat(empty())}</span>
      <span fg={props.theme.text.base}>{`  ${props.text}`}</span>
    </text>
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
        <text
          wrapMode="none"
          selectable={false}
          fg={theme().text.action.primary.selected}
          onMouseDown={cycleRange}
        >
          {` · ${props.state.range}`}
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
          <BarRow
            theme={theme()}
            label="Cached"
            filled={sessionCached()}
            total={sessionCached() + sessionInput() + sessionCacheWrite()}
            width={width()}
            text={`${fmtTokens(sessionCached())} ${pct(sessionCacheHit())}`}
          />

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
            width={width()}
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
