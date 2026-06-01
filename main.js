// Data
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DATA_URL = new URL("data/sierra_melt_timing_profiles.csv", document.baseURI).href;
const PROJECTED_SCENARIO = "ssp585";

// Illustrative agricultural water demand (not from CMIP6)
const demand = [8, 7, 10, 15, 38, 70, 100, 97, 62, 28, 10, 7];

let historical;
let projected;
let moderate;

// Tooltip metadata lookup: "${scenario}-${month}" -> { mean_kgm2, model_count }
let metadataByKey = {};

function profileFromCsv(rows, scenario) {
  const values = rows
    .filter((d) => d.scenario === scenario)
    .sort((a, b) => d3.ascending(a.month, b.month))
    .map((d) => Math.max(0, d.snw_index));

  if (values.length !== 12) return null;
  if (values.some((v) => !Number.isFinite(v))) {
    throw new Error(`Non-numeric snw_index values for scenario ${scenario}`);
  }
  return values;
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
    snw_index: +d.snw_index,
    mean_kgm2: +d.mean,           // raw mrro flux (kg m^-2 s^-1)
    model_count: +d.model_count,
  }));

  // Build the tooltip metadata lookup (additive; chart arrays unchanged).
  metadataByKey = {};
  rows.forEach((d) => {
    metadataByKey[`${d.scenario}-${d.month}`] = {
      mean_kgm2: d.mean_kgm2,
      model_count: d.model_count,
    };
  });

  const hist = profileFromCsv(rows, "historical");
  const proj = profileFromCsv(rows, PROJECTED_SCENARIO);
  const mod  = profileFromCsv(rows, "ssp245");

  if (!hist || !proj) {
    const scenarios = [...new Set(rows.map((d) => d.scenario))];
    throw new Error(
      `Expected 12 monthly rows per scenario in ${DATA_URL}. ` +
      `Found scenarios: ${scenarios.join(", ")}`
    );
  }

  return { historical: hist, projected: proj, moderate: mod };
}

// Chart setup
const svg   = d3.select("#chart-svg");
const W     = () => svg.node().getBoundingClientRect().width;
const H     = () => svg.node().getBoundingClientRect().height;
const MARGIN = { top: 28, right: 24, bottom: 40, left: 56 };

const x = d3.scalePoint().domain(MONTHS).padding(0.1);
const y = d3.scaleLinear().domain([0, 110]).nice();

const area = (data) => d3.area()
  .x((d,i) => x(MONTHS[i]))
  .y0(y(0))
  .y1(d => y(d))
  .curve(d3.curveCatmullRom.alpha(0.5))(data);

const line = (data) => d3.line()
  .x((d,i) => x(MONTHS[i]))
  .y(d => y(d))
  .curve(d3.curveCatmullRom.alpha(0.5))(data);

function innerW() { return W() - MARGIN.left - MARGIN.right; }
function innerH() { return H() - MARGIN.top  - MARGIN.bottom; }

// SVG elements
const root = svg.append("g")
  .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

const gridG = root.append("g").attr("class","grid");
const xAxisG = root.append("g").attr("class","x-axis");
const yAxisG = root.append("g").attr("class","y-axis");

const gapBand = root.append("g").attr("class","gap-band-layer").attr("opacity",0);
gapBand.append("rect").attr("class","gap-band")
  .attr("fill","rgba(224,90,74,0.14)");

const demandAreaPath = root.append("path").attr("class","demand-area");
const demandLinePath = root.append("path").attr("class","demand-line");

const histAreaPath = root.append("path").attr("class","hist-area");
const histLinePath = root.append("path").attr("class","hist-line");

const projAreaPath = root.append("path").attr("class","proj-area")
  .attr("opacity",0);
const projLinePath = root.append("path").attr("class","proj-line")
  .attr("opacity",0);

const histPeak = root.append("g").attr("class","peak-hist").attr("opacity",0);
histPeak.append("line").attr("stroke","var(--blue)").attr("stroke-width",1)
  .attr("stroke-dasharray","3 3");
