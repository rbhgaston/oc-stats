#!/usr/bin/env python3
"""Generate the README previews as plain SVG (no external assets)."""

from __future__ import annotations

import random
from xml.sax.saxutils import escape

FONT = "'SF Mono', 'JetBrains Mono', 'Menlo', 'DejaVu Sans Mono', 'Consolas', monospace"

BG = "#12131a"
PANEL = "#191a23"
PANEL_2 = "#1e1f2b"
BORDER = "#2b2d3c"
TEXT = "#c9cde4"
MUTED = "#6f7490"
DIM = "#3a3d50"
ACCENT = "#9a83e6"
SUCCESS = "#7fd88f"
WARNING = "#f5a742"
ERROR = "#f7768e"
TEAL = "#5fd7c8"


def esc(value: str) -> str:
    return escape(str(value))


def text(
    x: float,
    y: float,
    value: str,
    fill: str = TEXT,
    size: float = 14,
    weight: int = 400,
    anchor: str = "start",
    opacity: float = 1,
    spacing: float | None = None,
) -> str:
    extra = f' letter-spacing="{spacing}"' if spacing is not None else ""
    return (
        f'<text x="{x}" y="{y}" fill="{fill}" font-family="{FONT}" font-size="{size}" '
        f'font-weight="{weight}" text-anchor="{anchor}" opacity="{opacity}"{extra}>{esc(value)}</text>'
    )


def rect(
    x: float,
    y: float,
    w: float,
    h: float,
    fill: str,
    rx: float = 0,
    stroke: str | None = None,
    opacity: float = 1,
) -> str:
    extra = f' stroke="{stroke}"' if stroke else ""
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
        f'opacity="{opacity}"{extra}/>'
    )


def line(x1: float, y1: float, x2: float, y2: float, stroke: str = BORDER, opacity: float = 1) -> str:
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" opacity="{opacity}"/>'


def window_bar(width: int, title: str) -> list[str]:
    parts = [
        rect(0, 0, width, 44, PANEL_2),
        line(0, 44, width, 44, BORDER),
        text(24, 28, "opencode", MUTED, 11.5, 600, spacing=0.6),
        text(120, 28, title, TEXT, 13, 600),
        text(width - 24, 28, "esc", MUTED, 11.5, anchor="end"),
    ]
    return parts


def pill(x: float, y: float, label: str, active: bool, color: str = ACCENT) -> list[str]:
    width = 12 + len(label) * 8
    if active:
        return [
            rect(x, y, width, 26, color, rx=7, opacity=0.18),
            text(x + width / 2, y + 17.5, label, color, 12.5, 600, "middle"),
        ]
    return [text(x + width / 2, y + 17.5, label, MUTED, 12.5, 400, "middle")]


def row(x: float, y: float, label: str, value: str, note: str = "", color: str = TEXT, note_color: str = MUTED) -> list[str]:
    parts = [text(x, y, label, MUTED, 13), text(x + 66, y, value, color, 13, 500)]
    if note:
        parts.append(text(x + 140, y, note, note_color, 12.5))
    return parts


def section(x: float, y: float, label: str, width: float, color: str, note: str = "", note_color: str = MUTED) -> list[str]:
    left = f"{label} {note} " if note else f"{label} "
    rule_width = max(0, width - len(left) * 7.8)
    parts = [text(x, y, label, color, 12.5, 700, spacing=0.4)]
    cursor = x + len(label) * 7.8 + 4
    if note:
        parts.append(text(cursor, y, note, note_color, 12.5, 600))
        cursor += len(note) * 7.8 + 6
    parts.append(line(cursor, y - 4, x + width, y - 4, color, 0.35))
    return parts


