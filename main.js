// Data
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DATA_URL = new URL("data/sierra_melt_timing_profiles.csv", document.baseURI).href;
const PROJECTED_SCENARIO = "ssp585";

// Illustrative agricultural water demand (not from CMIP6)
const demand = [8, 7, 10, 15, 38, 70, 100, 97, 62, 28, 10, 7];

let historical;
let projected;

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

  if (!hist || !proj) {
    const scenarios = [...new Set(rows.map((d) => d.scenario))];
    throw new Error(
      `Expected 12 monthly rows per scenario in ${DATA_URL}. ` +
      `Found scenarios: ${scenarios.join(", ")}`
    );
  }

  return { historical: hist, projected: proj };
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
      <div class="tt-footer-line">2050–2075</div>
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
      setStep(i);
    }
  });
}, { threshold: 0.5 });

steps.forEach(s => observer.observe(s));

// Progress dot navigation
dots.forEach(d => {
  d.addEventListener("click", () => {
    const i = +d.dataset.step;
    steps[i].scrollIntoView({ behavior:"smooth", block:"center" });
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
      historical = profiles.historical;
      projected = profiles.projected;
      console.info("Loaded snow profiles from", DATA_URL, {
        historical,
        projected,
      });
      draw();
      setStep(currentStep);
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
    anomaly: +d.anomaly
  }));
}

async function initScene2() {
  await loadSWEData();
  
  const meanX = d3.mean(S2_DATA, d => d.year);
  const meanY = d3.mean(S2_DATA, d => d.anomaly);
  const num = d3.sum(S2_DATA, d => (d.year - meanX) * (d.anomaly - meanY));
  const den = d3.sum(S2_DATA, d => (d.year - meanX) ** 2);
  const trendSlope = { m: num / den, b: meanY - (num / den) * meanX };
   
  const svg2 = d3.select("#scene2-svg");
  const slider = document.getElementById("scene2-slider");
  const yearVal = document.getElementById("scene2-year-val");
  const statBox = document.getElementById("scene2-stat");

  if (!svg2.node() || !slider) return;

  const M2 = { top: 30, right: 30, bottom: 40, left: 60 };
  const x2 = d3.scaleLinear().domain([1950, 2023]);
  const y2 = d3.scaleLinear();
  const svgNode = svg2.node();

  function setup2() {
    svg2.selectAll("*").remove();

    const anomalyExtent = d3.extent(S2_DATA, d => d.anomaly);
    const maxVal = Math.max(Math.abs(anomalyExtent[0]), Math.abs(anomalyExtent[1]));
    y2.domain([-maxVal - 2, maxVal + 2]);

    const W2 = svgNode.getBoundingClientRect().width;
    const H2 = svgNode.getBoundingClientRect().height;
    const iW2 = W2 - M2.left - M2.right;
    const iH2 = H2 - M2.top - M2.bottom;

    x2.range([0, iW2]);
    y2.range([iH2, 0]);

    const defs = svg2.append("defs");

    defs.append("clipPath").attr("id", "s2-clip")
      .append("rect")
      .attr("x", 0)
      .attr("y", -M2.top)
      .attr("width", 0)
      .attr("height", iH2 + M2.top + M2.bottom);

    const root2 = svg2.append("g").attr("transform", `translate(${M2.left},${M2.top})`);
    
    root2.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${iH2})`)
      .call(d3.axisBottom(x2).tickFormat(d3.format("d")).ticks(8))
      .call(g => g.select(".domain").attr("stroke", "rgba(255,255,255,0.1)"))
      .call(g => g.selectAll("text").attr("fill", "var(--text-dim)").attr("font-family", "'IBM Plex Mono',monospace"));

    root2.append("g")
      .attr("class", "y-axis")
      .call(d3.axisLeft(y2).ticks(6).tickFormat(d => (d > 0 ? "+" : "") + d + " in"))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll("text").attr("fill", "var(--text-dim)").attr("font-family", "'IBM Plex Mono',monospace"));

    root2.append("line")
      .attr("x1", 0).attr("x2", iW2)
      .attr("y1", y2(0)).attr("y2", y2(0))
      .attr("stroke", "rgba(255,255,255,0.4)")
      .attr("stroke-width", 1);

    const barWidth = Math.max(1.5, (iW2 / S2_DATA.length) * 0.65);

    root2.selectAll(".anomaly-bar")
      .data(S2_DATA)
      .join("rect")
      .attr("class", "anomaly-bar")
      .attr("x", d => x2(d.year) - barWidth / 2)
      .attr("y", d => d.anomaly >= 0 ? y2(d.anomaly) : y2(0))
      .attr("width", barWidth)
      .attr("height", d => Math.abs(y2(d.anomaly) - y2(0)))
      .attr("fill", d => d.anomaly >= 0 ? "rgba(79,168,213,0.85)" : "rgba(224,90,74,0.85)")
      .attr("clip-path", "url(#s2-clip)");

    const lineGen2 = d3.line()
      .x(d => x2(d.year))
      .y(d => y2(d.anomaly));

    const trendData = [
      { year: 1950, anomaly: trendSlope.m * 1950 + trendSlope.b },
      { year: 2023, anomaly: trendSlope.m * 2023 + trendSlope.b }
    ];
    
    root2.append("path")
      .datum(trendData)
      .attr("fill", "none")
      .attr("stroke", "var(--red)")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 4")
      .attr("d", lineGen2)
      .attr("clip-path", "url(#s2-clip)");

    defs.select("#s2-clip rect")
      .transition().duration(1200)
      .attr("width", iW2);
  }

  setup2();
  window.addEventListener("resize", setup2);

  slider.addEventListener("input", (e) => {
    const targetYear = +e.target.value;
    if (yearVal) yearVal.textContent = targetYear;
    
    const d = S2_DATA.find(row => row.year === targetYear);
    if (d && statBox) {
      const color = d.anomaly >= 0 ? "rgba(79,168,213,1)" : "rgba(224,90,74,1)";
      const sign = d.anomaly >= 0 ? "+" : "";
      statBox.innerHTML = `Year: <strong>${d.year}</strong> | Anomaly: <strong style="color:${color}">${sign}${d.anomaly.toFixed(1)} in</strong>`;
    }
  });
}

initScene2().catch(err => console.error(err));
