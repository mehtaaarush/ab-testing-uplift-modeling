/* viz.js - small shared layer over Plotly: theme tokens -> layouts, formatters,
   stat tiles, chart/table twins and the light/dark toggle. No build step. */
(function (global) {
  'use strict';

  const FONT = 'ui-sans-serif, system-ui, sans-serif';
  const CONFIG = { displayModeBar: false, responsive: true, displaylogo: false };
  const FIGURE = /^[<>+−$£-]{0,2}\d/; // a cell that opens on a number, after a sign, a currency or both (+$0.77)
  const root = document.documentElement;
  const charts = [];

  function cssVar(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function tokens() {
    const t = {
      font: cssVar('--font-chart') || FONT,
      fontFig: cssVar('--font-chart-figures'),
      surface: cssVar('--surface-1'),
      surface2: cssVar('--surface-2'),
      text: cssVar('--text-primary'),
      text2: cssVar('--text-secondary'),
      muted: cssVar('--text-muted'),
      grid: cssVar('--grid'),
      baseline: cssVar('--baseline'),
      deemph: cssVar('--deemph'),
      divNeg: cssVar('--div-neg'),
      divMid: cssVar('--div-mid'),
      divPos: cssVar('--div-pos'),
      good: cssVar('--good'),
      critical: cssVar('--critical'),
      person: cssVar('--person'),
    };
    if (!t.fontFig) t.fontFig = t.font;
    t.series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar('--series-' + i));
    if (!t.person) t.person = t.series[0]; // a value the reader set, where a theme marks one
    t.seq = [100, 200, 300, 400, 500, 600, 700].map((s) => cssVar('--seq-' + s));
    t.seqScale = t.seq.map((c, i) => [i / (t.seq.length - 1), c]);
    t.divScale = [[0, t.divNeg], [0.5, t.divMid], [1, t.divPos]];
    return t;
  }

  function isObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function merge(target, src) {
    Object.keys(src).forEach((k) => {
      if (isObj(src[k]) && isObj(target[k])) target[k] = merge(Object.assign({}, target[k]), src[k]);
      else target[k] = src[k];
    });
    return target;
  }

  function axis(t) {
    return {
      gridcolor: t.grid, gridwidth: 1, linecolor: t.baseline, linewidth: 1,
      zeroline: false, ticks: '', automargin: true,
      tickfont: { color: t.muted, size: 11 },
      title: { font: { color: t.text2, size: 12 }, standoff: 8 },
    };
  }

  function layout(extra, narrow) {
    const t = tokens();
    const base = {
      paper_bgcolor: t.surface,
      plot_bgcolor: t.surface,
      font: { family: t.font, size: 12, color: t.text2 },
      margin: { l: 8, r: 14, t: 12, b: 8 },
      xaxis: Object.assign(axis(t), { showgrid: false, showline: true }),
      yaxis: Object.assign(axis(t), { showgrid: true, showline: false }),
      hoverlabel: {
        bgcolor: t.surface, bordercolor: t.baseline, align: 'left',
        font: { family: t.font, color: t.text, size: 12 },
      },
      legend: {
        orientation: 'h', x: 0, xanchor: 'left', y: 1.0, yanchor: 'bottom',
        font: { color: t.text2, size: 12 }, bgcolor: 'rgba(0,0,0,0)',
      },
      showlegend: false,
      hovermode: 'closest',
      dragmode: false,
    };
    const out = merge(base, extra || {});
    /* Gridded axes are the value axes: at most five lines unless a chart sets its own
       ticks, and their figures in the theme's figure face where it has one. */
    Object.keys(out).forEach((k) => {
      const a = out[k];
      if (!/^[xy]axis\d*$/.test(k) || !isObj(a)) return;
      const isX = /^x/.test(k);
      const own = a.nticks != null || a.dtick != null || a.tickvals != null; // the chart set its own ticks
      if (isX && narrow && narrow.level) { // labels Plotly had to turn on end: keep every second, then every third
        const step = narrow.level + 1;
        if (typeof a.dtick === 'number') a.dtick *= step;
        if (Array.isArray(a.tickvals)) {
          const keep = (_, i) => i % step === 0;
          a.tickvals = a.tickvals.filter(keep);
          if (Array.isArray(a.ticktext)) a.ticktext = a.ticktext.filter(keep);
        }
        if (!own && !a.showgrid) a.nticks = narrow.level > 1 ? 4 : 6; // month and other category names
      }
      if (!a.showgrid) return;
      if (!own) a.nticks = isX && narrow ? narrow.xTicks : 5;
      a.tickfont = Object.assign({}, a.tickfont, { family: t.fontFig });
    });
    return out;
  }

  /* Crosshair for time series: a hairline that snaps to the nearest x. */
  function crosshair(t) {
    return {
      showspikes: true, spikemode: 'across', spikesnap: 'data', spikedash: 'solid',
      spikethickness: 1, spikecolor: t.baseline,
    };
  }

  /* A plot under NARROW px gives its x axis four ticks, then three, then two while Plotly still has
     to turn the labels on end. A bar chart whose names would take more than two fifths of that width
     sets each name on its own line above its bar, and grows to give every row its line. */
  const NARROW = 480;
  const ctx = document.createElement('canvas').getContext('2d');
  function textWidth(s, px, face) {
    ctx.font = px + 'px ' + face;
    return ctx.measureText(s).width;
  }
  function wrapText(s, n) {
    const lines = [];
    let line = '';
    s.split(' ').forEach((w) => {
      if (line && (line + ' ' + w).length > n) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
    });
    if (line) lines.push(line);
    return lines.join('<br>');
  }
  function wrapCategories(spec, height) {
    spec.layout = spec.layout || {};
    const ax = spec.layout.yaxis = spec.layout.yaxis || {};
    if (ax.tickvals) return;
    const names = [];
    spec.data.forEach((tr) => {
      if (tr.orientation !== 'h' || !Array.isArray(tr.y)) return;
      tr.y.forEach((y) => { if (typeof y === 'string' && !names.includes(y)) names.push(y); });
    });
    if (!names.some((s) => s.length > 18) || height / names.length < 32) return; // two lines need a row of room
    ax.tickvals = names;
    ax.ticktext = names.map((s) => wrapText(s, 18));
  }
  function wrapTitles(spec, t, w, h) {
    const L = spec.layout || {};
    Object.keys(L).forEach((k) => {
      const a = L[k];
      if (!/^[xy]axis\d*$/.test(k) || !isObj(a) || !isObj(a.title) || typeof a.title.text !== 'string') return;
      const s = a.title.text;
      const room = (/^x/.test(k) ? w : h) - 48;
      const width = textWidth(s, (a.title.font && a.title.font.size) || 12, t.font);
      if (width > room) L[k] = Object.assign({}, a, { title: Object.assign({}, a.title, { text: wrapText(s, Math.floor(s.length * room / width)) }) });
    });
  }
  function namesAbove(spec, t, w, node) {
    const data = spec.data || [];
    if (!data.length || !data.every((tr) => tr.type === 'bar' && tr.orientation === 'h' && Array.isArray(tr.y))) return false;
    const L = spec.layout = spec.layout || {};
    const ax = L.yaxis = L.yaxis || {};
    if (ax.tickvals) return false;
    const names = Array.isArray(ax.categoryarray) ? ax.categoryarray.slice() : [];
    data.forEach((tr) => tr.y.forEach((y) => { if (typeof y === 'string' && !names.includes(y)) names.push(y); }));
    const size = (ax.tickfont && ax.tickfont.size) || 12;
    const widest = Math.max(0, ...names.map((s) => textWidth(s, size, t.font)));
    if (!names.length || widest < w * 0.4) return false; // names that leave the bars most of the width stay beside them
    const room = w - 24;
    const lines = widest > room ? 2 : 1;
    const label = (s) => (lines > 1 ? wrapText(s, Math.floor(s.length * room / textWidth(s, size, t.font))) : s);
    const group = L.barmode === 'group' ? data.length : 1;
    const bar = group > 1 ? 8 : 12;
    const groupPx = group * bar + (group - 1) * 3;
    const m = L.margin = Object.assign({ t: 12, b: 8 }, L.margin);
    m.t += 6; // air between a legend and the first name
    const title = L.xaxis && L.xaxis.title && (L.xaxis.title.text || typeof L.xaxis.title === 'string');
    const chrome = m.t + m.b + 22 + (title ? 22 : 0); // the figures under the plot, and the axis title
    const row = lines * (size + 2) + 3 + groupPx + 9;
    const height = Math.max(node.getBoundingClientRect().height, Math.ceil(names.length * row + chrome));
    node.style.height = height + 'px';
    const band = (height - chrome) / names.length;
    if (group > 1) {
      L.bargap = Math.max(0.05, 1 - groupPx / band);
      L.bargroupgap = 0.2;
      data.forEach((tr) => { delete tr.width; });
    } else data.forEach((tr) => { tr.width = Math.min(0.9, bar / band); });
    data.forEach((tr) => { tr.constraintext = 'none'; }); // a value at the bar end keeps its size beside the thinner bar
    ax.showticklabels = false;
    const font = { family: t.font, size, color: (ax.tickfont && ax.tickfont.color) || t.text2 };
    L.annotations = (L.annotations || []).concat(names.map((s) => ({
      xref: 'paper', x: 0, xanchor: 'left', yref: 'y', y: s, yanchor: 'bottom', yshift: groupPx / 2 + 3,
      text: label(s), align: 'left', showarrow: false, font,
    })));
    return true;
  }

  function draw(entry) {
    const node = entry.node;
    const w = node.getBoundingClientRect().width;
    const narrow = w > 0 && w < NARROW;
    if (narrow !== entry.narrow) entry.level = 0; // a new width starts again from four ticks
    entry.narrow = narrow;
    node.style.height = '';
    const t = tokens();
    t.narrow = narrow; // a chart may shorten its own labels on a phone
    t.width = w;
    const spec = entry.build(t);
    if (narrow && !namesAbove(spec, t, w, node)) wrapCategories(spec, node.getBoundingClientRect().height);
    if (narrow) wrapTitles(spec, t, w, node.getBoundingClientRect().height); // a long axis title takes two lines
    const level = entry.level || 0;
    const opts = narrow ? { xTicks: [4, 3, 2][level], level } : null;
    const done = global.Plotly.react(node, spec.data, layout(spec.layout, opts), Object.assign({}, CONFIG, spec.config));
    const drawn = entry.drawn = (entry.drawn || 0) + 1;
    if (opts && level < 2 && done && done.then) {
      done.then(() => {
        if (entry.drawn !== drawn) return; // a later draw has replaced these labels
        const turned = Array.from(node.querySelectorAll('.xtick text')).some((n) => /rotate\(\s*-?[1-9]/.test(n.getAttribute('transform') || ''));
        if (turned) { entry.level = level + 1; draw(entry); }
      }).catch(() => { /* hidden behind its table: redrawn on show */ });
    }
  }

  /* Plotly only listens to the window. A card can change width without the window
     changing (a font arriving, a grid track settling), so each plot also follows its box. */
  const widths = new WeakMap();
  const sizer = typeof global.ResizeObserver === 'function' ? new global.ResizeObserver((entries) => {
    entries.forEach((e) => {
      const w = Math.round(e.contentRect.width);
      if (!w || widths.get(e.target) === w) return;
      widths.set(e.target, w);
      const entry = charts.find((c) => c.node === e.target);
      if (entry && entry.ready && entry.narrow !== (w < NARROW)) { draw(entry); return; } // ticks and names re-laid for the new width
      const p = global.Plotly.Plots.resize(e.target);
      if (p && p.catch) p.catch(() => { /* hidden behind its table: redrawn on show */ });
    });
  }) : null;

  /* Plotly measures every label when it draws, and Plotly.react does not measure again
     when only the font has changed. So the first draw waits (two seconds at most) for
     the chart face to load. */
  const faces = [cssVar('--font-chart') || FONT, cssVar('--font-chart-figures')].filter(Boolean);
  const fontReady = document.fonts && document.fonts.load
    ? Promise.race([
      Promise.all(faces.map((f) => document.fonts.load('12px ' + f).catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
    : Promise.resolve();

  /* Register a chart. build(tokens) returns {data, layout}; it is re-run on theme change. */
  function chart(el, build) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    const entry = { node, build, ready: false };
    charts.push(entry);
    fontReady.then(() => {
      entry.ready = true;
      draw(entry);
      if (sizer) {
        widths.set(node, Math.round(node.getBoundingClientRect().width));
        sizer.observe(node);
      }
    });
    return { update: () => { if (entry.ready) draw(entry); }, node };
  }

  /* Hidden charts (table view showing) are redrawn when their card flips back. */
  function redrawAll() {
    charts.forEach((entry) => {
      if (entry.ready && entry.node.offsetParent !== null) draw(entry);
    });
  }

  function renderTable(box, spec) {
    box.textContent = '';
    const table = document.createElement('table');
    table.className = 'data';
    const head = table.createTHead().insertRow();
    spec.columns.forEach((c) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      head.appendChild(th);
    });
    const body = table.createTBody();
    spec.rows.forEach((r) => {
      const tr = body.insertRow();
      r.forEach((v, i) => {
        const td = tr.insertCell();
        td.textContent = v == null ? '' : String(v);
        td.dataset.label = spec.columns[i] || ''; // a phone layout may restack the row and label each cell
        if (FIGURE.test(td.textContent)) td.classList.add('num'); // a figure, set in the theme's figure face
      });
    });
    // A column that is mostly figures is a figure column, head included; the theme decides its alignment.
    spec.columns.forEach((c, i) => {
      const cells = Array.from(body.rows).map((r) => r.cells[i]).filter((td) => td && td.textContent.trim());
      const figures = cells.filter((td) => td.classList.contains('num')).length;
      if (cells.length && figures * 2 >= cells.length) {
        head.cells[i].classList.add('col-num');
        cells.forEach((td) => td.classList.add('col-num'));
      }
    });
    box.appendChild(table);
  }

  /* Every chart card gets a table twin: a toggle button swaps the plot for its data. */
  function card(id, opts) {
    const cardEl = document.getElementById(id);
    const chartEl = cardEl.querySelector('.chart');
    const handle = chartEl && opts.build ? chart(chartEl, opts.build) : null;
    const btn = cardEl.querySelector('.view-toggle');
    const box = cardEl.querySelector('.table-view');
    if (btn && box && opts.table) {
      btn.addEventListener('click', () => {
        const showing = cardEl.classList.toggle('show-table');
        btn.textContent = showing ? 'Chart' : 'Table';
        btn.setAttribute('aria-pressed', String(showing));
        if (showing) renderTable(box, opts.table());
        else {
          if (handle) handle.update();
          if (opts.onShow) opts.onShow();
        }
      });
    }
    return {
      update() {
        if (handle) handle.update();
        if (cardEl.classList.contains('show-table') && opts.table) renderTable(box, opts.table());
      },
    };
  }

  /* Area washes: the series hue at low opacity. */
  function alpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* Bar thickness is capped (~22px) instead of filling the band. */
  function barWidth(node, n, horizontal, maxPx, maxFrac) {
    const el = typeof node === 'string' ? document.getElementById(node) : node;
    const len = (horizontal ? el.clientHeight : el.clientWidth) * 0.8;
    const band = len / Math.max(n, 1);
    return Math.min(maxFrac || 0.72, (maxPx || 22) / Math.max(band, 1));
  }

  function tile(el, spec) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    node.textContent = '';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = spec.label;
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = spec.value;
    node.append(label, value);
    if (spec.delta || spec.note) {
      const d = document.createElement('div');
      d.className = 'delta';
      if (spec.delta) {
        const s = document.createElement('span');
        s.className = spec.tone || '';
        s.textContent = spec.delta; // the sign carries the direction
        d.appendChild(s);
      }
      if (spec.note) d.appendChild(document.createTextNode((spec.delta ? ' ' : '') + spec.note));
      node.appendChild(d);
    }
  }

  function initTheme(button) {
    const KEY = root.dataset.themeKey || 'dashboard-theme';
    const media = global.matchMedia('(prefers-color-scheme: dark)');
    try {
      const saved = global.localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
    } catch (e) { /* storage unavailable: follow the OS */ }
    const current = () => root.getAttribute('data-theme') || (media.matches ? 'dark' : 'light');
    const label = () => {
      button.textContent = current() === 'dark' ? 'Light mode' : 'Dark mode';
    };
    label();
    button.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { global.localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      label();
      redrawAll();
    });
    media.addEventListener('change', () => {
      if (!root.getAttribute('data-theme')) { label(); redrawAll(); }
    });
  }

  const nf = (opts) => new Intl.NumberFormat('en-US', opts);
  const fmt = {
    int: (n) => nf({ maximumFractionDigits: 0 }).format(n),
    num: (n, d) => nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(n),
    compact: (n, d) => nf({ notation: 'compact', maximumFractionDigits: d == null ? 1 : d }).format(n),
    pct: (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%',
    signedPct: (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d == null ? 1 : d) + '%',
    pp: (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d == null ? 2 : d) + ' pp',
    usd: (n, d) => (n < 0 ? '−' : '') + '$' + nf({ minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }).format(Math.abs(n)),
    usdCompact: (n) => (n < 0 ? '−' : '') + '$' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)),
    gbp: (n, d) => (n < 0 ? '−' : '') + '£' + nf({ minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d }).format(Math.abs(n)),
    gbpCompact: (n, d) => (n < 0 ? '−' : '') + '£' + nf({ notation: 'compact', maximumFractionDigits: d == null ? 2 : d }).format(Math.abs(n)),
    date: (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    month: (iso) => new Date(iso.slice(0, 7) + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
  };

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load ' + url + ' (' + res.status + ')');
    return res.json();
  }

  global.Viz = { tokens, layout, crosshair, chart, card, alpha, barWidth, tile, initTheme, redrawAll, renderTable, fmt, loadJSON, FONT };
})(window);