def stats_panel(x: float, y: float, width: float, compact: bool = False) -> list[str]:
    parts: list[str] = []
    parts.append(text(x, y, "Stats", ACCENT, 14, 700))
    parts.append(text(x + 44, y, "▾", MUTED, 13))
    y += 22
    parts += section(x, y, "Session", width, ACCENT)
    y += 21
    parts += row(x, y, "Cost", "$0.42", "", SUCCESS)
    y += 20
    parts += row(x, y, "Input", "5.6m", "billed")
    y += 20
    parts += row(x, y, "Output", "359k")
    y += 20
    parts += row(x, y, "Cached", "196.5m", "97%", ACCENT)
    y += 18

    bar_x, bar_w, bar_h = x + 64, width - 64, 12
    segments = [int(bar_w * 0.22), int(bar_w * 0.39)]
    segments.append(bar_w - sum(segments))
    cursor = bar_x
    parts.append(text(x, y + 9, "Spend", MUTED, 12.5))
    for size, color in zip(segments, (WARNING, ACCENT, SUCCESS)):
        parts.append(rect(cursor, y, size, bar_h, color, rx=2))
        cursor += size
    y += 22
    parts.append(text(bar_x, y, "out 22%", WARNING, 11.5, 600))
    parts.append(text(bar_x + 62, y, "·", MUTED, 11.5))
    parts.append(text(bar_x + 72, y, "in 39%", ACCENT, 11.5, 600))
    parts.append(text(bar_x + 126, y, "·", MUTED, 11.5))
    parts.append(text(bar_x + 136, y, "cache 39%", SUCCESS, 11.5, 600))
    y += 24

    parts += section(x, y, "Project", width, WARNING, "oc-stats")
    y += 21
    parts += row(x, y, "Cost", "$3.21", "", SUCCESS)
    y += 24

    parts += section(x, y, "Range", width, SUCCESS, "90d ↻", ACCENT)
    parts.append(line(x + 66, y + 4, x + 106, y + 4, ACCENT, 0.6))
    y += 21
    parts += row(x, y, "Cost", "$38.4", "+12%", SUCCESS, WARNING)
    y += 20
    parts += row(x, y, "Tokens", "128m", "cache 94%", ACCENT)
    y += 20
    parts += row(x, y, "Tools", "4.2k", "2% err", TEXT, ERROR)
    y += 20
    parts += row(x, y, "Streak", "5d", "32 sess")
    y += 20
    parts.append(text(x, y, "Steps", MUTED, 12.5))
    parts.append(text(x + 64, y, "▁▂▄▅▇█▇▆▅▃▂▁▂▄▅▆▇█", ACCENT, 13))
    y += 26
    parts.append(text(x, y, "open /stats ↗", ACCENT, 12.5, 600))
    return parts


