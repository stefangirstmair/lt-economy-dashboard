// app.js — renders the dashboard from data/catalogue.json and data/series/*.json.
// Uses the global `Plot` and `d3` loaded from /vendor (Observable Plot 0.6.16, d3 7.9.0).

import { TILES, SECTIONS, GEO_SLOT, VIEW_SHORT, RANGES } from "./layout.js";

const Plot = window.Plot, d3 = window.d3;
const state = { range: load("range", "10y"), catalogue: null, byId: new Map(), cache: new Map(), charts: [] };

// ── small utilities ───────────────────────────────────────────────────────────
function load(k, dflt) { try { return localStorage.getItem("ltd." + k) ?? dflt; } catch { return dflt; } }
function save(k, v) { try { localStorage.setItem("ltd." + k, v); } catch { /* private mode */ } }
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const utc = (s) => new Date(s + "T00:00:00Z");
const FREQ_NAME = { M: "Monthly", Q: "Quarterly", A: "Annual" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(date, freq) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth();
  if (freq === "Q") return `${y} Q${Math.floor(m / 3) + 1}`;
  if (freq === "M") return `${MONTHS[m]} ${y}`;
  return String(y);
}
const isRateUnit = (u) => u === "%" || u === "pp" || u.startsWith("%");
function fmt(v, unit) {
  if (v == null || !isFinite(v)) return "–";
  if (isRateUnit(unit)) return d3.format(".1f")(v);
  const a = Math.abs(v);
  if (a >= 1000) return d3.format(",.0f")(v);
  if (a >= 100) return d3.format(",.1f")(v);
  if (a >= 10) return d3.format(".1f")(v);
  return d3.format(".2f")(v);
}
const unitSuffix = (unit) => (unit.startsWith("%") ? "%" : unit === "pp" || unit.startsWith("pp ") ? " pp" : "");
function slotColor(slot) {
  if (slot === "other") return css("--series-other");
  if (slot === "faint") return css("--scatter-old");
  return css(`--series-${slot}`);
}

// ── data ──────────────────────────────────────────────────────────────────────
async function getSeries(id) {
  if (!state.cache.has(id)) {
    state.cache.set(id, fetch(`data/series/${encodeURIComponent(id)}.json`).then((r) => {
      if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
      return r.json();
    }).then((j) => ({ ...j, dates: j.dates.map(utc) })));
  }
  return state.cache.get(id);
}
const meta = (id) => state.byId.get(id);
const shortView = (v, freq) => (VIEW_SHORT[v] ?? v).replace("{p}", freq === "M" ? "month" : freq === "Q" ? "qtr" : "yr");

// Small label with the data frequency of the given series ("Monthly", "Quarterly", or both if mixed).
function freqTag(ids) {
  const fs = [...new Set(ids.map((id) => meta(id)?.freq).filter(Boolean))];
  return el("span", { class: "freq", title: "Frequency of the data" }, fs.map((f) => FREQ_NAME[f] ?? f).join(" / "));
}
const titleRow = (title, ids) => el("div", { class: "title-row" }, el("h3", {}, title), freqTag(ids));
const viewMeta = (id, view) => meta(id)?.views.find((v) => v.id === view);

