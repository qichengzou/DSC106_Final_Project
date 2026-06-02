// Data — MONTHS is calendar order (0-indexed). The story is told on a water-year
// axis (Oct → Sep), so every plotted series is built in WY_ORDER, not calendar order.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// water-year order as CALENDAR indices: Oct(9), Nov(10), Dec(11), Jan(0) ... Sep(8)
const WY_ORDER  = [9,10,11,0,1,2,3,4,5,6,7,8];
const WY_LABELS = WY_ORDER.map((i) => MONTHS[i]); // ["Oct",...,"Sep"]

const DATA_URL = new URL("data/sierra_snowmelt_profiles.csv", document.baseURI).href;
const PROJECTED_SCENARIO = "ssp585";
const SECONDS_PER_DAY = 86400; // snm flux (kg m^-2 s^-1) × 86400 → mm/day

// Illustrative agricultural water demand (not from CMIP6), calendar order Jan..Dec.
const demand = [8, 7, 10, 15, 38, 70, 100, 97, 62, 28, 10, 7];

// Display mode: normalized (each curve scaled to its own peak — timing only) by
// default; raw = mm/day (timing + volume).
let normalize = true;

// Parsed snowmelt records: scenario -> 12 calendar-ordered records.
let scenarioData = { historical: null, projected: null };

// Tooltip metadata lookup: "${scenario}-${month}" -> { mean_kgm2, model_count, self_index }
let metadataByKey = {};

function profileFromCsv(rows, scenario) {
  const recs = rows
    .filter((d) => d.scenario === scenario)
    .sort((a, b) => d3.ascending(a.month, b.month))
    .map((d) => ({
      monthIdx: d.month - 1,          // 0-11 calendar
      flux: d.mean,                   // kg m^-2 s^-1
      selfIndex: Math.max(0, d.self_index),
      modelCount: d.model_count,
    }));

  if (recs.length !== 12) return null;
  if (recs.some((r) => !Number.isFinite(r.flux) || !Number.isFinite(r.selfIndex))) {
    throw new Error(`Non-numeric snowmelt values for scenario ${scenario}`);
  }
  return recs;
}

function showLoadError(message) {
  const el = document.getElementById("chart-load-error");
  if (!el) return;
  el.innerHTML = message;
  el.classList.add("visible");
}

function hideLoadError() {
  const el = document.getElementById("chart-load-error");
  if (!el) return;
  el.classList.remove("visible");
  el.textContent = "";
}

async function loadSnowProfiles() {
  if (window.location.protocol === "file:") {
    throw new Error("FILE_PROTOCOL");
  }

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} loading ${DATA_URL}`);
  }

  const rows = d3.csvParse(await response.text(), (d) => ({
    scenario: (d.scenario || "").trim(),
    month: +d.month,
    mean: +d.mean,                // snm flux (kg m^-2 s^-1)
    self_index: +d.self_index,    // indexed so each scenario's own peak = 100
    model_count: +d.model_count,
  }));

  // Tooltip metadata lookup (carries self_index for the normalized secondary line).
  metadataByKey = {};
  rows.forEach((d) => {
    metadataByKey[`${d.scenario}-${d.month}`] = {
      mean_kgm2: d.mean,
      model_count: d.model_count,
      self_index: d.self_index,
    };
  });

  const hist = profileFromCsv(rows, "historical");
  const proj = profileFromCsv(rows, PROJECTED_SCENARIO);

  if (!hist || !proj) {
    const scenarios = [...new Set(rows.map((d) => d.scenario))];
    throw new Error(
      `Expected 12 monthly rows per scenario in ${DATA_URL}. ` +
      `Found scenarios: ${scenarios.join(", ")}`
    );
  }

  return { historical: hist, projected: proj };
}

// Build a water-year plotting array (Oct..Sep) from 12 calendar records. The
// area/line generators connect points in array order, so this MUST be water-year
// ordered to avoid a zig-zag path.
function waterYearPoints(recs) {
  const byCal = {};
  recs.forEach((r) => { byCal[r.monthIdx] = r; });
  return WY_ORDER.map((ci, pos) => {
    const r = byCal[ci];
    const value = normalize ? r.selfIndex : r.flux * SECONDS_PER_DAY; // mm/day when raw
    return { pos, monthIdx: ci, label: MONTHS[ci], value };
  });
}

// Illustrative demand, self-normalized to its own peak (0-100), water-year order.
// Demand has no mm/day meaning, so it is only ever shown on the normalized axis.
function demandWaterYearPoints() {
  const dmax = Math.max(...demand);
  return WY_ORDER.map((ci, pos) => ({
    pos, monthIdx: ci, label: MONTHS[ci], value: (demand[ci] / dmax) * 100,
  }));
}

// Chart setup
const svg   = d3.select("#chart-svg");
const W     = () => svg.node().getBoundingClientRect().width;
const H     = () => svg.node().getBoundingClientRect().height;
const MARGIN = { top: 52, right: 24, bottom: 44, left: 56 };

const x = d3.scalePoint().domain(WY_LABELS).padding(0.1);
const y = d3.scaleLinear();

// Generators reference the live x/y scales; ranges/domains are set in draw().
const area = d3.area()
  .x((d) => x(d.label))
  .y0(() => y(0))
  .y1((d) => y(d.value))
  .curve(d3.curveCatmullRom.alpha(0.5));

const line = d3.line()
  .x((d) => x(d.label))
  .y((d) => y(d.value))
  .curve(d3.curveCatmullRom.alpha(0.5));

function innerW() { return W() - MARGIN.left - MARGIN.right; }
function innerH() { return H() - MARGIN.top  - MARGIN.bottom; }

// SVG elements
const defs = svg.append("defs");
defs.append("marker")
  .attr("id", "arrow-shift")
  .attr("viewBox", "0 0 10 10").attr("refX", 5).attr("refY", 5)
  .attr("markerWidth", 6).attr("markerHeight", 6)
  .attr("orient", "auto-start-reverse")
  .append("path").attr("d", "M0,5 L10,0 L10,10 Z").attr("fill", "var(--text)");

const root = svg.append("g")
  .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

const gridG  = root.append("g").attr("class","grid");
const xAxisG = root.append("g").attr("class","x-axis");
const yAxisG = root.append("g").attr("class","y-axis");

const yAxisTitle = root.append("text").attr("class","axis-title")
  .attr("transform","rotate(-90)").attr("text-anchor","middle")
  .attr("fill","var(--text-dim)").attr("font-size","10px")
  .attr("font-family","'IBM Plex Mono',monospace");
const xAxisTitle = root.append("text").attr("class","axis-title")
  .attr("text-anchor","middle")
  .attr("fill","var(--text-dim)").attr("font-size","10px")
  .attr("font-family","'IBM Plex Mono',monospace")
  .text("Oct → Sep");

const demandAreaPath = root.append("path").attr("class","demand-area").attr("opacity",0);
const demandLinePath = root.append("path").attr("class","demand-line").attr("opacity",0);

const histAreaPath = root.append("path").attr("class","hist-area");
const histLinePath = root.append("path").attr("class","hist-line");

const projAreaPath = root.append("path").attr("class","proj-area").attr("opacity",0);
const projLinePath = root.append("path").attr("class","proj-line").attr("opacity",0);

const histPeak = root.append("g").attr("class","peak-hist").attr("opacity",0);
histPeak.append("line").attr("stroke","var(--blue)").attr("stroke-width",1)
  .attr("stroke-dasharray","3 3");
histPeak.append("text").attr("class","peak-label")
  .attr("fill","var(--blue)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .text("Hist. melt peak");

const projPeak = root.append("g").attr("class","peak-proj").attr("opacity",0);
projPeak.append("line").attr("stroke","var(--red)").attr("stroke-width",1)
  .attr("stroke-dasharray","3 3");
projPeak.append("text").attr("class","peak-label")
  .attr("fill","var(--red)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .text("Proj. melt peak");

const demandPeak = root.append("g").attr("class","peak-demand").attr("opacity",0);
demandPeak.append("line").attr("stroke","var(--demand)").attr("stroke-width",1)
  .attr("stroke-dasharray","3 3");
demandPeak.append("text").attr("class","peak-label")
  .attr("fill","var(--demand)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .text("Water demand peak");

// "peak shifts ~N month(s) earlier" annotation (arrow points to the earlier peak).
const peakShift = root.append("g").attr("class","peak-shift").attr("opacity",0);
peakShift.append("line").attr("class","peak-shift-line")
  .attr("stroke","var(--text)").attr("stroke-width",1)
  .attr("marker-start","url(#arrow-shift)");
peakShift.append("text").attr("class","peak-shift-label")
  .attr("fill","var(--text)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px").attr("text-anchor","middle");

// "~N-month water gap" annotation — same style as the peak-shift annotation, but a
// double-headed span at mid-height between the projected melt peak and the demand peak.
// Replaces the peak-shift annotation on the final step.
const gapAnnotation = root.append("g").attr("class","gap-annotation").attr("opacity",0);
gapAnnotation.append("line").attr("class","gap-line")
  .attr("stroke","var(--text)").attr("stroke-width",1)
  .attr("marker-start","url(#arrow-shift)")
  .attr("marker-end","url(#arrow-shift)");
gapAnnotation.append("text").attr("class","gap-label")
  .attr("fill","var(--text)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px").attr("text-anchor","middle");

// Hover hit targets — appended last so they sit on top of paths & annotations.
const tooltipTargets = root.append("g").attr("class","tooltip-targets");

function placePeakLabel(textSel, px, py, iW) {
  const nearLeft = px < iW * 0.22;
  const nearRight = px > iW * 0.78;

  if (nearLeft) {
    textSel
      .attr("x", px + 8)
      .attr("y", py)
      .attr("dy", "-10px")
      .attr("text-anchor", "start");
  } else if (nearRight) {
    textSel
      .attr("x", px - 8)
      .attr("y", py)
      .attr("dy", "-10px")
      .attr("text-anchor", "end");
  } else {
    textSel
      .attr("x", px)
      .attr("y", py)
      .attr("dy", "-10px")
      .attr("text-anchor", "middle");
  }
}

// ---- Tooltip (hover interaction) ----
const MONTH_FULL = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];

function demandPhase(monthIdx) {
  if ([10,11,0,1,2,3].includes(monthIdx)) return "Low — winter dormancy";
  if ([4,5].includes(monthIdx)) return "Rising — growing season begins";
  if ([6,7].includes(monthIdx)) return "Near peak — agricultural draw";
  return "Tapering — late season"; // Sep, Oct
}

function metaFor(series, monthIdx) {
  const scenario = series === "historical" ? "historical"
    : series === "projected" ? PROJECTED_SCENARIO
    : null;
  if (!scenario) return null;
  return metadataByKey[`${scenario}-${monthIdx + 1}`] || null;
}

// Only show a tooltip for a series the chart is currently displaying.
function isSeriesVisible(series) {
  const className = series === "historical" ? "hist-line"
    : series === "projected" ? "proj-line"
    : series === "demand" ? "demand-line"
    : null;
  if (!className) return false;
  const path = svg.select(`.${className}`);
  if (path.empty()) return false;
  return +path.attr("opacity") > 0.1;
}

function tooltipHtml(series, monthIdx) {
  const month = MONTH_FULL[monthIdx];

  if (series === "demand") {
    return `
      <div class="tt-eyebrow"><span class="tt-month">${month}</span> · WATER DEMAND</div>
      <div class="tt-primary">${demandPhase(monthIdx)}</div>
      <div class="tt-footer">
        <div class="tt-footer-line">Illustrative</div>
        <div class="tt-footer-line">Not from CMIP6</div>
      </div>`;
  }

  const meta = metaFor(series, monthIdx);
  const mmLine = meta
    ? `<div class="tt-primary">${(meta.mean_kgm2 * SECONDS_PER_DAY).toFixed(2)} mm/day</div>`
    : "";
  const selfLine = meta && Number.isFinite(meta.self_index)
    ? `<div class="tt-secondary">${Math.round(meta.self_index)}% of its own peak</div>`
    : "";
  const count = meta ? `${meta.model_count}-model ensemble · GFDL-CM4, GFDL-ESM4` : "";

  if (series === "historical") {
    return `
      <div class="tt-eyebrow"><span class="tt-month">${month}</span> · SNOWMELT</div>
      ${mmLine}
      ${selfLine}
      <div class="tt-footer">
        <div class="tt-footer-line">Historical · 1970–2000</div>
        <div class="tt-footer-line">${count}</div>
      </div>`;
  }

  // projected (SSP5-8.5)
  return `
    <div class="tt-eyebrow"><span class="tt-month">${month}</span> · PROJECTED · SSP5-8.5</div>
    ${mmLine}
    ${selfLine}
    <div class="tt-footer">
      <div class="tt-footer-line">Projected · 2070–2100</div>
      <div class="tt-footer-line">${count}</div>
    </div>`;
}

function positionTooltip(event) {
  const tt = document.getElementById("chart-tooltip");
  if (!tt) return;
  const rect = tt.getBoundingClientRect();
  const pad = 12;
  let x = event.clientX + pad;
  let y = event.clientY - rect.height - pad;
  // right-edge collision -> flip to left of cursor
  if (x + rect.width > window.innerWidth - 8) {
    x = event.clientX - rect.width - pad;
  }
  // top-edge collision -> flip below cursor
  if (y < 8) {
    y = event.clientY + pad;
  }
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

function showTooltip(event, series, monthIdx) {
  const tt = document.getElementById("chart-tooltip");
  if (!tt) return;
  tt.innerHTML = tooltipHtml(series, monthIdx);
  tt.setAttribute("data-series", series);
  tt.setAttribute("aria-hidden", "false");
  tt.classList.add("visible");
  positionTooltip(event);
}

function hideTooltip() {
  const tt = document.getElementById("chart-tooltip");
  if (!tt) return;
  tt.classList.remove("visible");
  tt.setAttribute("aria-hidden", "true");
}

// Water-year positions of each peak (set in draw, consumed by applyVisibility).
let histPeakPos = -1;
let projPeakPos = -1;

// Draw/update chart
function draw() {
  const width = W();
  const height = H();
  if (width <= 0 || height <= 0) return;

  svg.attr("width", width).attr("height", height);

  const iW = innerW();
  const iH = innerH();
  if (iW <= 0 || iH <= 0) return;

  x.range([0, iW]);

  const hist = scenarioData.historical;
  const proj = scenarioData.projected;
  const histPts = hist ? waterYearPoints(hist) : null;
  const projPts = proj ? waterYearPoints(proj) : null;
  const demandPts = demandWaterYearPoints();

  // Dynamic y-domain by mode. Raw is based on hist+proj (historical dominates, so
  // the axis stays put as projected fades in); normalized maxes at 100.
  if (normalize) {
    y.domain([0, 110]);
  } else {
    const vals = [];
    if (histPts) histPts.forEach((p) => vals.push(p.value));
    if (projPts) projPts.forEach((p) => vals.push(p.value));
    const vmax = vals.length ? d3.max(vals) : 1;
    y.domain([0, vmax * 1.1]).nice();
  }
  y.range([iH, 0]);

  gridG.selectAll("line").data(y.ticks(5)).join("line")
    .attr("x1",0).attr("x2",iW)
    .attr("y1",d=>y(d)).attr("y2",d=>y(d))
    .attr("stroke","rgba(255,255,255,0.05)").attr("stroke-width",1);

  xAxisG.attr("transform",`translate(0,${iH})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(10))
    .call(g => g.select(".domain").attr("stroke","rgba(255,255,255,0.1)"))
    .call(g => g.selectAll("text")
      .attr("fill","var(--text-dim)")
      .attr("font-size","11px")
      .attr("font-family","'IBM Plex Mono',monospace"));

  const yTickFormat = normalize ? ((d) => `${d}`) : d3.format(".2f");
  yAxisG.call(d3.axisLeft(y).ticks(5).tickFormat(yTickFormat).tickSize(0).tickPadding(8))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll("text")
      .attr("fill","var(--text-dim)")
      .attr("font-size","10px")
      .attr("font-family","'IBM Plex Mono',monospace"));

  yAxisTitle.attr("x", -iH / 2).attr("y", -(MARGIN.left - 14))
    .text(normalize ? "% of each curve's own peak" : "snowmelt (mm/day)");
  xAxisTitle.attr("x", iW / 2).attr("y", iH + 34);

  if (normalize) {
    demandAreaPath.attr("d", area(demandPts)).attr("fill","var(--demand-dim)");
    demandLinePath.attr("d", line(demandPts)).attr("fill","none")
      .attr("stroke","var(--demand)").attr("stroke-width",2).attr("stroke-dasharray","5 4");
  } else {
    // Raw mm/day axis: demand (a 0-100 index) has no place here. Cancel any
    // in-flight fade and hide instantly so it cannot flash mis-scaled.
    demandAreaPath.interrupt().attr("opacity", 0);
    demandLinePath.interrupt().attr("opacity", 0);
    demandPeak.interrupt().attr("opacity", 0);
    gapAnnotation.interrupt().attr("opacity", 0);
  }

  if (histPts) {
    histAreaPath.attr("d", area(histPts)).attr("fill","var(--blue-dim)").attr("opacity",1);
    histLinePath.attr("d", line(histPts)).attr("fill","none")
      .attr("stroke","var(--blue)").attr("stroke-width",2.5).attr("opacity",1);
  }
  if (projPts) {
    projAreaPath.attr("d", area(projPts)).attr("fill","var(--red-dim)");
    projLinePath.attr("d", line(projPts)).attr("fill","none")
      .attr("stroke","var(--red)").attr("stroke-width",2.5);
  }

  // Hover hit targets — built from water-year arrays, carrying calendar monthIdx
  // for the metadata lookup. Demand targets exist only in normalized mode.
  const targetData = [];
  if (projPts) projPts.forEach((p) =>
    targetData.push({ series:"projected", monthIdx:p.monthIdx, cx:x(p.label), cy:y(p.value) }));
  if (normalize) demandPts.forEach((p) =>
    targetData.push({ series:"demand", monthIdx:p.monthIdx, cx:x(p.label), cy:y(p.value) }));
  if (histPts) histPts.forEach((p) =>
    targetData.push({ series:"historical", monthIdx:p.monthIdx, cx:x(p.label), cy:y(p.value) }));

  tooltipTargets.selectAll("circle")
    .data(targetData)
    .join("circle")
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", 14)
    .attr("fill", "transparent")
    .attr("stroke", "none")
    .attr("data-series", (d) => d.series)
    .attr("data-month", (d) => d.monthIdx)
    .on("mouseenter", (event, d) => {
      if (!isSeriesVisible(d.series)) return;
      showTooltip(event, d.series, d.monthIdx);
    })
    .on("mousemove", (event) => positionTooltip(event))
    .on("mouseleave", hideTooltip);

  if (!histPts || !projPts) { histPeakPos = -1; projPeakPos = -1; return; }

  // Peaks = max-value point of each scenario's water-year array.
  const histPk = histPts.reduce((a, b) => (b.value > a.value ? b : a));
  const projPk = projPts.reduce((a, b) => (b.value > a.value ? b : a));
  histPeakPos = histPk.pos;
  projPeakPos = projPk.pos;

  const hpx = x(histPk.label), ppx = x(projPk.label);
  const histY = y(histPk.value), projY = y(projPk.value);

  histPeak.select("line").attr("x1",hpx).attr("x2",hpx).attr("y1",histY).attr("y2",iH);
  projPeak.select("line").attr("x1",ppx).attr("x2",ppx).attr("y1",projY).attr("y2",iH);

  // When the two peak months are adjacent, splay the labels outward so they don't
  // collide (projected label to the left of its peak, historical to the right).
  const peaksClose = Math.abs(hpx - ppx) < iW * 0.14;
  if (peaksClose) {
    projPeak.select("text").attr("text-anchor","end")
      .attr("x", ppx - 6).attr("y", projY).attr("dy","-10px");
    histPeak.select("text").attr("text-anchor","start")
      .attr("x", hpx + 6).attr("y", histY).attr("dy","-10px");
  } else {
    placePeakLabel(histPeak.select("text"), hpx, histY, iW);
    placePeakLabel(projPeak.select("text"), ppx, projY, iW);
  }

  // Peak-shift annotation: line from the projected (earlier) peak to the historical
  // peak, arrow on the earlier end, label centered just above the higher peak.
  const monthsShift = histPk.pos - projPk.pos;
  if (monthsShift !== 0) {
    const peakTop = Math.min(histY, projY);
    const shiftY = Math.max(2, peakTop - 46);
    peakShift.select("line")
      .attr("x1", ppx).attr("y1", shiftY)
      .attr("x2", hpx).attr("y2", shiftY);
    peakShift.select("text")
      .attr("x", (ppx + hpx) / 2).attr("y", shiftY - 5)
      .text(`peak shifts ~${Math.abs(monthsShift)} month${Math.abs(monthsShift) > 1 ? "s" : ""} earlier`);
  }

  // Water-gap annotation (normalized only): a double-headed span at mid-height from
  // the projected melt peak to the summer demand peak — same style as the peak-shift
  // annotation, which it replaces on the final step.
  if (normalize) {
    const demandPk = demandPts.reduce((a, b) => (b.value > a.value ? b : a));
    const dpx = x(demandPk.label);
    const gapMonths = Math.abs(demandPk.pos - projPk.pos);
    const gapY = iH / 2;
    gapAnnotation.select(".gap-line")
      .attr("x1", ppx).attr("y1", gapY)
      .attr("x2", dpx).attr("y2", gapY);
    gapAnnotation.select(".gap-label")
      .attr("x", (ppx + dpx) / 2).attr("y", gapY - 6)
      .text(`~${gapMonths}-month water gap`);

    const demandPkY = y(demandPk.value);
    demandPeak.select("line")
      .attr("x1", dpx).attr("x2", dpx)
      .attr("y1", demandPkY).attr("y2", iH);
    placePeakLabel(demandPeak.select("text"), dpx, demandPkY, iW);
  }
}

