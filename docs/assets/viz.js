/* viz.js - small shared layer over Plotly: theme tokens -> layouts, formatters,
   stat tiles, chart/table twins and the light/dark toggle. No build step. */
(function (global) {
  'use strict';

  const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const CONFIG = { displayModeBar: false, responsive: true, displaylogo: false };
  const root = document.documentElement;
  const charts = [];

  function cssVar(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function tokens() {
    const t = {
      font: cssVar('--font-chart') || FONT,
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
    };
    t.series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar('--series-' + i));
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

  function layout(extra) {
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
    return merge(base, extra || {});
  }

  /* Crosshair for time series: a hairline that snaps to the nearest x. */
  function crosshair(t) {
    return {
      showspikes: true, spikemode: 'across', spikesnap: 'data', spikedash: 'solid',
      spikethickness: 1, spikecolor: t.baseline,
    };
  }

  function draw(entry) {
    const spec = entry.build(tokens());
    global.Plotly.react(entry.node, spec.data, layout(spec.layout), Object.assign({}, CONFIG, spec.config));
  }

  /* Register a chart. build(tokens) returns {data, layout}; it is re-run on theme change. */
  function chart(el, build) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    const entry = { node, build };
    charts.push(entry);
    draw(entry);
    return { update: () => draw(entry), node };
  }

  /* Hidden charts (table view showing) are redrawn when their card flips back. */
  function redrawAll() {
    charts.forEach((entry) => {
      if (entry.node.offsetParent !== null) draw(entry);
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
      r.forEach((v) => { tr.insertCell().textContent = v == null ? '' : String(v); });
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
        const icon = spec.tone && spec.tone.indexOf('down') === 0 ? '▼ ' : spec.tone ? '▲ ' : '';
        s.textContent = icon + spec.delta;
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

  /* Web fonts can arrive after the first draw (some only start loading when a chart asks
     for them), so re-measure the charts whenever a batch of fonts finishes loading. */
  if (document.fonts) {
    document.fonts.ready.then(redrawAll);
    document.fonts.addEventListener('loadingdone', redrawAll);
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
