// layout.js — what the site shows, and where. Series ids come from catalogue/*.toml.
//
// Chart types
//   lines   : time series. Either `concept` (all countries of one concept, LT first)
//             or `series` (explicit list of {id, label}). `view` = default view.
//             `headline` marks a series drawn in the text colour (e.g. all-items HICP).
//   contrib : stacked bars of contributions + a total (GDP growth decomposition)
//   scatter : connected scatter of two series over time (Beveridge curve)

export const TILES = [
  { id: "gdp_real.LT",   view: "yoy",   label: "Real GDP growth" },
  { id: "hicp.LT",       view: "yoy",   label: "HICP inflation" },
  { id: "hicp_core.LT",  view: "yoy",   label: "Core inflation" },
  { id: "unemp_rate.LT", view: "level", label: "Unemployment rate" },
  { id: "wages.LT",      view: "yoy",   label: "Gross wages" },
  { id: "real_wages.LT", view: "yoy",   label: "Real wages" },
];

export const SECTIONS = [
  {
    id: "growth",
    title: "Growth",
    intro: "Output, its expenditure components, monthly activity and sentiment.",
    charts: [
      { type: "lines", title: "Real GDP", concept: "gdp_real", view: "yoy" },
      {
        type: "contrib", title: "What drove GDP growth",
        bars: [
          { id: "gdp_contrib_hh.LT",     label: "Households",  slot: 1 },
          { id: "gdp_contrib_gov.LT",    label: "Government",  slot: 2 },
          { id: "gdp_contrib_inv.LT",    label: "Investment",  slot: 3 },
          { id: "gdp_contrib_nx.LT",     label: "Net exports", slot: 4 },
          { id: "gdp_contrib_stocks.LT", label: "Inventories", slot: "other" },
        ],
        total: { id: "gdp_contrib_total.LT", label: "GDP growth" },
        subtitle: "Contributions to real GDP growth, q/q, percentage points",
        maxYears: 6,
      },
      {
        type: "lines", title: "GDP components, real", view: "yoy",
        series: [
          { id: "consumption_real.LT", label: "Consumption" },
          { id: "investment_real.LT",  label: "Investment" },
          { id: "exports_real.LT",     label: "Exports" },
          { id: "imports_real.LT",     label: "Imports" },
        ],
      },
      { type: "lines", title: "Industrial production", concept: "industrial_production" },
      { type: "lines", title: "Retail trade volume", concept: "retail_trade" },
      { type: "lines", title: "Economic sentiment", concept: "esi" },
      { type: "lines", title: "Consumer confidence", concept: "consumer_confidence" },
    ],
  },
  {
    id: "labour",
    title: "Labour market",
    intro: "Unemployment, employment, vacancies and wages.",
    charts: [
      { type: "lines", title: "Unemployment rate", concept: "unemp_rate" },
      { type: "lines", title: "Employment rate (20-64)", concept: "emp_rate" },
      { type: "lines", title: "Job vacancy rate", concept: "jvr" },
      {
        type: "scatter", title: "Beveridge curve",
        x: { id: "unemp_rate_q.LT", label: "Unemployment rate, %" },
        y: { id: "jvr.LT", label: "Job vacancy rate, %" },
        subtitle: "Lithuania, quarterly; the recent quarters are highlighted",
      },
      { type: "lines", title: "Vacancies per unemployed person", series: [{ id: "vu_ratio.LT", label: "Lithuania" }] },
      { type: "lines", title: "Job vacancies, monthly (experimental)", series: [{ id: "vacancies_m.LT", label: "Lithuania" }] },
      {
        type: "lines", title: "Average gross wages", view: "yoy",
        series: [
          { id: "wages.LT",      label: "Nominal" },
          { id: "real_wages.LT", label: "Real (HICP-deflated)" },
        ],
      },
      { type: "lines", title: "Gross wages, monthly (experimental)", series: [{ id: "wages_m.LT", label: "Lithuania" }] },
      { type: "lines", title: "Labour cost index", concept: "lci" },
      { type: "lines", title: "Employment (national accounts)", concept: "employment" },
      { type: "lines", title: "Youth unemployment rate", concept: "youth_unemp_rate" },
    ],
  },
  {
    id: "inflation",
    title: "Inflation",
    intro: "Consumer prices (HICP) and the GDP deflator.",
    charts: [
      { type: "lines", title: "HICP inflation", concept: "hicp", view: "yoy" },
      {
        type: "contrib", wide: true, title: "Supply- and demand-driven inflation", info: "sd", maxYears: 10,
        variants: [
          {
            label: "All items", hint: "Headline HICP inflation",
            subtitle: "Contributions to HICP inflation, y/y, percentage points. Own estimates (Shapiro method, ECB adaptation)",
            bars: [
              { id: "sd_demand.LT",    label: "Demand-driven", slot: 2 },
              { id: "sd_supply.LT",    label: "Supply-driven", slot: 3 },
              { id: "sd_ambiguous.LT", label: "Ambiguous",     slot: "other" },
              { id: "sd_uncovered.LT", label: "Not covered",   slot: "faint" },
            ],
            total: { id: "hicp.LT", view: "yoy", label: "HICP inflation" },
          },
          {
            label: "Core", hint: "HICP excluding energy, food, alcohol and tobacco (as in the ECB's analysis)",
            subtitle: "Contributions to core inflation (HICP excl. energy, food, alcohol, tobacco), y/y, percentage points",
            bars: [
              { id: "sdc_demand.LT",    label: "Demand-driven", slot: 2 },
              { id: "sdc_supply.LT",    label: "Supply-driven", slot: 3 },
              { id: "sdc_ambiguous.LT", label: "Ambiguous",     slot: "other" },
              { id: "sdc_uncovered.LT", label: "Not covered",   slot: "faint" },
            ],
            total: { id: "hicp_core.LT", view: "yoy", label: "Core inflation" },
          },
        ],
      },
      { type: "sdtable", wide: true, title: "Supply or demand, by HICP group" },
      {
        type: "lines", title: "Inflation by component, Lithuania", view: "yoy",
        series: [
          { id: "hicp.LT",          label: "All items", headline: true },
          { id: "hicp_services.LT", label: "Services" },
          { id: "hicp_goods.LT",    label: "Goods" },
          { id: "hicp_food.LT",     label: "Food" },
          { id: "hicp_energy.LT",   label: "Energy" },
        ],
      },
      { type: "lines", title: "Core inflation", concept: "hicp_core", view: "yoy" },
      { type: "lines", title: "GDP deflator", concept: "gdp_deflator", view: "yoy" },
      {
        type: "contrib", title: "Cross-check: consumption deflator",
        subtitle: "Household consumption deflator, y/y; contributions in pp. 4 groups from national accounts",
        bars: [
          { id: "sdq_demand.LT",    label: "Demand-driven", slot: 2 },
          { id: "sdq_supply.LT",    label: "Supply-driven", slot: 3 },
          { id: "sdq_ambiguous.LT", label: "Ambiguous",     slot: "other" },
        ],
        total: { id: "sdq_total.LT", label: "Deflator inflation" },
        maxYears: 10, info: "sd",
      },
    ],
  },
];

// Fixed colour order: colour follows the country, whatever else is on the chart.
export const GEO_SLOT = { LT: 1, EA21: 2, EU27_2020: 2, LV: 3, EE: 4 };

export const VIEW_SHORT = {
  level: "Level", diff: "Change", pop: "q/q", pop_ann: "q/q ann.", yoy: "y/y",
  yoy_diff: "Change y/y", "index:2019": "Index 2019=100", "ma:3": "3-{p} avg",
  "yoy_ma:3": "y/y, 3-{p} avg",
};

export const RANGES = [
  { id: "3y", label: "3Y", years: 3 },
  { id: "5y", label: "5Y", years: 5 },
  { id: "10y", label: "10Y", years: 10 },
  { id: "20y", label: "20Y", years: 20 },
  { id: "all", label: "All", years: null },
];
