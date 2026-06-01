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

/* ============================================================ */
/* SCENE 3 · Zoom Out: The Sierra Water Network                 */
/* All Scene 3 code is namespaced with scene3 / Scene3 and is   */
/* self-contained so it cannot disturb the existing scenes.     */
/* ============================================================ */

const SCENE3_MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SCENE3_MONTH_FULL = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

const SCENE3_RIVERS_URL = new URL("data/rivers.geojson", document.baseURI).href;

// View box (lon/lat). Trimmed to the network's content so the map fills the
// frame: the empty far-north and dead east margin are cropped, which zooms in
// moderately. Map geometry that falls outside is clipped (see drawScene3BaseMap).
const SCENE3_BBOX = { west: -122.6, east: -117.45, south: 33.85, north: 40.55 };

// Approximate outline of the Sierra Nevada range: gentle western foothill line and
// steep eastern escarpment, wider in the north (Tahoe latitude), tapering south to
// Tehachapi. Geographic reference only -- not the exact CMIP6 analysis box.
// Ordered clockwise: north tip -> south down the west foothills -> north up the east front.
const SCENE3_SIERRA_OUTLINE = [
  [-121.00, 40.25],
  [-121.35, 39.75], [-121.15, 39.30], [-120.85, 38.80], [-120.55, 38.30],
  [-120.10, 37.75], [-119.65, 37.25], [-119.20, 36.70], [-118.80, 36.20],
  [-118.55, 35.65], [-118.40, 35.05],
  [-118.05, 35.35], [-118.00, 35.95], [-118.15, 36.45], [-118.45, 37.00],
  [-118.80, 37.55], [-119.10, 38.05], [-119.45, 38.55], [-119.70, 39.00],
  [-119.95, 39.45], [-120.25, 39.95],
];

// State boundaries (CA/NV + neighbors), public-domain GeoJSON trimmed locally.
const SCENE3_STATES_URL = new URL("data/states.geojson", document.baseURI).href;

// Branch + base width metadata for the six target rivers in the network.
const SCENE3_RIVER_META = {
  "Sacramento River": { branch: "west",  baseWidth: 8 },
  "San Joaquin River": { branch: "west",  baseWidth: 7 },
  "Truckee River":     { branch: "east",  baseWidth: 5 },
  "Carson River":      { branch: "east",  baseWidth: 4 },
  "Walker River":      { branch: "east",  baseWidth: 4 },
  "Owens River":       { branch: "owens", baseWidth: 5 },
};