def overview(x: float, y: float, width: float) -> list[str]:
    parts: list[str] = []
    parts.append(text(x, y, "Usage stats", ACCENT, 20, 700))
    parts.append(text(x + 152, y, "last 90 days", MUTED, 13))
    parts.append(text(x + width, y, "esc close", MUTED, 12, anchor="end"))
    y += 30

    parts += pill(x, y, "Overview", True)
    parts += pill(x + 112, y, "Projects", False)
    parts += pill(x + 198, y, "Performance", False)
    y += 38

    parts.append(text(x, y + 18, "Range", MUTED, 12.5))
    cursor = x + 50
    for index, label in enumerate(("24h", "7d", "30d", "90d", "all")):
        width_pill = 12 + len(label) * 8
        parts += pill(cursor, y, label, index == 3, SUCCESS)
        cursor += width_pill
    parts.append(text(x + width, y + 18, "4 213 calls · 42 sessions", MUTED, 12, anchor="end"))
    y += 38

    parts.append(line(x, y, x + width, y))
    y += 30

    left = [
        ("Cost", "$124.80", SUCCESS),
        ("Input", "5.6m", TEXT),
        ("Output", "359k", TEXT),
        ("Reasoning", "1.1m", TEXT),
        ("Cache read", "196.5m", ACCENT),
        ("Cache write", "0", TEXT),
        ("Cache saved", "$58.20", SUCCESS),
        ("Busy time", "4h 12m", ACCENT),
    ]
    right = [
        ("Sessions", "42 +6", TEXT),
        ("Prompts", "1,204", TEXT),
        ("Steps", "12,430", TEXT),
        ("Active days", "18", TEXT),
        ("Streak", "12d", TEXT),
        ("Cache hit", "97%", SUCCESS),
        ("Tool calls", "14,210", TEXT),
        ("Tool errors", "3.1%", ERROR),
    ]
    col_w = (width - 28) / 2
    for index, ((label, value, color), (label2, value2, color2)) in enumerate(zip(left, right)):
        row_y = y + index * 23
        parts.append(text(x, row_y, label, MUTED, 12.5))
        parts.append(text(x + 88, row_y, value, color, 12.5, 500))
        parts.append(text(x + col_w + 28, row_y, label2, MUTED, 12.5))
        parts.append(text(x + col_w + 116, row_y, value2, color2, 12.5, 500))
    y += len(left) * 23 + 26

    parts.append(line(x, y, x + width, y))
    y += 26

    parts.append(text(x, y, "Daily cost", MUTED, 12.5, 600, spacing=0.3))
    parts.append(text(x + 88, y, "last 90 days · ", MUTED, 12))
    parts.append(text(x + 190, y, "$4.18", SUCCESS, 12, 600))
    parts.append(text(x + 222, y, " today", MUTED, 12))
    y += 14

    rng = random.Random(7)
    cell, gap = 20, 5
    columns = 13
    for week in range(columns):
        for day in range(7):
            level = rng.choices([0, 1, 2, 3, 4], weights=[38, 24, 18, 12, 8])[0]
            colors = ["#202231", "#274134", "#2f6544", "#469d5b", "#7fd88f"]
            parts.append(
                rect(
                    x + week * (cell + gap),
                    y + day * (cell + gap),
                    cell,
                    cell,
                    colors[level],
                    rx=3,
                )
            )
    heat_w = columns * (cell + gap) - gap
    parts.append(text(x, y + 7 * (cell + gap) + 14, "Nov", MUTED, 10.5))
    parts.append(text(x + heat_w - 24, y + 7 * (cell + gap) + 14, "Feb", MUTED, 10.5, anchor="end"))

    comp_x = x + heat_w + 52
    comp_y = y - 14
    parts.append(text(comp_x, comp_y, "Compared with previous", MUTED, 12.5, 600, spacing=0.3))
    comp_y += 24
    for label, value, change, color in (
        ("Cost", "$109.20 → $124.80", "+14%", WARNING),
        ("Tokens", "5.1m → 5.6m", "+10%", ACCENT),
        ("Prompts", "1,310 → 1,204", "-8%", SUCCESS),
    ):
        parts.append(text(comp_x, comp_y, label, MUTED, 12.5))
        parts.append(text(comp_x + 74, comp_y, value, TEXT, 12))
        parts.append(text(comp_x + 250, comp_y, change, color, 12, 600))
        comp_y += 24

    y += 7 * (cell + gap) + 34

    parts.append(text(x, y, "Top models", MUTED, 12.5, 600, spacing=0.3))
    y += 18
    headers = [("Model", 0), ("Steps", 0.46), ("Tokens", 0.58), ("Cost", 0.74), ("Saved", 0.87)]
    for label, ratio in headers:
        parts.append(text(x + ratio * width, y, label, MUTED, 11.5))
    y += 6
    parts.append(line(x, y, x + width, y, BORDER, 0.8))
    y += 20

    models = [
        ("openrouter/deepseek-v4.1-flash", "8,120", "512m", "$84.20", "$41.10", ACCENT),
        ("openrouter/claude-sonnet-4.6", "2,340", "98m", "$28.40", "$12.20", TEAL),
        ("openrouter/gpt-5.4", "1,120", "44m", "$9.80", "$3.10", WARNING),
        ("openrouter/gemini-3-pro", "850", "31m", "$2.40", "$1.90", TEXT),
    ]
    for index, (model, steps, tokens, cost, saved, color) in enumerate(models):
        if index % 2 == 0:
            parts.append(rect(x - 8, y - 14, width + 16, 22, PANEL_2, rx=5, opacity=0.6))
        parts.append(text(x, y, model, color, 12))
        parts.append(text(x + 0.46 * width, y, steps, TEXT, 12))
        parts.append(text(x + 0.58 * width, y, tokens, TEXT, 12))
        parts.append(text(x + 0.74 * width, y, cost, SUCCESS, 12, 600))
        parts.append(text(x + 0.87 * width, y, saved, SUCCESS, 12, 500, opacity=0.8))
        y += 24

    return parts


def preview() -> str:
    """The /stats dialog, as it appears over a session."""
    width, height = 1200, 900
    parts = [
        rect(52, 34, 1096, 842, "#000000", rx=24, opacity=0.45),
        rect(60, 40, 1080, 820, PANEL, rx=18, stroke=BORDER),
    ]
    parts += overview(120, 110, 960)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc"><title id="title">oc-stats /stats dialog</title><desc id="desc">The centered /stats dialog from OpenCode, showing the Overview tab with totals, latency, a daily cost heatmap, previous-period comparison and top models.</desc>' + "".join(parts) + "</svg>"