window.addEventListener("resize", draw);

// Redraw once the SVG has layout dimensions (flex + async CSV load)
if (typeof ResizeObserver !== "undefined") {
  const chartObserver = new ResizeObserver(() => draw());
  chartObserver.observe(svg.node());
}

// Scrollytelling
const steps = document.querySelectorAll(".step");
const dots  = document.querySelectorAll(".dot");

let currentStep = 0;

// Per-step visibility + preferred mode. normalized=false means the step prefers
// raw mm/day. A manual toggle overrides until the next step boundary re-applies.
const STEP_CONFIG = {
  0: { proj:false, histPeak:false, projPeak:false, shift:false, demand:false, normalized:true  },
  1: { proj:false, histPeak:true,  projPeak:false, shift:false, demand:false, normalized:true  },
  2: { proj:true,  histPeak:true,  projPeak:true,  shift:true,  demand:false, normalized:true  },
  3: { proj:true,  histPeak:true,  projPeak:true,  shift:true,  demand:false, normalized:false },
  4: { proj:true,  histPeak:true,  projPeak:true,  shift:false, demand:true,  normalized:true  },
};

function applyVisibility(animate) {
  const cfg = STEP_CONFIG[currentStep] || STEP_CONFIG[0];
  const both = !!(scenarioData.historical && scenarioData.projected);
  const projShown   = cfg.proj && both;
  const histPkShown = cfg.histPeak && !!scenarioData.historical;
  const projPkShown = cfg.projPeak && projShown;
  const shiftShown  = cfg.shift && projShown && histPeakPos >= 0 && histPeakPos !== projPeakPos;
  const demandShown = cfg.demand && normalize;

  const tt = (sel, dur) => (animate ? sel.transition().duration(dur) : sel);

  tt(projAreaPath, 700).attr("opacity", projShown ? 1 : 0);
  tt(projLinePath, 700).attr("opacity", projShown ? 1 : 0);
  tt(histPeak, 500).attr("opacity", histPkShown ? 1 : 0);
  tt(projPeak, 500).attr("opacity", projPkShown ? 1 : 0);
  tt(peakShift, 500).attr("opacity", shiftShown ? 1 : 0);
  tt(demandAreaPath, 700).attr("opacity", demandShown ? 1 : 0);
  tt(demandLinePath, 700).attr("opacity", demandShown ? 0.7 : 0);
  tt(demandPeak, 500).attr("opacity", demandShown ? 1 : 0);
  tt(gapAnnotation, 800).attr("opacity", demandShown ? 1 : 0);

  d3.select("#legend-future").style("opacity", projShown ? "1" : "0");
  d3.select("#legend-demand").style("opacity", demandShown ? "1" : "0");
}

function setStep(i) {
  currentStep = i;
  dots.forEach((d, j) => d.classList.toggle("active", j === i));
  const cfg = STEP_CONFIG[i] || STEP_CONFIG[0];
  normalize = cfg.normalized; // apply the step's preferred mode
  draw();
  applyVisibility(true);
}

// Intersection observer
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      setStep(+entry.target.dataset.step);
    }
  });
}, { threshold: 0.5 });

steps.forEach((s) => observer.observe(s));

// Progress dot navigation
dots.forEach((d) => {
  d.addEventListener("click", () => {
    steps[+d.dataset.step].scrollIntoView({ behavior:"smooth", block:"center" });
  });
});

