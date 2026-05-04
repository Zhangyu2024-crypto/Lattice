"""Render C1 figures for the Lattice paper.

Generates four figures from the C1 plan into ./figures/:
  fig-c1-architecture       five-subsystem workspace overview
  fig-c1-agent-loop         orchestrator turn sequence
  fig-c1-approval-matrix    trustLevel x permissionMode safety matrix
  fig-c1-artifact-dag       evidence graph of an XRD interpretation

Style: Lattice canon — grayscale only, flat, system-ui font, weight <= 600,
small corner radii, no shadows or gradients. Output as both PDF and PNG.
"""

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle

OUT = Path(__file__).parent

# ---------------------------------------------------------------------------
# style
# ---------------------------------------------------------------------------
import matplotlib.font_manager as fm

# register Arial explicitly so matplotlib picks it up across PDF + PNG
for _f in ("/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
           "/usr/share/fonts/truetype/msttcorefonts/arialbd.ttf",
           "/usr/share/fonts/truetype/msttcorefonts/Arial_Italic.ttf"):
    if Path(_f).exists():
        fm.fontManager.addfont(_f)

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Liberation Sans", "DejaVu Sans"],
    "font.size": 10,
    "axes.linewidth": 0.6,
    "savefig.dpi": 220,
    "savefig.bbox": "tight",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})

INK = "#1a1a1a"          # primary borders + text
INK_MID = "#555555"      # secondary text
INK_SOFT = "#888888"     # tertiary lines
FILL_LIGHT = "#f5f5f5"   # default block fill
FILL_MID = "#e6e6e6"     # emphasised block fill
FILL_DARK = "#cfcfcf"    # heavy block fill
WHITE = "#ffffff"


def save(fig, name):
    fig.patch.set_facecolor(WHITE)
    fig.savefig(OUT / f"{name}.pdf", facecolor=WHITE)
    fig.savefig(OUT / f"{name}.png", facecolor=WHITE)
    plt.close(fig)


def block(ax, x, y, w, h, label, sub=None, fill=FILL_LIGHT, lw=0.9, fs=10,
          sub_fs=8, badge=None):
    box = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0,rounding_size=0.06",
        linewidth=lw, edgecolor=INK, facecolor=fill, joinstyle="miter",
        zorder=3,
    )
    ax.add_patch(box)
    if sub is None:
        ax.text(x + w / 2, y + h / 2, label,
                ha="center", va="center", color=INK, fontsize=fs, fontweight=500,
                linespacing=1.05, zorder=4)
    else:
        ax.text(x + w / 2, y + h * 0.66, label,
                ha="center", va="center", color=INK, fontsize=fs, fontweight=600,
                linespacing=1.05, zorder=4)
        ax.text(x + w / 2, y + h * 0.30, sub,
                ha="center", va="center", color=INK_MID, fontsize=sub_fs, fontweight=400,
                linespacing=1.08, zorder=4)
    if badge is not None:
        ax.text(x + 0.22, y + h - 0.22, str(badge), ha="center", va="center",
                color=INK, fontsize=8.5, fontweight=600,
                bbox=dict(boxstyle="circle,pad=0.16",
                          fc=WHITE, ec=INK, lw=0.7),
                zorder=5)


def arrow(ax, p0, p1, style="-|>", lw=0.9, color=INK, ls="-",
          mut=8, connectionstyle="arc3,rad=0", zorder=2):
    a = FancyArrowPatch(
        p0, p1, arrowstyle=style, mutation_scale=mut,
        linewidth=lw, color=color, linestyle=ls,
        connectionstyle=connectionstyle,
        shrinkA=0, shrinkB=0,
        zorder=zorder,
    )
    ax.add_patch(a)


def setup_ax(ax, xlim, ylim):
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    ax.set_aspect("equal")
    ax.axis("off")


