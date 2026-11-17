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
  const links = [["overview", "Overview"], ...SECTIONS.map((s) => [s.id, s.title]), ["calendar", "Calendar"]];
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
    .slice(0, 13);
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
    calendarCard()));
  root.append(sec);
}

// ── release calendar ("Coming up") + data status ─────────────────────────────
const SECTION_NAME = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
const SRC_SHORT = { "Statistics Lithuania": "Statistics Lithuania", Eurostat: "Eurostat" };

function calendarCard() {
  const nW = state.catalogue.warnings.length, nE = state.catalogue.errors.length;
  const list = el("div", { class: "cal" }, el("p", { class: "loading" }, "Loading…"));
  const status = el("details", { class: "status-details" },
    el("summary", {}, `Data status: ${state.catalogue.series.length} series · built ${state.catalogue.today}`,
      nE ? ` · ${nE} failed` : "", nW ? ` · ${nW} note${nW > 1 ? "s" : ""}` : " · all current"),
    statusList());
  const card = el("div", { class: "card", id: "calendar" }, el("h3", {}, "Coming up"),
    el("p", { class: "subtitle" }, "Scheduled data releases, Vilnius time. From the official calendars of Statistics Lithuania and Eurostat"),
    list, status);
  fetch("data/calendar.json").then((r) => r.json()).then((d) => {
    const today = new Date().toISOString().slice(0, 10);
    const ev = d.events.filter((e) => e.date >= today);
    if (!ev.length) {
      list.replaceChildren(el("p", {}, d.errors.length ? "The release calendars could not be read at the last update." : "No releases scheduled in the coming weeks."));
      return;
    }
    let shown = 7;
    const draw = () => {
      const byDay = d3.group(ev.slice(0, shown), (e) => e.date);
      const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
      const rel = (iso) => {
        const n = Math.round((new Date(iso + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 864e5);
        return n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
      };
      list.replaceChildren(...[...[...byDay].map(([date, es]) => el("div", { class: "cal-day" },
          el("div", { class: "cal-date" }, el("strong", {}, day(date)), el("span", {}, rel(date))),
          el("ul", {}, es.map((e) => el("li", {},
            el("span", { class: "cal-time" }, e.time),
            el("span", { class: "cal-title" },
              e.section ? el("a", { href: `#${e.section}`, title: `Go to ${SECTION_NAME[e.section] ?? e.section}` }, e.title) : e.title,
              e.flash ? el("span", { class: "flash-tag" }, "Flash") : null),
            el("span", { class: "cal-period" }, e.period),
            el("span", { class: "cal-src" }, SRC_SHORT[e.source] ?? e.source)))))),
        ev.length > shown ? el("button", { type: "button", class: "link-btn", onclick: () => { shown = ev.length; draw(); } },
          `Show all ${ev.length} releases until ${new Date(ev.at(-1).date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`) : null,
        d.errors.length ? el("p", { class: "cal-note" }, `Not available at the last update: ${d.errors.map((x) => x.split(":")[0]).join(", ")}.`) : null]
        .flat().filter(Boolean));
    };
    draw();
  }).catch(() => list.replaceChildren(el("p", {}, "Release calendar not available.")));
  return card;
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
  if (CARD_TYPES[c.type]) return CARD_TYPES[c.type](card, c);
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

// ── "How this is built" panels ──────────────────────────────────────────────
// Registries filled by optional modules (models.js): info panels, extra card types, #hash → info panel.
const INFO = {}, CARD_TYPES = {}, HASH_INFO = {};

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
  if (state.catalogue.models) {
    try {
      (await import("./models.js")).install({ SECTIONS, INFO, CARD_TYPES, HASH_INFO,
        el, d3, fmt, periodLabel, utc, slotColor, titleRow, infoButton });
    } catch (e) { console.warn("models.js not loaded:", e); }
  }
  root.replaceChildren();
  await renderOverview(root);
  renderSections(root);
  renderChrome();
  setupTheme();
  rerenderAll();
  if (HASH_INFO[location.hash]) openInfo(HASH_INFO[location.hash]);

  let t;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(t); t = setTimeout(rerenderAll, 150);
  });
}

main();