histPeak.append("text").attr("class","peak-label")
  .attr("fill","var(--blue)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .text("Hist. runoff peak");

const projPeak = root.append("g").attr("class","peak-proj").attr("opacity",0);
projPeak.append("line").attr("stroke","var(--red)").attr("stroke-width",1)
  .attr("stroke-dasharray","3 3");
projPeak.append("text").attr("class","peak-label")
  .attr("fill","var(--red)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .text("Proj. runoff peak");

const gapAnnotation = root.append("g").attr("class","gap-annotation").attr("opacity",0);
gapAnnotation.append("line").attr("class","gap-h-proj")
  .attr("stroke","var(--red)").attr("stroke-width",1.2);
gapAnnotation.append("line").attr("class","gap-h-demand")
  .attr("stroke","var(--demand)").attr("stroke-width",1.2);
gapAnnotation.append("text").attr("class","gap-label")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px").attr("fill","var(--red)")
  .attr("text-anchor","middle")
  .attr("dy","0.35em")
  .text("Winter runoff → summer demand");

// Hover hit targets — appended last so they sit on top of paths & annotations
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
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const SECONDS_PER_DAY = 86400;

// mrro is a flux (kg m^-2 s^-1); multiply by the month's seconds to get a
// monthly runoff depth in mm (1 kg/m^2 = 1 mm of water).
function fluxToMonthlyMm(flux, monthIdx) {
  return flux * DAYS_IN_MONTH[monthIdx] * SECONDS_PER_DAY;
}

function demandPhase(monthIdx) {
  if ([10,11,0,1,2,3].includes(monthIdx)) return "Low — winter dormancy";
  if ([4,5].includes(monthIdx)) return "Rising — growing season begins";
  if ([6,7].includes(monthIdx)) return "Near peak — agricultural draw";
  return "Tapering — late season"; // Sep, Oct
}

function metaFor(series, monthIdx) {
  const scenario = series === "historical" ? "historical"
    : series === "projected" ? PROJECTED_SCENARIO
    : series === "moderate"  ? "ssp245"
    : null;
  if (!scenario) return null;
  return metadataByKey[`${scenario}-${monthIdx + 1}`] || null;
}

// Only show a tooltip for a series the chart is currently displaying.
function isSeriesVisible(series) {
  if (series === "demand") return true;
  const className = series === "historical" ? "hist-line" : "proj-line";
  const path = svg.select(`.${className}`);
  if (path.empty()) return false;
  return +path.attr("opacity") > 0.1;
}

function isSeriesVisible5(series) {
  const classMap = {
    historical: "hist-line-5",
    moderate:   "mod-line-5",
    projected:  "proj-line-5",
  };
  const cls = classMap[series];
  if (!cls) return false;
  const path = svg5.select(`.${cls}`);
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
  const mm = meta
    ? Math.max(0, Math.round(fluxToMonthlyMm(meta.mean_kgm2, monthIdx)))
    : null;
  const mmLine = mm !== null ? `<div class="tt-primary">${mm} mm</div>` : "";

  if (series === "historical") {
    const pct = Math.round(Math.max(0, historical[monthIdx]));
    const count = meta
      ? (meta.model_count === 1 ? "1 model" : `${meta.model_count}-model ensemble mean`)
      : "";
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
    const pct = Math.round(Math.max(0, moderate[monthIdx]));
    const count = meta
      ? (meta.model_count === 1 ? "1 model" : `${meta.model_count}-model ensemble mean`)
      : "";
    return `
      <div class="tt-eyebrow"><span class="tt-month">${month}</span> · PROJECTED · SSP2-4.5</div>
      ${mmLine}
      <div class="tt-secondary">${pct}% of historical maximum</div>
      <div class="tt-footer">
        <div class="tt-footer-line">Moderate emissions · 2050–2075</div>
        <div class="tt-footer-line">${count}</div>
      </div>`;
  }

  // projected (SSP5-8.5)
  const pct = Math.round(Math.max(0, projected[monthIdx]));
  const count = meta
    ? (meta.model_count === 1 ? "1 model: IPSL-CM6A-LR" : `${meta.model_count}-model ensemble mean`)
    : "";
  return `
    <div class="tt-eyebrow"><span class="tt-month">${month}</span> · PROJECTED · SSP5-8.5</div>
    ${mmLine}
    <div class="tt-secondary">${pct}% of historical maximum</div>
    <div class="tt-footer">
      <div class="tt-footer-line">High emissions · 2050–2075</div>
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

  yAxisG.call(d3.axisLeft(y).ticks(5).tickFormat(d=>d+"%").tickSize(0).tickPadding(8))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll("text")
      .attr("fill","var(--text-dim)")
      .attr("font-size","10px")
      .attr("font-family","'IBM Plex Mono',monospace"));

  demandAreaPath.attr("d", area(demand))
    .attr("fill","var(--demand-dim)");
  demandLinePath.attr("d", line(demand))
    .attr("fill","none")
    .attr("stroke","var(--demand)")
    .attr("stroke-width",2)
    .attr("stroke-dasharray","5 4")
    .attr("opacity",0.7);

  if (historical && projected) {
    histAreaPath
      .attr("d", area(historical))
      .attr("fill","var(--blue-dim)")
      .attr("opacity", 1);
    histLinePath
      .attr("d", line(historical))
      .attr("fill","none")
      .attr("stroke","var(--blue)")
      .attr("stroke-width",2.5)
      .attr("opacity", 1);

    projAreaPath
      .attr("d", area(projected))
      .attr("fill","var(--red-dim)");
    projLinePath
      .attr("d", line(projected))
      .attr("fill","none")
      .attr("stroke","var(--red)")
      .attr("stroke-width",2.5);
  }

  // Hover hit targets — one transparent circle per (series, month) point.
  // Projected is appended first (beneath) so the always-visible demand and
  // historical targets win where points overlap.
  const targetData = [];
  if (projected) projected.forEach((v, i) =>
    targetData.push({ series: "projected", month: i, cx: x(MONTHS[i]), cy: y(v) }));
  demand.forEach((v, i) =>
    targetData.push({ series: "demand", month: i, cx: x(MONTHS[i]), cy: y(Math.max(0, v)) }));
  if (historical) historical.forEach((v, i) =>
    targetData.push({ series: "historical", month: i, cx: x(MONTHS[i]), cy: y(v) }));

  tooltipTargets.selectAll("circle")
    .data(targetData)
    .join("circle")
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", 14)
    .attr("fill", "transparent")
    .attr("stroke", "none")
    .attr("data-series", (d) => d.series)
    .attr("data-month", (d) => d.month)
    .on("mouseenter", (event, d) => {
      if (!isSeriesVisible(d.series)) return;
      showTooltip(event, d.series, d.month);
    })
    .on("mousemove", (event) => positionTooltip(event))
    .on("mouseleave", hideTooltip);

  if (!historical || !projected) return;

  const histPeakIdx = historical.indexOf(Math.max(...historical));
  const projPeakIdx = projected.indexOf(Math.max(...projected));

  const hpx = x(MONTHS[histPeakIdx]);
  const ppx = x(MONTHS[projPeakIdx]);

  const histY = y(historical[histPeakIdx]);
  const projY = y(projected[projPeakIdx]);
  const peaksClose = Math.abs(hpx - ppx) < iW * 0.14;

  histPeak.select("line")
    .attr("x1",hpx).attr("x2",hpx)
    .attr("y1",histY).attr("y2",iH);
  projPeak.select("line")
    .attr("x1",ppx).attr("x2",ppx)
    .attr("y1",projY).attr("y2",iH);

  const demandPeakIdx = demand.indexOf(Math.max(...demand));
  const demandPeakX = x(MONTHS[demandPeakIdx]);
  const yDemandPeak = y(demand[demandPeakIdx]);
  const x0 = Math.min(ppx, demandPeakX);
  const x1 = Math.max(ppx, demandPeakX);
  const yTop = Math.min(projY, yDemandPeak);
  const bandHeight = Math.abs(yDemandPeak - projY);

  gapBand.select(".gap-band")
    .attr("x", x0)
    .attr("y", yTop)
    .attr("width", Math.max(x1 - x0, 1))
    .attr("height", Math.max(bandHeight, 1));

  gapAnnotation.select(".gap-h-proj")
    .attr("x1", x0).attr("x2", x1)
    .attr("y1", projY).attr("y2", projY);

  gapAnnotation.select(".gap-h-demand")
    .attr("x1", x0).attr("x2", x1)
    .attr("y1", yDemandPeak).attr("y2", yDemandPeak);

  const gapLabelX = x0 + (x1 - x0) * 0.62;
  const gapLabelY = bandHeight > 28
    ? yTop + bandHeight / 2
    : projY + 18;

  gapAnnotation.select(".gap-label")
    .attr("x", gapLabelX)
    .attr("y", gapLabelY);

  placePeakLabel(histPeak.select("text"), hpx, histY, iW);
  const projText = projPeak.select("text");
  placePeakLabel(projText, ppx, yTop, iW);
  projText.attr("dy", "-14px");
  if (peaksClose) {
    const dy = parseFloat(projText.attr("dy")) || -14;
    projText.attr("dy", `${dy - 18}px`);
    histPeak.select("text").attr("dy", "-32px");
  }
}

window.addEventListener("resize", draw);

// Redraw once the SVG has layout dimensions (flex + async CSV load)
if (typeof ResizeObserver !== "undefined") {
  const chartObserver = new ResizeObserver(() => draw());
  chartObserver.observe(svg.node());
}

// Scrollytelling states
const steps = document.querySelectorAll(".step");
const dots  = document.querySelectorAll(".dot");

const states = {
  0: () => {
    projAreaPath.transition().duration(500).attr("opacity",0);
    projLinePath.transition().duration(500).attr("opacity",0);
    projPeak.transition().duration(400).attr("opacity",0);
    histPeak.transition().duration(400).attr("opacity",0);
    gapBand.transition().duration(400).attr("opacity",0);
    gapAnnotation.transition().duration(400).attr("opacity",0);
    d3.select("#legend-future").style("opacity","0");
  },
  1: () => {
    projAreaPath.transition().duration(500).attr("opacity",0);
    projLinePath.transition().duration(500).attr("opacity",0);
    projPeak.transition().duration(400).attr("opacity",0);
    histPeak.transition().duration(600).attr("opacity",1);
    gapBand.transition().duration(400).attr("opacity",0);
    gapAnnotation.transition().duration(400).attr("opacity",0);
    d3.select("#legend-future").style("opacity","0");
  },
  2: () => {
    projAreaPath.transition().duration(700).attr("opacity",1);
    projLinePath.transition().duration(700).attr("opacity",1);
    projPeak.transition().duration(600).attr("opacity",1);
    histPeak.transition().duration(600).attr("opacity",1);
    gapBand.transition().duration(700).delay(200).attr("opacity",1);
    gapAnnotation.transition().duration(800).delay(400).attr("opacity",1);
    d3.select("#legend-future").style("opacity","1");
  },
  3: () => {
    projAreaPath.transition().duration(400).attr("opacity",1);
    projLinePath.transition().duration(400).attr("opacity",1);
    projPeak.transition().duration(400).attr("opacity",1);
    histPeak.transition().duration(400).attr("opacity",1);
    gapBand.transition().duration(500).attr("opacity",1);
    gapAnnotation.transition().duration(400).attr("opacity",1);
    d3.select("#legend-future").style("opacity","1");
  }
};

let currentStep = 0;

function setStep(i) {
  currentStep = i;
  dots.forEach((d,j) => d.classList.toggle("active", j===i));
  if (states[i]) states[i]();
}

// Intersection observer
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const i = +entry.target.dataset.step;
      // Deactivate scene 5 dots when main scene is in view
      dots.forEach((d, j) => { if (j >= 4) d.classList.remove("active"); });
      setStep(i);
    }
  });
}, { threshold: 0.5 });

steps.forEach(s => observer.observe(s));

// Progress dot navigation
dots.forEach((d, j) => {
  d.addEventListener("click", () => {
    const i = +d.dataset.step;
    if (j < 4) {
      steps[i].scrollIntoView({ behavior:"smooth", block:"center" });
    } else {
      // dots 4–7 have data-step="4"–"7"; scene 5 steps are indexed 0–3
      steps5[i - 4].scrollIntoView({ behavior:"smooth", block:"center" });
    }
  });
});

// ============================================================
// Scene 5 — Two Futures chart
// ============================================================

const svg5    = d3.select("#chart-svg-5");
const W5      = () => svg5.node().getBoundingClientRect().width;
const H5      = () => svg5.node().getBoundingClientRect().height;
const MARGIN5 = { top: 28, right: 24, bottom: 40, left: 56 };

const x5 = d3.scalePoint().domain(MONTHS).padding(0.1);
const y5 = d3.scaleLinear().domain([0, 110]).nice();

const area5 = (data) => d3.area()
  .x((d,i) => x5(MONTHS[i]))
  .y0(y5(0))
  .y1(d => y5(d))
  .curve(d3.curveCatmullRom.alpha(0.5))(data);

const line5 = (data) => d3.line()
  .x((d,i) => x5(MONTHS[i]))
  .y(d => y5(d))
  .curve(d3.curveCatmullRom.alpha(0.5))(data);

function innerW5() { return W5() - MARGIN5.left - MARGIN5.right; }
function innerH5() { return H5() - MARGIN5.top  - MARGIN5.bottom; }

const root5    = svg5.append("g").attr("transform", `translate(${MARGIN5.left},${MARGIN5.top})`);
const gridG5   = root5.append("g").attr("class","grid");
const xAxisG5  = root5.append("g").attr("class","x-axis");
const yAxisG5  = root5.append("g").attr("class","y-axis");

const histAreaPath5 = root5.append("path").attr("class","hist-area-5");
const histLinePath5 = root5.append("path").attr("class","hist-line-5");

const modAreaPath5 = root5.append("path").attr("class","mod-area-5").attr("opacity",0);
const modLinePath5 = root5.append("path").attr("class","mod-line-5").attr("opacity",0);

const projAreaPath5 = root5.append("path").attr("class","proj-area-5").attr("opacity",0);
const projLinePath5 = root5.append("path").attr("class","proj-line-5").attr("opacity",0);

// Diff annotation group (shown at step 3)
const diffAnnotation5 = root5.append("g").attr("class","diff-annotation").attr("opacity",0);
diffAnnotation5.append("line").attr("class","diff-line-mod")
  .attr("stroke","var(--green)").attr("stroke-width",1).attr("stroke-dasharray","3 3");
diffAnnotation5.append("line").attr("class","diff-line-high")
  .attr("stroke","var(--red)").attr("stroke-width",1).attr("stroke-dasharray","3 3");
diffAnnotation5.append("text").attr("class","diff-label")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .attr("fill","var(--text-dim)")
  .attr("text-anchor","middle")
  .attr("dy","0.35em")
  .text("~10 pt gap at peak");

const tooltipTargets5 = root5.append("g").attr("class","tooltip-targets");

function draw5() {
  const width = W5();
  const height = H5();
  if (width <= 0 || height <= 0) return;

  svg5.attr("width", width).attr("height", height);

  const iW = innerW5();
  const iH = innerH5();
  if (iW <= 0 || iH <= 0) return;

  x5.range([0, iW]);
  y5.range([iH, 0]);

  gridG5.selectAll("line").data(y5.ticks(5)).join("line")
    .attr("x1",0).attr("x2",iW)
    .attr("y1",d=>y5(d)).attr("y2",d=>y5(d))
    .attr("stroke","rgba(255,255,255,0.05)").attr("stroke-width",1);

  xAxisG5.attr("transform",`translate(0,${iH})`)
    .call(d3.axisBottom(x5).tickSize(0).tickPadding(10))
    .call(g => g.select(".domain").attr("stroke","rgba(255,255,255,0.1)"))
    .call(g => g.selectAll("text")
      .attr("fill","var(--text-dim)")
      .attr("font-size","11px")
      .attr("font-family","'IBM Plex Mono',monospace"));

  yAxisG5.call(d3.axisLeft(y5).ticks(5).tickFormat(d=>d+"%").tickSize(0).tickPadding(8))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll("text")
      .attr("fill","var(--text-dim)")
      .attr("font-size","10px")
      .attr("font-family","'IBM Plex Mono',monospace"));

  if (!historical) return;

  histAreaPath5
    .attr("d", area5(historical))
    .attr("fill","var(--blue-dim)")
    .attr("opacity", 1);
  histLinePath5
    .attr("d", line5(historical))
    .attr("fill","none")
    .attr("stroke","var(--blue)")
    .attr("stroke-width",2.5)
    .attr("opacity", 1);

  if (moderate) {
    modAreaPath5
      .attr("d", area5(moderate))
      .attr("fill","var(--green-dim)");
    modLinePath5
      .attr("d", line5(moderate))
      .attr("fill","none")
      .attr("stroke","var(--green)")
      .attr("stroke-width",2.5);
  }

  if (projected) {
    projAreaPath5
      .attr("d", area5(projected))
      .attr("fill","var(--red-dim)");
    projLinePath5
      .attr("d", line5(projected))
      .attr("fill","none")
      .attr("stroke","var(--red)")
      .attr("stroke-width",2.5);
  }

  // Diff annotation — vertical gap at Feb peak between mod and proj
  if (moderate && projected) {
    const peakIdx = historical.indexOf(Math.max(...historical));
    const px = x5(MONTHS[peakIdx]);
    const modY = y5(moderate[peakIdx]);
    const projY = y5(projected[peakIdx]);

    diffAnnotation5.select(".diff-line-mod")
      .attr("x1", px - 18).attr("x2", px + 18)
      .attr("y1", modY).attr("y2", modY);
    diffAnnotation5.select(".diff-line-high")
      .attr("x1", px - 18).attr("x2", px + 18)
      .attr("y1", projY).attr("y2", projY);
    diffAnnotation5.select(".diff-label")
      .attr("x", px + 38)
      .attr("y", (modY + projY) / 2);
  }

  // Hover hit targets for scene 5
  const targetData5 = [];
  if (projected) projected.forEach((v, i) =>
    targetData5.push({ series: "projected", month: i, cx: x5(MONTHS[i]), cy: y5(v) }));
  if (moderate) moderate.forEach((v, i) =>
    targetData5.push({ series: "moderate", month: i, cx: x5(MONTHS[i]), cy: y5(v) }));
  if (historical) historical.forEach((v, i) =>
    targetData5.push({ series: "historical", month: i, cx: x5(MONTHS[i]), cy: y5(v) }));

  tooltipTargets5.selectAll("circle")
    .data(targetData5)
    .join("circle")
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", 14)
    .attr("fill", "transparent")
    .attr("stroke", "none")
    .attr("data-series", (d) => d.series)
    .attr("data-month", (d) => d.month)
    .on("mouseenter", (event, d) => {
      if (!isSeriesVisible5(d.series)) return;
      showTooltip(event, d.series, d.month);
    })
    .on("mousemove", (event) => positionTooltip(event))
    .on("mouseleave", hideTooltip);
}

window.addEventListener("resize", draw5);

if (typeof ResizeObserver !== "undefined") {
  const chartObserver5 = new ResizeObserver(() => draw5());
  const svg5Node = svg5.node();
  if (svg5Node) chartObserver5.observe(svg5Node);
}

// Scene 5 scroll state machine
const state5 = {
  0: () => {
    modAreaPath5.transition().duration(500).attr("opacity",0);
    modLinePath5.transition().duration(500).attr("opacity",0);
    projAreaPath5.transition().duration(500).attr("opacity",0);
    projLinePath5.transition().duration(500).attr("opacity",0);
    diffAnnotation5.transition().duration(400).attr("opacity",0);
    document.getElementById("legend-moderate-5").classList.remove("visible");
    document.getElementById("legend-high-5").classList.remove("visible");
    document.getElementById("scenario-toggle").classList.remove("visible");
  },
  1: () => {
    modAreaPath5.transition().duration(700).attr("opacity",1);
    modLinePath5.transition().duration(700).attr("opacity",1);
    projAreaPath5.transition().duration(400).attr("opacity",0);
    projLinePath5.transition().duration(400).attr("opacity",0);
    diffAnnotation5.transition().duration(400).attr("opacity",0);
    document.getElementById("legend-moderate-5").classList.add("visible");
    document.getElementById("legend-high-5").classList.remove("visible");
    document.getElementById("scenario-toggle").classList.remove("visible");
  },
  2: () => {
    modAreaPath5.transition().duration(500).attr("opacity",0.2);
    modLinePath5.transition().duration(500).attr("opacity",0.35);
    projAreaPath5.transition().duration(700).attr("opacity",1);
    projLinePath5.transition().duration(700).attr("opacity",1);
    diffAnnotation5.transition().duration(400).attr("opacity",0);
    document.getElementById("legend-moderate-5").classList.add("visible");
    document.getElementById("legend-high-5").classList.add("visible");
    document.getElementById("scenario-toggle").classList.remove("visible");
  },
  3: () => {
    modAreaPath5.transition().duration(500).attr("opacity",1);
    modLinePath5.transition().duration(500).attr("opacity",1);
    projAreaPath5.transition().duration(500).attr("opacity",1);
    projLinePath5.transition().duration(500).attr("opacity",1);
    diffAnnotation5.transition().duration(700).delay(300).attr("opacity",1);
    document.getElementById("legend-moderate-5").classList.add("visible");
    document.getElementById("legend-high-5").classList.add("visible");
    document.getElementById("scenario-toggle").classList.add("visible");
  },
};

let currentStep5 = 0;

function setStep5(i) {
  currentStep5 = i;
  // dots 4–7 correspond to scene 5 steps 0–3
  dots.forEach((d, j) => {
    if (j >= 4) d.classList.toggle("active", j - 4 === i);
  });
  if (state5[i]) state5[i]();
}

// Scene 5 IntersectionObserver
const steps5 = document.querySelectorAll(".step-s5");
const observer5 = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const i = +entry.target.dataset.step;
      dots.forEach((d, j) => { if (j < 4) d.classList.remove("active"); });
      // Redraw with in-viewport dimensions — off-screen getBoundingClientRect is unreliable
      draw5();
      setStep5(i);
    }
  });
}, { threshold: 0.5 });

steps5.forEach(s => observer5.observe(s));

// Scenario toggle buttons
document.querySelectorAll(".toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const scenario = btn.dataset.scenario;

    document.querySelectorAll(".toggle-btn").forEach(b => {
      b.classList.remove("active-both","active-mod","active-high");
    });

    if (scenario === "both") {
      btn.classList.add("active-both");
      modAreaPath5.transition().duration(400).attr("opacity",1);
      modLinePath5.transition().duration(400).attr("opacity",1);
      projAreaPath5.transition().duration(400).attr("opacity",1);
      projLinePath5.transition().duration(400).attr("opacity",1);
    } else if (scenario === "moderate") {
      btn.classList.add("active-mod");
      modAreaPath5.transition().duration(400).attr("opacity",1);
      modLinePath5.transition().duration(400).attr("opacity",1);
      projAreaPath5.transition().duration(400).attr("opacity",0.12);
      projLinePath5.transition().duration(400).attr("opacity",0.2);
    } else if (scenario === "high") {
      btn.classList.add("active-high");
      modAreaPath5.transition().duration(400).attr("opacity",0.12);
      modLinePath5.transition().duration(400).attr("opacity",0.2);
      projAreaPath5.transition().duration(400).attr("opacity",1);
      projLinePath5.transition().duration(400).attr("opacity",1);
    }
  });
});

// Draw both charts immediately (axes/grid render without data)
draw();
draw5();

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
      historical = profiles.historical;
      projected = profiles.projected;
      moderate  = profiles.moderate;
      console.info("Loaded snow profiles from", DATA_URL, {
        historical,
        projected,
        moderate,
      });
      draw();
      setStep(currentStep);
      draw5();
    })
    .catch((err) => {
      console.error("Failed to load snow profile CSV:", err);
      const fileHint = err.message === "FILE_PROTOCOL"
        ? "Use <code>python3 -m http.server 5500</code> instead of opening the HTML file directly."
        : `Check that <code>data/sierra_melt_timing_profiles.csv</code> exists and the dev server is running.`;
      showLoadError(
        "Could not load snowpack CSV. " + fileHint
      );
    });
}