# ---------------------------------------------------------------------------
# Fig 1 — five-subsystem architecture
# ---------------------------------------------------------------------------
def fig_architecture():
    fig, ax = plt.subplots(figsize=(11.2, 5.8))
    setup_ax(ax, (0, 18), (0.95, 10.05))

    # frame: workspace boundary
    frame = Rectangle((0.4, 1.2), 17.2, 8.4,
                      linewidth=0.7, edgecolor=INK_SOFT, facecolor=WHITE,
                      linestyle=(0, (4, 3)))
    ax.add_patch(frame)
    ax.text(0.7, 9.85, "Lattice desktop workspace   ·   Electron renderer + main + Python worker",
            color=INK_MID, fontsize=8.5, fontweight=500, va="bottom")

    # scientist
    block(ax, 0.9, 4.8, 2.05, 1.2, "Scientist", fill=WHITE, fs=10)
    ax.text(1.93, 4.63, "prompts • reviews\nedits • aborts",
            ha="center", va="top", color=INK_MID, fontsize=7.6, linespacing=1.1)

    # llm provider
    block(ax, 0.9, 2.5, 2.05, 1.2, "LLM provider", fill=WHITE, fs=9.5)
    ax.text(1.93, 2.35, "Anthropic / OpenAI",
            ha="center", va="top", color=INK_MID, fontsize=7.5)

    # 1 orchestrator (centre)
    block(ax, 6.6, 4.55, 4.45, 2.25,
          "Agent orchestrator",
          "bounded loop  ·  loop detection\nabort signal  ·  permission modes",
          fill=FILL_MID, lw=1.2, fs=11.2, sub_fs=8.2, badge="1")

    # 4 artifact workspace (top-centre)
    block(ax, 4.65, 7.35, 6.65, 1.7,
          "Artifact-centered canvas",
          "30 typed kinds  ·  Pro workbenches  ·  evidence DAG\nIndexedDB-backed persistence",
          fill=FILL_LIGHT, fs=10, sub_fs=7.8, badge="4")

    # 5 approval gates (bottom-centre)
    block(ax, 5.05, 2.12, 5.95, 1.75,
          "Two-layer approval",
          "pre-exec: trustLevel × mode\npost-exec: proposal cards",
          fill=FILL_DARK, fs=10, sub_fs=7.9, badge="5")

    # 2 tool catalog (top-right)
    block(ax, 12.5, 6.7, 4.9, 1.9,
          "Tool catalog   ~70 LocalTool",
          "spectrum · structure · compute · research\nlatex · library · hypothesis · workspace",
          fill=FILL_LIGHT, fs=10, sub_fs=7.8, badge="2")

    # 3 python worker (bottom-right)
    block(ax, 12.5, 3.0, 4.9, 1.9,
          "Python scientific worker",
          "JSON-RPC stdio · ~22 methods\nxrd / xps / raman / rag / cif_db · offline DBs",
          fill=FILL_LIGHT, fs=10, sub_fs=7.8, badge="3")

    # arrows
    # scientist <-> orchestrator
    arrow(ax, (2.95, 5.55), (6.6, 5.88))
    arrow(ax, (6.6, 5.65), (2.95, 5.25), ls=(0, (3, 2)), color=INK_MID)
    # llm <-> orchestrator
    arrow(ax, (2.95, 3.25), (6.6, 4.8), connectionstyle="arc3,rad=-0.12")
    arrow(ax, (6.6, 4.7), (2.95, 3.05), connectionstyle="arc3,rad=-0.12",
          color=INK_MID, ls=(0, (3, 2)))
    # orchestrator -> tool catalog
    arrow(ax, (11.05, 6.35), (12.5, 7.2))
    # tool catalog delegates to python worker
    arrow(ax, (15.0, 6.7), (15.0, 4.9), color=INK_MID)
    ax.text(15.22, 5.8, "delegate", color=INK_MID, fontsize=7.7,
            bbox=dict(fc=WHITE, ec="none", pad=1.0), zorder=5)
    # orchestrator -> python worker (direct, dashed)
    arrow(ax, (11.05, 5.0), (12.5, 4.0), ls=(0, (3, 2)), color=INK_MID)
    # orchestrator -> artifacts (writes)
    arrow(ax, (8.35, 6.8), (7.55, 7.35))
    arrow(ax, (8.72, 7.35), (8.95, 6.8), color=INK_MID, ls=(0, (3, 2)))
    # tool catalog -> artifacts (Pro workbench patches)
    arrow(ax, (12.5, 7.45), (11.3, 8.02), color=INK_MID)
    # orchestrator -> approval
    arrow(ax, (8.35, 4.55), (7.55, 3.87))
    arrow(ax, (8.78, 3.87), (8.98, 4.55), color=INK_MID, ls=(0, (3, 2)))
    # approval -> scientist (review prompts)
    arrow(ax, (5.05, 3.05), (2.95, 4.8), ls=(0, (3, 2)), color=INK_MID,
          connectionstyle="arc3,rad=0.10")

    save(fig, "fig-c1-architecture")