// Approximate paths used only when a target river is absent from the GeoJSON.
const SCENE3_FALLBACK_GEOMETRY = {
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
const SCENE3_AQUEDUCT_GEOMETRY = [
  [-117.96, 36.43], [-117.98, 35.95], [-118.05, 35.40], [-118.16, 34.90],
  [-118.27, 34.45], [-118.24, 34.28],
];

// Region / city dependency nodes by branch.
const SCENE3_NODES = [
  { id: "centralvalley", label: "Central Valley farms", lon: -120.55, lat: 37.05, branch: "west",  kind: "region", color: "var(--s3-valley)" },
  { id: "bayarea",       label: "Bay Area",             lon: -122.25, lat: 37.85, branch: "west",  kind: "city",   color: "var(--s3-valley)" },
  { id: "socal",         label: "Southern California",  lon: -117.55, lat: 34.55, branch: "west",  kind: "region", color: "var(--s3-valley)" },
  { id: "reno",          label: "Reno-Sparks",          lon: -119.81, lat: 39.53, branch: "east",  kind: "city",   color: "var(--s3-nevada)" },
  { id: "pyramid",       label: "Pyramid Lake",         lon: -119.58, lat: 39.99, branch: "east",  kind: "lake",   color: "var(--s3-nevada)" },
  { id: "lahontan",      label: "Lahontan Valley",      lon: -118.97, lat: 39.45, branch: "east",  kind: "region", color: "var(--s3-nevada)" },
  { id: "walkerlake",    label: "Walker Lake",          lon: -118.71, lat: 38.74, branch: "east",  kind: "lake",   color: "var(--s3-nevada)" },
  { id: "la",            label: "Los Angeles",          lon: -118.24, lat: 34.05, branch: "owens", kind: "city",   color: "var(--s3-owens)" },
];

// Region polygons (loose blobs) so branches read as dependency areas.
const SCENE3_REGIONS = [
  {
    id: "centralvalley", branch: "west", color: "var(--s3-valley-dim)", stroke: "var(--s3-valley)",
    coords: [[-121.9, 39.5], [-120.9, 39.7], [-119.9, 37.6], [-119.6, 36.6], [-120.4, 36.3], [-121.3, 37.6], [-122.0, 38.6]],
  },
  {
    id: "wnevada", branch: "east", color: "var(--s3-nevada-dim)", stroke: "var(--s3-nevada)",
    coords: [[-120.1, 40.3], [-118.6, 40.2], [-118.4, 38.5], [-119.4, 38.3], [-120.2, 39.3]],
  },
];

const scene3 = {
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

function getScene3ScenarioLabel(scenario) {
  if (scenario === "ssp245") return "SSP2-4.5";
  if (scenario === "ssp585") return "SSP5-8.5";
  return "Historical";
}

function getScene3MonthLabel(month) {
  const idx = Math.max(1, Math.min(12, month)) - 1;
  return SCENE3_MONTH_FULL[idx];
}

// Returns the snw_index (0-100 scale) for a scenario/month.
// Falls back to a fixed visual value (x100) when the CSV is unavailable.
function getScene3MeltValue(scenario, month) {
  if (scene3.meltOk && scene3.meltProfiles[scenario] && scene3.meltProfiles[scenario][month]) {
    return scene3.meltProfiles[scenario][month].snw_index;
  }
  const f = scene3.fallback[scenario];
  return (f !== undefined ? f : 0.6) * 100;
}

function getScene3VisualScale(snwIndex) {
  return Math.max(0.15, Math.min(1.25, snwIndex / 100));
}

async function loadScene3MeltProfiles() {
  if (window.location.protocol === "file:") throw new Error("FILE_PROTOCOL");
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${DATA_URL}`);

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

async function loadScene3States() {
  if (window.location.protocol === "file:") return [];
  try {
    const response = await fetch(SCENE3_STATES_URL);
    if (!response.ok) return [];
    const geo = await response.json();
    return (geo && geo.features) ? geo.features : [];
  } catch (err) {
    console.warn("Scene 3: states.geojson could not be loaded; skipping outlines.", err);
    return [];
  }
}

async function loadScene3Rivers() {
  if (window.location.protocol === "file:") return [];
  try {
    const response = await fetch(SCENE3_RIVERS_URL);
    if (!response.ok) return [];
    const geo = await response.json();
    return (geo && geo.features) ? geo.features : [];
  } catch (err) {
    console.warn("Scene 3: rivers.geojson could not be loaded; using fallbacks.", err);
    return [];
  }
}

// Map a raw GeoJSON name to one of the canonical target river names.
function normalizeScene3RiverName(rawName) {
  const n = (rawName || "").toLowerCase();
  if (n.includes("sacramento")) return "Sacramento River";
  if (n.includes("san joaquin")) return "San Joaquin River";
  if (n.includes("truckee")) return "Truckee River";
  if (n.includes("carson")) return "Carson River";
  if (n.includes("walker")) return "Walker River";
  if (n.includes("owens")) return "Owens River";
  return null;
}

function makeScene3FallbackRiverFeatures(existingRiverNames) {
  const have = new Set(existingRiverNames);
  const features = [];
  Object.keys(SCENE3_FALLBACK_GEOMETRY).forEach((name) => {
    if (have.has(name)) return;
    const meta = SCENE3_RIVER_META[name];
    features.push({
      name,
      branch: meta.branch,
      baseWidth: meta.baseWidth,
      isFallback: true,
      feature: {
        type: "Feature",
        properties: { name },
        geometry: { type: "LineString", coordinates: SCENE3_FALLBACK_GEOMETRY[name] },
      },
    });
  });
  return features;
}

function mergeLoadedAndFallbackScene3Rivers(loadedFeatures) {
  const merged = [];
  const seen = new Set();

  loadedFeatures.forEach((feat) => {
    const props = feat.properties || {};
    const canonical = normalizeScene3RiverName(props.name || props.name_en || props.originalName);
    if (!canonical || !SCENE3_RIVER_META[canonical] || seen.has(canonical)) return;
    seen.add(canonical);
    const meta = SCENE3_RIVER_META[canonical];
    merged.push({
      name: canonical,
      branch: meta.branch,
      baseWidth: meta.baseWidth,
      isFallback: false,
      feature: feat,
    });
  });

  // Add approximate paths for any target river still missing.
  return merged.concat(makeScene3FallbackRiverFeatures([...seen]));
}

async function loadScene3Data() {
  // Melt profiles (drives river thickness).
  try {
    scene3.meltProfiles = await loadScene3MeltProfiles();
    scene3.meltOk = true;
    // Historical peak melt month (1-12) for the baseline default.
    const hist = scene3.meltProfiles.historical;
    let peakMonth = 4, peakVal = -Infinity;
    Object.keys(hist).forEach((m) => {
      if (hist[m].snw_index > peakVal) { peakVal = hist[m].snw_index; peakMonth = +m; }
    });
    scene3.histPeakMonth = peakMonth;
  } catch (err) {
    console.warn("Scene 3: melt profile CSV not loaded; using visual fallback values.", err);
    scene3.meltOk = false;
  }

  // River geometry (real where available, fallback where not).
  const loaded = await loadScene3Rivers();
  scene3.rivers = mergeLoadedAndFallbackScene3Rivers(loaded);

  // State boundaries for geographic context (optional; skipped if unavailable).
  scene3.states = await loadScene3States();
}

function scene3Measure() {
  const wrap = scene3.el.svgWrap;
  if (!wrap) return false;
  const rect = wrap.getBoundingClientRect();
  scene3.width = Math.max(10, rect.width);
  scene3.height = Math.max(10, rect.height);
  return true;
}

function setupScene3Projection() {
  const { west, east, south, north } = SCENE3_BBOX;
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
  scene3.projection = d3.geoMercator()
    .fitExtent([[pad, pad], [scene3.width - pad, scene3.height - pad]], bounds);
  scene3.path = d3.geoPath(scene3.projection);
}

function scene3LonLat(lon, lat) {
  return scene3.projection([lon, lat]);
}

function drawScene3BaseMap() {
  const svg = scene3.el.svg;
  svg.attr("width", scene3.width).attr("height", scene3.height);

  // <defs>: clip rectangle (= SVG frame) so map geometry cropped by the
  // zoomed-in view doesn't spill into the controls. Node labels are
  // intentionally left unclipped so edge labels stay fully readable.
  let defs = svg.select("defs");
  if (defs.empty()) {
    defs = svg.append("defs");
    defs.append("clipPath").attr("id", "scene3-bbox-clip").append("rect")
      .attr("class", "scene3-bbox-clip-rect");
  }

  // Keep the clip rect sized to the visible SVG frame.
  svg.select("#scene3-bbox-clip rect.scene3-bbox-clip-rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", scene3.width).attr("height", scene3.height);

  // Layer groups, drawn back-to-front, created once. Geometry layers are clipped
  // to the frame; gNodes is not, so labels near the edges remain visible.
  if (!scene3.el.gStates) {
    scene3.el.gStates    = svg.append("g").attr("class", "scene3-layer-states")
      .attr("clip-path", "url(#scene3-bbox-clip)");
    scene3.el.gRegions   = svg.append("g").attr("class", "scene3-layer-regions")
      .attr("clip-path", "url(#scene3-bbox-clip)");
    scene3.el.gSnow      = svg.append("g").attr("class", "scene3-layer-snow")
      .attr("clip-path", "url(#scene3-bbox-clip)");
    scene3.el.gRivers    = svg.append("g").attr("class", "scene3-layer-rivers")
      .attr("clip-path", "url(#scene3-bbox-clip)");
    scene3.el.gAqueduct  = svg.append("g").attr("class", "scene3-layer-aqueduct")
      .attr("clip-path", "url(#scene3-bbox-clip)");
    scene3.el.gParticles = svg.append("g").attr("class", "scene3-layer-particles")
      .attr("clip-path", "url(#scene3-bbox-clip)");
    scene3.el.gNodes     = svg.append("g").attr("class", "scene3-layer-nodes");
  }
}

// State boundaries for geographic context. Clipped to the frame so the polygons
// that extend beyond the visible map (e.g. the rest of Oregon/Arizona) are cut off.
function drawScene3States() {
  const g = scene3.el.gStates;
  if (!g) return;
  const join = g.selectAll("path.scene3-state").data(scene3.states, (d, i) =>
    (d.properties && d.properties.name) || i);
  join.join("path")
    .attr("class", "scene3-state")
    .attr("data-name", (d) => (d.properties ? d.properties.name : ""))
    .attr("d", (d) => scene3.path(d));
}

function drawScene3Regions() {
  const join = scene3.el.gRegions.selectAll("path.scene3-region-shape")
    .data(SCENE3_REGIONS, (d) => d.id);
  join.join("path")
    .attr("class", (d) => `scene3-region-shape scene3-region-${d.branch}`)
    .attr("d", (d) => scene3.path({
      type: "Polygon",
      coordinates: [d.coords.concat([d.coords[0]])],
    }))
    .attr("fill", (d) => d.color)
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-opacity", 0.35)
    .attr("data-branch", (d) => d.branch);
}

function drawScene3SnowSource() {
  const g = scene3.el.gSnow;
  const c = scene3LonLat(-119.1, 38.25);

  let label = g.select("text.scene3-snow-label");
  if (label.empty()) label = g.append("text").attr("class", "scene3-snow-label");
  label
    .attr("x", c[0]).attr("y", c[1])
    .attr("text-anchor", "middle")
    .text("Sierra snowpack");
}

// Approximate outline of the Sierra Nevada range. Geographic reference only;
// drawn in the snow layer so it frames the snowpack source.
function drawScene3SierraArea() {
  const g = scene3.el.gSnow;
  if (!g) return;
  const feature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [SCENE3_SIERRA_OUTLINE.concat([SCENE3_SIERRA_OUTLINE[0]])],
    },
  };

  let path = g.select("path.scene3-sierra-area");
  if (path.empty()) path = g.append("path").attr("class", "scene3-sierra-area");
  path.attr("d", scene3.path(feature));

  // Label near the wider northern end so it doesn't collide with the snow glow.
  const anchor = scene3LonLat(-120.45, 40.0);
  let label = g.select("text.scene3-sierra-label");
  if (label.empty()) label = g.append("text").attr("class", "scene3-sierra-label");
  label
    .attr("x", anchor[0]).attr("y", anchor[1] - 6)
    .attr("text-anchor", "middle")
    .text("Sierra Nevada");
}

function drawScene3Rivers() {
  const sel = scene3.el.gRivers.selectAll("path.scene3-river")
    .data(scene3.rivers, (d) => d.name);

  sel.join(
    (enter) => enter.append("path")
      .attr("class", (d) => `scene3-river scene3-river-${d.branch}`)
      .attr("data-name", (d) => d.name)
      .attr("data-branch", (d) => d.branch)
      .on("mousemove", (event, d) => scene3ShowTooltip(event, d))
      .on("mouseleave", scene3HideTooltip),
    (update) => update,
  )
    .attr("d", (d) => scene3.path(d.feature))
    .each(function (d) {
      d.node = this;
      d.length = this.getTotalLength();
    });
}

function drawScene3Aqueduct() {
  const g = scene3.el.gAqueduct;
  const feature = {
    type: "Feature",
    properties: { name: "Los Angeles Aqueduct" },
    geometry: { type: "LineString", coordinates: SCENE3_AQUEDUCT_GEOMETRY },
  };
  let path = g.select("path.scene3-aqueduct");
  if (path.empty()) {
    path = g.append("path")
      .attr("class", "scene3-aqueduct")
      .attr("data-name", "Los Angeles Aqueduct")
      .attr("data-branch", "owens")
      .on("mousemove", (event) => scene3ShowTooltip(event, {
        name: "Los Angeles Aqueduct", branch: "owens", isAqueduct: true,
      }))
      .on("mouseleave", scene3HideTooltip);
  }
  path.attr("d", scene3.path(feature));
}

function drawScene3Nodes() {
  const g = scene3.el.gNodes;

  const dots = g.selectAll("circle.scene3-node-dot").data(SCENE3_NODES, (d) => d.id);
  dots.join("circle")
    .attr("class", (d) => `scene3-node-dot scene3-node-${d.branch}`)
    .attr("data-branch", (d) => d.branch)
    .attr("cx", (d) => scene3LonLat(d.lon, d.lat)[0])
    .attr("cy", (d) => scene3LonLat(d.lon, d.lat)[1])
    .attr("r", (d) => (d.kind === "region" ? 5.5 : 4))
    .attr("fill", (d) => d.color)
    .attr("stroke", "rgba(8,12,18,0.8)")
    .attr("stroke-width", 1.2);

  const labels = g.selectAll("text.scene3-node-label").data(SCENE3_NODES, (d) => d.id);
  labels.join("text")
    .attr("class", (d) => `scene3-node-label scene3-node-${d.branch}`)
    .attr("data-branch", (d) => d.branch)
    .attr("x", (d) => scene3LonLat(d.lon, d.lat)[0] + 8)
    .attr("y", (d) => scene3LonLat(d.lon, d.lat)[1] + 3)
    .text((d) => d.label);
}

function drawScene3Legend() {
  const items = [
    { swatch: `<span class="scene3-legend-swatch" style="width:26px;height:6px;border-radius:3px;background:var(--s3-river)"></span>`,
      text: "Thick / bright river = stronger melt proxy" },
    { swatch: `<span class="scene3-legend-swatch" style="width:26px;height:2px;border-radius:2px;background:var(--s3-river);opacity:0.4"></span>`,
      text: "Thin / faint river = weaker melt proxy" },
    { swatch: `<span class="scene3-legend-swatch" style="width:10px;height:10px;border-radius:50%;background:var(--s3-snow)"></span>`,
      text: "Moving dots = downstream dependency direction" },
    { swatch: `<span class="scene3-legend-swatch" style="width:26px;height:0;border-top:2px dashed var(--s3-owens)"></span>`,
      text: "Dashed line = engineered aqueduct connection" },
  ];
  scene3.el.legend.innerHTML = items.map((it) =>
    `<div class="scene3-legend-item">${it.swatch}<span>${it.text}</span></div>`).join("");
}

// Apply melt-proxy scaling + branch highlight to rivers, aqueduct, nodes, snow.
function updateScene3RiverStress(visualScale) {
  scene3.visualScale = visualScale;
  const branch = scene3.current.branchHighlight;
  const baseOpacity = 0.25 + 0.75 * Math.min(1, visualScale);

  const inBranch = (b) => branch === "all" || branch === b;
  const dim = (b) => (inBranch(b) ? 1 : 0.16);

  scene3.el.gRivers.selectAll("path.scene3-river")
    .transition().duration(650)
    .attr("stroke-width", (d) => Math.max(0.6, d.baseWidth * visualScale))
    .attr("opacity", (d) => baseOpacity * dim(d.branch));

  scene3.el.gAqueduct.select("path.scene3-aqueduct")
    .classed("is-animating", inBranch("owens"))
    .transition().duration(650)
    .attr("stroke-width", Math.max(1, 3 * visualScale))
    .attr("opacity", (0.4 + 0.5 * Math.min(1, visualScale)) * dim("owens"));

  scene3.el.gNodes.selectAll(".scene3-node-dot, .scene3-node-label")
    .transition().duration(500)
    .style("opacity", function () {
      const b = this.getAttribute("data-branch");
      return inBranch(b) ? 1 : 0.18;
    });

  scene3.el.gRegions.selectAll("path.scene3-region-shape")
    .transition().duration(500)
    .style("opacity", function () {
      const b = this.getAttribute("data-branch");
      return inBranch(b) ? 1 : 0.22;
    });

}

// ---- Particles ----
function animateScene3Particle(pathNode, visualScale) {
  if (!pathNode) return;
  const len = pathNode.__s3len || pathNode.getTotalLength();
  pathNode.__s3len = len;
  if (len < 5 || scene3.particles.length > 260) return;

  const isAqueduct = pathNode.classList.contains("scene3-aqueduct");
  const r = Math.max(0.8, 2.5 * visualScale);
  const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  el.setAttribute("class", "scene3-particle");
  el.setAttribute("r", r);
  el.setAttribute("fill", isAqueduct ? "var(--s3-owens)" : "var(--s3-snow)");
  el.setAttribute("opacity", 0.85);
  scene3.el.gParticles.node().appendChild(el);

  scene3.particles.push({
    el,
    node: pathNode,
    len,
    dist: 0,
    speed: 0.045 * (0.4 + visualScale), // px per ms
  });
}

function scene3Tick(ts) {
  if (!scene3.particlesOn) return;
  if (!scene3.lastTs) scene3.lastTs = ts;
  const dt = Math.min(60, ts - scene3.lastTs);
  scene3.lastTs = ts;

  const vs = scene3.visualScale;
  const branch = scene3.current.branchHighlight;
  const inBranch = (b) => branch === "all" || branch === b;
  const interval = scene3.baseSpawnInterval / Math.max(0.12, vs);

  // Spawn along rivers (and aqueduct) currently in the active branch.
  scene3.rivers.forEach((r) => {
    if (!r.node || !inBranch(r.branch)) return;
    r.spawnAcc = (r.spawnAcc || 0) + dt;
    if (r.spawnAcc >= interval) {
      r.spawnAcc = 0;
      animateScene3Particle(r.node, vs);
    }
  });

  const aq = scene3.el.gAqueduct.select("path.scene3-aqueduct").node();
  if (aq && inBranch("owens")) {
    scene3.aqAcc = (scene3.aqAcc || 0) + dt;
    if (scene3.aqAcc >= interval * 1.2) {
      scene3.aqAcc = 0;
      animateScene3Particle(aq, vs);
    }
  }

  // Advance existing particles.
  scene3.particles = scene3.particles.filter((p) => {
    p.dist += p.speed * dt;
    if (p.dist >= p.len) { p.el.remove(); return false; }
    const pt = p.node.getPointAtLength(p.dist);
    p.el.setAttribute("cx", pt.x);
    p.el.setAttribute("cy", pt.y);
    return true;
  });

  scene3.raf = requestAnimationFrame(scene3Tick);
}

function startScene3Particles() {
  if (scene3.particlesOn) return;
  scene3.particlesOn = true;
  scene3.lastTs = 0;
  scene3.raf = requestAnimationFrame(scene3Tick);
}

function stopScene3Particles() {
  scene3.particlesOn = false;
  if (scene3.raf) cancelAnimationFrame(scene3.raf);
  scene3.raf = null;
  scene3.particles.forEach((p) => p.el.remove());
  scene3.particles = [];
}

// ---- Tooltip ----
function scene3ShowTooltip(event, d) {
  const tt = scene3.el.tooltip;
  if (!tt) return;
  const scenario = scene3.current.scenario;
  const month = scene3.current.month;
  const meta = (scene3.meltOk && scene3.meltProfiles[scenario] && scene3.meltProfiles[scenario][month])
    ? scene3.meltProfiles[scenario][month] : null;
  const snwIndex = getScene3MeltValue(scenario, month);
  const modelCount = meta ? meta.model_count : "—";

  tt.innerHTML = `
    <div class="scene3-tt-title">${d.name}</div>
    <div class="scene3-tt-row">Branch · <b>${scene3BranchLabel(d.branch)}</b></div>
    <div class="scene3-tt-row">Scenario · <b>${getScene3ScenarioLabel(scenario)}</b></div>
    <div class="scene3-tt-row">Month · <b>${getScene3MonthLabel(month)}</b></div>
    <div class="scene3-tt-row">Melt proxy (snw_index) · <b>${snwIndex.toFixed(1)}</b></div>
    <div class="scene3-tt-row">Models · <b>${modelCount}</b></div>
    <div class="scene3-tt-note">melt proxy, not measured flow</div>`;
  tt.classList.add("visible");
  scene3PositionTooltip(event);
}

function scene3PositionTooltip(event) {
  const tt = scene3.el.tooltip;
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

function scene3HideTooltip() {
  const tt = scene3.el.tooltip;
  if (tt) tt.classList.remove("visible");
}

function scene3BranchLabel(branch) {
  if (branch === "west") return "Western slope (California)";
  if (branch === "east") return "Eastern slope (W. Nevada)";
  if (branch === "owens") return "Owens Valley → Los Angeles";
  return "All branches";
}

// ---- Caption ----
function scene3UpdateCaption() {
  const cap = scene3.el.caption;
  if (!cap) return;
  const base = "River thickness is scaled by the project\u2019s CMIP6-derived Sierra melt proxy, " +
    "normalized so the historical peak melt month equals 100. It represents relative upstream " +
    "snowmelt stress/timing, not exact river discharge or managed water deliveries.";
  if (!scene3.meltOk) {
    cap.classList.add("is-warning");
    cap.textContent = "CMIP6 melt profile data not loaded; using visual fallback values. " + base;
  } else {
    cap.classList.remove("is-warning");
    cap.textContent = base;
  }
}

function scene3UpdateStateLabel() {
  const el = scene3.el.stateLabel;
  if (!el) return;
  const snw = getScene3MeltValue(scene3.current.scenario, scene3.current.month);
  el.textContent =
    `${getScene3ScenarioLabel(scene3.current.scenario)} · ${getScene3MonthLabel(scene3.current.month)} · proxy ${snw.toFixed(0)}`;
}

// ---- Central update ----
function updateScene3({ scenario, month, step, branchHighlight } = {}) {
  if (scenario !== undefined) scene3.current.scenario = scenario;
  if (month !== undefined) scene3.current.month = month;
  if (step !== undefined) scene3.current.step = step;
  if (branchHighlight !== undefined) scene3.current.branchHighlight = branchHighlight;

  const snw = getScene3MeltValue(scene3.current.scenario, scene3.current.month);
  const visualScale = getScene3VisualScale(snw);

  updateScene3RiverStress(visualScale);
  scene3SyncControls();
  scene3UpdateStateLabel();

  // Particles begin from step 1 onward (subtle), unless a user override is active.
  if (scene3.current.step >= 1 || scene3.lock.scenario || scene3.lock.month || scene3.lock.branch) {
    startScene3Particles();
  } else {
    stopScene3Particles();
  }
}

// ---- Controls ----
function scene3SyncControls() {
  const root = scene3.el.section;
  root.querySelectorAll('.scene3-btn[data-scenario]').forEach((b) =>
    b.classList.toggle("is-active", b.dataset.scenario === scene3.current.scenario));
  root.querySelectorAll('.scene3-btn[data-branch]').forEach((b) =>
    b.classList.toggle("is-active", b.dataset.branch === scene3.current.branchHighlight));
  root.querySelectorAll('.scene3-btn[data-month]').forEach((b) =>
    b.classList.toggle("is-active", +b.dataset.month === scene3.current.month));
}

function setupScene3Controls() {
  const root = scene3.el.section;

  // Build month buttons.
  const monthWrap = root.querySelector(".scene3-months");
  if (monthWrap) {
    monthWrap.innerHTML = SCENE3_MONTH_LABELS.map((m, i) =>
      `<button class="scene3-btn" data-month="${i + 1}">${m}</button>`).join("");
  }

  root.querySelectorAll(".scene3-btn[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene3.lock.scenario = true;
      updateScene3({ scenario: btn.dataset.scenario });
    });
  });
  root.querySelectorAll(".scene3-btn[data-branch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene3.lock.branch = true;
      updateScene3({ branchHighlight: btn.dataset.branch });
    });
  });
  root.querySelectorAll(".scene3-btn[data-month]").forEach((btn) => {
    btn.addEventListener("click", () => {
      scene3.lock.month = true;
      updateScene3({ month: +btn.dataset.month });
    });
  });
}

// ---- Scroll observer ----
function setupScene3ScrollObserver() {
  const stepEls = scene3.el.section.querySelectorAll(".scene3-step");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const ds = entry.target.dataset;
      entry.target.classList.add("is-active");
      stepEls.forEach((s) => { if (s !== entry.target) s.classList.remove("is-active"); });

      // Scroll only drives dimensions the user has not locked via controls.
      const patch = { step: +ds.step };
      if (!scene3.lock.scenario && ds.scenario) patch.scenario = ds.scenario;
      if (!scene3.lock.month && ds.month) patch.month = +ds.month;
      if (!scene3.lock.branch && ds.branch) patch.branchHighlight = ds.branch;
      updateScene3(patch);
    });
  }, { threshold: 0.55 });
  stepEls.forEach((s) => observer.observe(s));
}

function scene3Resize() {
  if (!scene3.initialized) return;
  if (!scene3Measure()) return;
  setupScene3Projection();
  drawScene3BaseMap();
  drawScene3States();
  drawScene3Regions();
  drawScene3SnowSource();
  drawScene3SierraArea();
  drawScene3Rivers();
  drawScene3Aqueduct();
  drawScene3Nodes();
  updateScene3RiverStress(scene3.visualScale);
}

async function initScene3RiverNetwork() {
  const section = document.getElementById("scene-3-river-network");
  if (!section) return;

  scene3.el.section = section;
  scene3.el.svg = d3.select("#scene3-river-svg");
  scene3.el.svgWrap = section.querySelector(".scene3-svg-wrap");
  scene3.el.legend = section.querySelector(".scene3-legend");
  scene3.el.caption = section.querySelector(".scene3-caption");
  scene3.el.stateLabel = section.querySelector(".scene3-state-label");

  // Dedicated tooltip element appended once to the body.
  let tt = document.querySelector(".scene3-tooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.className = "scene3-tooltip";
    document.body.appendChild(tt);
  }
  scene3.el.tooltip = tt;

  await loadScene3Data();

  if (!scene3Measure()) {
    // Layout not ready yet; retry on next frame.
    requestAnimationFrame(() => initScene3RiverNetwork());
    return;
  }

  setupScene3Projection();
  drawScene3BaseMap();
  drawScene3States();
  drawScene3Regions();
  drawScene3SnowSource();
  drawScene3SierraArea();
  drawScene3Rivers();
  drawScene3Aqueduct();
  drawScene3Nodes();
  drawScene3Legend();

  setupScene3Controls();
  setupScene3ScrollObserver();
  scene3UpdateCaption();

  scene3.initialized = true;

  // Baseline default: historical peak month (fallback to April / month 4).
  const baselineMonth = scene3.meltOk ? scene3.histPeakMonth : 4;
  scene3.current.month = baselineMonth;
  // Reflect the baseline month in the step-0 default for scroll consistency.
  const step0 = section.querySelector('.scene3-step[data-step="0"]');
  if (step0) step0.dataset.month = String(baselineMonth);
  const step1 = section.querySelector('.scene3-step[data-step="1"]');
  if (step1) step1.dataset.month = String(baselineMonth);

  updateScene3({ scenario: "historical", month: baselineMonth, step: 0, branchHighlight: "all" });

  // Keep the map sized to its sticky container.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scene3Resize());
    ro.observe(scene3.el.svgWrap);
  }
  window.addEventListener("resize", scene3Resize);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScene3RiverNetwork);
} else {
  initScene3RiverNetwork();
}