def closeup() -> str:
    """A session view with the real right-hand sidebar and the Stats panel."""
    width, height = 1200, 760
    sidebar_x = 870
    parts = [rect(0, 0, width, height, BG)]
    parts += window_bar(width, "Build the usage dashboard")

    parts.append(rect(sidebar_x, 44, width - sidebar_x, height - 44, PANEL))
    parts.append(line(sidebar_x, 44, sidebar_x, height, BORDER))

    # Chat transcript, muted so the sidebar stays the focus.
    parts.append(rect(40, 80, 560, 64, PANEL_2, rx=10))
    parts.append(text(60, 106, "Make the sidebar numbers match the dashboard.", TEXT, 12.5))
    parts.append(text(60, 126, "and add a spend bar.", MUTED, 12))

    parts.append(rect(40, 164, 660, 124, PANEL, rx=10, stroke=BORDER, opacity=0.7))
    parts.append(text(60, 192, "I'll wire the session stats in first.", TEXT, 12.5))
    parts.append(text(60, 218, "ctx.data.session.get(sessionID)", MUTED, 11.5))
    parts.append(text(60, 240, "  cost · tokens · model", MUTED, 11.5))
    parts.append(text(60, 262, "then split the spend by token type.", MUTED, 11.5))

    parts.append(rect(40, 308, 430, 46, PANEL_2, rx=8))
    parts.append(text(58, 336, "shell", ACCENT, 11.5, 600))
    parts.append(text(110, 336, "143ms", MUTED, 11.5))
    parts.append(text(170, 336, "✓", SUCCESS, 11.5, 600))

    parts.append(rect(40, 374, 520, 88, PANEL, rx=8, stroke=BORDER, opacity=0.6))
    parts.append(text(60, 400, "+ cached   196.5m  97%", SUCCESS, 11.5))
    parts.append(text(60, 422, "+ input      5.6m  billed", TEXT, 11.5))
    parts.append(text(60, 444, "+ output     359k", TEXT, 11.5))

    parts.append(rect(40, 660, 790, 58, BG, rx=12, stroke=ACCENT, opacity=0.9))
    parts.append(text(60, 695, "> /stats", ACCENT, 13, 600))
    parts.append(text(760, 695, "enter to open", MUTED, 11.5, anchor="end"))

    # Right sidebar: session details, then the Stats panel.
    parts.append(text(sidebar_x + 24, 80, "Session", MUTED, 11.5, 600, spacing=0.6))
    parts.append(text(sidebar_x + 24, 104, "Build the usage dashboard", TEXT, 13, 600))
    parts.append(text(sidebar_x + 24, 128, "~/projects/oc-stats", MUTED, 11.5))
    parts.append(line(sidebar_x + 24, 146, width - 24, 146, BORDER, 0.7))
    parts.append(text(sidebar_x + 24, 174, "Context", MUTED, 11.5))
    parts.append(rect(sidebar_x + 96, 164, 190, 8, DIM, rx=4))
    parts.append(rect(sidebar_x + 96, 164, 128, 8, TEAL, rx=4))
    parts.append(text(sidebar_x + 24, 198, "Todo", MUTED, 11.5))
    parts.append(text(sidebar_x + 96, 198, "3 open · 1 done", TEXT, 12))
    parts.append(line(sidebar_x + 24, 218, width - 24, 218, BORDER, 0.7))

    parts += stats_panel(sidebar_x + 24, 240, width - sidebar_x - 48)
    parts.append(line(sidebar_x + 24, 700, width - 24, 700, BORDER, 0.7))
    parts.append(text(sidebar_x + 24, 726, "Files", MUTED, 11.5, 600, spacing=0.4))
    parts.append(text(sidebar_x + 24, 746, "M tui.tsx        +64", MUTED, 11.5))
    parts.append(text(sidebar_x + 200, 746, "M sidebar.tsx", MUTED, 11.5))

    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc"><title id="title">oc-stats in the session sidebar</title><desc id="desc">An OpenCode session with the oc-stats Stats panel in the right-hand sidebar, showing session, project and range totals plus a spend bar.</desc>' + "".join(parts) + "</svg>"


if __name__ == "__main__":
    with open("preview.svg", "w") as handle:
        handle.write(preview())
    with open("sidebar.svg", "w") as handle:
        handle.write(closeup())
    print("wrote preview.svg and sidebar.svg")
