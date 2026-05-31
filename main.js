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
const MARGIN = { top: 28, right: 24, bottom: 44, left: 56 };

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
  .text("water year (Oct → Sep)");

// Shaded melt → demand offset region (sits behind the curves).
const gapBand = root.append("g").attr("class","gap-band-layer").attr("opacity",0);
gapBand.append("rect").attr("class","gap-band").attr("fill","var(--gap)");

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

// "peak shifts ~N month(s) earlier" annotation (arrow points to the earlier peak).
const peakShift = root.append("g").attr("class","peak-shift").attr("opacity",0);
peakShift.append("line").attr("class","peak-shift-line")
  .attr("stroke","var(--text)").attr("stroke-width",1)
  .attr("marker-start","url(#arrow-shift)");
peakShift.append("text").attr("class","peak-shift-label")
  .attr("fill","var(--text)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px").attr("text-anchor","middle");

// melt → demand horizontal offset bracket.
const gapAnnotation = root.append("g").attr("class","gap-annotation").attr("opacity",0);
gapAnnotation.append("line").attr("class","gap-measure")
  .attr("stroke","var(--red)").attr("stroke-width",1.2);
gapAnnotation.append("line").attr("class","gap-tick-left")
  .attr("stroke","var(--red)").attr("stroke-width",1.2);
gapAnnotation.append("line").attr("class","gap-tick-right")
  .attr("stroke","var(--red)").attr("stroke-width",1.2);
gapAnnotation.append("text").attr("class","gap-label")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px").attr("fill","var(--red)")
  .attr("text-anchor","middle");

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

  demandAreaPath.attr("d", area(demandPts)).attr("fill","var(--demand-dim)");
  demandLinePath.attr("d", line(demandPts))
    .attr("fill","none")
    .attr("stroke","var(--demand)")
    .attr("stroke-width",2)
    .attr("stroke-dasharray","5 4");

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
    const shiftY = Math.max(14, peakTop - 16);
    peakShift.select("line")
      .attr("x1", ppx).attr("y1", shiftY)
      .attr("x2", hpx).attr("y2", shiftY);
    peakShift.select("text")
      .attr("x", (ppx + hpx) / 2).attr("y", shiftY - 5)
      .text(`peak shifts ~${Math.abs(monthsShift)} month${Math.abs(monthsShift) > 1 ? "s" : ""} earlier`);
  }

  // melt → demand offset. The shaded band spans the projected melt peak to the
  // demand peak (full height); the bracket measures that gap in months.
  const demandPk = demandPts.reduce((a, b) => (b.value > a.value ? b : a));
  const dpx = x(demandPk.label);
  const gx0 = Math.min(ppx, dpx), gx1 = Math.max(ppx, dpx);

  gapBand.select(".gap-band")
    .attr("x", gx0).attr("y", 0)
    .attr("width", Math.max(gx1 - gx0, 1)).attr("height", iH);

  const bracketY = Math.round(iH * 0.30);
  gapAnnotation.select(".gap-measure")
    .attr("x1", gx0).attr("x2", gx1).attr("y1", bracketY).attr("y2", bracketY);
  gapAnnotation.select(".gap-tick-left")
    .attr("x1", gx0).attr("x2", gx0).attr("y1", bracketY - 4).attr("y2", bracketY + 4);
  gapAnnotation.select(".gap-tick-right")
    .attr("x1", gx1).attr("x2", gx1).attr("y1", bracketY - 4).attr("y2", bracketY + 4);
  const offMonths = Math.abs(demandPk.pos - projPk.pos);
  gapAnnotation.select(".gap-label")
    .attr("x", (gx0 + gx1) / 2).attr("y", bracketY - 7)
    .text(`~${offMonths} months: winter melt → summer demand`);
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
  4: { proj:true,  histPeak:true,  projPeak:true,  shift:true,  demand:true,  normalized:true  },
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
  tt(gapBand, 700).attr("opacity", demandShown ? 1 : 0);
  tt(gapAnnotation, 800).attr("opacity", demandShown ? 1 : 0);

  d3.select("#legend-future").style("opacity", projShown ? "1" : "0");
  d3.select("#legend-demand").style("opacity", demandShown ? "1" : "0");
}

function setStep(i) {
  currentStep = i;
  dots.forEach((d, j) => d.classList.toggle("active", j === i));
  const cfg = STEP_CONFIG[i] || STEP_CONFIG[0];
  normalize = cfg.normalized; // apply the step's preferred mode
  const tog = document.getElementById("normalize-toggle");
  if (tog) tog.checked = normalize;
  draw();
  applyVisibility(true);
}

// Normalize toggle — manual override of the current mode.
const normalizeToggle = document.getElementById("normalize-toggle");
if (normalizeToggle) {
  normalizeToggle.addEventListener("change", (e) => {
    normalize = e.target.checked;
    draw();
    applyVisibility(false);
  });
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
