/* E-mail uplift dashboard: renders docs/data/dashboard.json (computed by `python -m uplift.pipeline`). */
(function () {
  'use strict';

  const fmt = Viz.fmt;
  const el = (id) => document.getElementById(id);
  const ARMS = ['mens', 'womens'];
  const ALL_ARMS = ['control', 'mens', 'womens'];
  let D;
  let NAMES;

  const signedUsd = (v, d) => (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toFixed(d == null ? 2 : d);
  const signedNum = (v, d) => (v >= 0 ? '+' : '−') + fmt.num(Math.abs(v), d == null ? 1 : d);
  const pText = (p) => (p < 0.0001 ? '<0.0001' : p.toFixed(4));
  const armColor = (t, arm) => (arm === 'mens' ? t.series[0] : arm === 'womens' ? t.series[1] : t.deemph);

  /* Per-metric formatting: levels (rates or $), absolute differences and axis units. */
  const METRIC = {
    visit: { level: (v) => fmt.pct(v, 1), diff: (v) => fmt.pp(v, 1), scale: 100, suffix: ' pp', axisFmt: '.1f', levelAxis: { tickformat: '.0%' } },
    conversion: { level: (v) => fmt.pct(v, 2), diff: (v) => fmt.pp(v, 2), scale: 100, suffix: ' pp', axisFmt: '.2f', levelAxis: { tickformat: '.1%' } },
    spend: { level: (v) => fmt.usd(v), diff: (v) => signedUsd(v), scale: 1, prefix: '$', suffix: '', axisFmt: '.2f', levelAxis: { tickprefix: '$', tickformat: '.2f' } },
  };

  const effect = (arm, metric) => D.effects.find((r) => r.arm === arm && r.metric === metric);

  /* Horizontal dot-and-interval chart. labels run top to bottom; each series is one colour,
     offset vertically when there are several so intervals never overlap. */
  function dotWhisker(t, spec) {
    const n = spec.labels.length;
    const k = spec.series.length;
    const gap = k > 1 ? Math.min(0.32, 0.6 / k) : 0;
    const data = spec.series.map((s, j) => {
      const offset = ((k - 1) / 2 - j) * gap;
      const pts = s.points.filter((p) => p && p.x != null);
      return {
        type: 'scatter', mode: 'markers', name: s.name,
        x: pts.map((p) => p.x * spec.scale),
        y: pts.map((p) => n - 1 - spec.labels.indexOf(p.label) + offset),
        error_x: {
          type: 'data', symmetric: false, thickness: 2, width: 0, color: s.color,
          array: pts.map((p) => (p.hi - p.x) * spec.scale), arrayminus: pts.map((p) => (p.x - p.lo) * spec.scale),
        },
        marker: { color: s.color, size: 10, line: { color: t.surface, width: 2 } },
        customdata: pts.map((p) => [p.label, p.text]),
        hovertemplate: '<b>%{customdata[0]}</b><br>' + s.name + ': %{customdata[1]}<extra></extra>',
      };
    });
    const ref = spec.reference == null ? 0 : spec.reference;
    return {
      data,
      layout: {
        showlegend: k > 1,
        margin: { l: 8, r: 18, t: k > 1 ? 30 : 10, b: 8 },
        xaxis: Object.assign({ showgrid: true, showline: false, title: { text: spec.xTitle }, tickformat: spec.axisFmt,
          ticksuffix: spec.suffix || '', tickprefix: spec.prefix || '' }, spec.xaxis || {}),
        yaxis: { tickvals: spec.labels.map((_, i) => n - 1 - i), ticktext: spec.labels, range: [-0.6, n - 0.4], showgrid: false,
          tickfont: { color: t.text2, size: 12 } },
        shapes: [{ type: 'line', yref: 'paper', y0: 0, y1: 1, x0: ref, x1: ref, line: { color: t.baseline, width: 1 } }].concat(spec.shapes || []),
      },
    };
  }

  function segmented(id, attr, onChange) {
    const buttons = Array.from(el(id).querySelectorAll('button'));
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(b.dataset[attr]);
    }));
  }

  function insights(id, items) {
    const box = el(id);
    box.textContent = '';
    items.forEach(([title, body]) => {
      const div = document.createElement('div');
      div.className = 'insight';
      const s = document.createElement('strong');
      s.textContent = title;
      div.append(s, document.createTextNode(body));
      box.appendChild(div);
    });
  }

  // The pipeline writes straight apostrophes into its labels; the page sets them typographically.
  function curly(o) {
    if (typeof o === 'string') return o.replace(/'/g, '’');
    if (Array.isArray(o)) return o.map(curly);
    if (o && typeof o === 'object') { Object.keys(o).forEach((k) => { o[k] = curly(o[k]); }); }
    return o;
  }

  /* ---------- Contents ---------- */
  // Under 60rem the contents fold into a menu; at every width the section in view is marked current.
  function contents() {
    const nav = document.querySelector('.contents');
    if (!nav) return;
    const button = nav.querySelector('.contents-toggle');
    const setOpen = (open) => { nav.classList.toggle('open', open); button.setAttribute('aria-expanded', String(open)); };
    button.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const sections = links.map((a) => { const h = document.getElementById(a.getAttribute('href').slice(1)); return h && h.closest('section'); });
    let queued = false;
    const mark = () => {
      queued = false;
      let current = -1;
      sections.forEach((sec, i) => { if (sec && sec.getBoundingClientRect().top <= window.innerHeight * 0.3) current = i; });
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atEnd && current >= 0) current = sections.length - 1; // the last sections cannot scroll up to the line
      links.forEach((a, i) => { if (i === current) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(mark); } }, { passive: true });
    mark();
  }

  /* ---------- Hero ---------- */
  function hero() {
    const s = effect('mens', 'spend');
    const v = effect('mens', 'visit');
    const c = effect('mens', 'conversion');
    el('hero-value').textContent = signedUsd(s.diff);
    el('hero-caption').textContent = fmt.usd(s.control) + ' to ' + fmt.usd(s.treatment) + ' per customer over two weeks (' + fmt.signedPct(s.lift, 0) +
      '; 95% CI ' + fmt.usd(s.ci_low) + ' to ' + fmt.usd(s.ci_high) + '). That is about ' + fmt.usd(s.diff * 1000, 0) + ' per 1,000 customers e-mailed.';
    Viz.tile('kpi-visit', { label: "Visit rate, men’s e-mail", value: fmt.pp(v.diff, 1), delta: fmt.signedPct(v.lift, 0), tone: 'up-good',
      note: 'from ' + fmt.pct(v.control, 1) + ' to ' + fmt.pct(v.treatment, 1) });
    Viz.tile('kpi-conversion', { label: "Conversion rate, men’s e-mail", value: fmt.pp(c.diff, 2), delta: fmt.signedPct(c.lift, 0), tone: 'up-good',
      note: 'from ' + fmt.pct(c.control, 2) + ' to ' + fmt.pct(c.treatment, 2) });
    const maxSmd = Math.max(...D.balance.map((r) => Math.max(Math.abs(r.mens), Math.abs(r.womens))));
    Viz.tile('kpi-srm', { label: 'Randomisation checks', value: D.srm.passed ? 'Passed' : 'Failed',
      note: 'Sample-ratio p = ' + D.srm.p_value.toFixed(2) + '; largest |SMD| ' + maxSmd.toFixed(3) });
    const w = D.uplift.campaigns.womens;
    const sel = w.models.find((m) => m.key === w.selected);
    Viz.tile('kpi-targeting', { label: "Women’s e-mail, top 30% by model", value: fmt.pct(sel.capture_30, 0),
      note: 'of its extra visits from 30% of the sends' });
    el('meta-size').textContent = fmt.int(D.meta.customers) + ' customers, three arms, two-week outcome window';
  }

  /* ---------- Experiment health ---------- */
  function health() {
    const n = D.meta.customers;
    const counts = ALL_ARMS.map((a) => D.srm.counts[a]);
    Viz.card('card-srm', {
      build: (t) => ({
        data: [{
          type: 'bar', x: ALL_ARMS.map((a) => NAMES[a]), y: counts,
          marker: { color: ALL_ARMS.map((a) => armColor(t, a)), cornerradius: 2 },
          width: Viz.barWidth('chart-srm', 3, false, 24, 0.5),
          text: counts.map(fmt.int), textposition: 'outside', textfont: { color: t.text2, size: 12 }, constraintext: 'none', cliponaxis: false,
          hovertemplate: '%{x}: %{y:,} customers<extra></extra>',
        }],
        layout: {
          yaxis: { range: [0, Math.max(...counts) * 1.2], tickformat: ',.0f' },
          shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: n / 3, y1: n / 3, line: { color: t.text2, width: 1, dash: 'dot' } }],
          annotations: [{ xref: 'paper', x: 1 / 3, y: n / 3, yanchor: 'bottom', xanchor: 'center', text: 'Equal split', showarrow: false, // between the first two bars, clear of their counts
            font: { color: t.muted, size: 11 } }],
        },
      }),
      table: () => ({ columns: ['Arm', 'Customers', 'Share', 'Expected'],
        rows: ALL_ARMS.map((a, i) => [NAMES[a], fmt.int(counts[i]), fmt.pct(counts[i] / n, 2), fmt.int(n / 3)]) }),
    });
    el('srm-note').textContent = 'Chi-square = ' + D.srm.chi2.toFixed(2) + ', p = ' + D.srm.p_value.toFixed(2) +
      '. A p-value below 0.001 would point to a broken split; this one is what chance alone produces.';

    const covs = D.balance.map((r) => r.covariate);
    Viz.card('card-balance', {
      build: (t) => dotWhisker(t, {
        labels: covs, scale: 1, axisFmt: '.2f', xTitle: 'Standardised mean difference',
        xaxis: { range: [-0.13, 0.13], dtick: 0.05 },
        series: ARMS.map((arm) => ({
          name: NAMES[arm], color: armColor(t, arm),
          points: D.balance.map((r) => ({ label: r.covariate, x: r[arm], lo: r[arm], hi: r[arm], text: 'SMD ' + r[arm].toFixed(3) })),
        })),
        shapes: [{ type: 'rect', yref: 'paper', y0: 0, y1: 1, x0: -0.1, x1: 0.1, fillcolor: t.surface2, line: { width: 0 }, layer: 'below' }],
      }),
      table: () => ({ columns: ['Covariate', "Men’s e-mail", "Women’s e-mail"],
        rows: D.balance.map((r) => [r.covariate, r.mens.toFixed(3), r.womens.toFixed(3)]) }),
    });
  }

  /* ---------- Average effects ---------- */
  function effects() {
    const state = { metric: 'visit', scale: 'abs' };

    const levels = Viz.card('card-levels', {
      build: (t) => {
        const m = METRIC[state.metric];
        const ys = ALL_ARMS.map((a) => (a === 'control' ? effect('mens', state.metric).control : effect(a, state.metric).treatment));
        return {
          data: [{
            type: 'bar', x: ALL_ARMS.map((a) => NAMES[a]), y: ys,
            marker: { color: ALL_ARMS.map((a) => armColor(t, a)), cornerradius: 2 },
            width: Viz.barWidth('chart-levels', 3, false, 24, 0.5),
            text: ys.map(m.level), textposition: 'outside', textfont: { color: t.text2, size: 12 }, constraintext: 'none', cliponaxis: false,
            customdata: ys.map(m.level), hovertemplate: '%{x}: %{customdata}<extra></extra>',
          }],
          layout: { yaxis: Object.assign({ range: [0, Math.max(...ys) * 1.22] }, m.levelAxis) },
        };
      },
      table: () => {
        const m = METRIC[state.metric];
        return { columns: ['Arm', D.meta.metrics[state.metric], 'Customers'],
          rows: ALL_ARMS.map((a) => {
            const r = effect(a === 'control' ? 'mens' : a, state.metric);
            return [NAMES[a], m.level(a === 'control' ? r.control : r.treatment), fmt.int(a === 'control' ? r.n_control : r.n_treatment)];
          }) };
      },
    });

    const effectsCard = Viz.card('card-effects', {
      build: (t) => {
        const m = METRIC[state.metric];
        const rel = state.scale === 'rel';
        const spec = {
          labels: ARMS.map((a) => NAMES[a]),
          scale: rel ? 100 : m.scale,
          axisFmt: rel ? '.0f' : m.axisFmt,
          suffix: rel ? '%' : m.suffix,
          prefix: rel ? '' : m.prefix,
          xTitle: rel ? 'Relative lift vs. no e-mail' : 'Change vs. no e-mail',
          series: ARMS.map((arm) => {
            const r = effect(arm, state.metric);
            const p = rel
              ? { label: NAMES[arm], x: r.lift, lo: r.lift_low, hi: r.lift_high,
                text: fmt.signedPct(r.lift, 0) + ' (' + fmt.signedPct(r.lift_low, 0) + ' to ' + fmt.signedPct(r.lift_high, 0) + ')' }
              : { label: NAMES[arm], x: r.diff, lo: r.ci_low, hi: r.ci_high,
                text: m.diff(r.diff) + ' (' + m.diff(r.ci_low) + ' to ' + m.diff(r.ci_high) + ')' };
            return { name: NAMES[arm], color: armColor(t, arm), points: [p] };
          }),
        };
        const out = dotWhisker(t, spec);
        // one e-mail per row, so drop the multi-series offset and the legend (the axis labels name them)
        out.data.forEach((tr, j) => { tr.y = [ARMS.length - 1 - j]; });
        out.layout.showlegend = false;
        out.layout.margin.t = 10;
        const ends = ARMS.map((a) => effect(a, state.metric)).map((r) => (rel ? [r.lift_low, r.lift_high] : [r.ci_low, r.ci_high]));
        const lo = Math.min(0, ...ends.map((e) => e[0])) * spec.scale;
        const hi = Math.max(...ends.map((e) => e[1])) * spec.scale;
        out.layout.xaxis.range = [lo * 1.1, hi * 1.12];
        return out;
      },
      table: () => {
        const m = METRIC[state.metric];
        return { columns: ['E-mail', 'Difference', '95% CI', 'Relative lift', '95% CI', 'p (Holm)'],
          rows: ARMS.map((a) => {
            const r = effect(a, state.metric);
            return [NAMES[a], m.diff(r.diff), m.diff(r.ci_low) + ' to ' + m.diff(r.ci_high), fmt.signedPct(r.lift, 0),
              fmt.signedPct(r.lift_low, 0) + ' to ' + fmt.signedPct(r.lift_high, 0), pText(r.p_holm)];
          }) };
      },
    });

    function relabel() {
      el('levels-title').textContent = D.meta.metrics[state.metric] + ' by arm';
      el('effects-title').textContent = (state.scale === 'rel' ? 'Relative lift' : 'Effect') + ' vs. no e-mail: ' + D.meta.metrics[state.metric].toLowerCase();
    }
    relabel();
    segmented('metric-control', 'metric', (v) => { state.metric = v; relabel(); levels.update(); effectsCard.update(); });
    segmented('scale-control', 'scale', (v) => { state.scale = v; relabel(); effectsCard.update(); });

    const box = el('results-table');
    Viz.renderTable(box, {
      columns: ['E-mail', 'Outcome', 'No e-mail', 'With e-mail', 'Difference (95% CI)', 'Relative lift (95% CI)', 'p (Holm)'],
      rows: D.effects.map((r) => {
        const m = METRIC[r.metric];
        return [NAMES[r.arm], D.meta.metrics[r.metric], m.level(r.control), m.level(r.treatment),
          m.diff(r.diff) + '\n' + m.diff(r.ci_low) + ' to ' + m.diff(r.ci_high), // the interval sits under its estimate
          fmt.signedPct(r.lift, 0) + '\n' + fmt.signedPct(r.lift_low, 0) + ' to ' + fmt.signedPct(r.lift_high, 0),
          pText(r.p_holm)];
      }),
    });

    const worstP = Math.max(...D.effects.map((r) => r.p_holm));
    const mv = effect('mens', 'visit'), wv = effect('womens', 'visit');
    const ms = effect('mens', 'spend'), ws = effect('womens', 'spend');
    const mc = effect('mens', 'conversion');
    insights('insights-effects', [
      ['Both e-mails work', 'All six effects are positive and significant after Holm correction (largest adjusted p = ' + worstP.toFixed(4) + ').'],
      ["The men’s e-mail wins on every outcome", 'It lifts visits by ' + fmt.pp(mv.diff, 1) + ' against ' + fmt.pp(wv.diff, 1) +
        ', and revenue by ' + signedUsd(ms.diff) + ' against ' + signedUsd(ws.diff) + ' per customer.'],
      ['Big relative lifts, small absolute numbers', 'Conversion more than doubles (' + fmt.signedPct(mc.lift, 0) + '), but only from ' +
        fmt.pct(mc.control, 2) + ' to ' + fmt.pct(mc.treatment, 2) + '. Most of the response is browsing, not buying.'],
    ]);
  }

  /* ---------- Revenue robustness ---------- */
  function robustness() {
    const METHODS = ['Welch t-test', 'Bootstrap', 'Regression-adjusted'];
    const rows = (arm) => {
      const w = effect(arm, 'spend');
      const b = D.bootstrap.find((r) => r.arm === arm);
      const a = D.adjusted.find((r) => r.arm === arm && r.metric === 'spend');
      return [
        { label: METHODS[0], x: w.diff, lo: w.ci_low, hi: w.ci_high },
        { label: METHODS[1], x: w.diff, lo: b.ci_low, hi: b.ci_high },
        { label: METHODS[2], x: a.diff, lo: a.ci_low, hi: a.ci_high },
      ].map((p) => Object.assign(p, { text: signedUsd(p.x) + ' (' + fmt.usd(p.lo) + ' to ' + fmt.usd(p.hi) + ')' }));
    };
    Viz.card('card-robust', {
      build: (t) => dotWhisker(t, {
        labels: METHODS, scale: 1, axisFmt: '.2f', prefix: '$', xTitle: 'Extra revenue per customer vs. no e-mail',
        xaxis: { rangemode: 'tozero' },
        series: ARMS.map((arm) => ({ name: NAMES[arm], color: armColor(t, arm), points: rows(arm) })),
      }),
      table: () => ({ columns: ['Method', 'E-mail', 'Estimate', '95% interval'],
        rows: ARMS.flatMap((arm) => rows(arm).map((p) => [p.label, NAMES[arm], signedUsd(p.x), fmt.usd(p.lo) + ' to ' + fmt.usd(p.hi)])) }),
    });
    Viz.renderTable(el('adjust-table'), {
      columns: ['Outcome', 'E-mail', 'Unadjusted', 'Adjusted', 'CI narrower'],
      rows: D.adjusted.map((r) => {
        const m = METRIC[r.metric];
        return [D.meta.metrics[r.metric].replace(' per customer', ''), NAMES[r.arm].replace(' e-mail', ''), m.diff(r.unadjusted_diff), m.diff(r.diff),
          fmt.pct(r.ci_width_reduction, 1)];
      }),
    });
  }

  /* ---------- Heterogeneous effects ---------- */
  function segments() {
    const select = el('segment-control');
    D.segments.dimensions.forEach((d) => {
      const o = document.createElement('option');
      o.value = d.key;
      o.textContent = d.label;
      select.appendChild(o);
    });
    const state = { dim: 'purchase_mix', metric: 'visit' };
    const rowsFor = () => D.segments.rows.filter((r) => r.dimension === state.dim && r.metric === state.metric);
    const levelsFor = () => {
      const dim = D.segments.dimensions.find((d) => d.key === state.dim);
      const present = new Set(rowsFor().map((r) => r.level));
      return dim.levels.filter((l) => present.has(l));
    };
    const chartNode = el('chart-segments');
    const height = () => Math.max(260, 110 + levelsFor().length * 62);
    const card = Viz.card('card-segments', {
      build: (t) => {
        const m = METRIC[state.metric];
        const rows = rowsFor();
        const out = dotWhisker(t, {
          labels: levelsFor(), scale: m.scale, axisFmt: m.axisFmt, suffix: m.suffix, prefix: m.prefix,
          xTitle: D.meta.metrics[state.metric] + ', change vs. no e-mail',
          series: ARMS.map((arm) => ({
            name: NAMES[arm], color: armColor(t, arm),
            points: rows.filter((r) => r.arm === arm).map((r) => ({
              label: r.level, x: r.diff, lo: r.ci_low, hi: r.ci_high,
              text: m.diff(r.diff) + ' (' + m.diff(r.ci_low) + ' to ' + m.diff(r.ci_high) + '), ' + fmt.int(r.n_treatment + r.n_control) + ' customers',
            })),
          })),
        });
        out.layout.height = height();
        return out;
      },
      table: () => {
        const m = METRIC[state.metric];
        return { columns: ['Segment', 'Share of customers', 'E-mail', 'No e-mail', 'With e-mail', 'Difference (95% CI)'],
          rows: rowsFor().map((r) => [r.level, fmt.pct(r.share, 1), NAMES[r.arm], m.level(r.control), m.level(r.treatment),
            m.diff(r.diff) + ' (' + m.diff(r.ci_low) + ' to ' + m.diff(r.ci_high) + ')']) };
      },
    });
    function redraw() {
      const dim = D.segments.dimensions.find((d) => d.key === state.dim);
      el('segments-title').textContent = D.meta.metrics[state.metric] + ' effect by ' + dim.label.toLowerCase();
      chartNode.style.height = height() + 'px';
      card.update();
    }
    select.addEventListener('change', () => { state.dim = select.value; redraw(); });
    el('segment-metric').addEventListener('change', (e) => { state.metric = e.target.value; redraw(); });
    redraw();

    const seg = (dim, level, arm) => D.segments.rows.find((r) => r.dimension === dim && r.metric === 'visit' && r.level === level && r.arm === arm);
    const wm = seg('purchase_mix', "Men’s only", 'womens'), ww = seg('purchase_mix', "Women’s only", 'womens');
    const mm = seg('purchase_mix', "Men’s only", 'mens'), mw = seg('purchase_mix', "Women’s only", 'mens'), mb = seg('purchase_mix', 'Both', 'mens');
    const visitRows = D.segments.rows.filter((r) => r.metric === 'visit' && r.arm === 'womens');
    const womensAhead = visitRows.filter((r) => r.diff > seg(r.dimension, r.level, 'mens').diff).map((r) => r.level);
    insights('insights-segments', [
      ["The women’s e-mail misses men’s buyers", 'It lifts visits by ' + fmt.pp(ww.diff, 1) + " among women’s-only buyers but just " +
        fmt.pp(wm.diff, 1) + " among men’s-only buyers."],
      ["The men’s e-mail works for everyone", "It lifts visits by " + fmt.pp(mm.diff, 1) + " for men’s-only buyers, " + fmt.pp(mw.diff, 1) +
        " for women’s-only buyers and " + fmt.pp(mb.diff, 1) + ' for customers who buy both.'],
      ['Only one segment is a tie', "Among women’s-only buyers the two e-mails do equally well (" + fmt.pp(ww.diff, 1) + ' vs. ' + fmt.pp(mw.diff, 1) +
        '). Of the other ' + (visitRows.length - womensAhead.length) + " segments, the men’s e-mail has the larger effect in every one."],
    ]);
  }

  /* ---------- Uplift models ---------- */
  function uplift() {
    const state = { campaign: 'womens', model: null };
    const C = () => D.uplift.campaigns[state.campaign];
    const modelInfo = (key) => C().models.find((m) => m.key === key);
    const select = el('uplift-model');

    function fillModels() {
      select.textContent = '';
      C().models.forEach((m) => {
        const o = document.createElement('option');
        o.value = m.key;
        o.textContent = m.name + (m.key === C().selected ? ' (selected)' : '');
        select.appendChild(o);
      });
      state.model = C().selected;
      select.value = state.model;
    }
    fillModels();

    const curveCard = Viz.card('card-curve', {
      build: (t) => {
        const c = C().curve;
        const x = [0].concat(c.fraction.map((f) => f * 100));
        const y = [0].concat(c[state.model].map((v) => v * 100));
        const total = y[y.length - 1];
        const color = armColor(t, state.campaign);
        return {
          data: [
            { type: 'scatter', mode: 'lines', name: 'Random targeting', x, y: x.map((f) => (f / 100) * total),
              line: { color: t.muted, width: 2, dash: 'dash' }, hovertemplate: 'Random: %{y:.2f}<extra></extra>' },
            { type: 'scatter', mode: 'lines', name: 'Ranked by model', x, y, line: { color, width: 2 },
              hovertemplate: 'Model: %{y:.2f}<extra></extra>' },
          ],
          layout: {
            showlegend: true, hovermode: 'x unified', margin: { t: 30 },
            xaxis: Object.assign({ title: { text: 'Share of customers e-mailed (%)' }, ticksuffix: '%', range: [0, 100] }, Viz.crosshair(t)),
            yaxis: { title: { text: 'Extra visits per 100 customers' }, rangemode: 'tozero' },
          },
        };
      },
      table: () => {
        const c = C().curve;
        const total = c[state.model][c.fraction.length - 1];
        return { columns: ['Share e-mailed', 'Extra visits / 100 (model)', 'Extra visits / 100 (random)'],
          rows: c.fraction.filter((_, i) => (i + 1) % 10 === 0).map((f) => {
            const i = c.fraction.indexOf(f);
            return [fmt.pct(f, 0), fmt.num(c[state.model][i] * 100, 2), fmt.num(total * f * 100, 2)];
          }) };
      },
    });

    const decileCard = Viz.card('card-deciles', {
      build: (t) => {
        const d = C().deciles;
        return {
          data: [
            { type: 'bar', name: 'Observed (hold-out)', x: d.map((r) => r.group), y: d.map((r) => r.observed * 100),
              marker: { color: armColor(t, state.campaign), cornerradius: 2 }, width: Viz.barWidth('chart-deciles', 10, false, 24, 0.6),
              error_y: { type: 'data', symmetric: false, array: d.map((r) => (r.ci_high - r.observed) * 100),
                arrayminus: d.map((r) => (r.observed - r.ci_low) * 100), color: t.text2, thickness: 1.2, width: 0 },
              customdata: d.map((r) => [fmt.pp(r.observed, 1), fmt.pp(r.ci_low, 1), fmt.pp(r.ci_high, 1)]),
              hovertemplate: 'Decile %{x}<br>Observed %{customdata[0]} (%{customdata[1]} to %{customdata[2]})<extra></extra>' },
            { type: 'scatter', mode: 'markers', name: 'Predicted', x: d.map((r) => r.group), y: d.map((r) => r.predicted * 100),
              marker: { color: t.text, size: 9, symbol: 'diamond', line: { color: t.surface, width: 2 } },
              hovertemplate: 'Decile %{x}<br>Predicted %{y:.1f} pp<extra></extra>' },
          ],
          layout: {
            showlegend: true, margin: { t: 30 },
            xaxis: { title: { text: 'Predicted-uplift decile (1 = highest)' }, dtick: 1 },
            yaxis: { title: { text: 'Visit-rate uplift' }, ticksuffix: ' pp', zeroline: true, zerolinecolor: t.baseline },
          },
        };
      },
      table: () => ({ columns: ['Decile', 'Predicted', 'Observed', '95% CI', 'Customers'],
        rows: C().deciles.map((r) => [r.group, fmt.pp(r.predicted, 1), fmt.pp(r.observed, 1), fmt.pp(r.ci_low, 1) + ' to ' + fmt.pp(r.ci_high, 1), fmt.int(r.n)]) }),
    });

    const modelsCard = Viz.card('card-models', {
      build: (t) => {
        const ms = C().models.slice().reverse();
        const color = armColor(t, state.campaign);
        return {
          data: [{
            type: 'bar', orientation: 'h', y: ms.map((m) => m.name), x: ms.map((m) => m.test_auuc),
            marker: { color: ms.map((m) => (m.key === C().selected ? color : t.deemph)), cornerradius: 2 },
            width: Viz.barWidth('chart-models', ms.length, true, 22, 0.6),
            error_x: { type: 'data', symmetric: false, array: ms.map((m) => m.test_high - m.test_auuc),
              arrayminus: ms.map((m) => m.test_auuc - m.test_low), color: t.text2, thickness: 1.2, width: 0 },
            customdata: ms.map((m) => [m.test_low.toFixed(2), m.test_high.toFixed(2), m.cv_auuc.toFixed(3), m.key === C().selected ? ', selected by cross-validation' : '']),
            hovertemplate: '<b>%{y}</b>%{customdata[3]}<br>Hold-out AUUC gain %{x:.3f} (%{customdata[0]} to %{customdata[1]})<br>Cross-validated %{customdata[2]}<extra></extra>',
          }],
          layout: {
            margin: { l: 8, r: 18, t: 6, b: 8 },
            xaxis: { title: { text: 'AUUC gain (hold-out)' }, showgrid: true, zeroline: true, zerolinecolor: t.baseline, tickformat: '.2f' },
            yaxis: { showgrid: false, tickfont: { color: t.text2, size: 12 } },
          },
        };
      },
      table: () => ({ columns: ['Model', 'CV AUUC', 'Hold-out AUUC', '95% interval', 'Top 30% captures'],
        rows: C().models.map((m) => [m.name + (m.key === C().selected ? ' (selected)' : ''), m.cv_auuc.toFixed(3), m.test_auuc.toFixed(3),
          m.test_low.toFixed(3) + ' to ' + m.test_high.toFixed(3), fmt.pct(m.capture_30, 0)]) }),
    });

    function profile() {
      const fmtTrait = (name, v) => (name.indexOf('$') >= 0 ? fmt.usd(v, 0) : name.indexOf('Months') === 0 ? fmt.num(v, 1) : fmt.pct(v, 0));
      Viz.renderTable(el('profile-table'), {
        columns: ['Trait', 'Top 30%', 'Bottom 30%', 'All customers'],
        rows: C().profile.map((r) => [r.trait, fmtTrait(r.trait, r.top), fmtTrait(r.trait, r.bottom), fmtTrait(r.trait, r.all)]),
      });
      const sel = modelInfo(C().selected);
      const womensTrait = C().profile.find((r) => r.trait.indexOf("women’s") >= 0);
      el('profile-note').textContent = sel.test_low > 0
        ? "The model’s ranking is mostly about past purchases: " + fmt.pct(womensTrait.top, 0) + " of its top 30% bought women’s items, against " +
          fmt.pct(womensTrait.bottom, 0) + ' of its bottom 30%.'
        : "This e-mail lifts visits across the board, so there is little to rank on: the hold-out AUUC interval includes zero and targeting is close to random.";
    }
    profile();

    function refresh() {
      curveCard.update();
      decileCard.update();
      modelsCard.update();
      profile();
    }
    segmented('campaign-control', 'campaign', (v) => { state.campaign = v; fillModels(); refresh(); });
    select.addEventListener('change', () => { state.model = select.value; curveCard.update(); });
  }

  /* ---------- Targeting simulator ---------- */
  function simulator() {
    const campaign = el('sim-campaign');
    const value = el('sim-value');
    const cost = el('sim-cost');
    const share = el('sim-share');
    const defaults = () => Math.round(D.uplift.campaigns[campaign.value].value_per_visit * 2) / 2;
    value.value = defaults();
    cost.value = 0.1;
    share.value = 30;

    function curves() {
      const S = D.uplift.campaigns[campaign.value].simulator;
      const V = Number(value.value);
      const cst = Number(cost.value);
      const frac = [0].concat(S.fraction);
      const inc = [0].concat(S.fraction.map((f, i) => (S.visit_t[i] / S.n_t[i] - S.visit_c[i] / S.n_c[i]) * f * 1000));
      const ate = inc[inc.length - 1];
      const incRandom = frac.map((f) => ate * f);
      const net = inc.map((v, i) => v * V - frac[i] * 1000 * cst);
      const netRandom = incRandom.map((v, i) => v * V - frac[i] * 1000 * cst);
      let best = 0;
      net.forEach((v, i) => { if (v > net[best]) best = i; });
      return { frac, inc, incRandom, net, netRandom, best, V, cst };
    }

    const card = Viz.card('card-sim', {
      build: (t) => {
        const c = curves();
        const x = c.frac.map((f) => f * 100);
        const chosen = Number(share.value);
        const color = armColor(t, campaign.value);
        return {
          data: [
            { type: 'scatter', mode: 'lines', name: 'Random customers', x, y: c.netRandom, line: { color: t.muted, width: 2, dash: 'dash' },
              hovertemplate: 'Random: %{y:$,.0f}<extra></extra>' },
            { type: 'scatter', mode: 'lines', name: 'Ranked by model', x, y: c.net, line: { color, width: 2 },
              hovertemplate: 'Model: %{y:$,.0f}<extra></extra>' },
            { type: 'scatter', mode: 'markers', name: 'Best share', x: [x[c.best]], y: [c.net[c.best]], showlegend: false,
              marker: { color, size: 11, line: { color: t.surface, width: 2 } }, hoverinfo: 'skip' },
          ],
          layout: {
            showlegend: true, hovermode: 'x unified', margin: { t: 30 },
            xaxis: Object.assign({ title: { text: 'Share of customers e-mailed (%)' }, ticksuffix: '%', range: [0, 100] }, Viz.crosshair(t)),
            yaxis: { title: { text: 'Net value per 1,000 customers' }, tickprefix: '$', tickformat: ',.0f', zeroline: true, zerolinecolor: t.baseline },
            shapes: [{ type: 'line', yref: 'paper', y0: 0, y1: 1, x0: chosen, x1: chosen, line: { color: t.person, width: 1.5, dash: 'dot' } }],
            annotations: [{ x: chosen, yref: 'paper', y: 0.02, yanchor: 'bottom', xanchor: 'left', xshift: 4, text: 'Your share', showarrow: false,
              font: { color: t.muted, size: 11 } }],
          },
        };
      },
      table: () => {
        const c = curves();
        return { columns: ['Share e-mailed', 'E-mails / 1,000', 'Extra visits (model)', 'Extra visits (random)', 'Net value (model)', 'Net value (random)'],
          rows: c.frac.slice(1).map((f, j) => {
            const i = j + 1;
            return [fmt.pct(f, 0), fmt.int(f * 1000), fmt.num(c.inc[i], 1), fmt.num(c.incRandom[i], 1), fmt.usd(c.net[i], 0), fmt.usd(c.netRandom[i], 0)];
          }) };
      },
    });

    function readout() {
      const c = curves();
      const k = c.frac.findIndex((f) => Math.abs(f * 100 - Number(share.value)) < 0.5);
      el('out-value').textContent = fmt.usd(c.V);
      el('out-cost').textContent = fmt.usd(c.cst);
      el('out-share').textContent = share.value + '%';
      el('sim-sub').textContent = (campaign.value === 'mens' ? "Men’s" : "Women’s") + ' e-mail, ' + share.value + '% of customers ranked by predicted uplift';
      const box = el('sim-readout');
      box.textContent = '';
      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = fmt.usd(c.net[k], 0);
      const lines = [
        'net value per 1,000 customers (' + fmt.int(c.frac[k] * 1000) + ' e-mails).',
        'Extra visits: ' + fmt.num(c.inc[k], 1) + ' with the model, ' + fmt.num(c.incRandom[k], 1) + ' with random customers' +
          (c.incRandom[k] > 0 ? ' (' + fmt.signedPct(c.inc[k] / c.incRandom[k] - 1, 0) + ').' : '.'),
        c.best === 0
          ? 'At this cost no share pays: the best choice is not to send.'
          : 'Best share for these economics: ' + fmt.pct(c.frac[c.best], 0) + ' (' + fmt.usd(c.net[c.best], 0) + '). E-mailing everyone: ' +
            fmt.usd(c.net[c.net.length - 1], 0) + '.',
      ];
      box.appendChild(big);
      lines.forEach((l) => { const p = document.createElement('p'); p.textContent = l; box.appendChild(p); });
    }

    function update() { readout(); card.update(); }
    campaign.addEventListener('change', () => { value.value = defaults(); update(); });
    [value, cost, share].forEach((n) => n.addEventListener('input', update));
    readout();
  }

  /* ---------- Policies ---------- */
  function policies() {
    const P = D.policies;
    const state = { outcome: 'visit' };
    const LABEL = { visit: 'Visits', conversion: 'Orders', spend: 'Revenue' };
    const val = (r, suffix) => r[state.outcome + suffix];
    const show = (v) => (state.outcome === 'spend' ? fmt.usd(v, 0) : fmt.num(v, 1));
    const card = Viz.card('card-policy', {
      build: (t) => {
        const rows = P.rows.slice().reverse();
        return {
          data: [{
            type: 'bar', orientation: 'h', y: rows.map((r) => r.policy), x: rows.map((r) => val(r, '_per_1000')),
            marker: { color: rows.map((r) => (r.policy === P.baseline ? t.series[0] : t.deemph)), cornerradius: 2 },
            width: Viz.barWidth('chart-policy', rows.length, true, 22, 0.6),
            error_x: { type: 'data', symmetric: false, array: rows.map((r) => val(r, '_high') - val(r, '_per_1000')),
              arrayminus: rows.map((r) => val(r, '_per_1000') - val(r, '_low')), color: t.text2, thickness: 1.2, width: 0 },
            customdata: rows.map((r) => [show(val(r, '_low')), show(val(r, '_high')), fmt.int(r.emails_per_1000)]),
            hovertemplate: '<b>%{y}</b><br>' + LABEL[state.outcome] + ' per 1,000: %{x:,.1f} (%{customdata[0]} to %{customdata[1]})<br>E-mails per 1,000: %{customdata[2]}<extra></extra>',
          }],
          layout: {
            margin: { l: 8, r: 18, t: 6, b: 8 },
            xaxis: { title: { text: LABEL[state.outcome] + ' per 1,000 customers' }, showgrid: true, rangemode: 'tozero',
              tickprefix: state.outcome === 'spend' ? '$' : '', tickformat: ',.0f' },
            yaxis: { showgrid: false, tickfont: { color: t.text2, size: 12 } },
          },
        };
      },
      table: () => ({ columns: ['Policy', 'E-mails / 1,000', 'Visits', 'Orders', 'Revenue', 'Visits vs. ' + P.baseline.toLowerCase() + ' (95% CI)'],
        rows: P.rows.map((r) => [r.policy, fmt.int(r.emails_per_1000), fmt.num(r.visit_per_1000, 1), fmt.num(r.conversion_per_1000, 1),
          fmt.usd(r.spend_per_1000, 0), r.policy === P.baseline ? 'baseline'
            : signedNum(r.visit_vs_baseline) + ' (' + signedNum(r.visit_vs_low) + ' to ' + signedNum(r.visit_vs_high) + ')']) }),
    });
    segmented('policy-control', 'outcome', (v) => {
      state.outcome = v;
      el('policy-title').textContent = LABEL[v] + ' per 1,000 customers';
      card.update();
    });

    const find = (name) => P.rows.find((r) => r.policy === name);
    const none = find('No e-mail'), mensAll = find(P.baseline);
    const best = find('Best e-mail for each customer'), half = find('Best e-mail, top half by predicted uplift');
    const keep = (half.visit_per_1000 - none.visit_per_1000) / (mensAll.visit_per_1000 - none.visit_per_1000);
    insights('insights-policy', [
      ["Send the men’s e-mail", 'It produces the most visits (' + fmt.num(mensAll.visit_per_1000, 0) + ' per 1,000 customers vs. ' +
        fmt.num(none.visit_per_1000, 0) + ' with no e-mail) and the most revenue of any policy.'],
      ["Personalising doesn’t help here", 'Choosing the better e-mail per customer changes visits by ' + signedNum(best.visit_vs_baseline) +
        ' per 1,000 (95% CI ' + signedNum(best.visit_vs_low) + ' to ' + signedNum(best.visit_vs_high) + "). The women’s e-mail is never clearly better for any segment."],
      ['Targeting saves sends, not visits', 'E-mailing only the top half by predicted uplift keeps ' + fmt.pct(keep, 0) +
        ' of the extra visits with 50% of the e-mails. Worth it only when sends are expensive.'],
    ]);
  }

  /* ---------- Power ---------- */
  function qnorm(p) {
    // Acklam's rational approximation to the inverse normal CDF (relative error < 1.2e-9)
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (p < lo || p > 1 - lo) {
      const q = Math.sqrt(-2 * Math.log(p < lo ? p : 1 - p));
      const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      return p < lo ? x : -x;
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function power() {
    const P = D.power;
    const metric = el('pw-metric'), base = el('pw-base'), lift = el('pw-lift'), alpha = el('pw-alpha'), pow = el('pw-power');
    const DEFAULT_LIFT = { visit: 1, conversion: 0.25 };
    const setDefaults = () => {
      base.value = (P.baseline[metric.value] * 100).toFixed(metric.value === 'conversion' ? 3 : 2);
      lift.value = DEFAULT_LIFT[metric.value];
    };
    setDefaults();
    const zsum = () => qnorm(1 - Number(alpha.value) / 2) + qnorm(Number(pow.value));
    const nFor = (p, delta) => Math.ceil((zsum() ** 2) * (p * (1 - p) + (p + delta) * (1 - p - delta)) / (delta * delta));
    const inputs = () => ({ p: Number(base.value) / 100, delta: Number(lift.value) / 100 });
    const valid = ({ p, delta }) => p > 0 && p < 1 && delta > 0 && p + delta < 1;

    el('power-lede').textContent = 'This test had ' + fmt.int(P.n_per_arm) + ' customers per arm: enough to detect a ' + fmt.pp(P.mde.visit, 2) +
      ' change in visit rate or ' + fmt.pp(P.mde.conversion, 2) + ' in conversion with 80% power at the 5% level. Size a follow-up test below.';

    const card = Viz.card('card-power', {
      build: (t) => {
        const { p, delta } = inputs();
        if (!valid({ p, delta })) return { data: [], layout: {} };
        const maxLift = Math.max(delta * 2.5, metric.value === 'visit' ? 3 : 0.6) / 100;
        const xs = Array.from({ length: 60 }, (_, i) => maxLift * (0.08 + (0.92 * i) / 59));
        const ns = xs.map((v) => nFor(p, v));
        const lo = Math.min(...ns, P.n_per_arm), hi = Math.max(...ns, P.n_per_arm);
        const ticks = [];
        for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e += 1) {
          [1, 2, 5].forEach((m) => { const v = m * 10 ** e; if (v >= lo / 1.5 && v <= hi * 1.5) ticks.push(v); });
        }
        return {
          data: [
            { type: 'scatter', mode: 'lines', name: 'Customers per arm', x: xs.map((v) => v * 100), y: xs.map((v) => nFor(p, v)),
              line: { color: t.series[0], width: 2 }, hovertemplate: '+%{x:.2f} pp: %{y:,} per arm<extra></extra>' },
            { type: 'scatter', mode: 'markers', name: 'Your lift', x: [delta * 100], y: [nFor(p, delta)], showlegend: false,
              marker: { color: t.person, size: 11, line: { color: t.surface, width: 2 } }, hovertemplate: 'Your lift: %{y:,} per arm<extra></extra>' },
          ],
          layout: {
            xaxis: { title: { text: 'Lift to detect (percentage points)' }, ticksuffix: ' pp', showgrid: false },
            yaxis: { type: 'log', title: { text: 'Customers per arm (log scale)' }, tickvals: ticks, ticktext: ticks.map((v) => fmt.compact(v, 0)) },
            shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: P.n_per_arm, y1: P.n_per_arm, line: { color: t.text2, width: 1, dash: 'dot' } }],
            annotations: [{ xref: 'paper', x: 1, y: Math.log10(P.n_per_arm), yanchor: 'bottom', xanchor: 'right', text: 'This test', showarrow: false,
              font: { color: t.muted, size: 11 } }],
          },
        };
      },
      table: () => {
        const { p } = inputs();
        const lifts = metric.value === 'visit' ? [0.25, 0.5, 1, 1.5, 2, 3] : [0.05, 0.1, 0.2, 0.3, 0.5];
        return { columns: ['Lift to detect', 'Customers per arm', 'Two-arm total'],
          rows: lifts.map((l) => [fmt.pp(l / 100, 2), fmt.int(nFor(p, l / 100)), fmt.int(2 * nFor(p, l / 100))]) };
      },
    });

    function readout() {
      const box = el('pw-readout');
      box.textContent = '';
      const inp = inputs();
      if (!valid(inp)) { box.textContent = 'Enter a baseline rate and a lift that keep both rates between 0% and 100%.'; return; }
      const n = nFor(inp.p, inp.delta);
      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = fmt.int(n);
      const mde = zsum() * Math.sqrt((2 * inp.p * (1 - inp.p)) / P.n_per_arm);
      box.appendChild(big);
      [
        'customers per arm to detect ' + fmt.pct(inp.p, 2) + ' to ' + fmt.pct(inp.p + inp.delta, 2) + ' (' + fmt.signedPct(inp.delta / inp.p, 0) + ' relative).',
        'A two-arm test needs ' + fmt.int(2 * n) + ' customers; the three-arm design used here needs ' + fmt.int(3 * n) + '.',
        'With ' + fmt.int(P.n_per_arm) + ' per arm, the smallest detectable lift at these settings is ' + fmt.pp(mde, 2) + '.',
      ].forEach((l) => { const p = document.createElement('p'); p.textContent = l; box.appendChild(p); });
    }

    metric.addEventListener('change', () => { setDefaults(); readout(); card.update(); });
    [base, lift, alpha, pow].forEach((n) => n.addEventListener('input', () => { readout(); card.update(); }));
    readout();
  }

  async function main() {
    Viz.initTheme(el('theme-toggle'));
    contents();
    try {
      D = curly(await Viz.loadJSON('data/dashboard.json'));
    } catch (err) {
      el('meta-size').textContent = 'Could not load the data: ' + err.message;
      return;
    }
    NAMES = D.meta.arm_names;
    hero();
    health();
    effects();
    robustness();
    segments();
    uplift();
    simulator();
    policies();
    power();
  }

  main();
})();