// Draw demand/axes immediately; load snow curves from CSV
draw();

if (window.location.protocol === "file:") {
  showLoadError(
    "Snowpack data cannot load when this page is opened as a local file " +
    "(<code>file://</code>). Run a local web server from the project folder, then open " +
    "<code>http://localhost:5500/index.html</code>:<br><br>" +
    "<code>cd DSC106_Final_Project</code><br>" +
    "<code>python3 -m http.server 5500</code>"
  );
} else {
  loadSnowProfiles()
    .then((profiles) => {
      hideLoadError();
      scenarioData.historical = profiles.historical;
      scenarioData.projected = profiles.projected;
      console.info("Loaded snow profiles from", DATA_URL, scenarioData);
      draw();
      setStep(currentStep);
    })
    .catch((err) => {
      console.error("Failed to load snow profile CSV:", err);
      const fileHint = err.message === "FILE_PROTOCOL"
        ? "Use <code>python3 -m http.server 5500</code> instead of opening the HTML file directly."
        : `Check that <code>data/sierra_snowmelt_profiles.csv</code> exists and the dev server is running.`;
      showLoadError(
        "Could not load snowpack CSV. " + fileHint
      );
    });
}


// ============================================================
// Scene 2 — A Century of Storage
// April 1 Sierra Nevada SWE anomaly, 1950–2023
// Anomaly in inches relative to 1981–2010 mean
// Source: DWR / NRCS cooperative snow surveys + reanalysis
// ============================================================

let S2_DATA = [];

async function loadSWEData() {
  const url = new URL("data/sierra_april1_swe.csv", document.baseURI).href;
  const res = await fetch(url);
  const text = await res.text();
  S2_DATA = d3.csvParse(text, d => ({
    year: +d.year,
    anomaly: +d.anomaly,
  }));
}

async function initScene2() {
  await loadSWEData();
  const meanX = d3.mean(S2_DATA, d => d.year);
  const meanY = d3.mean(S2_DATA, d => d.anomaly);
  const num = d3.sum(S2_DATA, d => (d.year - meanX) * (d.anomaly - meanY));
  const den = d3.sum(S2_DATA, d => (d.year - meanX) ** 2);
  const trendSlope = { m: num / den, b: 0 };
  trendSlope.b = meanY - trendSlope.m * meanX;
  
  const svg2 = d3.select("#scene2-svg");
  const slider = document.getElementById("scene2-slider");
  const yearVal = document.getElementById("scene2-year-val");
  const statBox = document.getElementById("scene2-stat");

  if (!svg2.node() || !slider) return;

  const M2 = { top: 24, right: 24, bottom: 36, left: 52 };

  const x2 = d3.scaleLinear().domain([1950, 2023]);
  const y2 = d3.scaleLinear();

  const svgNode = svg2.node();

  let root2, gridG2, xAxisG2, yAxisG2, zeroLine2,
      areaPos2, areaNeg2, lineG2, trendG2, dotG2, clipPath2;

  function setup2() {
    svg2.selectAll("*").remove();

    const anomalyExtent = d3.extent(S2_DATA, d => d.anomaly);
    const pad = Math.max(1, (anomalyExtent[1] - anomalyExtent[0]) * 0.15);
    y2.domain([anomalyExtent[0] - pad, anomalyExtent[1] + pad]);

    const W2 = svgNode.getBoundingClientRect().width;
    const H2 = svgNode.getBoundingClientRect().height;
    const iW2 = W2 - M2.left - M2.right;
    const iH2 = H2 - M2.top - M2.bottom;

    x2.range([0, iW2]);
    y2.range([iH2, 0]);

    const defs = svg2.append("defs");

    defs.append("clipPath").attr("id", "s2-clip")
      .append("rect").attr("x", 0).attr("y", -M2.top)
        .attr("width", 0).attr("height", iH2 + M2.top + M2.bottom);

    defs.append("linearGradient").attr("id", "s2-grad-pos")
        .attr("x1","0").attr("y1","0").attr("x2","0").attr("y2","1")
      .selectAll("stop")
      .data([
        { offset: "0%", color: "rgba(79,168,213,0.25)" },
        { offset: "100%", color: "rgba(79,168,213,0.02)" }
      ])
      .join("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);

    defs.append("linearGradient").attr("id", "s2-grad-neg")
        .attr("x1","0").attr("y1","1").attr("x2","0").attr("y2","0")
      .selectAll("stop")
      .data([
        { offset: "0%", color: "rgba(224,90,74,0.22)" },
        { offset: "100%", color: "rgba(224,90,74,0.02)" }
      ])
      .join("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);

    root2 = svg2.append("g")
      .attr("transform", `translate(${M2.left},${M2.top})`);

    gridG2 = root2.append("g");
    xAxisG2 = root2.append("g").attr("transform", `translate(0,${iH2})`);
    yAxisG2 = root2.append("g");

    zeroLine2 = root2.append("line")
      .attr("x1", 0).attr("x2", iW2)
      .attr("y1", y2(0)).attr("y2", y2(0))
      .attr("stroke", "rgba(255,255,255,0.18)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 3");

    const clipG = root2.append("g").attr("clip-path", "url(#s2-clip)");
    clipPath2 = svg2.select("#s2-clip rect");

    areaPos2 = clipG.append("path").attr("fill", "url(#s2-grad-pos)");
    areaNeg2 = clipG.append("path").attr("fill", "url(#s2-grad-neg)");
    lineG2 = clipG.append("path")
      .attr("fill", "none")
      .attr("stroke", "var(--blue)")
      .attr("stroke-width", 2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round");

    trendG2 = root2.append("line")
      .attr("stroke", "var(--red)")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "6 3")
      .attr("opacity", 0.7);

    dotG2 = root2.append("circle")
      .attr("r", 5)
      .attr("fill", "var(--blue)")
      .attr("stroke", "var(--bg)")
      .attr("stroke-width", 2)
      .attr("opacity", 0);

    drawAxes2(iW2, iH2);
    redrawScene2(+slider.value);
  }

  function drawAxes2(iW2, iH2) {
    gridG2.selectAll("line").data(y2.ticks(6)).join("line")
      .attr("x1", 0).attr("x2", iW2)
      .attr("y1", d => y2(d)).attr("y2", d => y2(d))
      .attr("stroke", "rgba(255,255,255,0.04)")
      .attr("stroke-width", 1);

    xAxisG2.call(
      d3.axisBottom(x2).ticks(8).tickFormat(d3.format("d")).tickSize(0).tickPadding(10)
    )
      .call(g => g.select(".domain").attr("stroke", "rgba(255,255,255,0.1)"))
      .call(g => g.selectAll("text")
        .attr("fill", "var(--text-dim)")
        .attr("font-size", "11px")
        .attr("font-family", "'IBM Plex Mono',monospace"));

    yAxisG2.call(
      d3.axisLeft(y2).ticks(6).tickFormat(d => (d > 0 ? "+" : "") + d + '"').tickSize(0).tickPadding(8)
    )
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll("text")
        .attr("fill", "var(--text-dim)")
        .attr("font-size", "10px")
        .attr("font-family", "'IBM Plex Mono',monospace"));
  }

  function redrawScene2(endYear) {
    const W2 = svgNode.getBoundingClientRect().width;
    const H2 = svgNode.getBoundingClientRect().height;
    const iW2 = W2 - M2.left - M2.right;
    const iH2 = H2 - M2.top - M2.bottom;

    const visible = S2_DATA.filter(d => d.year <= endYear);
    if (!visible.length) return;

    const clipW = x2(endYear) - x2(1950) + x2(1951) - x2(1950);
    clipPath2.attr("width", Math.max(0, clipW));

    const areaPosFn = d3.area()
      .x(d => x2(d.year))
      .y0(y2(0))
      .y1(d => d.anomaly >= 0 ? y2(d.anomaly) : y2(0))
      .curve(d3.curveMonotoneX);

    const areaNegFn = d3.area()
      .x(d => x2(d.year))
      .y0(y2(0))
      .y1(d => d.anomaly < 0 ? y2(d.anomaly) : y2(0))
      .curve(d3.curveMonotoneX);

    const lineFn = d3.line()
      .x(d => x2(d.year))
      .y(d => y2(d.anomaly))
      .curve(d3.curveMonotoneX);

    areaPos2.attr("d", areaPosFn(S2_DATA));
    areaNeg2.attr("d", areaNegFn(S2_DATA));
    lineG2.attr("d", lineFn(S2_DATA));

    const trend = trendSlope;
    const tx1 = 1950, tx2 = endYear;
    trendG2
      .attr("x1", x2(tx1)).attr("y1", y2(trend.m * tx1 + trend.b))
      .attr("x2", x2(tx2)).attr("y2", y2(trend.m * tx2 + trend.b));

    const last = visible[visible.length - 1];
    dotG2
      .attr("cx", x2(last.year))
      .attr("cy", y2(last.anomaly))
      .attr("fill", last.anomaly >= 0 ? "var(--blue)" : "var(--red)")
      .attr("opacity", 1);

    yearVal.textContent = endYear;

    const decadeData = S2_DATA.filter(d => d.year >= 1990 && d.year <= endYear);
    const recentMean = decadeData.length
      ? d3.mean(decadeData, d => d.anomaly).toFixed(1)
      : null;

    const sign = last.anomaly >= 0 ? "+" : "";
    const color = last.anomaly >= 0 ? "var(--blue)" : "var(--red)";
    statBox.style.color = color;
    statBox.innerHTML = `April 1, ${endYear}: <strong>${sign}${last.anomaly.toFixed(1)}"</strong> vs. mean` +
      (recentMean !== null && endYear >= 2000
        ? `<br>1990–${endYear} avg: <strong>${recentMean >= 0 ? "+" : ""}${recentMean}"</strong>`
        : "");
  }

  slider.addEventListener("input", () => redrawScene2(+slider.value));

  setup2();
  const ro2 = new ResizeObserver(() => setup2());
  ro2.observe(svgNode);
}

initScene2();

// ============================================================
// Scene 1 — The cause: what winter precipitation falls as
// CMIP6 prsn/pr cold-season (Nov–Mar) snow fraction over the Sierra box,
// 2 GFDL models. Reads data/sierra_snowfall_seasons.csv (+ tas seasons for
// the warming chips) with an embedded snapshot fallback so the pane renders
// even before fetch (e.g. opened via file://). Namespaced scene1 / Scene1.
// ============================================================

const SCENE1_SEASONS = [
  { key: "historical", label: "Historical", years: "1970–2000", precip: 20.446, snow: 5.060, warm: 0.0,  color: "var(--blue)"  },
  { key: "ssp245",     label: "SSP2-4.5",   years: "2070–2100", precip: 21.375, snow: 3.364, warm: 2.39, color: "var(--green)" },
  { key: "ssp585",     label: "SSP5-8.5",   years: "2070–2100", precip: 22.404, snow: 2.578, warm: 3.75, color: "var(--red)"   },
];
let scene1Mode = "share"; // "share" | "amount"

async function loadScene1Data() {
  try {
    const base = document.baseURI;
    const sf = await d3.csv(new URL("data/sierra_snowfall_seasons.csv", base).href, d3.autoType);
    let tas = null;
    try { tas = await d3.csv(new URL("data/sierra_tas_seasons.csv", base).href, d3.autoType); } catch (e) { /* optional */ }
    if (sf && sf.length) {
      SCENE1_SEASONS.forEach((s) => {
        const r = sf.find((d) => d.scenario === s.key);
        if (r) { s.precip = +r.cold_precip_mm_day; s.snow = +r.cold_snow_mm_day; }
        if (tas) { const tr = tas.find((d) => d.scenario === s.key); if (tr) s.warm = +tr.delta_cold_vs_hist_c; }
      });
    }
  } catch (e) {
    // Embedded snapshot stands (e.g. file:// or missing CSV).
    console.info("Scene 1: using embedded snowfall snapshot —", e.message);
  }
}

function initScene1() {
  const svg = d3.select("#scene1-svg");
  const svgNode = svg.node();
  if (!svgNode) return;

  const frac   = (d) => (d.precip > 0 ? d.snow / d.precip : 0);
  const rain   = (d) => Math.max(0, d.precip - d.snow);
  const fmtPct = (f) => Math.round(f * 100) + "%";
  const fmtMm  = (v) => v.toFixed(1);

  const M1 = { top: 14, right: 66, bottom: 32, left: 142 };
  const x1 = d3.scaleLinear();

  let tip = document.getElementById("scene1-tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "scene1-tip"; document.body.appendChild(tip); }
  const statBox = document.getElementById("scene1-stat");

  function updateStat() {
    if (!statBox) return;
    const h  = SCENE1_SEASONS.find((s) => s.key === "historical");
    const hi = SCENE1_SEASONS.find((s) => s.key === "ssp585");
    if (scene1Mode === "share") {
      statBox.innerHTML =
        `Snow's share of cold-season precip:<br>` +
        `<strong>${fmtPct(frac(h))} → ${fmtPct(frac(hi))}</strong> · historical → SSP5-8.5`;
    } else {
      statBox.innerHTML =
        `Snowfall <strong>${fmtMm(h.snow)} → ${fmtMm(hi.snow)} mm/day</strong>, while total precip ` +
        `holds near <strong>${fmtMm(h.precip)}–${fmtMm(hi.precip)}</strong>.<br>Same weather — less snow.`;
    }
  }

  function setup1() {
    svg.selectAll("*").remove();
    const W = svgNode.getBoundingClientRect().width;
    const H = svgNode.getBoundingClientRect().height;
    const iW = W - M1.left - M1.right;
    const iH = H - M1.top - M1.bottom;
    x1.range([M1.left, M1.left + iW]);

    const gAxis = svg.append("g").attr("class", "s1-axis").attr("transform", `translate(0,${M1.top + iH})`);
    const gBars = svg.append("g").attr("class", "s1-bars");

    const n = SCENE1_SEASONS.length;
    const band = iH / n;
    const barH = Math.min(46, band * 0.5);

    const groups = gBars.selectAll("g.s1-bar").data(SCENE1_SEASONS, (d) => d.key).join((enter) => {
      const g = enter.append("g").attr("class", "s1-bar").style("cursor", "pointer");
      g.append("rect").attr("class", "s1-snow").attr("rx", 2).attr("fill", "var(--snow)");
      g.append("rect").attr("class", "s1-rain").attr("rx", 2).attr("fill", "var(--blue)").attr("fill-opacity", 0.6);
      g.append("text").attr("class", "s1-name").attr("text-anchor", "end").attr("font-family", "'IBM Plex Mono',monospace").attr("font-size", 12);
      g.append("text").attr("class", "s1-year").attr("text-anchor", "end").attr("font-family", "'IBM Plex Mono',monospace").attr("font-size", 9.5).attr("fill", "var(--text-dim)");
      g.append("text").attr("class", "s1-warm").attr("text-anchor", "end").attr("font-family", "'IBM Plex Mono',monospace").attr("font-size", 9.5).attr("fill", "var(--red)");
      g.append("text").attr("class", "s1-pct").attr("font-family", "'Playfair Display',serif").attr("font-size", 17).attr("fill", "var(--snow)");
      return g;
    });

    groups
      .on("mousemove", (ev, d) => {
        tip.style.opacity = 1;
        tip.style.left = (ev.clientX + 14) + "px";
        tip.style.top = (ev.clientY + 14) + "px";
        tip.innerHTML =
          `<div class="h">${d.label} · ${d.years}</div>` +
          `<div class="row"><span>Snow share</span><strong>${fmtPct(frac(d))}</strong></div>` +
          `<div class="row"><span>Snowfall</span><strong>${fmtMm(d.snow)} mm/day</strong></div>` +
          `<div class="row"><span>Rain</span><strong>${fmtMm(rain(d))} mm/day</strong></div>` +
          `<div class="row"><span>Total precip</span><strong>${fmtMm(d.precip)} mm/day</strong></div>` +
          (d.warm > 0 ? `<div class="row"><span>Warming</span><strong>+${d.warm.toFixed(1)} °C</strong></div>` : ``);
      })
      .on("mouseleave", () => { tip.style.opacity = 0; });

    setup1._layout = { band, barH, gAxis, groups };
    redraw1(false);
  }

  function redraw1(animate) {
    const L = setup1._layout;
    if (!L) return;
    const maxAmt = d3.max(SCENE1_SEASONS, (d) => d.precip) * 1.03;
    x1.domain(scene1Mode === "share" ? [0, 100] : [0, maxAmt]);
    const snowVal = (d) => (scene1Mode === "share" ? frac(d) * 100 : d.snow);
    const totVal  = (d) => (scene1Mode === "share" ? 100 : d.precip);
    const t = d3.transition().duration(animate ? 450 : 0);

    const axis = d3.axisBottom(x1).ticks(5).tickSize(0).tickPadding(8)
      .tickFormat(scene1Mode === "share" ? ((v) => v + "%") : ((v) => v));
    L.gAxis.transition(t).call(axis)
      .call((g) => g.select(".domain").attr("stroke", "rgba(255,255,255,0.1)"))
      .call((g) => g.selectAll("text").attr("fill", "var(--text-dim)").attr("font-size", "10px").attr("font-family", "'IBM Plex Mono',monospace"));

    L.groups.each(function (d, i) {
      const g = d3.select(this);
      const y = M1.top + i * L.band + (L.band - L.barH) / 2;
      const mid = y + L.barH / 2;
      const x0 = x1(0), xSnow = x1(snowVal(d)), xTot = x1(totVal(d));
      g.select(".s1-snow").transition(t).attr("x", x0).attr("y", y).attr("height", L.barH).attr("width", Math.max(0, xSnow - x0));
      g.select(".s1-rain").transition(t).attr("x", xSnow).attr("y", y).attr("height", L.barH).attr("width", Math.max(0, xTot - xSnow));
      g.select(".s1-name").attr("x", M1.left - 12).attr("y", mid - 4).attr("fill", d.color).text(d.label);
      g.select(".s1-year").attr("x", M1.left - 12).attr("y", mid + 9).text(d.years);
      g.select(".s1-warm").attr("x", M1.left - 12).attr("y", mid + 21).text(d.warm > 0 ? `+${d.warm.toFixed(1)}°C cold` : "baseline");
      g.select(".s1-pct").transition(t).attr("x", xTot + 8).attr("y", mid + 6).text(fmtPct(frac(d)));
    });
  }

  document.querySelectorAll(".scene1-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene1Mode = btn.dataset.mode;
      document.querySelectorAll(".scene1-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
      updateStat();
      redraw1(true);
    });
  });

  updateStat();
  setup1();
  const ro1 = new ResizeObserver(() => setup1());
  ro1.observe(svgNode);
}