# ---------------------------------------------------------------------------
# Fig 2 — agent orchestrator turn sequence
# ---------------------------------------------------------------------------
def fig_agent_loop():
    fig, ax = plt.subplots(figsize=(10.8, 6.3))
    setup_ax(ax, (0, 16.6), (0, 10.55))

    lanes = [
        ("Scientist",          1.55),
        ("Orchestrator",       4.90),
        ("LLM",                8.35),
        ("Tool",              11.65),
        ("Artifact / step",   14.95),
    ]
    top = 9.45
    bot = 0.95
    for name, x in lanes:
        block(ax, x - 1.25, top, 2.5, 0.7, name, fill=FILL_LIGHT, fs=9.5)
        ax.plot([x, x], [top, bot], color=INK_SOFT, lw=0.55, ls=(0, (3, 3)), zorder=1)

    def msg(y, x0, x1, label, ls="-", color=INK, dy=0.12, fs=7.9):
        arrow(ax, (x0, y), (x1, y), color=color, ls=ls, lw=0.9, mut=8)
        mid = (x0 + x1) / 2
        ax.text(mid, y + dy, label, ha="center", va="bottom",
                color=INK, fontsize=fs, fontweight=500, linespacing=1.05,
                bbox=dict(fc=WHITE, ec="none", pad=1.3), zorder=5)

    sx, ox, lx, tx, ax_ = 1.55, 4.90, 8.35, 11.65, 14.95

    msg(8.9, sx, ox, "ask: interpret this XRD")
    msg(8.3, ox, lx, "transcript + filtered schema")
    msg(7.7, lx, ox, "tool_use: detect_peaks", ls=(0, (3, 2)))
    msg(7.1, ox, tx, "execute(input)")
    msg(6.5, tx, ax_, "patch xrd-pro:\npeaks", ls=(0, (3, 2)), color=INK_MID, dy=0.08)
    msg(5.9, tx, ox, "result + sourceStepId", ls=(0, (3, 2)))
    msg(5.3, ox, lx, "tool_result(peaks)")
    msg(4.7, lx, ox, "tool_use: xrd_search_phases", ls=(0, (3, 2)), fs=7.6)
    msg(4.1, ox, tx, "execute(input)")
    msg(3.5, tx, ax_, "patch xrd-pro:\ncandidates", ls=(0, (3, 2)), color=INK_MID, dy=0.08)
    msg(2.9, tx, ox, "result", ls=(0, (3, 2)))
    msg(2.3, ox, lx, "tool_result(candidates)")
    msg(1.7, lx, ox, "final answer with caveats", ls=(0, (3, 2)), fs=7.7)
    msg(1.1, ox, sx, "answer + tool steps")

    # loop-detect / abort annotations
    ax.text(0.25, 0.48,
            "termination: plain-text reply  ·  abort signal  ·  iteration ceiling  ·  loop detected\n"
            "(canonicalized signature unchanged for 3 rounds)",
            ha="left", va="center", color=INK_MID, fontsize=7.3, linespacing=1.08)

    save(fig, "fig-c1-agent-loop")


# ---------------------------------------------------------------------------
# Fig 3 — approval matrix
# ---------------------------------------------------------------------------
def fig_approval_matrix():
    fig, ax = plt.subplots(figsize=(10.0, 4.8))
    setup_ax(ax, (0, 13.4), (0.45, 7.05))

    rows = ["normal", "auto-accept", "read-only", "yolo"]
    cols = ["safe", "sandboxed", "localWrite", "hostExec", "review / edit\ncards"]

    M = [
        ["A", "A", "Q", "Q", "Q"],
        ["A", "A", "A", "Q", "A"],
        ["A", "A", "D", "D", "D"],
        ["A", "A", "A", "A", "A"],
    ]

    def cell_fill(v):
        return {"A": FILL_LIGHT, "Q": FILL_MID, "D": FILL_DARK}[v]

    def cell_label(v):
        return {"A": "auto", "Q": "ask", "D": "deny"}[v]

    x0, y0, cw, rh = 2.6, 0.8, 2.05, 1.05
    matrix_top = y0 + len(rows) * rh        # = 5.0
    matrix_right = x0 + len(cols) * cw      # = 12.85

    # column header band
    for j, c in enumerate(cols):
        bx = x0 + j * cw
        block(ax, bx, matrix_top, cw, 0.85, c,
              fill=WHITE, fs=8.5, lw=0.6)

    # row labels + cells
    for i, r in enumerate(rows):
        y = y0 + (len(rows) - 1 - i) * rh
        block(ax, 0.55, y, x0 - 0.75, rh, r, fill=WHITE, fs=9.0, lw=0.6)
        for j, _ in enumerate(cols):
            v = M[i][j]
            bx = x0 + j * cw
            block(ax, bx, y, cw, rh, cell_label(v),
                  fill=cell_fill(v), fs=9, lw=0.6)

    # axis labels — placed in margins, away from legend / column headers
    # column-axis label centred above column headers
    ax.text((x0 + matrix_right) / 2, matrix_top + 0.85 + 0.20,
            "trust level",
            ha="center", va="bottom", color=INK_MID, fontsize=8.5, fontweight=500)
    # row-axis label rotated to the left of row labels
    ax.text(0.30, y0 + (len(rows) * rh) / 2,
            "permission mode",
            ha="center", va="center", rotation=90,
            color=INK_MID, fontsize=8.5, fontweight=500)

    # legend, kept independent from the trust-level axis label
    legx = 8.15
    legy = matrix_top + 0.85 + 0.58
    ax.text(legx - 0.28, legy + 0.21, "cell action",
            ha="right", va="center", color=INK_MID, fontsize=8.2)
    for v, label in [("A", "auto"), ("Q", "ask"), ("D", "deny")]:
        block(ax, legx, legy, 0.5, 0.42, "", fill=cell_fill(v), lw=0.6)
        ax.text(legx + 0.62, legy + 0.21, label,
                ha="left", va="center", color=INK, fontsize=8.5)
        legx += 1.55

    save(fig, "fig-c1-approval-matrix")


