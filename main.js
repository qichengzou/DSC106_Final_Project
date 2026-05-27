// Data
// Representative CMIP6-derived seasonal cycles (indexed to annual max = 100)
// Replace with real mrro values from your Python pipeline.

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const historical = [3, 6, 18, 42, 82, 100, 72, 30, 10, 4, 2, 2];
const projected  = [4, 9, 30, 78, 100, 62, 24,  8,  3, 2, 1, 1];
const demand     = [8, 7, 10, 15, 38,  70, 100, 97, 62, 28,10, 7];

// Chart setup
const svg   = d3.select("#chart-svg");
const W     = () => svg.node().getBoundingClientRect().width;
const H     = () => svg.node().getBoundingClientRect().height;
const MARGIN = { top: 24, right: 24, bottom: 40, left: 44 };

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

const demandAreaPath = root.append("path").attr("class","demand-area");
const demandLinePath = root.append("path").attr("class","demand-line");

const gapRect = root.append("rect").attr("class","gap-rect")
  .attr("fill","rgba(224,90,74,0.14)").attr("opacity",0);

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
  .text("Historical peak");

const projPeak = root.append("g").attr("class","peak-proj").attr("opacity",0);
projPeak.append("line").attr("stroke","var(--red)").attr("stroke-width",1)
  .attr("stroke-dasharray","3 3");
projPeak.append("text").attr("class","peak-label")
  .attr("fill","var(--red)")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px")
  .text("Projected peak");

const gapAnnotation = root.append("g").attr("class","gap-annotation").attr("opacity",0);
gapAnnotation.append("line")
  .attr("stroke","var(--red)").attr("stroke-width",1.2)
  .attr("marker-end","url(#arrowR)").attr("marker-start","url(#arrowL)");
gapAnnotation.append("text")
  .attr("font-family","'IBM Plex Mono',monospace")
  .attr("font-size","10px").attr("fill","var(--red)")
  .attr("text-anchor","middle").attr("dy","-6px")
  .text("~6–8 week gap");

const defs = svg.append("defs");
["arrowR","arrowL"].forEach((id,i) => {
  defs.append("marker").attr("id",id)
    .attr("viewBox","0 0 10 10").attr("refX",5).attr("refY",5)
    .attr("markerWidth",6).attr("markerHeight",6)
    .attr("orient", i===0 ? "auto" : "auto-start-reverse")
    .append("path").attr("d","M1 1L9 5L1 9").attr("fill","none")
    .attr("stroke","var(--red)").attr("stroke-width",1.5);
});

// Draw/update chart
function draw() {
  const iW = innerW(), iH = innerH();
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

  histAreaPath.attr("d", area(historical))
    .attr("fill","var(--blue-dim)");
  histLinePath.attr("d", line(historical))
    .attr("fill","none")
    .attr("stroke","var(--blue)")
    .attr("stroke-width",2.5);

  projAreaPath.attr("d", area(projected))
    .attr("fill","var(--red-dim)");
  projLinePath.attr("d", line(projected))
    .attr("fill","none")
    .attr("stroke","var(--red)")
    .attr("stroke-width",2.5);

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

  if (peaksClose) {
    // Peaks are adjacent months — fan labels outward and stagger vertically
    histPeak.select("text")
      .attr("x", hpx + 6)
      .attr("y", histY)
      .attr("dy", "-10px")
      .attr("text-anchor", "start");
    projPeak.select("text")
      .attr("x", ppx - 6)
      .attr("y", projY)
      .attr("dy", "-28px")
      .attr("text-anchor", "end");
  } else {
    histPeak.select("text")
      .attr("x", hpx)
      .attr("y", histY)
      .attr("dy", "-8px")
      .attr("text-anchor", "middle");
    projPeak.select("text")
      .attr("x", ppx)
      .attr("y", projY)
      .attr("dy", "-8px")
      .attr("text-anchor", "middle");
  }

  const arrowY = iH * 0.55;
  gapAnnotation.select("line")
    .attr("x1",ppx+4).attr("x2",hpx-4)
    .attr("y1",arrowY).attr("y2",arrowY);
  gapAnnotation.select("text")
    .attr("x",(ppx+hpx)/2).attr("y",arrowY);

  const demandPeakIdx = demand.indexOf(Math.max(...demand));
  gapRect
    .attr("x", ppx)
    .attr("y", 0)
    .attr("width", x(MONTHS[demandPeakIdx]) - ppx)
    .attr("height", iH);
}

draw();
window.addEventListener("resize", draw);

// Scrollytelling states
const steps = document.querySelectorAll(".step");
const dots  = document.querySelectorAll(".dot");

const states = {
  0: () => {
    projAreaPath.transition().duration(500).attr("opacity",0);
    projLinePath.transition().duration(500).attr("opacity",0);
    projPeak.transition().duration(400).attr("opacity",0);
    histPeak.transition().duration(400).attr("opacity",0);
    gapAnnotation.transition().duration(400).attr("opacity",0);
    gapRect.transition().duration(400).attr("opacity",0);
    d3.select("#legend-future").style("opacity","0");
  },
  1: () => {
    projAreaPath.transition().duration(500).attr("opacity",0);
    projLinePath.transition().duration(500).attr("opacity",0);
    projPeak.transition().duration(400).attr("opacity",0);
    histPeak.transition().duration(600).attr("opacity",1);
    gapAnnotation.transition().duration(400).attr("opacity",0);
    gapRect.transition().duration(400).attr("opacity",0);
    d3.select("#legend-future").style("opacity","0");
  },
  2: () => {
    projAreaPath.transition().duration(700).attr("opacity",1);
    projLinePath.transition().duration(700).attr("opacity",1);
    projPeak.transition().duration(600).attr("opacity",1);
    histPeak.transition().duration(600).attr("opacity",1);
    gapAnnotation.transition().duration(800).delay(400).attr("opacity",1);
    gapRect.transition().duration(700).delay(200).attr("opacity",1);
    d3.select("#legend-future").style("opacity","1");
  },
  3: () => {
    projAreaPath.transition().duration(400).attr("opacity",1);
    projLinePath.transition().duration(400).attr("opacity",1);
    projPeak.transition().duration(400).attr("opacity",1);
    histPeak.transition().duration(400).attr("opacity",1);
    gapAnnotation.transition().duration(400).attr("opacity",1);
    gapRect.transition().duration(500).attr("opacity",1);
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