loadScene1Data().then(initScene1);

/* ============================================================ */
/* SCENE 4 · Zoom Out: The Sierra Water Network                 */
/* All Scene 4 code is namespaced with scene4 / Scene4 and is   */
/* self-contained so it cannot disturb the existing scenes.     */
/* ============================================================ */

const SCENE4_MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SCENE4_MONTH_FULL = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

const SCENE4_RIVERS_URL = new URL("data/rivers.geojson", document.baseURI).href;

// Scene 4's own melt profile CSV (has snw_index). Independent of the hydrograph's DATA_URL.
const SCENE4_MELT_URL = new URL("data/sierra_melt_timing_profiles.csv", document.baseURI).href;

// View box (lon/lat). Trimmed to the network's content so the map fills the
// frame: the empty far-north and dead east margin are cropped, which zooms in
// moderately. Map geometry that falls outside is clipped (see drawScene4BaseMap).
const SCENE4_BBOX = { west: -122.6, east: -117.45, south: 33.85, north: 40.55 };

// Approximate outline of the Sierra Nevada range: gentle western foothill line and
// steep eastern escarpment, wider in the north (Tahoe latitude), tapering south to
// Tehachapi. Geographic reference only -- not the exact CMIP6 analysis box.
// Ordered clockwise: north tip -> south down the west foothills -> north up the east front.
const SCENE4_SIERRA_OUTLINE = [
  [-121.00, 40.25],
  [-121.35, 39.75], [-121.15, 39.30], [-120.85, 38.80], [-120.55, 38.30],
  [-120.10, 37.75], [-119.65, 37.25], [-119.20, 36.70], [-118.80, 36.20],
  [-118.55, 35.65], [-118.40, 35.05],
  [-118.05, 35.35], [-118.00, 35.95], [-118.15, 36.45], [-118.45, 37.00],
  [-118.80, 37.55], [-119.10, 38.05], [-119.45, 38.55], [-119.70, 39.00],
  [-119.95, 39.45], [-120.25, 39.95],
];

// State boundaries (CA/NV + neighbors), public-domain GeoJSON trimmed locally.
const SCENE4_STATES_URL = new URL("data/states.geojson", document.baseURI).href;

// Branch + base width metadata for the six target rivers in the network.
const SCENE4_RIVER_META = {
  "Sacramento River": { branch: "west",  baseWidth: 8 },
  "San Joaquin River": { branch: "west",  baseWidth: 7 },
  "Truckee River":     { branch: "east",  baseWidth: 5 },
  "Carson River":      { branch: "east",  baseWidth: 4 },
  "Walker River":      { branch: "east",  baseWidth: 4 },
  "Owens River":       { branch: "owens", baseWidth: 5 },
};

// Approximate paths used only when a target river is absent from the GeoJSON.
const SCENE4_FALLBACK_GEOMETRY = {
  "Truckee River": [
    [-120.13, 39.17], [-120.19, 39.33], [-120.00, 39.44], [-119.81, 39.53],
    [-119.70, 39.65], [-119.61, 39.80], [-119.58, 39.96],
  ],
  "Carson River": [
    [-119.83, 38.62], [-119.78, 38.85], [-119.77, 39.16], [-119.55, 39.24],
    [-119.30, 39.28], [-118.97, 39.43],
  ],
  "Walker River": [
    [-119.45, 38.40], [-119.28, 38.50], [-119.10, 38.55], [-118.90, 38.61],
    [-118.78, 38.66], [-118.71, 38.72],
  ],
  "Owens River": [
    [-118.72, 37.73], [-118.55, 37.52], [-118.42, 37.30], [-118.25, 37.05],
    [-118.12, 36.80], [-118.01, 36.55], [-117.96, 36.43],
  ],
};

// The engineered Los Angeles Aqueduct (Owens Lake -> Los Angeles).
const SCENE4_AQUEDUCT_GEOMETRY = [
  [-117.96, 36.43], [-117.98, 35.95], [-118.05, 35.40], [-118.16, 34.90],
  [-118.27, 34.45], [-118.24, 34.28],
];

// Region / city dependency nodes by branch.
const SCENE4_NODES = [
  { id: "centralvalley", label: "Central Valley farms", lon: -120.55, lat: 37.05, branch: "west",  kind: "region", color: "var(--s4-valley)" },
  { id: "bayarea",       label: "Bay Area",             lon: -122.25, lat: 37.85, branch: "west",  kind: "city",   color: "var(--s4-valley)" },
  { id: "socal",         label: "Southern California",  lon: -117.55, lat: 34.55, branch: "west",  kind: "region", color: "var(--s4-valley)" },
  { id: "reno",          label: "Reno-Sparks",          lon: -119.81, lat: 39.53, branch: "east",  kind: "city",   color: "var(--s4-nevada)" },
  { id: "pyramid",       label: "Pyramid Lake",         lon: -119.58, lat: 39.99, branch: "east",  kind: "lake",   color: "var(--s4-nevada)" },
  { id: "lahontan",      label: "Lahontan Valley",      lon: -118.97, lat: 39.45, branch: "east",  kind: "region", color: "var(--s4-nevada)" },
  { id: "walkerlake",    label: "Walker Lake",          lon: -118.71, lat: 38.74, branch: "east",  kind: "lake",   color: "var(--s4-nevada)" },
  { id: "la",            label: "Los Angeles",          lon: -118.24, lat: 34.05, branch: "owens", kind: "city",   color: "var(--s4-owens)" },
];

// Region polygons (loose blobs) so branches read as dependency areas.
const SCENE4_REGIONS = [
  {
    id: "centralvalley", branch: "west", color: "var(--s4-valley-dim)", stroke: "var(--s4-valley)",
    coords: [[-121.9, 39.5], [-120.9, 39.7], [-119.9, 37.6], [-119.6, 36.6], [-120.4, 36.3], [-121.3, 37.6], [-122.0, 38.6]],
  },
  {
    id: "wnevada", branch: "east", color: "var(--s4-nevada-dim)", stroke: "var(--s4-nevada)",
    coords: [[-120.1, 40.3], [-118.6, 40.2], [-118.4, 38.5], [-119.4, 38.3], [-120.2, 39.3]],
  },
];

const scene4 = {
  initialized: false,
  meltProfiles: null,     // { scenario: { month: {snw_index, mean, median, model_count} } }
  meltOk: false,
  rivers: [],             // [{ name, branch, baseWidth, feature, node, length }]
  states: [],             // state-boundary GeoJSON features (CA/NV + neighbors)
  histPeakMonth: 4,
  projection: null,
  path: null,
  width: 0,
  height: 0,
  current: { scenario: "historical", month: 4, step: 0, branchHighlight: "all" },
  // Per-dimension user locks: once a control is clicked, scroll stops overriding it.
  lock: { scenario: false, month: false, branch: false },
  visualScale: 1,
  particlesOn: false,
  particles: [],
  raf: null,
  lastTs: 0,
  baseSpawnInterval: 820, // ms at visualScale = 1
  // Fallback visual scales (used only if the CMIP6 CSV fails to load).
  fallback: { historical: 1.0, ssp245: 0.7, ssp585: 0.45 },
  el: {},
};