# ---------------------------------------------------------------------------
# Fig 4 — artifact evidence graph
# ---------------------------------------------------------------------------
def fig_artifact_dag():
    fig, ax = plt.subplots(figsize=(12.4, 4.2))
    setup_ax(ax, (0, 27.2), (0, 9.1))

    # Wider boxes and side ports keep labels clear and keep diagonal links out of text.
    nodes = [
        # x, y, w, h, label, sub, fill
        (0.7,  4.60, 3.05, 1.55, "raw spectrum",     "user upload",              FILL_LIGHT),
        (4.65, 4.60, 3.25, 1.55, "xrd-pro",          "workbench\nincremental patches", FILL_MID),
        (9.00, 7.25, 3.15, 1.55, "peak table",       "detect_peaks",             FILL_LIGHT),
        (8.85, 2.00, 3.45, 1.55, "phase candidates", "xrd_search_phases",        FILL_LIGHT),
        (13.65, 4.60, 3.45, 1.55, "approx. fit",      "xrd_refine\npseudo-Voigt", FILL_LIGHT),
        (18.20, 7.25, 3.05, 1.55, "plot",             "plot_spectrum",            FILL_LIGHT),
        (18.05, 2.00, 3.35, 1.55, "literature ctx",   "paper_rag_ask",            FILL_LIGHT),
        (22.65, 4.60, 4.05, 1.55, "final answer",     "sourceStepId refs",        FILL_DARK),
    ]
    for (x, y, w, h, lbl, sub, fill) in nodes:
        block(ax, x, y, w, h, lbl, sub, fill=fill, fs=9.6, sub_fs=7.8)

    def edge(a, b, side_a="r", side_b="l", frac_a=0.5, frac_b=0.5):
        nx0, ny0, nw0, nh0, *_ = nodes[a]
        nx1, ny1, nw1, nh1, *_ = nodes[b]

        def port(x, y, w, h, side, frac):
            if side == "r": return (x + w, y + h * frac)
            if side == "l": return (x, y + h * frac)
            if side == "t": return (x + w * frac, y + h)
            if side == "b": return (x + w * frac, y)

        p0 = port(nx0, ny0, nw0, nh0, side_a, frac_a)
        p1 = port(nx1, ny1, nw1, nh1, side_b, frac_b)
        arrow(ax, p0, p1)

    # wire up using box-side ports so arrows don't cross subtitles
    edge(0, 1, "r", "l")
    edge(1, 2, "r", "l", 0.82, 0.35)
    edge(1, 3, "r", "l", 0.18, 0.65)
    edge(2, 4, "r", "l", 0.35, 0.78)
    edge(3, 4, "r", "l", 0.65, 0.22)
    edge(4, 5, "r", "l", 0.78, 0.35)
    edge(4, 6, "r", "l", 0.22, 0.65)
    edge(5, 7, "r", "l", 0.35, 0.78)
    edge(6, 7, "r", "l", 0.65, 0.22)
    edge(4, 7, "r", "l")

    ax.text(0.7, 0.70,
            "edges = parent pointers   ·   filled workbench node accumulates incremental patches",
            color=INK_MID, fontsize=8)
    ax.text(0.7, 0.35,
            "tool step ids travel with every artifact; nodes persist across sessions",
            color=INK_MID, fontsize=8)

    save(fig, "fig-c1-artifact-dag")


# ---------------------------------------------------------------------------
def main():
    fig_architecture()
    fig_agent_loop()
    fig_approval_matrix()
    fig_artifact_dag()
    print("rendered:")
    for p in sorted(OUT.glob("fig-c1-*.pdf")):
        print(" ", p.name)


if __name__ == "__main__":
    main()
