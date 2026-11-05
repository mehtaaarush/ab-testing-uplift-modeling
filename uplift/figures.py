"""Static figures for the README (matplotlib, same palette as the dashboard's light theme)."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as mticker  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from . import config  # noqa: E402
from .export import ARM_NAMES, SEGMENTS  # noqa: E402

SURFACE, INK, INK2, MUTED = "#fcfcfb", "#0b0b0b", "#52514e", "#898781"
GRID, BASELINE = "#e1e0d9", "#c3c2b7"
ARM_COLORS = {"mens": "#2a78d6", "womens": "#eb6834"}
MINUS = "−"


def _style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
            "font.family": ["Segoe UI", "DejaVu Sans", "sans-serif"], "font.size": 10,
            "axes.edgecolor": BASELINE, "axes.labelcolor": INK2, "axes.titlesize": 12.5,
            "axes.titleweight": "bold", "axes.titlecolor": INK, "axes.titlelocation": "left", "axes.titlepad": 12,
            "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
            "axes.grid": True, "axes.grid.axis": "x", "axes.axisbelow": True, "grid.color": GRID, "grid.linewidth": 0.8,
            "xtick.color": MUTED, "ytick.color": MUTED, "xtick.major.size": 0, "ytick.major.size": 0,
            "legend.frameon": False, "legend.labelcolor": INK2, "lines.solid_capstyle": "round",
            "axes.unicode_minus": True,
        }
    )


def _save(fig, name: str) -> Path:
    config.FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    path = config.FIGURES_DIR / name
    fig.savefig(path, dpi=160, bbox_inches="tight")
    plt.close(fig)
    return path


def _signed(fmt: str):
    return mticker.FuncFormatter(lambda v, _p: (fmt.format(v) if v >= 0 else MINUS + fmt.format(-v)))


def effects_figure(effects: pd.DataFrame) -> Path:
    """Forest plot: each e-mail vs. no e-mail, absolute effect with 95% CI, one panel per metric."""
    fig, axes = plt.subplots(1, 3, figsize=(12, 2.9))
    units = {"visit": ("{:.1f} pp", 100), "conversion": ("{:.2f} pp", 100), "spend": ("${:.2f}", 1)}
    for ax, metric in zip(axes, config.METRICS):
        sub = effects[effects["metric"] == metric].set_index("arm").loc[config.TREATMENTS[::-1]]
        fmt, scale = units[metric]
        for i, (arm, r) in enumerate(sub.iterrows()):
            ax.plot([r["ci_low"] * scale, r["ci_high"] * scale], [i, i], color=ARM_COLORS[arm], lw=2.2)
            ax.plot(r["diff"] * scale, i, "o", color=ARM_COLORS[arm], ms=8, mec=SURFACE, mew=2)
            ax.annotate(fmt.format(r["diff"] * scale).replace("$", "+$") if metric == "spend" else "+" + fmt.format(r["diff"] * scale),
                        (r["ci_high"] * scale, i), xytext=(8, 0), textcoords="offset points", va="center", color=INK2, fontsize=9.5)
        ax.axvline(0, color=BASELINE, lw=1)
        ax.set_yticks(range(len(sub)), [ARM_NAMES[a] for a in sub.index])
        ax.set_ylim(-0.7, len(sub) - 0.3)
        ax.set_xlim(left=min(0, sub["ci_low"].min() * scale) * 1.1, right=sub["ci_high"].max() * scale * 1.45)
        ax.xaxis.set_major_formatter(_signed(fmt))
        ax.set_title(config.METRICS[metric])
    for ax in axes[1:]:
        ax.set_yticklabels([])
    fig.suptitle("Effect of each e-mail versus no e-mail (95% confidence intervals)", x=0.01, ha="left", fontsize=13,
                 fontweight="bold", color=INK, y=1.06)
    return _save(fig, "effects.png")


def segment_figure(segments: pd.DataFrame, dimension: str = "purchase_mix", metric: str = "visit") -> Path:
    label, levels = SEGMENTS[dimension]
    sub = segments[(segments["dimension"] == dimension) & (segments["metric"] == metric)]
    fig, ax = plt.subplots(figsize=(8, 3.4))
    offsets = {"mens": 0.14, "womens": -0.14}
    for arm in config.TREATMENTS:
        rows = sub[sub["arm"] == arm].set_index("level").reindex(levels[::-1])
        y = np.arange(len(levels)) + offsets[arm]
        ax.hlines(y, rows["ci_low"] * 100, rows["ci_high"] * 100, color=ARM_COLORS[arm], lw=2.2)
        ax.plot(rows["diff"] * 100, y, "o", color=ARM_COLORS[arm], ms=8, mec=SURFACE, mew=2, label=ARM_NAMES[arm])
    ax.axvline(0, color=BASELINE, lw=1)
    ax.set_yticks(range(len(levels)), levels[::-1])
    ax.xaxis.set_major_formatter(_signed("{:.0f} pp"))
    ax.set_xlabel("Change in visit rate versus no e-mail (percentage points)")
    ax.set_title(f"Who responds: visit uplift by {label.lower()}", pad=30)
    ax.legend(loc="lower left", ncol=2, bbox_to_anchor=(0, 1.0), fontsize=9.5, borderaxespad=0.3)
    return _save(fig, "segments.png")


def uplift_curves_figure(campaigns: dict) -> Path:
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.8), sharey=True)
    for ax, arm in zip(axes, config.TREATMENTS):
        res = campaigns[arm]
        frac = np.r_[0, res["curve"]["fraction"]] * 100
        curve = np.r_[0, res["curve"][res["selected"]]] * 100
        total = curve[-1]
        name = next(m["name"] for m in res["models"] if m["key"] == res["selected"])
        auuc = next(m["test_auuc"] for m in res["models"] if m["key"] == res["selected"])
        ax.plot(frac, frac / 100 * total, color=BASELINE, lw=1.6, ls=(0, (4, 3)), label="Random targeting")
        ax.plot(frac, curve, color=ARM_COLORS[arm], lw=2.2, label=name)
        ax.set_title(f"{ARM_NAMES[arm]}: AUUC gain {auuc:.2f}")
        ax.set_xlabel("Share of customers e-mailed, highest predicted uplift first (%)")
        ax.grid(axis="y", visible=True)
        ax.legend(loc="lower right", fontsize=9)
    axes[0].set_ylabel("Incremental visits per 100 customers")
    return _save(fig, "uplift_curves.png")


def deciles_figure(campaigns: dict) -> Path:
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6), sharey=True)
    for ax, arm in zip(axes, config.TREATMENTS):
        d = campaigns[arm]["deciles"]
        ax.bar(d["group"], d["observed"] * 100, color=ARM_COLORS[arm], width=0.62)
        ax.errorbar(d["group"], d["observed"] * 100, yerr=[(d["observed"] - d["ci_low"]) * 100, (d["ci_high"] - d["observed"]) * 100],
                    fmt="none", ecolor=INK2, elinewidth=1, capsize=0)
        ax.axhline(0, color=BASELINE, lw=1)
        ax.set_xticks(range(1, 11))
        ax.set_xlabel("Predicted-uplift decile (1 = highest)")
        ax.set_title(f"{ARM_NAMES[arm]}: observed uplift by decile")
        ax.grid(axis="x", visible=False)
        ax.grid(axis="y", visible=True)
        ax.yaxis.set_major_formatter(_signed("{:.0f} pp"))
    axes[0].set_ylabel("Visit rate, e-mail minus control")
    return _save(fig, "uplift_deciles.png")


def all_figures(effects, segments, campaigns) -> list[Path]:
    _style()
    return [effects_figure(effects), segment_figure(segments), uplift_curves_figure(campaigns), deciles_figure(campaigns)]