function getScene4ScenarioLabel(scenario) {
  if (scenario === "ssp245") return "SSP2-4.5";
  if (scenario === "ssp585") return "SSP5-8.5";
  return "Historical";
}

function getScene4MonthLabel(month) {
  const idx = Math.max(1, Math.min(12, month)) - 1;
  return SCENE4_MONTH_FULL[idx];
}

// Returns the snw_index (0-100 scale) for a scenario/month.
// Falls back to a fixed visual value (x100) when the CSV is unavailable.
function getScene4MeltValue(scenario, month) {
  if (scene4.meltOk && scene4.meltProfiles[scenario] && scene4.meltProfiles[scenario][month]) {
    return scene4.meltProfiles[scenario][month].snw_index;
  }
  const f = scene4.fallback[scenario];
  return (f !== undefined ? f : 0.6) * 100;
}

function getScene4VisualScale(snwIndex) {
  return Math.max(0.15, Math.min(1.25, snwIndex / 100));
}

async function loadScene4MeltProfiles() {
  if (window.location.protocol === "file:") throw new Error("FILE_PROTOCOL");
  const response = await fetch(SCENE4_MELT_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${SCENE4_MELT_URL}`);

  const rows = d3.csvParse(await response.text(), (d) => ({
    scenario: (d.scenario || "").trim(),
    month: +d.month,
    mean: +d.mean,
    median: +d.median,
    model_count: +d.model_count,
    snw_index: +d.snw_index,
  }));

  const profiles = {};
  rows.forEach((d) => {
    if (!d.scenario || !Number.isFinite(d.month)) return;
    (profiles[d.scenario] || (profiles[d.scenario] = {}))[d.month] = {
      snw_index: d.snw_index,
      mean: d.mean,
      median: d.median,
      model_count: d.model_count,
    };
  });

  if (!profiles.historical) throw new Error("No historical rows in melt profiles CSV.");
  return profiles;
}

async function loadScene4States() {
  if (window.location.protocol === "file:") return [];
  try {
    const response = await fetch(SCENE4_STATES_URL);
    if (!response.ok) return [];
    const geo = await response.json();
    return (geo && geo.features) ? geo.features : [];
  } catch (err) {
    console.warn("Scene 4: states.geojson could not be loaded; skipping outlines.", err);
    return [];
  }
}

async function loadScene4Rivers() {
  if (window.location.protocol === "file:") return [];
  try {
    const response = await fetch(SCENE4_RIVERS_URL);
    if (!response.ok) return [];
    const geo = await response.json();
    return (geo && geo.features) ? geo.features : [];
  } catch (err) {
    console.warn("Scene 4: rivers.geojson could not be loaded; using fallbacks.", err);
    return [];
  }
}

// Map a raw GeoJSON name to one of the canonical target river names.
function normalizeScene4RiverName(rawName) {
  const n = (rawName || "").toLowerCase();
  if (n.includes("sacramento")) return "Sacramento River";
  if (n.includes("san joaquin")) return "San Joaquin River";
  if (n.includes("truckee")) return "Truckee River";
  if (n.includes("carson")) return "Carson River";
  if (n.includes("walker")) return "Walker River";
  if (n.includes("owens")) return "Owens River";
  return null;
}

function makeScene4FallbackRiverFeatures(existingRiverNames) {
  const have = new Set(existingRiverNames);
  const features = [];
  Object.keys(SCENE4_FALLBACK_GEOMETRY).forEach((name) => {
    if (have.has(name)) return;
    const meta = SCENE4_RIVER_META[name];
    features.push({
      name,
      branch: meta.branch,
      baseWidth: meta.baseWidth,
      isFallback: true,
      feature: {
        type: "Feature",
        properties: { name },
        geometry: { type: "LineString", coordinates: SCENE4_FALLBACK_GEOMETRY[name] },
      },
    });
  });
  return features;
}

function mergeLoadedAndFallbackScene4Rivers(loadedFeatures) {
  const merged = [];
  const seen = new Set();

  loadedFeatures.forEach((feat) => {
    const props = feat.properties || {};
    const canonical = normalizeScene4RiverName(props.name || props.name_en || props.originalName);
    if (!canonical || !SCENE4_RIVER_META[canonical] || seen.has(canonical)) return;
    seen.add(canonical);
    const meta = SCENE4_RIVER_META[canonical];
    merged.push({
      name: canonical,
      branch: meta.branch,
      baseWidth: meta.baseWidth,
      isFallback: false,
      feature: feat,
    });
  });

  // Add approximate paths for any target river still missing.
  return merged.concat(makeScene4FallbackRiverFeatures([...seen]));
}

async function loadScene4Data() {
  // Melt profiles (drives river thickness).
  try {
    scene4.meltProfiles = await loadScene4MeltProfiles();
    scene4.meltOk = true;
    // Historical peak melt month (1-12) for the baseline default.
    const hist = scene4.meltProfiles.historical;
    let peakMonth = 4, peakVal = -Infinity;
    Object.keys(hist).forEach((m) => {
      if (hist[m].snw_index > peakVal) { peakVal = hist[m].snw_index; peakMonth = +m; }
    });
    scene4.histPeakMonth = peakMonth;
  } catch (err) {
    console.warn("Scene 4: melt profile CSV not loaded; using visual fallback values.", err);
    scene4.meltOk = false;
  }

  // River geometry (real where available, fallback where not).
  const loaded = await loadScene4Rivers();
  scene4.rivers = mergeLoadedAndFallbackScene4Rivers(loaded);

  // State boundaries for geographic context (optional; skipped if unavailable).
  scene4.states = await loadScene4States();
}

function scene4Measure() {
  const wrap = scene4.el.svgWrap;
  if (!wrap) return false;
  const rect = wrap.getBoundingClientRect();
  scene4.width = Math.max(10, rect.width);
  scene4.height = Math.max(10, rect.height);
  return true;
}

function setupScene4Projection() {
  const { west, east, south, north } = SCENE4_BBOX;
  const bounds = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [west, north], [east, north], [east, south], [west, south], [west, north],
      ]],
    },
  };
  const pad = 10;
  scene4.projection = d3.geoMercator()
    .fitExtent([[pad, pad], [scene4.width - pad, scene4.height - pad]], bounds);
  scene4.path = d3.geoPath(scene4.projection);
}

function scene4LonLat(lon, lat) {
  return scene4.projection([lon, lat]);
}

function drawScene4BaseMap() {
  const svg = scene4.el.svg;
  svg.attr("width", scene4.width).attr("height", scene4.height);

  // <defs>: clip rectangle (= SVG frame) so map geometry cropped by the
  // zoomed-in view doesn't spill into the controls. Node labels are
  // intentionally left unclipped so edge labels stay fully readable.
  let defs = svg.select("defs");
  if (defs.empty()) {
    defs = svg.append("defs");
    defs.append("clipPath").attr("id", "scene4-bbox-clip").append("rect")
      .attr("class", "scene4-bbox-clip-rect");
  }

  // Keep the clip rect sized to the visible SVG frame.
  svg.select("#scene4-bbox-clip rect.scene4-bbox-clip-rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", scene4.width).attr("height", scene4.height);

  // Layer groups, drawn back-to-front, created once. Geometry layers are clipped
  // to the frame; gNodes is not, so labels near the edges remain visible.
  if (!scene4.el.gStates) {
    scene4.el.gStates    = svg.append("g").attr("class", "scene4-layer-states")
      .attr("clip-path", "url(#scene4-bbox-clip)");
    scene4.el.gRegions   = svg.append("g").attr("class", "scene4-layer-regions")
      .attr("clip-path", "url(#scene4-bbox-clip)");
    scene4.el.gSnow      = svg.append("g").attr("class", "scene4-layer-snow")
      .attr("clip-path", "url(#scene4-bbox-clip)");
    scene4.el.gRivers    = svg.append("g").attr("class", "scene4-layer-rivers")
      .attr("clip-path", "url(#scene4-bbox-clip)");
    scene4.el.gAqueduct  = svg.append("g").attr("class", "scene4-layer-aqueduct")
      .attr("clip-path", "url(#scene4-bbox-clip)");
    scene4.el.gParticles = svg.append("g").attr("class", "scene4-layer-particles")
      .attr("clip-path", "url(#scene4-bbox-clip)");
    scene4.el.gNodes     = svg.append("g").attr("class", "scene4-layer-nodes");
  }
}

// State boundaries for geographic context. Clipped to the frame so the polygons
// that extend beyond the visible map (e.g. the rest of Oregon/Arizona) are cut off.
function drawScene4States() {
  const g = scene4.el.gStates;
  if (!g) return;
  const join = g.selectAll("path.scene4-state").data(scene4.states, (d, i) =>
    (d.properties && d.properties.name) || i);
  join.join("path")
    .attr("class", "scene4-state")
    .attr("data-name", (d) => (d.properties ? d.properties.name : ""))
    .attr("d", (d) => scene4.path(d));
}

function drawScene4Regions() {
  const join = scene4.el.gRegions.selectAll("path.scene4-region-shape")
    .data(SCENE4_REGIONS, (d) => d.id);
  join.join("path")
    .attr("class", (d) => `scene4-region-shape scene4-region-${d.branch}`)
    .attr("d", (d) => scene4.path({
      type: "Polygon",
      coordinates: [d.coords.concat([d.coords[0]])],
    }))
    .attr("fill", (d) => d.color)
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-opacity", 0.35)
    .attr("data-branch", (d) => d.branch);
}

function drawScene4SnowSource() {
  const g = scene4.el.gSnow;
  const c = scene4LonLat(-119.1, 38.25);

  let label = g.select("text.scene4-snow-label");
  if (label.empty()) label = g.append("text").attr("class", "scene4-snow-label");
  label
    .attr("x", c[0]).attr("y", c[1])
    .attr("text-anchor", "middle")
    .text("Sierra snowpack");
}

// Approximate outline of the Sierra Nevada range. Geographic reference only;
// drawn in the snow layer so it frames the snowpack source.
function drawScene4SierraArea() {
  const g = scene4.el.gSnow;
  if (!g) return;
  const feature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [SCENE4_SIERRA_OUTLINE.concat([SCENE4_SIERRA_OUTLINE[0]])],
    },
  };

  let path = g.select("path.scene4-sierra-area");
  if (path.empty()) path = g.append("path").attr("class", "scene4-sierra-area");
  path.attr("d", scene4.path(feature));

  // Label near the wider northern end so it doesn't collide with the snow glow.
  const anchor = scene4LonLat(-120.45, 40.0);
  let label = g.select("text.scene4-sierra-label");
  if (label.empty()) label = g.append("text").attr("class", "scene4-sierra-label");
  label
    .attr("x", anchor[0]).attr("y", anchor[1] - 6)
    .attr("text-anchor", "middle")
    .text("Sierra Nevada");
}

function drawScene4Rivers() {
  const sel = scene4.el.gRivers.selectAll("path.scene4-river")
    .data(scene4.rivers, (d) => d.name);

  sel.join(
    (enter) => enter.append("path")
      .attr("class", (d) => `scene4-river scene4-river-${d.branch}`)
      .attr("data-name", (d) => d.name)
      .attr("data-branch", (d) => d.branch)
      .on("mousemove", (event, d) => scene4ShowTooltip(event, d))
      .on("mouseleave", scene4HideTooltip),
    (update) => update,
  )
    .attr("d", (d) => scene4.path(d.feature))
    .each(function (d) {
      d.node = this;
      d.length = this.getTotalLength();
    });
}

function drawScene4Aqueduct() {
  const g = scene4.el.gAqueduct;
  const feature = {
    type: "Feature",
    properties: { name: "Los Angeles Aqueduct" },
    geometry: { type: "LineString", coordinates: SCENE4_AQUEDUCT_GEOMETRY },
  };
  let path = g.select("path.scene4-aqueduct");
  if (path.empty()) {
    path = g.append("path")
      .attr("class", "scene4-aqueduct")
      .attr("data-name", "Los Angeles Aqueduct")
      .attr("data-branch", "owens")
      .on("mousemove", (event) => scene4ShowTooltip(event, {
        name: "Los Angeles Aqueduct", branch: "owens", isAqueduct: true,
      }))
      .on("mouseleave", scene4HideTooltip);
  }
  path.attr("d", scene4.path(feature));
}

function drawScene4Nodes() {
  const g = scene4.el.gNodes;

  const dots = g.selectAll("circle.scene4-node-dot").data(SCENE4_NODES, (d) => d.id);
  dots.join("circle")
    .attr("class", (d) => `scene4-node-dot scene4-node-${d.branch}`)
    .attr("data-branch", (d) => d.branch)
    .attr("cx", (d) => scene4LonLat(d.lon, d.lat)[0])
    .attr("cy", (d) => scene4LonLat(d.lon, d.lat)[1])
    .attr("r", (d) => (d.kind === "region" ? 5.5 : 4))
    .attr("fill", (d) => d.color)
    .attr("stroke", "rgba(8,12,18,0.8)")
    .attr("stroke-width", 1.2);

  const labels = g.selectAll("text.scene4-node-label").data(SCENE4_NODES, (d) => d.id);
  labels.join("text")
    .attr("class", (d) => `scene4-node-label scene4-node-${d.branch}`)
    .attr("data-branch", (d) => d.branch)
    .attr("x", (d) => scene4LonLat(d.lon, d.lat)[0] + 8)
    .attr("y", (d) => scene4LonLat(d.lon, d.lat)[1] + 3)
    .text((d) => d.label);
}

function drawScene4Legend() {
  const items = [
    { swatch: `<span class="scene4-legend-swatch" style="width:26px;height:6px;border-radius:3px;background:var(--s4-river)"></span>`,
      text: "Thick / bright river = stronger melt proxy" },
    { swatch: `<span class="scene4-legend-swatch" style="width:26px;height:2px;border-radius:2px;background:var(--s4-river);opacity:0.4"></span>`,
      text: "Thin / faint river = weaker melt proxy" },
    { swatch: `<span class="scene4-legend-swatch" style="width:10px;height:10px;border-radius:50%;background:var(--s4-snow)"></span>`,
      text: "Moving dots = downstream dependency direction" },
    { swatch: `<span class="scene4-legend-swatch" style="width:26px;height:0;border-top:2px dashed var(--s4-owens)"></span>`,
      text: "Dashed line = engineered aqueduct connection" },
  ];
  scene4.el.legend.innerHTML = items.map((it) =>
    `<div class="scene4-legend-item">${it.swatch}<span>${it.text}</span></div>`).join("");
}

// Apply melt-proxy scaling + branch highlight to rivers, aqueduct, nodes, snow.
function updateScene4RiverStress(visualScale) {
  scene4.visualScale = visualScale;
  const branch = scene4.current.branchHighlight;
  const baseOpacity = 0.25 + 0.75 * Math.min(1, visualScale);

  const inBranch = (b) => branch === "all" || branch === b;
  const dim = (b) => (inBranch(b) ? 1 : 0.16);

  scene4.el.gRivers.selectAll("path.scene4-river")
    .transition().duration(650)
    .attr("stroke-width", (d) => Math.max(0.6, d.baseWidth * visualScale))
    .attr("opacity", (d) => baseOpacity * dim(d.branch));

  scene4.el.gAqueduct.select("path.scene4-aqueduct")
    .classed("is-animating", inBranch("owens"))
    .transition().duration(650)
    .attr("stroke-width", Math.max(1, 3 * visualScale))
    .attr("opacity", (0.4 + 0.5 * Math.min(1, visualScale)) * dim("owens"));

  scene4.el.gNodes.selectAll(".scene4-node-dot, .scene4-node-label")
    .transition().duration(500)
    .style("opacity", function () {
      const b = this.getAttribute("data-branch");
      return inBranch(b) ? 1 : 0.18;
    });

  scene4.el.gRegions.selectAll("path.scene4-region-shape")
    .transition().duration(500)
    .style("opacity", function () {
      const b = this.getAttribute("data-branch");
      return inBranch(b) ? 1 : 0.22;
    });

}

// ---- Particles ----
function animateScene4Particle(pathNode, visualScale) {
  if (!pathNode) return;
  const len = pathNode.__s3len || pathNode.getTotalLength();
  pathNode.__s3len = len;
  if (len < 5 || scene4.particles.length > 260) return;

  const isAqueduct = pathNode.classList.contains("scene4-aqueduct");
  const r = Math.max(0.8, 2.5 * visualScale);
  const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  el.setAttribute("class", "scene4-particle");
  el.setAttribute("r", r);
  el.setAttribute("fill", isAqueduct ? "var(--s4-owens)" : "var(--s4-snow)");
  el.setAttribute("opacity", 0.85);
  scene4.el.gParticles.node().appendChild(el);

  scene4.particles.push({
    el,
    node: pathNode,
    len,
    dist: 0,
    speed: 0.045 * (0.4 + visualScale), // px per ms
  });
}

function scene4Tick(ts) {
  if (!scene4.particlesOn) return;
  if (!scene4.lastTs) scene4.lastTs = ts;
  const dt = Math.min(60, ts - scene4.lastTs);
  scene4.lastTs = ts;

  const vs = scene4.visualScale;
  const branch = scene4.current.branchHighlight;
  const inBranch = (b) => branch === "all" || branch === b;
  const interval = scene4.baseSpawnInterval / Math.max(0.12, vs);

  // Spawn along rivers (and aqueduct) currently in the active branch.
  scene4.rivers.forEach((r) => {
    if (!r.node || !inBranch(r.branch)) return;
    r.spawnAcc = (r.spawnAcc || 0) + dt;
    if (r.spawnAcc >= interval) {
      r.spawnAcc = 0;
      animateScene4Particle(r.node, vs);
    }
  });

  const aq = scene4.el.gAqueduct.select("path.scene4-aqueduct").node();
  if (aq && inBranch("owens")) {
    scene4.aqAcc = (scene4.aqAcc || 0) + dt;
    if (scene4.aqAcc >= interval * 1.2) {
      scene4.aqAcc = 0;
      animateScene4Particle(aq, vs);
    }
  }

  // Advance existing particles.
  scene4.particles = scene4.particles.filter((p) => {
    p.dist += p.speed * dt;
    if (p.dist >= p.len) { p.el.remove(); return false; }
    const pt = p.node.getPointAtLength(p.dist);
    p.el.setAttribute("cx", pt.x);
    p.el.setAttribute("cy", pt.y);
    return true;
  });

  scene4.raf = requestAnimationFrame(scene4Tick);
}

function startScene4Particles() {
  if (scene4.particlesOn) return;
  scene4.particlesOn = true;
  scene4.lastTs = 0;
  scene4.raf = requestAnimationFrame(scene4Tick);
}

function stopScene4Particles() {
  scene4.particlesOn = false;
  if (scene4.raf) cancelAnimationFrame(scene4.raf);
  scene4.raf = null;
  scene4.particles.forEach((p) => p.el.remove());
  scene4.particles = [];
}

// ---- Tooltip ----
function scene4ShowTooltip(event, d) {
  const tt = scene4.el.tooltip;
  if (!tt) return;
  const scenario = scene4.current.scenario;
  const month = scene4.current.month;
  const meta = (scene4.meltOk && scene4.meltProfiles[scenario] && scene4.meltProfiles[scenario][month])
    ? scene4.meltProfiles[scenario][month] : null;
  const snwIndex = getScene4MeltValue(scenario, month);
  const modelCount = meta ? meta.model_count : "—";

  tt.innerHTML = `
    <div class="scene4-tt-title">${d.name}</div>
    <div class="scene4-tt-row">Branch · <b>${scene4BranchLabel(d.branch)}</b></div>
    <div class="scene4-tt-row">Scenario · <b>${getScene4ScenarioLabel(scenario)}</b></div>
    <div class="scene4-tt-row">Month · <b>${getScene4MonthLabel(month)}</b></div>
    <div class="scene4-tt-row">Melt proxy (snw_index) · <b>${snwIndex.toFixed(1)}</b></div>
    <div class="scene4-tt-row">Models · <b>${modelCount}</b></div>
    <div class="scene4-tt-note">melt proxy, not measured flow</div>`;
  tt.classList.add("visible");
  scene4PositionTooltip(event);
}

function scene4PositionTooltip(event) {
  const tt = scene4.el.tooltip;
  if (!tt) return;
  const rect = tt.getBoundingClientRect();
  const pad = 12;
  let x = event.clientX + pad;
  let y = event.clientY - rect.height - pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y < 8) y = event.clientY + pad;
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

function scene4HideTooltip() {
  const tt = scene4.el.tooltip;
  if (tt) tt.classList.remove("visible");
}

function scene4BranchLabel(branch) {
  if (branch === "west") return "Western slope (California)";
  if (branch === "east") return "Eastern slope (W. Nevada)";
  if (branch === "owens") return "Owens Valley → Los Angeles";
  return "All branches";
}

// ---- Caption ----
function scene4UpdateCaption() {
  const cap = scene4.el.caption;
  if (!cap) return;
  const base = "River thickness is scaled by the project\u2019s CMIP6-derived Sierra melt proxy, " +
    "normalized so the historical peak melt month equals 100. It represents relative upstream " +
    "snowmelt stress/timing, not exact river discharge or managed water deliveries.";
  if (!scene4.meltOk) {
    cap.classList.add("is-warning");
    cap.textContent = "CMIP6 melt profile data not loaded; using visual fallback values. " + base;
  } else {
    cap.classList.remove("is-warning");
    cap.textContent = base;
  }
}

function scene4UpdateStateLabel() {
  const el = scene4.el.stateLabel;
  if (!el) return;
  const snw = getScene4MeltValue(scene4.current.scenario, scene4.current.month);
  el.textContent =
    `${getScene4ScenarioLabel(scene4.current.scenario)} · ${getScene4MonthLabel(scene4.current.month)} · proxy ${snw.toFixed(0)}`;
}

// ---- Central update ----
function updateScene4({ scenario, month, step, branchHighlight } = {}) {
  if (scenario !== undefined) scene4.current.scenario = scenario;
  if (month !== undefined) scene4.current.month = month;
  if (step !== undefined) scene4.current.step = step;
  if (branchHighlight !== undefined) scene4.current.branchHighlight = branchHighlight;

  const snw = getScene4MeltValue(scene4.current.scenario, scene4.current.month);
  const visualScale = getScene4VisualScale(snw);

  updateScene4RiverStress(visualScale);
  scene4SyncControls();
  scene4UpdateStateLabel();

  // Particles begin from step 1 onward (subtle), unless a user override is active.
  if (scene4.current.step >= 1 || scene4.lock.scenario || scene4.lock.month || scene4.lock.branch) {
    startScene4Particles();
  } else {
    stopScene4Particles();
  }
}

// ---- Controls ----
function scene4SyncControls() {
  const root = scene4.el.section;
  root.querySelectorAll('.scene4-btn[data-scenario]').forEach((b) =>
    b.classList.toggle("is-active", b.dataset.scenario === scene4.current.scenario));
  root.querySelectorAll('.scene4-btn[data-branch]').forEach((b) =>
    b.classList.toggle("is-active", b.dataset.branch === scene4.current.branchHighlight));
  root.querySelectorAll('.scene4-btn[data-month]').forEach((b) =>
    b.classList.toggle("is-active", +b.dataset.month === scene4.current.month));
}

function setupScene4Controls() {
  const root = scene4.el.section;

  // Build month buttons.
  const monthWrap = root.querySelector(".scene4-months");
  if (monthWrap) {
    monthWrap.innerHTML = SCENE4_MONTH_LABELS.map((m, i) =>
      `<button class="scene4-btn" data-month="${i + 1}">${m}</button>`).join("");
  }

  root.querySelectorAll(".scene4-btn[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene4.lock.scenario = true;
      updateScene4({ scenario: btn.dataset.scenario });
    });
  });
  root.querySelectorAll(".scene4-btn[data-branch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene4.lock.branch = true;
      updateScene4({ branchHighlight: btn.dataset.branch });
    });
  });
  root.querySelectorAll(".scene4-btn[data-month]").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene4.lock.month = true;
      updateScene4({ month: +btn.dataset.month });
    });
  });
}

// ---- Scroll observer ----
function setupScene4ScrollObserver() {
  const stepEls = scene4.el.section.querySelectorAll(".scene4-step");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const ds = entry.target.dataset;
      entry.target.classList.add("is-active");
      stepEls.forEach((s) => { if (s !== entry.target) s.classList.remove("is-active"); });

      // Scroll only drives dimensions the user has not locked via controls.
      const patch = { step: +ds.step };
      if (!scene4.lock.scenario && ds.scenario) patch.scenario = ds.scenario;
      if (!scene4.lock.month && ds.month) patch.month = +ds.month;
      if (!scene4.lock.branch && ds.branch) patch.branchHighlight = ds.branch;
      updateScene4(patch);
    });
  }, { threshold: 0.55 });
  stepEls.forEach((s) => observer.observe(s));
}

function scene4Resize() {
  if (!scene4.initialized) return;
  if (!scene4Measure()) return;
  setupScene4Projection();
  drawScene4BaseMap();
  drawScene4States();
  drawScene4Regions();
  drawScene4SnowSource();
  drawScene4SierraArea();
  drawScene4Rivers();
  drawScene4Aqueduct();
  drawScene4Nodes();
  updateScene4RiverStress(scene4.visualScale);
}

async function initScene4RiverNetwork() {
  const section = document.getElementById("scene-4-river-network");
  if (!section) return;

  scene4.el.section = section;
  scene4.el.svg = d3.select("#scene4-river-svg");
  scene4.el.svgWrap = section.querySelector(".scene4-svg-wrap");
  scene4.el.legend = section.querySelector(".scene4-legend");
  scene4.el.caption = section.querySelector(".scene4-caption");
  scene4.el.stateLabel = section.querySelector(".scene4-state-label");

  // Dedicated tooltip element appended once to the body.
  let tt = document.querySelector(".scene4-tooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.className = "scene4-tooltip";
    document.body.appendChild(tt);
  }
  scene4.el.tooltip = tt;

  await loadScene4Data();

  if (!scene4Measure()) {
    // Layout not ready yet; retry on next frame.
    requestAnimationFrame(() => initScene4RiverNetwork());
    return;
  }

  setupScene4Projection();
  drawScene4BaseMap();
  drawScene4States();
  drawScene4Regions();
  drawScene4SnowSource();
  drawScene4SierraArea();
  drawScene4Rivers();
  drawScene4Aqueduct();
  drawScene4Nodes();
  drawScene4Legend();

  setupScene4Controls();
  setupScene4ScrollObserver();
  scene4UpdateCaption();

  scene4.initialized = true;

  // Baseline default: historical peak month (fallback to April / month 4).
  const baselineMonth = scene4.meltOk ? scene4.histPeakMonth : 4;
  scene4.current.month = baselineMonth;
  // Reflect the baseline month in the step-0 default for scroll consistency.
  const step0 = section.querySelector('.scene4-step[data-step="0"]');
  if (step0) step0.dataset.month = String(baselineMonth);
  const step1 = section.querySelector('.scene4-step[data-step="1"]');
  if (step1) step1.dataset.month = String(baselineMonth);

  updateScene4({ scenario: "historical", month: baselineMonth, step: 0, branchHighlight: "all" });

  // Keep the map sized to its sticky container.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scene4Resize());
    ro.observe(scene4.el.svgWrap);
  }
  window.addEventListener("resize", scene4Resize);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initScene4RiverNetwork();
    initScene6();
  });
} else {
  initScene4RiverNetwork();
  initScene6();
}


// ============================================================
// Scene 6 — Two Futures
// ============================================================

async function initScene6() {
  const SCENE6_DATA_URL = new URL("data/sierra_melt_timing_profiles.csv", document.baseURI).href;
  const SCENE6_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  let hist6, mod6, proj6;
  let meta6ByKey = {};

  const svg6    = d3.select("#chart-svg-6");
  if (svg6.empty()) return;

  const W6      = () => svg6.node().getBoundingClientRect().width;
  const H6      = () => svg6.node().getBoundingClientRect().height;
  const MARGIN6 = { top: 28, right: 24, bottom: 40, left: 56 };

  const x6 = d3.scalePoint().domain(SCENE6_MONTHS).padding(0.1);
  const y6 = d3.scaleLinear().domain([0, 110]).nice();

  const area6 = (data) => d3.area()
    .x((d,i) => x6(SCENE6_MONTHS[i]))
    .y0(y6(0))
    .y1(d => y6(d))
    .curve(d3.curveCatmullRom.alpha(0.5))(data);

  const line6 = (data) => d3.line()
    .x((d,i) => x6(SCENE6_MONTHS[i]))
    .y(d => y6(d))
    .curve(d3.curveCatmullRom.alpha(0.5))(data);

  function innerW6() { return W6() - MARGIN6.left - MARGIN6.right; }
  function innerH6() { return H6() - MARGIN6.top  - MARGIN6.bottom; }

  const root6    = svg6.append("g").attr("transform", `translate(${MARGIN6.left},${MARGIN6.top})`);
  const gridG6   = root6.append("g").attr("class","grid");
  const xAxisG6  = root6.append("g").attr("class","x-axis");
  const yAxisG6  = root6.append("g").attr("class","y-axis");

  const histAreaPath6 = root6.append("path").attr("class","hist-area-6");
  const histLinePath6 = root6.append("path").attr("class","hist-line-6");

  const modAreaPath6 = root6.append("path").attr("class","mod-area-6");
  const modLinePath6 = root6.append("path").attr("class","mod-line-6");

  const projAreaPath6 = root6.append("path").attr("class","proj-area-6");
  const projLinePath6 = root6.append("path").attr("class","proj-line-6");

  const diffAnnotation6 = root6.append("g").attr("class","diff-annotation");
  diffAnnotation6.append("line").attr("class","diff-line-mod")
    .attr("stroke","var(--green)").attr("stroke-width",1).attr("stroke-dasharray","3 3");
  diffAnnotation6.append("line").attr("class","diff-line-high")
    .attr("stroke","var(--red)").attr("stroke-width",1).attr("stroke-dasharray","3 3");
  diffAnnotation6.append("text").attr("class","diff-label")
    .attr("font-family","'IBM Plex Mono',monospace")
    .attr("font-size","10px")
    .attr("fill","var(--text-dim)")
    .attr("text-anchor","middle")
    .attr("dy","0.35em")
    .text("~10 pt gap at peak");

  const tooltipTargets6 = root6.append("g").attr("class","tooltip-targets");

  const MONTH_FULL6 = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
    "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const DAYS_IN_MONTH6 = [31,28,31,30,31,30,31,31,30,31,30,31];

  function fluxToMm6(flux, monthIdx) {
    return flux * DAYS_IN_MONTH6[monthIdx] * 86400;
  }

  function tooltipHtml6(series, monthIdx) {
    const month = MONTH_FULL6[monthIdx];
    const metaKey = series === "historical" ? "historical"
      : series === "moderate" ? "ssp245"
      : "ssp585";
    const meta = meta6ByKey[`${metaKey}-${monthIdx + 1}`] || null;
    const mm = meta ? Math.max(0, Math.round(fluxToMm6(meta.mean_kgm2, monthIdx))) : null;
    const mmLine = mm !== null ? `<div class="tt-primary">${mm} mm</div>` : "";
    const count = meta
      ? (meta.model_count === 1 ? "1 model" : `${meta.model_count}-model ensemble mean`)
      : "";

    if (series === "historical") {
      const pct = Math.round(Math.max(0, hist6[monthIdx]));
      return `
        <div class="tt-eyebrow"><span class="tt-month">${month}</span> · SNOWMELT RUNOFF</div>
        ${mmLine}
        <div class="tt-secondary">${pct}% of annual maximum</div>
        <div class="tt-footer">
          <div class="tt-footer-line">Historical · 1970–2000</div>
          <div class="tt-footer-line">${count}</div>
        </div>`;
    }
    if (series === "moderate") {
      const pct = Math.round(Math.max(0, mod6[monthIdx]));
      return `
        <div class="tt-eyebrow"><span class="tt-month">${month}</span> · PROJECTED · SSP2-4.5</div>
        ${mmLine}
        <div class="tt-secondary">${pct}% of historical maximum</div>
        <div class="tt-footer">
          <div class="tt-footer-line">Moderate emissions · 2050–2075</div>
          <div class="tt-footer-line">${count}</div>
        </div>`;
    }
    const pct = Math.round(Math.max(0, proj6[monthIdx]));
    return `
      <div class="tt-eyebrow"><span class="tt-month">${month}</span> · PROJECTED · SSP5-8.5</div>
      ${mmLine}
      <div class="tt-secondary">${pct}% of historical maximum</div>
      <div class="tt-footer">
        <div class="tt-footer-line">High emissions · 2050–2075</div>
        <div class="tt-footer-line">${count}</div>
      </div>`;
  }

  function isSeriesVisible6(series) {
    const classMap = {
      historical: "hist-line-6",
      moderate:   "mod-line-6",
      projected:  "proj-line-6",
    };
    const cls = classMap[series];
    if (!cls) return false;
    const path = svg6.select(`.${cls}`);
    if (path.empty()) return false;
    return +path.attr("opacity") > 0.1;
  }

  const tt6 = document.getElementById("chart-tooltip");

  function showTooltip6(event, series, monthIdx) {
    if (!tt6) return;
    tt6.innerHTML = tooltipHtml6(series, monthIdx);
    tt6.setAttribute("data-series", series);
    tt6.setAttribute("aria-hidden", "false");
    tt6.classList.add("visible");
    positionTooltip6(event);
  }

  function positionTooltip6(event) {
    if (!tt6) return;
    const rect = tt6.getBoundingClientRect();
    const pad = 12;
    let x = event.clientX + pad;
    let y = event.clientY - rect.height - pad;
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
    if (y < 8) y = event.clientY + pad;
    tt6.style.left = `${x}px`;
    tt6.style.top = `${y}px`;
  }

  function hideTooltip6() {
    if (!tt6) return;
    tt6.classList.remove("visible");
    tt6.setAttribute("aria-hidden", "true");
  }

  function draw6() {
    const width = W6();
    const height = H6();
    if (width <= 0 || height <= 0) return;

    svg6.attr("width", width).attr("height", height);

    const iW = innerW6();
    const iH = innerH6();
    if (iW <= 0 || iH <= 0) return;

    x6.range([0, iW]);
    y6.range([iH, 0]);

    gridG6.selectAll("line").data(y6.ticks(5)).join("line")
      .attr("x1",0).attr("x2",iW)
      .attr("y1",d=>y6(d)).attr("y2",d=>y6(d))
      .attr("stroke","rgba(255,255,255,0.05)").attr("stroke-width",1);

    xAxisG6.attr("transform",`translate(0,${iH})`)
      .call(d3.axisBottom(x6).tickSize(0).tickPadding(10))
      .call(g => g.select(".domain").attr("stroke","rgba(255,255,255,0.1)"))
      .call(g => g.selectAll("text")
        .attr("fill","var(--text-dim)")
        .attr("font-size","11px")
        .attr("font-family","'IBM Plex Mono',monospace"));

    yAxisG6.call(d3.axisLeft(y6).ticks(5).tickFormat(d=>d+"%").tickSize(0).tickPadding(8))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll("text")
        .attr("fill","var(--text-dim)")
        .attr("font-size","10px")
        .attr("font-family","'IBM Plex Mono',monospace"));

    if (!hist6) return;

    histAreaPath6
      .attr("d", area6(hist6))
      .attr("fill","var(--blue-dim)")
      .attr("opacity", 1);
    histLinePath6
      .attr("d", line6(hist6))
      .attr("fill","none")
      .attr("stroke","var(--blue)")
      .attr("stroke-width",2.5)
      .attr("opacity", 1);

    if (mod6) {
      modAreaPath6
        .attr("d", area6(mod6))
        .attr("fill","var(--green-dim)")
        .attr("opacity", 1);
      modLinePath6
        .attr("d", line6(mod6))
        .attr("fill","none")
        .attr("stroke","var(--green)")
        .attr("stroke-width",2.5)
        .attr("opacity", 1);
    }

    if (proj6) {
      projAreaPath6
        .attr("d", area6(proj6))
        .attr("fill","var(--red-dim)")
        .attr("opacity", 1);
      projLinePath6
        .attr("d", line6(proj6))
        .attr("fill","none")
        .attr("stroke","var(--red)")
        .attr("stroke-width",2.5)
        .attr("opacity", 1);
    }

    if (mod6 && proj6) {
      const peakIdx = hist6.indexOf(Math.max(...hist6));
      const px = x6(SCENE6_MONTHS[peakIdx]);
      const modY = y6(mod6[peakIdx]);
      const projY = y6(proj6[peakIdx]);

      diffAnnotation6.select(".diff-line-mod")
        .attr("x1", px - 18).attr("x2", px + 18)
        .attr("y1", modY).attr("y2", modY);
      diffAnnotation6.select(".diff-line-high")
        .attr("x1", px - 18).attr("x2", px + 18)
        .attr("y1", projY).attr("y2", projY);
      diffAnnotation6.select(".diff-label")
        .attr("x", px + 38)
        .attr("y", (modY + projY) / 2);
    }

    const targetData6 = [];
    if (proj6) proj6.forEach((v, i) =>
      targetData6.push({ series: "projected", month: i, cx: x6(SCENE6_MONTHS[i]), cy: y6(v) }));
    if (mod6) mod6.forEach((v, i) =>
      targetData6.push({ series: "moderate", month: i, cx: x6(SCENE6_MONTHS[i]), cy: y6(v) }));
    if (hist6) hist6.forEach((v, i) =>
      targetData6.push({ series: "historical", month: i, cx: x6(SCENE6_MONTHS[i]), cy: y6(v) }));

    tooltipTargets6.selectAll("circle")
      .data(targetData6)
      .join("circle")
      .attr("cx", (d) => d.cx)
      .attr("cy", (d) => d.cy)
      .attr("r", 14)
      .attr("fill", "transparent")
      .attr("stroke", "none")
      .on("mouseenter", (event, d) => {
        if (!isSeriesVisible6(d.series)) return;
        showTooltip6(event, d.series, d.month);
      })
      .on("mousemove", (event) => positionTooltip6(event))
      .on("mouseleave", hideTooltip6);
  }

  draw6();

  window.addEventListener("resize", draw6);

  if (typeof ResizeObserver !== "undefined") {
    const ro6 = new ResizeObserver(() => draw6());
    ro6.observe(svg6.node());
  }

  const scene6El = document.getElementById("scene-6");
  if (scene6El) {
    new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) draw6(); });
    }, { threshold: 0.1 }).observe(scene6El);
  }

  document.querySelectorAll("#scene-6 .toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const scenario = btn.dataset.scenario;

      document.querySelectorAll("#scene-6 .toggle-btn").forEach(b => {
        b.classList.remove("active-both","active-mod","active-high");
      });

      if (scenario === "both") {
        btn.classList.add("active-both");
        modAreaPath6.transition().duration(400).attr("opacity",1);
        modLinePath6.transition().duration(400).attr("opacity",1);
        projAreaPath6.transition().duration(400).attr("opacity",1);
        projLinePath6.transition().duration(400).attr("opacity",1);
      } else if (scenario === "moderate") {
        btn.classList.add("active-mod");
        modAreaPath6.transition().duration(400).attr("opacity",1);
        modLinePath6.transition().duration(400).attr("opacity",1);
        projAreaPath6.transition().duration(400).attr("opacity",0.12);
        projLinePath6.transition().duration(400).attr("opacity",0.2);
      } else if (scenario === "high") {
        btn.classList.add("active-high");
        modAreaPath6.transition().duration(400).attr("opacity",0.12);
        modLinePath6.transition().duration(400).attr("opacity",0.2);
        projAreaPath6.transition().duration(400).attr("opacity",1);
        projLinePath6.transition().duration(400).attr("opacity",1);
      }
    });
  });

  if (window.location.protocol === "file:") return;

  try {
    const response = await fetch(SCENE6_DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rows = d3.csvParse(await response.text(), (d) => ({
      scenario: (d.scenario || "").trim(),
      month: +d.month,
      snw_index: +d.snw_index,
      mean_kgm2: +d.mean,
      model_count: +d.model_count,
    }));

    meta6ByKey = {};
    rows.forEach((d) => {
      meta6ByKey[`${d.scenario}-${d.month}`] = {
        mean_kgm2: d.mean_kgm2,
        model_count: d.model_count,
      };
    });

    function profileFromCsv6(scenario) {
      const values = rows
        .filter((d) => d.scenario === scenario)
        .sort((a, b) => d3.ascending(a.month, b.month))
        .map((d) => Math.max(0, d.snw_index));
      return values.length === 12 ? values : null;
    }

    hist6 = profileFromCsv6("historical");
    mod6  = profileFromCsv6("ssp245");
    proj6 = profileFromCsv6("ssp585");

    draw6();
  } catch (err) {
    console.error("Scene 6: failed to load melt timing CSV:", err);
  }
}


// ============================================================
// Scene 5 — The Consequence: where the summer water goes
// Apr–Jul ("summer") snowmelt as a share of the historical summer mean,
// decomposed (Shapley two-factor) into:
//   kept     = still arrives in summer
//   gone     = less total snowmelt (never banked as snow)
//   mistimed = still melts, but too early to use in summer
// Renders from an embedded snapshot (computed from sierra_snowmelt_profiles.csv);
// a live CSV recompute overrides it when served over http (file:// keeps the
// snapshot). Namespaced scene5 / SCENE5 so it cannot disturb other scenes.
// ============================================================

let SCENE5 = [
  { key: "historical", title: "Historical",         years: "1970–2000", kept: 100,  gone: 0,    mist: 0    },
  { key: "ssp245",     title: "Current Trajectory", years: "2070–2100", kept: 52.6, gone: 41.2, mist: 6.2  },
  { key: "ssp585",     title: "High Emissions",     years: "2070–2100", kept: 23.4, gone: 44.4, mist: 32.2 },
];

const SCENE5_COL = { kept: "var(--blue)", gone: "var(--text-dim)", mist: "var(--demand)" };

// Shapley two-factor split of summer (Apr–Jul) melt vs historical.
// Summer = AnnualTotal x SummerShare; the loss decomposes into a volume term
// ("gone") and a share/timing term ("mistimed"). kept + gone + mist = 100.
function scene5Decompose(meanByScenario) {
  const annual = (s) => d3.sum(meanByScenario[s]);
  const share  = (s) => (meanByScenario[s][3] + meanByScenario[s][4] +
                         meanByScenario[s][5] + meanByScenario[s][6]) / annual(s);
  const summer = (s) => annual(s) * share(s);
  const base = summer("historical");
  if (!(base > 0)) return null;
  const row = (key, title, years) => {
    if (key === "historical") return { key, title, years, kept: 100, gone: 0, mist: 0 };
    const dA = annual(key) - annual("historical");
    const dS = share(key) - share("historical");
    const gone = -(dA * (share("historical") + share(key)) / 2) / base * 100;
    const mist = -(dS * (annual("historical") + annual(key)) / 2) / base * 100;
    return { key, title, years, kept: (summer(key) / base) * 100, gone, mist };
  };
  return [
    row("historical", "Historical", "1970–2000"),
    row("ssp245", "Current Trajectory", "2070–2100"),
    row("ssp585", "High Emissions", "2070–2100"),
  ];
}

async function scene5LoadAndRecompute() {
  if (window.location.protocol === "file:") return;   // keep the embedded snapshot
  try {
    const url = new URL("data/sierra_snowmelt_profiles.csv", document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) return;
    const rows = d3.csvParse(await res.text(), (d) => ({
      scenario: (d.scenario || "").trim(), month: +d.month, mean: +d.mean,
    }));
    const byScen = {};
    rows.forEach((d) => {
      if (!byScen[d.scenario]) byScen[d.scenario] = new Array(12).fill(0);
      if (d.month >= 1 && d.month <= 12) byScen[d.scenario][d.month - 1] = d.mean;
    });
    if (byScen.historical && byScen.ssp245 && byScen.ssp585) {
      const out = scene5Decompose(byScen);
      if (out) { SCENE5 = out; drawScene5(); }
    }
  } catch (e) {
    console.info("Scene 5: using embedded snapshot —", e.message);
  }
}

function scene5Tooltip() {
  let t = document.getElementById("scene5-tip");
  if (!t) { t = document.createElement("div"); t.id = "scene5-tip"; document.body.appendChild(t); }
  return t;
}
function scene5ShowTip(tip, ev, html) {
  tip.innerHTML = html; tip.style.opacity = 1;
  const r = tip.getBoundingClientRect();
  let xx = ev.clientX + 14, yy = ev.clientY - r.height - 10;
  if (xx + r.width > window.innerWidth - 8) xx = ev.clientX - r.width - 14;
  if (yy < 8) yy = ev.clientY + 16;
  tip.style.left = xx + "px"; tip.style.top = yy + "px";
}

function drawScene5() {
  const el = document.getElementById("scene5-svg");
  if (!el) return;
  const w = el.clientWidth, h = +el.getAttribute("height") || 420;
  if (!w) return;
  const svg = d3.select(el);
  svg.selectAll("*").remove();

  const m = { t: 18, r: 12, b: 52, l: 34 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const colW = Math.min(iw * 0.60, 400);
  const calloutX = m.l + colW + Math.max(30, iw * 0.045);
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);

  const x = d3.scaleBand().domain(SCENE5.map((d) => d.key)).range([0, colW]).padding(0.58);
  const y = d3.scaleLinear().domain([0, 100]).range([ih, 0]);
  const r1 = (v) => Math.round(v);
  const tip = scene5Tooltip();

  [25, 50, 75, 100].forEach((t) =>
    g.append("line").attr("x1", 0).attr("x2", colW).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", "var(--rule)"));
  [[0, "0"], [100, "100%"]].forEach((p) =>
    g.append("text").attr("x", -9).attr("y", y(p[0]) + 3).attr("text-anchor", "end")
      .attr("font-family", "'IBM Plex Mono',monospace").attr("font-size", "10px").attr("fill", "var(--text-dim)").text(p[1]));

  SCENE5.forEach((d) => {
    const bx = x(d.key), bw = x.bandwidth();
    const segs = [
      { name: "Kept",     v: d.kept, y0: 0,               col: SCENE5_COL.kept },
      { name: "Gone",     v: d.gone, y0: d.kept,           col: SCENE5_COL.gone },
      { name: "Mistimed", v: d.mist, y0: d.kept + d.gone,  col: SCENE5_COL.mist },
    ];
    segs.forEach((s) => {
      if (s.v <= 0) return;
      g.append("rect").attr("x", bx).attr("y", y(s.y0 + s.v)).attr("width", bw)
        .attr("height", y(s.y0) - y(s.y0 + s.v)).attr("rx", 2).attr("fill", s.col)
        .attr("opacity", s.name === "Kept" ? 0.95 : 0.8).style("cursor", "pointer")
        .on("mousemove", (ev) => scene5ShowTip(tip, ev,
          `<div class="h">${d.title} · ${d.years}</div><div class="r"><span>${s.name}</span><b>${r1(s.v)}%</b></div>`))
        .on("mouseleave", () => { tip.style.opacity = 0; });
    });
    if (d.kept > 14) {
      g.append("text").attr("x", bx + bw / 2).attr("y", y(d.kept / 2)).attr("text-anchor", "middle")
        .attr("font-family", "'Playfair Display',serif").attr("font-size", "20px").attr("font-weight", 700)
        .attr("fill", "var(--snow)").attr("dy", "0.1em").text(r1(d.kept) + "%");
      g.append("text").attr("x", bx + bw / 2).attr("y", y(d.kept / 2) + 16).attr("text-anchor", "middle")
        .attr("font-family", "'IBM Plex Mono',monospace").attr("font-size", "9px").attr("fill", "var(--snow)")
        .attr("opacity", 0.85).text("reaches summer");
    }
    g.append("text").attr("x", bx + bw / 2).attr("y", ih + 22).attr("text-anchor", "middle")
      .attr("font-size", "12.5px").attr("font-weight", 500).attr("fill", "var(--text)").text(d.title);
    g.append("text").attr("x", bx + bw / 2).attr("y", ih + 38).attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Mono',monospace").attr("font-size", "10.5px").attr("fill", "var(--text-dim)").text(d.years);
  });

  // numberless callouts on the High-Emissions column (no hover needed)
  const hi = SCENE5[2], hx = x(hi.key) + x.bandwidth();
  const callouts = [
    { col: SCENE5_COL.mist, mid: hi.kept + hi.gone + hi.mist / 2, word: "MISTIMED", line: "melts too early to use" },
    { col: SCENE5_COL.gone, mid: hi.kept + hi.gone / 2,           word: "GONE",     line: "fell as rain, not snow" },
    { col: SCENE5_COL.kept, mid: hi.kept / 2,                     word: "KEPT",     line: "still reaches summer" },
  ];
  callouts.forEach((c) => {
    const yc = y(c.mid);
    g.append("line").attr("x1", hx + 2).attr("y1", yc).attr("x2", calloutX - 10).attr("y2", yc)
      .attr("stroke", c.col).attr("stroke-width", 1).attr("opacity", 0.5);
    g.append("circle").attr("cx", calloutX - 6).attr("cy", yc).attr("r", 3).attr("fill", c.col);
    g.append("text").attr("x", calloutX + 4).attr("y", yc - 3).attr("font-family", "'IBM Plex Mono',monospace")
      .attr("font-size", "12px").attr("font-weight", 500).attr("letter-spacing", ".06em").attr("fill", c.col).text(c.word);
    g.append("text").attr("x", calloutX + 4).attr("y", yc + 12).attr("font-size", "11.5px").attr("fill", "var(--text-dim)").text(c.line);
  });
}

function initScene5() {
  if (!document.getElementById("scene5-svg")) return;
  drawScene5();
  scene5LoadAndRecompute();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => drawScene5());
    ro.observe(document.getElementById("scene5-svg"));
  }
  window.addEventListener("resize", drawScene5);
}

initScene5();