function cutoff(maxDate, rangeId, maxYears) {
  const r = RANGES.find((x) => x.id === rangeId);
  let years = r?.years ?? null;
  if (maxYears) years = years == null ? maxYears : Math.min(years, maxYears);
  if (years == null) return new Date(0);
  const d = new Date(maxDate);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

// ── header, nav, range ───────────────────────────────────────────────────────
function renderChrome() {
  const generated = new Date(state.catalogue.generated);
  document.getElementById("updated").textContent =
    `Data updated ${generated.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;

  const nav = document.getElementById("nav-links");
  const links = [["overview", "Overview"], ...SECTIONS.map((s) => [s.id, s.title]), ["data", "Data status"]];
  nav.replaceChildren(...links.map(([id, t]) => el("li", {}, el("a", { href: `#${id}` }, t))));

  const rc = document.getElementById("range");
  const group = el("div", { class: "segmented", role: "group", "aria-label": "Time range" },
    RANGES.map((r) => el("button", {
      type: "button", "aria-pressed": String(r.id === state.range),
      onclick: () => { state.range = r.id; save("range", r.id); renderChrome(); rerenderAll(); },
    }, r.label)));
  rc.replaceChildren(el("span", {}, "Period"), group);

  // highlight the section in view
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      nav.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${e.target.id}`));
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  document.querySelectorAll("section.block").forEach((s) => obs.observe(s));
}

// ── overview ─────────────────────────────────────────────────────────────────
async function renderOverview(root) {
  const sec = el("section", { class: "block", id: "overview" },
    el("h2", {}, "Overview"),
    el("p", { class: "intro" }, "The latest readings for Lithuania. Changes are against the previous period."));
  const tiles = el("div", { class: "tiles" });
  sec.append(tiles);
  for (const t of TILES) {
    const m = meta(t.id);
    if (!m) continue;
    const vm = viewMeta(t.id, t.view), L = m.latest[t.view];
    const tile = el("div", { class: "tile" },
      el("div", { class: "label" }, t.label),
      el("div", { class: "value-row" },
        el("div", { class: "value" }, fmt(L?.value, vm.unit), el("small", {}, unitSuffix(vm.unit) || "")),
        freqTag([t.id])),
      el("div", { class: "meta" },
        `${VIEW_SHORT[t.view] === "Level" ? "" : shortView(t.view, m.freq) + " · "}${periodLabel(utc(L.date), m.freq)}`,
        L?.change != null ? ` · ${L.change >= 0 ? "▲" : "▼"} ${fmt(Math.abs(L.change), "pp")} pp` : ""),
      el("div", { class: "spark" }));
    tiles.append(tile);
    state.charts.push({ node: tile.querySelector(".spark"), draw: (n) => drawSpark(n, t) });
  }

  // latest releases + data status
  const recent = [...state.catalogue.series]
    .filter((s) => s.geo === "LT" && s.group !== "gdp_contrib")
    .sort((a, b) => (b.dataset_updated ?? "").localeCompare(a.dataset_updated ?? "") || b.last_date.localeCompare(a.last_date))
    .slice(0, 10);
  const rel = el("ul", { class: "releases" }, recent.map((s) => {
    const vm = viewMeta(s.id, s.default_view), L = s.latest[s.default_view];
    return el("li", {},
      el("span", {}, s.title),
      el("span", { class: "when" }, s.last_period),
      el("span", { class: "val" }, `${fmt(L?.value, vm.unit)}${unitSuffix(vm.unit)}`));
  }));
  sec.append(el("div", { class: "two-col" },
    el("div", { class: "card" }, el("h3", {}, "Recently updated"),
      el("p", { class: "subtitle" }, "Lithuanian series, by the source's last update"), rel),
    el("div", { class: "card", id: "status-card" }, el("h3", {}, "Data status"),
      el("p", { class: "subtitle" }, `${state.catalogue.series.length} series · built ${state.catalogue.today}`),
      statusList())));
  root.append(sec);
}

function statusList() {
  const w = state.catalogue.warnings, e = state.catalogue.errors;
  if (!w.length && !e.length) return el("p", {}, "All series are current.");
  return el("ul", { class: "status" },
    e.map((x) => el("li", { class: "error" }, `${x.id}: failed to update`)),
    w.map((x) => el("li", {}, `${meta(x.id)?.title ?? x.id} (${meta(x.id)?.geo_name ?? ""}): ${x.message}`)));
}

async function drawSpark(node, t) {
  const s = await getSeries(t.id);
  const vals = s.views[t.view];
  const cut = cutoff(s.dates.at(-1), "5y");
  const data = s.dates.map((d, i) => ({ d, v: vals[i] })).filter((r) => r.d >= cut && r.v != null);
  const brand = css("--brand");
  node.replaceChildren(Plot.plot({
    width: node.clientWidth || 160, height: 36, margin: 3, axis: null,
    style: { background: "transparent", overflow: "visible" },
    marks: [Plot.lineY(data, { x: "d", y: "v", stroke: brand, strokeWidth: 1.5 }),
            Plot.dot(data.slice(-1), { x: "d", y: "v", r: 2.5, fill: brand })],
  }));
}

// ── sections ─────────────────────────────────────────────────────────────────
function renderSections(root) {
  for (const sec of SECTIONS) {
    const s = el("section", { class: "block", id: sec.id },
      el("h2", {}, sec.title), el("p", { class: "intro" }, sec.intro));
    const grid = el("div", { class: "grid" });
    for (const c of sec.charts) {
      if (c.type === "subhead") {
        grid.append(el("div", { class: "subhead" },
          el("h3", {}, c.title, c.tag ? el("span", { class: "tag" }, c.tag) : null),
          c.intro ? el("p", {}, c.intro) : null));
        continue;
      }
      const card = buildCard(c);
      if (card) grid.append(card);
    }
    s.append(grid);
    root.append(s);
  }
}

// Resolve a chart spec into the list of series it shows.
function chartSeries(c) {
  if (c.type === "lines" && c.concept) {
    return state.catalogue.series.filter((s) => s.concept === c.concept)
      .sort((a, b) => (GEO_SLOT[a.geo] ?? 9) - (GEO_SLOT[b.geo] ?? 9))
      .map((s) => ({ id: s.id, label: s.geo_name, slot: GEO_SLOT[s.geo] ?? "other", primary: s.geo === "LT" }));
  }
  if (c.type === "lines") {
    let k = 0;
    return c.series.filter((s) => meta(s.id)).map((s) => ({
      ...s, slot: s.headline ? "headline" : (++k <= 4 ? k : "other"), primary: s.headline || k === 1,
    }));
  }
  return [];
}

function buildCard(c) {
  const card = el("article", { class: c.wide ? "card wide" : "card" });
  if (c.type === "sdtable") return buildSdTable(card, c);
  if (c.type === "cytable") return buildCyTable(card, c);
  const st = { view: null, hidden: new Set(), table: false };

  if (c.type === "lines") {
    const series = chartSeries(c);
    if (!series.length) return null;
    const common = series.map((s) => meta(s.id).views.map((v) => v.id))
      .reduce((a, b) => a.filter((v) => b.includes(v)));
    st.view = c.view && common.includes(c.view) ? c.view
      : common.includes(meta(series[0].id).default_view) ? meta(series[0].id).default_view : common[0];
    const viewBtns = common.length > 1 ? el("div", { class: "segmented", role: "group", "aria-label": "Transformation" },
      common.map((v) => el("button", {
        type: "button", "aria-pressed": String(v === st.view), "data-view": v,
        onclick: (ev) => { st.view = v; ev.currentTarget.parentNode.querySelectorAll("button")
          .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v))); draw(); },
      }, shortView(v, meta(series[0].id).freq)))) : null;
    const legend = el("div", { class: "legend" });
    const sub = el("p", { class: "subtitle" });
    const chart = el("div", { class: "chart", role: "img" });
    const foot = el("div", { class: "foot" });
    card.append(el("div", { class: "card-head" }, titleRow(c.title, series.map((s) => s.id)),
        el("div", { class: "controls" }, viewBtns, c.info ? infoButton(c.info) : null)),
      sub, legend, chart, foot);

    const draw = async () => {
      const vm = viewMeta(series[0].id, st.view);
      sub.textContent = c.subtitle ?? (vm.label === "Level" ? meta(series[0].id).unit : `${vm.label}${vm.unit === "%" ? "" : ", " + vm.unit}`);
      legend.replaceChildren(...(series.length > 1 ? series.map((s) => el("button", {
        type: "button", "aria-pressed": String(!st.hidden.has(s.id)),
        onclick: () => { st.hidden.has(s.id) ? st.hidden.delete(s.id) : st.hidden.add(s.id); draw(); },
      }, el("span", { class: "swatch", style: `background:${colorOf(s)}` }), s.label)) : []));
      const data = await Promise.all(series.map((s) => getSeries(s.id)));
      const shown = series.map((s, i) => ({ ...s, data: data[i] })).filter((s) => !st.hidden.has(s.id));
      if (st.table) renderTable(chart, shown, st.view, vm.unit, c);
      else drawLines(chart, shown, st.view, vm.unit);
      renderFoot(foot, series, st, c, () => draw(), shown, vm.unit);
    };
    state.charts.push({ node: chart, draw: () => draw() });
    return card;
  }

  if (c.type === "contrib") {
    // A contribution chart may offer variants (e.g. headline vs core); each variant
    // overrides bars / total / subtitle of the base spec.
    st.vi = 0;
    const cur = () => (c.variants ? { ...c, ...c.variants[st.vi] } : c);
    if (!meta(cur().total.id)) return null;
    const chart = el("div", { class: "chart", role: "img" });
    const legend = el("div", { class: "legend" });
    const sub = el("p", { class: "subtitle" });
    const foot = el("div", { class: "foot" });
    const variantBtns = c.variants ? el("div", { class: "segmented", role: "group", "aria-label": "Inflation measure" },
      c.variants.map((v, i) => el("button", {
        type: "button", "aria-pressed": String(i === st.vi), "data-i": i, title: v.hint ?? null,
        onclick: (ev) => {
          st.vi = i;
          ev.currentTarget.parentNode.querySelectorAll("button")
            .forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
          draw();
        },
      }, v.label))) : null;
    const allIds = (c.variants ?? [c]).flatMap((v) => [v.total.id, ...v.bars.map((b) => b.id)]);
    card.append(el("div", { class: "card-head" }, titleRow(c.title, allIds),
        el("div", { class: "controls" }, variantBtns, c.info ? infoButton(c.info) : null)),
      sub, legend, chart, foot);
    const draw = async () => {
      const v = cur();
      sub.textContent = v.subtitle;
      const monthly = meta(v.bars[0].id)?.freq === "M";
      legend.replaceChildren(
        ...v.bars.map((b) => el("span", { class: "legend-item" },
          el("span", { class: "swatch box", style: `background:${slotColor(b.slot)}` }), " ", b.label)),
        el("span", {}, el("span", { class: "swatch box",
          style: `background:${css("--text")};${monthly ? "height:3px;width:14px;border-radius:2px" : "border-radius:50%"}` }), " ", v.total.label));
      const bars = await Promise.all(v.bars.map((b) => getSeries(b.id)));
      const total = await getSeries(v.total.id);
      if (st.table) {
        const rows = [{ ...v.total, slot: "headline", data: total }, ...v.bars.map((b, i) => ({ ...b, data: bars[i] }))];
        renderTable(chart, rows, "level", "pp", v);  // rows carry their own view (total may be y/y)
      } else drawContrib(chart, v, bars, total);
      renderFoot(foot, [...v.bars, v.total], st, v, () => draw(),
        [{ ...v.total, data: total }, ...v.bars.map((b, i) => ({ ...b, data: bars[i] }))], "pp");
    };
    state.charts.push({ node: chart, draw: () => draw() });
    return card;
  }

  if (c.type === "scatter") {
    if (!meta(c.x.id) || !meta(c.y.id)) return null;
    const chart = el("div", { class: "chart", role: "img" });
    const foot = el("div", { class: "foot" });
    card.append(el("div", { class: "card-head" }, titleRow(c.title, [c.x.id, c.y.id])),
      el("p", { class: "subtitle" }, c.subtitle), chart, foot);
    const draw = async () => {
      const [xs, ys] = await Promise.all([getSeries(c.x.id), getSeries(c.y.id)]);
      drawScatter(chart, c, xs, ys);
      renderFoot(foot, [c.x, c.y], st, c, null, null, null);
    };
    state.charts.push({ node: chart, draw: () => draw() });
    return card;
  }
  return null;
}

function colorOf(s) { return s.slot === "headline" ? css("--text") : slotColor(s.slot); }

function renderFoot(foot, series, st, c, redraw, shown, unit) {
  const metas = series.map((s) => meta(s.id)).filter(Boolean);
  const sources = [...new Set(metas.map((m) => `${m.source_name}${m.source === "derived" ? "" : ` (${m.source_ref})`}`))];
  // contribution charts: "latest" refers to the bars, not the (often longer) total
  const latestPool = c.type === "contrib" ? metas.filter((m) => c.bars.some((b) => b.id === m.id)) : metas;
  const latest = latestPool.reduce((a, m) => (m.last_date > a.last_date ? m : a), latestPool[0]);
  const warnings = state.catalogue.warnings.filter((w) => metas.some((m) => m.id === w.id));
  const notes = [...new Set(metas.map((m) => m.notes).filter(Boolean))];
  const left = el("div", {},
    el("div", {}, `Source: ${sources.join("; ")}. Latest: ${latest.last_period}.`),
    notes.length ? el("div", { class: "notes" }, notes[0]) : null);
  const right = el("div", {},
    warnings.length ? el("span", { class: "badge", title: warnings.map((w) => `${meta(w.id).geo_name}: ${w.message}`).join("\n") }, "Delayed data") : null,
    redraw ? el("button", { class: "linkbtn", type: "button", onclick: () => { st.table = !st.table; redraw(); } },
      st.table ? "Chart" : "Table") : null,
    shown ? el("button", { class: "linkbtn", type: "button", onclick: () => downloadCsv(c, shown, st.view ?? "level", unit) }, "CSV") : null);
  foot.replaceChildren(left, right);
}

// ── charts ───────────────────────────────────────────────────────────────────
function baseStyle() {
  return { background: "transparent", color: css("--text-2"), fontFamily: css("--font-body"), fontSize: "12px", overflow: "visible" };
}

function rowsFor(s, view, cut) {
  const vals = s.data.views[view] ?? [];
  return s.data.dates.map((d, i) => ({ date: d, value: vals[i], key: s.id }))
    .filter((r) => r.date >= cut);
}

function drawLines(node, shown, view, unit) {
  const width = node.clientWidth || 560, height = 280;
  if (!shown.length) { node.replaceChildren(el("p", { class: "loading" }, "All series hidden")); return; }
  const maxDate = d3.max(shown, (s) => s.data.dates.at(-1));
  const cut = cutoff(maxDate, state.range);
  const per = shown.map((s) => ({ ...s, rows: rowsFor(s, view, cut) }));
  const all = per.flatMap((s) => s.rows.filter((r) => r.value != null));
  if (!all.length) { node.replaceChildren(el("p", { class: "loading" }, "No data in this period")); return; }
  const [ymin, ymax] = d3.extent(all, (r) => r.value);
  const freq = meta(shown[0].id).freq;

  // direct labels at line ends, nudged apart so they do not overlap
  const [d0, d1] = d3.scaleLinear().domain([ymin, ymax]).nice().domain();
  const plotH = height - 26 - 10, span = (d1 - d0) || 1, gap = (16 / plotH) * span;
  const ends = per.map((s) => { const r = s.rows.filter((x) => x.value != null).at(-1); return r && { ...r, s }; })
    .filter(Boolean).sort((a, b) => b.value - a.value);
  for (let i = 1; i < ends.length; i++) ends[i].ly = Math.min(ends[i].value, (ends[i - 1].ly ?? ends[i - 1].value) - gap);
  ends.forEach((e) => { e.ly ??= e.value; });

  // one row per date for the hover tooltip (all series at once)
  const byDate = d3.group(all, (r) => +r.date);
  const wide = [...byDate].map(([t, rs]) => ({ date: new Date(t), rs, top: d3.max(rs, (r) => r.value) }))
    .sort((a, b) => a.date - b.date);
  const labelOf = new Map(per.map((s) => [s.id, s.label]));
  const tipText = (d) => [periodLabel(d.date, freq),
    ...per.filter((s) => d.rs.some((r) => r.key === s.id))
      .map((s) => `${s.label}: ${fmt(d.rs.find((r) => r.key === s.id).value, unit)}${unitSuffix(unit)}`)].join("\n");
  const labelW = shown.length > 1 ? Math.min(120, 8 + 7 * d3.max(shown, (s) => s.label.length)) : 50;

  const marks = [
    Plot.gridY({ stroke: css("--grid"), strokeOpacity: 1 }),
    ymin < 0 && ymax > 0 ? Plot.ruleY([0], { stroke: css("--border"), strokeWidth: 1.2 }) : null,
    Plot.axisX({ ticks: Math.max(3, Math.floor(width / 110)), tickSize: 4, stroke: css("--border") }),
    Plot.axisY({ ticks: 5, tickSize: 0, tickFormat: (v) => fmt(v, unit), label: null }),
    ...per.map((s) => Plot.lineY(s.rows, {
      x: "date", y: "value", stroke: colorOf(s), strokeWidth: s.primary ? 2.5 : 2,
      strokeLinejoin: "round", strokeLinecap: "round",
    })),
    Plot.dot(ends, { x: "date", y: "value", r: 4, fill: (d) => colorOf(d.s), stroke: css("--surface"), strokeWidth: 2 }),
    shown.length > 1
      ? Plot.text(ends, { x: "date", y: "ly", text: (d) => d.s.label, dx: 8, textAnchor: "start", fill: css("--text"), fontSize: 12 })
      : Plot.text(ends, { x: "date", y: "value", text: (d) => `${fmt(d.value, unit)}${unitSuffix(unit)}`, dx: 8, textAnchor: "start", fill: css("--text"), fontSize: 12, fontWeight: 600 }),
    Plot.ruleX(wide, Plot.pointerX({ x: "date", stroke: css("--text-2"), strokeOpacity: 0.5 })),
    Plot.tip(wide, Plot.pointerX({ x: "date", y: "top", title: tipText, fill: css("--surface"), stroke: css("--border"), fontSize: 12 })),
  ].filter(Boolean);

  const svg = Plot.plot({
    width, height, marginLeft: 44, marginRight: labelW, marginTop: 10, marginBottom: 26,
    x: { type: "utc", label: null }, y: { label: null, nice: true },
    style: baseStyle(), marks,
  });
  const last = ends.map((e) => `${e.s.label} ${fmt(e.value, unit)}${unitSuffix(unit)}`).join(", ");
  node.setAttribute("aria-label", `Line chart. Latest (${periodLabel(maxDate, freq)}): ${last}.`);
  node.replaceChildren(svg);
}

function drawContrib(node, c, bars, total) {
  const width = node.clientWidth || 560, height = c.wide ? 320 : 280;
  const freq = meta(c.bars[0].id).freq;
  const tview = c.total.view ?? "level";
  const barEnd = d3.max(bars, (b) => b.dates.at(-1));
  const cut = cutoff(barEnd, state.range, c.maxYears);
  const rows = c.bars.flatMap((b, i) => bars[i].dates.map((d, k) => ({ date: d, value: bars[i].views.level[k], label: b.label, slot: b.slot })))
    .filter((r) => r.date >= cut && r.value != null);
  // the total is drawn over the bars' period only (e.g. HICP runs a month or two longer)
  const tot = total.dates.map((d, k) => ({ date: d, value: total.views[tview][k] }))
    .filter((r) => r.date >= cut && r.date <= barEnd && r.value != null);
  const step = freq === "M" ? 1 : 3;
  const mid = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + step * 15.2 * 864e5);
  const byDate = d3.group(rows, (r) => +r.date);
  const wide = tot.map((t) => ({ date: t.date, top: t.value, rs: byDate.get(+t.date) ?? [] }));
  const tipText = (d) => [`${periodLabel(d.date, freq)}  ${c.total.label} ${fmt(d.top, "pp")}%`,
    ...c.bars.map((b) => { const r = d.rs.find((x) => x.label === b.label); return r ? `${b.label}: ${fmt(r.value, "pp")} pp` : null; }).filter(Boolean)].join("\n");
  const q = d3.utcMonth.every(step);

  const svg = Plot.plot({
    width, height, marginLeft: 44, marginRight: 16, marginTop: 10, marginBottom: 26,
    x: { type: "utc", label: null }, y: { label: null, nice: true },
    style: baseStyle(),
    marks: [
      Plot.gridY({ stroke: css("--grid"), strokeOpacity: 1 }),
      Plot.axisX({ ticks: Math.max(3, Math.floor(width / 110)), tickSize: 4, stroke: css("--border") }),
      Plot.axisY({ ticks: 5, tickSize: 0, tickFormat: (v) => fmt(v, "pp"), label: null }),
      Plot.rectY(rows, { x: "date", interval: q, y: "value", fill: (d) => slotColor(d.slot),
        insetLeft: step === 1 && rows.length > 600 ? 0 : 0.5, insetRight: step === 1 && rows.length > 600 ? 0 : 0.5 }),
      Plot.ruleY([0], { stroke: css("--text-2"), strokeWidth: 1 }),
      step === 1
        ? Plot.lineY(tot, { x: (d) => mid(d.date), y: "value", stroke: css("--text"), strokeWidth: 2 })
        : Plot.dot(tot, { x: (d) => mid(d.date), y: "value", r: 3.5, fill: css("--text"), stroke: css("--surface"), strokeWidth: 1.5 }),
      Plot.ruleX(wide, Plot.pointerX({ x: (d) => mid(d.date), stroke: css("--text-2"), strokeOpacity: 0.4 })),
      Plot.tip(wide, Plot.pointerX({ x: (d) => mid(d.date), y: "top", title: tipText, fill: css("--surface"), stroke: css("--border"), fontSize: 12 })),
    ],
  });
  const lt = tot.at(-1);
  node.setAttribute("aria-label", `Stacked bar chart: ${c.subtitle}. Latest ${periodLabel(lt.date, freq)}: ${c.total.label} ${fmt(lt.value, "pp")}%.`);
  node.replaceChildren(svg);
}

function drawScatter(node, c, xs, ys) {
  const width = node.clientWidth || 560, height = 300;
  const yLookup = new Map(ys.dates.map((d, i) => [+d, ys.views.level[i]]));
  const all = xs.dates.map((d, i) => ({ date: d, x: xs.views.level[i], y: yLookup.get(+d) }))
    .filter((p) => p.x != null && p.y != null);
  const cut = cutoff(all.at(-1).date, state.range);
  const pts = all.filter((p) => p.date >= cut);
  const recent = pts.slice(-8);
  const yearLabels = pts.filter((p, i) => p.date.getUTCMonth() === 0 && (i === 0 || p.date.getUTCFullYear() % 2 === 0) && !recent.includes(p));
  const tip = (p) => `${periodLabel(p.date, "Q")}\nUnemployment ${fmt(p.x, "%")}%\nVacancies ${fmt(p.y, "%")}%`;
  const brand = css("--brand");
  const svg = Plot.plot({
    width, height, marginLeft: 44, marginRight: 24, marginTop: 10, marginBottom: 40,
    x: { label: c.x.label, nice: true }, y: { label: null, nice: true },
    style: baseStyle(),
    marks: [
      Plot.gridY({ stroke: css("--grid"), strokeOpacity: 1 }),
      Plot.gridX({ stroke: css("--grid"), strokeOpacity: 1 }),
      Plot.axisY({ ticks: 5, tickSize: 0, label: c.y.label, labelAnchor: "top", labelArrow: false }),
      Plot.axisX({ ticks: 6, tickSize: 4, stroke: css("--border"), label: c.x.label, labelArrow: false }),
      Plot.line(pts, { x: "x", y: "y", stroke: css("--scatter-old"), strokeWidth: 1.5 }),
      Plot.dot(pts.slice(0, -8), { x: "x", y: "y", r: 3, fill: css("--scatter-old") }),
      Plot.line(recent, { x: "x", y: "y", stroke: brand, strokeWidth: 2 }),
      Plot.dot(recent, { x: "x", y: "y", r: 3.5, fill: brand }),
      Plot.dot(recent.slice(-1), { x: "x", y: "y", r: 6, fill: brand, stroke: css("--surface"), strokeWidth: 2 }),
      Plot.text(yearLabels, { x: "x", y: "y", text: (p) => String(p.date.getUTCFullYear()), dy: -9, fill: css("--text-2"), fontSize: 11 }),
      Plot.text(recent.slice(-1), { x: "x", y: "y", text: (p) => periodLabel(p.date, "Q"), dx: 10, textAnchor: "start", fill: css("--text"), fontWeight: 600, fontSize: 12 }),
      Plot.tip(pts, Plot.pointer({ x: "x", y: "y", title: tip, fill: css("--surface"), stroke: css("--border"), fontSize: 12 })),
    ],
  });
  const p = pts.at(-1);
  node.setAttribute("aria-label", `Beveridge curve. Latest ${periodLabel(p.date, "Q")}: unemployment ${fmt(p.x, "%")}%, vacancy rate ${fmt(p.y, "%")}%.`);
  node.replaceChildren(svg);
}

// ── "How this is built" panel for the supply/demand decomposition ────────────
let sdData = null;
const getSdData = () => (sdData ??= fetch("data/supply_demand.json").then((r) => r.json()));

let cyData = null;
const getCyData = () => (cyData ??= fetch("data/cyclical.json").then((r) => r.json()));
const INFO = {
  sd: { load: () => getSdData(), content: (d) => sdInfoContent(d) },
  cy: { load: () => getCyData(), content: (d) => cyInfoContent(d) },
};

function infoButton(kind) {
  return el("button", { class: "info-btn", type: "button", "aria-haspopup": "dialog", onclick: () => openInfo(kind) },
    el("span", { "aria-hidden": "true" }, "ⓘ"), " How this is built");
}

async function openInfo(kind) {
  let dlg = document.getElementById(`${kind}-info`);
  if (!dlg) {
    dlg = el("dialog", { id: `${kind}-info`, class: "info-dialog", "aria-labelledby": `${kind}-info-title` });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // click on backdrop
    document.body.append(dlg);
    dlg.append(INFO[kind].content(await INFO[kind].load()));
  }
  dlg.showModal();
}

function sdInfoContent(d) {
  const S = d.settings, pct = (x) => `${d3.format(".1f")(x)}%`;
  const w = (x) => (x == null ? "–" : x < 0.5 ? "<0.1%" : d3.format(".1f")(x / 10) + "%");
  const groupsW = new Map(d.categories.map((x) => [x.label, x]));
  const ncTotal = d.not_covered.reduce((a, x) => a + (x.weight ?? 0), 0);
  const close = el("button", { class: "dialog-close", type: "button", "aria-label": "Close",
    onclick: (e) => e.currentTarget.closest("dialog").close() }, "×");
  const ref = (t, href) => el("li", {}, el("a", { href, target: "_blank", rel: "noopener" }, t));
  return el("div", { class: "dialog-body" },
    el("div", { class: "dialog-head" }, el("h2", { id: "sd-info-title" }, "Supply- and demand-driven inflation: how it is built"), close),

    el("h3", {}, "The idea"),
    el("p", {}, "When demand for a product rises, its price and the quantity sold tend to move up together; when supply is disrupted, the price rises while the quantity falls. Following Shapiro (Federal Reserve Bank of San Francisco), each HICP group is labelled every month by whether its ", el("em", {}, "unexpected"), " price and quantity moves go in the same direction (demand-driven) or in opposite directions (supply-driven). If either move is very small, the month is labelled ambiguous. Adding up the price changes of the groups under each label, weighted by their HICP weights, splits inflation into supply- and demand-driven parts."),

    el("h3", {}, "Step by step"),
    el("ol", {},
      el("li", {}, "Prices: monthly HICP index for each group (Eurostat prc_hicp_minr, ECOICOP 2)."),
      el("li", {}, "Quantities: Lithuania publishes no monthly consumption volumes by product, so — as the ECB does for the euro area — each group is paired with the closest monthly activity indicator: retail sales volumes for goods, services turnover deflated by the group's own price index for services, and energy statistics for electricity and heat (see “Energy” below)."),
      el("li", {}, `For each group, monthly price growth and activity growth are each explained by their own past (${S.lags} lags of both) and calendar-month effects, over a rolling window of up to ${S.max_window / 12} years (at least ${S.min_window / 12} years of data).`),
      el("li", {}, `The surprise in the latest month (the regression residual) sets the label: same sign → demand, opposite sign → supply, either surprise below ${S.ambiguity_sd} robust standard deviations → ambiguous.`),
      el("li", {}, "Contribution of a group = HICP weight × monthly price change, booked under its label. The weight is updated within the year for the group's price change since December, as the chain-linked HICP requires. Year-on-year figures add up the last 12 months, then are scaled so that they add up to the official annual rate (adding up monthly rates understates it when inflation is high, by about 2 pp in late 2022)."),
      el("li", {}, "Groups without an activity indicator, or whose indicator does not reach back far enough yet, are shown as “not covered”. That bar is headline inflation minus the matched groups, so the four parts add up to HICP inflation (the sum of 12 monthly changes is slightly below the compounded y/y rate when inflation is high).")),

    el("h3", {}, "What is covered"),
    el("p", {}, `Matched groups make up ${pct(100 * d.coverage_share)} of the ${d.latest.slice(0, 4)} HICP basket: `,
      `${pct(d.coverage_by_quality.high)} with a close indicator, ${pct(d.coverage_by_quality.medium)} with a reasonable one and ${pct(d.coverage_by_quality.low)} with a weak one. `,
      `The monthly series starts in ${periodLabel(utc(d.first), "M")}, once groups with at least ${100 * S.min_coverage}% of the basket can be estimated; most services join around 2020 because their data start in 2015.`),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["Activity indicator", "Eurostat", "Data from", "HICP groups (weight)"].map((h) => el("th", {}, h)))),
      el("tbody", {}, d.indicators.map((x) => el("tr", {},
        el("td", { class: "ind" }, x.label, x.deflated ? " — deflated by the group's HICP" : "",
          x.fallback ? " — before it starts, broader non-food retail sales" : ""),
        el("td", { class: "ind" }, `${x.dataset} ${x.code}`),
        el("td", {}, x.start ? x.start.slice(0, 7) : "–"),
        el("td", { class: "ind" }, x.groups.map((g) => `${g} (${w(groupsW.get(g)?.weight)})`).join(", "))))))),

    el("h3", {}, "Energy"),
    el("p", {}, "Energy is where the approaches differ most. Shapiro has real quantities for gasoline, electricity and natural gas in the US consumption statistics; the ECB sidesteps energy by decomposing only core inflation; Eesti Pank (Meriküll 2025) pairs all housing and energy items with the output of the energy sector (NACE D). Here:"),
    el("ul", {},
      el("li", {}, "Motor fuels: retail sales volume of automotive fuel."),
      el("li", {}, "Electricity: electricity consumed in Lithuania (available to the internal market, GWh). Not the energy sector's output: when imports from Russia stopped in 2022, Lithuanian generation rose while consumption fell, so output would misread 2022 as demand-driven."),
      el("li", {}, "District heating and solid fuels: output of the energy sector (D35), as Eesti Pank does — heat is produced and used locally. A weak proxy."),
      el("li", {}, "Gas: not covered. Lithuania's monthly gas use is dominated by industry (mainly fertiliser production) and household use is not published separately.")),

    el("h3", {}, "Headline and core"),
    el("p", {}, "The “Core” switch on the chart shows the same labels applied to core inflation — HICP excluding energy, food, alcohol and tobacco, the measure the ECB decomposes. Weights are rescaled to the core basket. ",
      d.core ? `In ${periodLabel(utc(d.latest), "M")}, ${fmt(d.core.latest_yoy.demand, "pp")} pp of core inflation is labelled demand-driven and ${fmt(d.core.latest_yoy.supply, "pp")} pp supply-driven (across specifications: demand ${fmt(d.core.range_yoy.demand[0], "pp")}–${fmt(d.core.range_yoy.demand[1], "pp")} pp, supply ${fmt(d.core.range_yoy.supply[0], "pp")}–${fmt(d.core.range_yoy.supply[1], "pp")} pp); matched groups cover ${Math.round(100 * d.core.coverage_share)}% of the core basket.` : ""),

    el("h3", {}, `What is not covered (${w(ncTotal)} of the basket)`),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["HICP group", "Weight", "Why"].map((h) => el("th", {}, h)))),
      el("tbody", {}, d.not_covered.map((x) => el("tr", {},
        el("td", { class: "ind" }, x.label), el("td", {}, w(x.weight)), el("td", { class: "ind" }, x.reason)))))),

    el("h3", {}, "How this differs from Shapiro and the ECB"),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["", "Shapiro (US)", "ECB (euro area)", "Here (Lithuania)"].map((h) => el("th", {}, h)))),
      el("tbody", {},
        el("tr", {}, el("td", { class: "ind" }, "Quantities"), el("td", { class: "ind" }, "PCE real consumption by product"),
          el("td", { class: "ind" }, "Deflated retail and services turnover"), el("td", { class: "ind" }, "Retail sales volumes; services turnover deflated by the group's HICP")),
        el("tr", {}, el("td", { class: "ind" }, "Groups"), el("td", { class: "ind" }, "129 PCE categories"),
          el("td", { class: "ind" }, "72 core HICP components"), el("td", { class: "ind" }, `${d.categories.length} HICP groups, incl. food and fuel`)),
        el("tr", {}, el("td", { class: "ind" }, "Model"), el("td", { class: "ind" }, "Log levels, 12 lags, 10-year rolling window"),
          el("td", { class: "ind" }, "Time-series model per component"), el("td", { class: "ind" }, `Monthly growth rates, ${S.lags} lags, calendar-month effects, ${S.min_window / 12}–${S.max_window / 12}-year window (short Lithuanian data)`)),
        el("tr", {}, el("td", { class: "ind" }, "Energy"), el("td", { class: "ind" }, "Real quantities of gasoline, electricity, natural gas"),
          el("td", { class: "ind" }, "Excluded (core only)"), el("td", { class: "ind" }, "Fuel retail volume; electricity consumption; heat via energy-sector output; gas not covered")),
        el("tr", {}, el("td", { class: "ind" }, "Ambiguous"), el("td", { class: "ind" }, "Robustness variant: residual within 0.1–0.3 s.d."),
          el("td", { class: "ind" }, "Not statistically significant"), el("td", { class: "ind" }, `Residual within ${S.ambiguity_sd} robust s.d.`))))),

    el("h3", {}, "Caveats"),
    el("ul", {},
      el("li", {}, "Activity indicators measure sales by sector, not household purchases of exactly the products in each HICP group (e.g. clothing shares an indicator with pharmacies and cosmetics)."),
      el("li", {}, "Deflating services turnover by the same price index makes activity surprises partly mirror price surprises, which tilts services towards “supply”."),
      el("li", {}, "Passenger transport uses land transport turnover, which includes freight."),
      el("li", {}, "Energy quantities are total-economy (electricity) or sector output (heat), not household purchases, and they swing with the weather, which the calendar-month effects only partly absorb."),
      el("li", {}, "Household electricity, gas and heat tariffs in Lithuania are set by the regulator at fixed dates, so energy “price surprises” partly reflect regulatory decisions rather than market shocks."),
      el("li", {}, "Research at the Reserve Bank of Australia (Read 2024) finds that these sign restrictions are often uninformative for individual categories; read single groups and single months with care."),
      el("li", {}, "Labels for a single month are noisy; the 12-month sums are more informative than any one month, and the latest months can change as data are revised.")),

    el("h3", {}, "How robust is it?"),
    el("p", {}, `The latest reading (${periodLabel(utc(d.latest), "M")}) is recomputed under ${d.robustness.length} alternative specifications (${d.robustness.join("; ")}). `,
      `Demand-driven inflation ranges ${fmt(d.range_yoy.demand[0], "pp")}–${fmt(d.range_yoy.demand[1], "pp")} pp and supply-driven ${fmt(d.range_yoy.supply[0], "pp")}–${fmt(d.range_yoy.supply[1], "pp")} pp (baseline ${fmt(d.latest_yoy.demand, "pp")} and ${fmt(d.latest_yoy.supply, "pp")} pp). `,
      "The quarterly cross-check applies the same model to four household-consumption groups from the national accounts (durable, semi-durable and non-durable goods, services); it is coarser and puts energy inside non-durables, so it attributes more of 2022 to demand."),

    el("h3", {}, "References"),
    el("ul", {},
      ref("Shapiro (2022, revised 2024), Decomposing Supply and Demand Driven Inflation, FRBSF Working Paper 2022-18", "https://www.frbsf.org/wp-content/uploads/wp2022-18.pdf"),
      ref("Gonçalves and Koester (2022), The role of demand and supply in underlying inflation, ECB Economic Bulletin 7/2022", "https://www.ecb.europa.eu/pub/economic-bulletin/focus/2022/html/ecb.ebbox202207_07~8b71edbfcf.en.html"),
      ref("Meriküll (2025), The impact of early pension withdrawals on household finances and inflation, Eesti Pank Working Paper 4/2025 (Appendix E)", "https://haldus.eestipank.ee/sites/default/files/2025-04/wp_2025_04.pdf"),
      ref("Read (2024), Sign Restrictions and Supply-demand Decompositions of Inflation, RBA Research Discussion Paper 2024-05", "https://www.rba.gov.au/publications/rdp/2024/pdf/rdp2024-05.pdf")),
    el("p", { class: "dialog-foot" }, "Own estimates from Eurostat data. Mapping and settings: catalogue/models/supply_demand.toml."));
}

// ── supply/demand table by HICP group ───────────────────────────────────────
function buildSdTable(card, c) {
  const body = el("div", {}, el("p", { class: "loading" }, "Loading…"));
  card.append(el("div", { class: "card-head" }, titleRow(c.title, ["sd_demand.LT"]), infoButton("sd")),
    el("p", { class: "subtitle" }, "Contributions to HICP inflation over the last 12 months, percentage points"), body);
  getSdData().then((d) => {
    const L = utc(d.latest), sum = d.latest_yoy, rg = d.range_yoy;
    const f2 = (v) => (v == null ? "–" : d3.format("+.2f")(v).replace("+0.00", "0.00"));
    const qual = { high: "●●●", medium: "●●○", low: "●○○" };
    const dom = (x) => {
      const m = Math.max(Math.abs(x.supply), Math.abs(x.demand), Math.abs(x.ambiguous));
      return m < 0.01 ? "" : Math.abs(x.demand) === m ? "demand" : Math.abs(x.supply) === m ? "supply" : "ambiguous";
    };
    const dot = (k) => k === "demand" || k === "supply"
      ? el("span", { class: "dot", style: `background:${slotColor(k === "demand" ? 2 : 3)}` }) : el("span", { class: "dot" });
    body.replaceChildren(
      el("p", { class: "sd-summary" },
        `${periodLabel(L, "M")}: of ${fmt(sum.supply + sum.demand + sum.ambiguous + sum.uncovered, "%")}% HICP inflation, `,
        el("strong", {}, `${fmt(sum.demand, "pp")} pp demand-driven`), " and ",
        el("strong", {}, `${fmt(sum.supply, "pp")} pp supply-driven`),
        `, ${fmt(sum.ambiguous, "pp")} pp ambiguous, ${fmt(sum.uncovered, "pp")} pp in groups not covered. `,
        `Across ${d.robustness.length} alternative specifications demand ranges ${fmt(rg.demand[0], "pp")}–${fmt(rg.demand[1], "pp")} pp and supply ${fmt(rg.supply[0], "pp")}–${fmt(rg.supply[1], "pp")} pp. `,
        `Matched groups cover ${Math.round(100 * d.coverage_share)}% of the basket.`),
      el("div", { class: "table-wrap tall" }, el("table", { class: "data" },
        el("thead", {}, el("tr", {}, ["HICP group", "Weight ‰", "Inflation y/y %", "Demand", "Supply", "Ambiguous", "Activity indicator", "Proxy"]
          .map((h) => el("th", { class: h === "Activity indicator" ? "ind" : null }, h)))),
        el("tbody", {}, d.categories.map((x) => el("tr", {},
          el("td", {}, dot(dom(x)), x.label),
          el("td", {}, d3.format(".1f")(x.weight)),
          el("td", {}, x.inflation_yoy == null ? "–" : d3.format(".1f")(x.inflation_yoy)),
          el("td", {}, f2(x.demand)), el("td", {}, f2(x.supply)), el("td", {}, f2(x.ambiguous)),
          el("td", { class: "ind" }, x.indicator),
          el("td", { title: `${x.quality} quality proxy` }, qual[x.quality] ?? x.quality)))))));
  }).catch((e) => body.replaceChildren(el("p", { class: "error" }, `Could not load supply_demand.json: ${e.message}`)));
  return card;
}

// ── cyclical / acyclical: "How this is built" panel and group table ──────────
const CY_DOT = { cyclical: 1, acyclical: 4 };
const cyDot = (cls) => el("span", { class: "dot", style: CY_DOT[cls] ? `background:${slotColor(CY_DOT[cls])}` : "" });

function cyInfoContent(d) {
  const S = d.settings, c = d.core_latest_yoy, rg = d.range_yoy, L = utc(d.latest);
  const nCyc = d.table.filter((x) => x.class === "cyclical").length;
  const nCls = d.table.filter((x) => x.class !== "none").length;
  const share = Math.round(100 * d.cyclical_weight / d.classified_weight);
  const close = el("button", { class: "dialog-close", type: "button", "aria-label": "Close",
    onclick: (e) => e.currentTarget.closest("dialog").close() }, "×");
  const ref = (t, href) => el("li", {}, el("a", { href, target: "_blank", rel: "noopener" }, t));
  return el("div", { class: "dialog-body" },
    el("div", { class: "dialog-head" }, el("h2", { id: "cy-info-title" }, "Cyclical and acyclical inflation: how it is built"), close),

    el("h3", {}, "The idea"),
    el("p", {}, "Some prices move with the business cycle: when the labour market is tight and incomes grow, restaurants, personal services or repairs can raise prices more. Others are driven by world prices, regulation or technology, whatever the state of the economy. Following Mahedy and Shapiro at the Federal Reserve Bank of San Francisco, each core HICP group is tested once for whether its inflation has responded to the unemployment gap. Groups that have are ", el("em", {}, "cyclical"), ", the rest ", el("em", {}, "acyclical"), ". Adding up the price changes of each class, weighted by HICP weights, splits core inflation into the two."),

    el("h3", {}, "Step by step"),
    el("ol", {},
      el("li", {}, `Prices: monthly HICP index for ${d.table.length} core groups (ECOICOP 2, 3-digit; food, alcohol, tobacco, household energy and motor fuels are outside core).`),
      el("li", {}, `Slack: the unemployment gap, trend minus actual monthly unemployment rate (Eurostat une_rt_m). The trend is a Hodrick–Prescott filter (λ = ${S.hp_lambda}); a positive gap means a tight labour market.`),
      el("li", {}, `For each group, monthly inflation is regressed on calendar-month effects, its own inflation over the previous 12 months and the gap in the previous month, over ${S.window_start.slice(0, 4)}–${S.window_end.slice(0, 4)}. That window covers the 2008–10 boom and bust and stops before COVID and the 2022 energy shock.`),
      el("li", {}, `A group is cyclical if the gap coefficient is positive with a t-statistic above ${S.t_crit} (Newey–West standard errors). The classification is then fixed for the whole sample, as at the San Francisco Fed.`),
      el("li", {}, "Contribution of a group = HICP weight (updated within the year for the group's price change since December, as the chain-linked index requires) × monthly price change. Year-on-year figures add up the last 12 months and are scaled to add up to the official annual rate."),
      el("li", {}, "Groups with too short a history (e.g. software, published from 2024) are “not classified”; that bar also absorbs small differences between core and its groups.")),

    el("h3", {}, "Result"),
    el("p", {}, `${nCyc} of ${nCls} classified groups are cyclical, ${share}% of the classified core basket by weight (in the euro area the same method gives about 30%). `,
      `In ${periodLabel(L, "M")}, ${fmt(c.cyclical, "pp")} pp of core inflation is cyclical and ${fmt(c.acyclical, "pp")} pp acyclical; across ${d.specs.length} alternative specifications the cyclical part ranges ${fmt(rg.cyclical[0], "pp")}–${fmt(rg.cyclical[1], "pp")} pp. `,
      d.corr_in != null ? `The 12-month cyclical contribution moves with the unemployment gap: correlation ${d3.format(".2f")(d.corr_in)} inside the estimation window and ${d3.format(".2f")(d.corr_out)} after it.` : ""),

    el("h3", {}, "How this differs from the San Francisco Fed"),
    el("div", { class: "table-wrap" }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, ["", "San Francisco Fed (US)", "Here (Lithuania)"].map((h) => el("th", {}, h)))),
      el("tbody", {},
        el("tr", {}, el("td", { class: "ind" }, "Prices"), el("td", { class: "ind" }, "Core PCE categories"), el("td", { class: "ind" }, `${d.table.length} core HICP groups`)),
        el("tr", {}, el("td", { class: "ind" }, "Slack"), el("td", { class: "ind" }, "Unemployment gap (CBO natural rate)"), el("td", { class: "ind" }, "Unemployment gap (HP trend; no official monthly natural rate)")),
        el("tr", {}, el("td", { class: "ind" }, "Window"), el("td", { class: "ind" }, "1988–2007"), el("td", { class: "ind" }, `${S.window_start.slice(0, 4)}–${S.window_end.slice(0, 4)}`)),
        el("tr", {}, el("td", { class: "ind" }, "Seasonality"), el("td", { class: "ind" }, "Seasonally adjusted data"), el("td", { class: "ind" }, "Calendar-month effects (HICP groups are not adjusted)")),
        el("tr", {}, el("td", { class: "ind" }, "Rule"), el("td", { class: "ind" }, "t > 1.96 on the gap"), el("td", { class: "ind" }, `t > ${S.t_crit}, Newey–West`))))),

    el("h3", {}, "Caveats"),
    el("ul", {},
      el("li", {}, "Convergence can look like the cycle: Lithuanian services inflation was high while unemployment trended down, so some groups may be labelled cyclical for structural reasons. The lagged-inflation term absorbs part of this."),
      el("li", {}, "Cyclical groups also pass on cost shocks. Restaurants and personal services raised prices in 2022 partly because food and energy costs rose, so the 2022 cyclical peak is not all labour-market pressure. The supply/demand decomposition above helps to tell the two apart."),
      el("li", {}, "With one large cycle in the window, the classification of groups near the threshold is fragile. The table shows how many of the alternative specifications agree."),
      el("li", {}, "The classification is fixed: a group whose behaviour changed after 2019 keeps its label.")),

    el("h3", {}, "References"),
    el("ul", {},
      el("li", {}, "Mahedy and Shapiro (2017), What's Down with Inflation?, FRBSF Economic Letter 2017-35"),
      ref("Shapiro (2020, revised 2022), A Simple Framework to Monitor Inflation, FRBSF Working Paper 2020-29", "https://www.frbsf.org/wp-content/uploads/wp2020-29.pdf"),
      ref("Federal Reserve Bank of San Francisco, Cyclical and Acyclical Core PCE Inflation (data page)", "https://www.frbsf.org/research-and-insights/data-and-indicators/cyclical-and-acyclical-core-pce-inflation/")),
    el("p", { class: "dialog-foot" }, "Own estimates from Eurostat data. Groups and settings: catalogue/models/cyclical.toml."));
}

function buildCyTable(card, c) {
  const body = el("div", {}, el("p", { class: "loading" }, "Loading…"));
  card.append(el("div", { class: "card-head" }, titleRow(c.title, ["cy_cyclical.LT"]), infoButton("cy")),
    el("p", { class: "subtitle" }, "Core HICP groups, sorted by how strongly their inflation has responded to the unemployment gap"), body);
  getCyData().then((d) => {
    const nSpecs = d.specs.length;
    const rows = [...d.table].sort((a, b) => (b.t ?? -99) - (a.t ?? -99));
    const agree = (x) => x.class === "none" ? "–" : `${Object.values(x.robustness).filter((v) => v === x.class).length} of ${nSpecs}`;
    const f2 = (v) => (v == null ? "–" : d3.format("+.2f")(v).replace("+0.00", "0.00"));
    const nm = { cyclical: "Cyclical", acyclical: "Acyclical", none: "Not classified" };
    body.replaceChildren(
      el("p", { class: "sd-summary" },
        `${periodLabel(utc(d.latest), "M")}: of ${fmt(d.core_latest_yoy.cyclical + d.core_latest_yoy.acyclical + d.core_latest_yoy.unclassified, "%")}% core inflation, `,
        el("strong", {}, `${fmt(d.core_latest_yoy.cyclical, "pp")} pp cyclical`), " and ",
        el("strong", {}, `${fmt(d.core_latest_yoy.acyclical, "pp")} pp acyclical`), ". ",
        `Cyclical groups make up ${Math.round(100 * d.cyclical_weight / d.classified_weight)}% of the classified core basket. `,
        `“Robust” counts the ${nSpecs} alternative specifications (${d.specs.join("; ")}) that give the same class.`),
      el("div", { class: "table-wrap tall" }, el("table", { class: "data" },
        el("thead", {}, el("tr", {}, ["Core HICP group", "Weight ‰", "Inflation y/y %", "Class", "t-statistic", "Robust", "Contribution, 12 months, pp"]
          .map((h) => el("th", {}, h)))),
        el("tbody", {}, rows.map((x) => el("tr", {},
          el("td", {}, cyDot(x.class), x.label),
          el("td", {}, x.weight == null ? "–" : d3.format(".1f")(x.weight)),
          el("td", {}, x.inflation_yoy == null ? "–" : d3.format(".1f")(x.inflation_yoy)),
          el("td", {}, nm[x.class] ?? x.class),
          el("td", {}, x.t == null ? "–" : d3.format(".1f")(x.t)),
          el("td", {}, agree(x)),
          el("td", {}, f2(x.contrib_core_12m))))))));
  }).catch((e) => body.replaceChildren(el("p", { class: "error" }, `Could not load cyclical.json: ${e.message}`)));
  return card;
}

// ── table view + CSV ─────────────────────────────────────────────────────────
function wideTable(shown, view, cut) {
  const dates = [...new Set(shown.flatMap((s) => s.data.dates.filter((d) => d >= cut).map((d) => +d)))].sort((a, b) => b - a);
  const looks = shown.map((s) => new Map(s.data.dates.map((d, i) => [+d, (s.data.views[s.view ?? view] ?? [])[i]])));
  return dates.map((t) => ({ date: new Date(t), vals: looks.map((l) => l.get(t)) }));
}

function renderTable(node, shown, view, unit, c) {
  const maxDate = d3.max(shown, (s) => s.data.dates.at(-1));
  const rows = wideTable(shown, view, cutoff(maxDate, state.range, c.maxYears));
  const freq = meta(shown[0].id).freq;
  node.removeAttribute("aria-label");
  node.replaceChildren(el("div", { class: "table-wrap" }, el("table", { class: "data" },
    el("thead", {}, el("tr", {}, el("th", {}, "Period"), shown.map((s) => el("th", {}, s.label)))),
    el("tbody", {}, rows.map((r) => el("tr", {}, el("td", {}, periodLabel(r.date, freq)),
      r.vals.map((v) => el("td", {}, fmt(v, unit)))))))));
}

function downloadCsv(c, shown, view, unit) {
  const rows = wideTable(shown, view, new Date(0)).reverse();
  const head = ["date", ...shown.map((s) => `"${s.label} (${s.id}, ${view})"`)].join(",");
  const body = rows.map((r) => [r.date.toISOString().slice(0, 10), ...r.vals.map((v) => (v == null ? "" : v))].join(","));
  const blob = new Blob([head + "\n" + body.join("\n") + "\n"], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${view.replace(":", "")}.csv` });
  document.body.append(a); a.click(); a.remove();
}

// ── lifecycle ────────────────────────────────────────────────────────────────
function rerenderAll() { for (const c of state.charts) c.draw(c.node); }

function setupTheme() {
  const btn = document.getElementById("theme-toggle");
  const saved = load("theme", null);
  if (saved) document.documentElement.dataset.theme = saved;
  const current = () => document.documentElement.dataset.theme
    ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const label = () => { btn.textContent = current() === "dark" ? "Light mode" : "Dark mode"; };
  label();
  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; save("theme", next); label(); rerenderAll();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { label(); rerenderAll(); });
}

async function main() {
  const root = document.getElementById("content");
  try {
    const r = await fetch("data/catalogue.json");
    if (!r.ok) throw new Error(`catalogue.json: HTTP ${r.status} — run "julia --project=. build.jl" first`);
    state.catalogue = await r.json();
  } catch (e) {
    root.replaceChildren(el("p", { class: "error" }, `Could not load data. ${e.message}`));
    return;
  }
  for (const s of state.catalogue.series) state.byId.set(s.id, s);
  root.replaceChildren();
  await renderOverview(root);
  renderSections(root);
  renderChrome();
  setupTheme();
  rerenderAll();
  if (location.hash === "#how-supply-demand") openInfo("sd");   // shareable links to the explanations
  if (location.hash === "#how-cyclical") openInfo("cy");

  let t;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(t); t = setTimeout(rerenderAll, 150);
  });
}

main();
