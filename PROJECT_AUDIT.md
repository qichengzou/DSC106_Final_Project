# DSC 106 Final Project — Full Audit

**Project:** "The Peak Comes Early" / *The Shrinking Snowpack* — Sierra Nevada Snowmelt (CMIP6)
**Audited:** June 2, 2026 · analysis-only pass, no files changed
**Repo:** `git@github.com:qichengzou/DSC106_Final_Project.git` · working branch `feature-water-year-snowmelt`
**Live URL audited:** https://qichengzou.github.io/DSC106_Final_Project (loads, all scenes present)
**Scope of grading this targets:** *Final Deliverables* rubric (20 pts; "satisfactory" = 17/20)

> **Headline:** The project has a genuinely strong centerpiece (the Scene 3 scroll hydrograph) and a polished, consistent visual language. But it is being held back by three things that are individually cheap to fix and collectively expensive in points: (1) a **"TO BUILD · OWNER: ______" placeholder card is live on the public page**, (2) **Scene 2 tells the viewer "This is observed data, not a model projection" — which is false** (it's a CMIP6 model ensemble), and (3) the three "melt" scenes (3, 4, 6) use **two different data files, two different time windows, two different axes, and disagree on the historical peak month**. Fixing these moves the page from a conservative ~10–13/20 to a realistic ~17–19/20.

---

## 1. Project Summary

**What it is.** A scroll-based explorable explanation arguing that Sierra Nevada snowmelt under climate warming arrives **earlier in the year** and carries **less water**, widening the gap between when water is available and when California needs it (summer). It is built with D3.js (required), a dark editorial theme (Playfair Display + IBM Plex Mono/Sans), scroll-driven "sticky chart" sections, and per-scene interactions.

**The story it's trying to tell (and-but-therefore).** The Sierra is California's frozen reservoir **AND** the system is built around its slow summer release, **BUT** warming flips precipitation from snow to rain and shifts/shrinks the melt pulse, **THEREFORE** cities and farms face a growing timing-and-volume mismatch — whose severity depends on the emissions path.

**Data.** Real CMIP6 climate-model output pulled from the Pangeo Google-Cloud Zarr catalog, spatially subset to a Sierra box (~lat 35–41, lon −122 to −118), cosine-latitude area-weighted, reduced to monthly climatologies. Variables in play: `snm` (snowmelt flux), `prsn`/`pr` (snowfall/precip), `tas` (temperature), `snw` (snow amount). Experiments: historical + SSP2-4.5 + SSP5-8.5. Most scenes use only **2 GFDL models** (GFDL-CM4, GFDL-ESM4); a couple use a **5-model** set.

**Current scene structure (as deployed).**

| Order | Section | Says | Viz | Data file | Status |
|---|---|---|---|---|---|
| Hook | "The Peak Comes Early" | Water arrives before we can use it | Title card | — | Built |
| 1 | The Cause | It's *what* falls as snow, not how much | Snow/rain split bars, share↔amount toggle | `sierra_snowfall_seasons.csv` (+`tas`) | Built |
| 2 | A Century of Storage | The reservoir is already shrinking | April-1 SWE anomaly area chart + year slider | `sierra_april1_swe.csv` | Built |
| 3 | The Shift (sticky, 5 steps) | Peak moves earlier *and* shrinks; misaligned with summer | Water-year hydrograph, normalize↔raw morph, demand overlay, hover | `sierra_snowmelt_profiles.csv` (`snm`) | Built — **strong** |
| 4 | Zoom Out: Water Network (sticky, 7 steps) | One snowpack feeds many rivers/cities | D3 map, rivers scaled by "melt proxy", particles, scenario/branch/month controls | `sierra_melt_timing_profiles.csv` + geojson | Built |
| 5 | The Consequence | (intended: melt vs demand gap) | **Empty placeholder card** | — | **NOT BUILT (visible stub)** |
| 6 | Two Futures | Moderate vs high emissions diverge | Calendar-axis runoff-index chart, scenario toggle, hover | `sierra_melt_timing_profiles.csv` | Built |
| Close | "Less Snowmelt, Arriving Sooner" | Less AND sooner; severity is a choice | Title card | — | Built (no video) |

---

## 2. Rubric-Based Score Estimate

Scoring the **Final Deliverables** rubric (20 pts). Conservative. Ranges reflect "as currently deployed" → "with the easy fixes." The web page is worth 15 of the 20; the video is worth 5.

### Summary table

| # | Rubric category | Max | Est. (as-is) | Severity of gap |
|---|---|---|---|---|
| 1 | Web page + video link + repo (bundled) | 1 | **0–1** | 🔴 High |
| 2 | Hook | 1 | **1** | 🟢 Low |
| 3 | Storytelling (ABT + surprise/emotion) | 3 | **1.5–2** | 🟠 Med-High |
| 4 | Visual encodings | 3 | **2** | 🟡 Medium |
| 5 | Interaction | 3 | **2** | 🟡 Medium |
| 6 | Annotations | 1 | **1** | 🟢 Low |
| 7 | Takeaways | 2 | **1** | 🟡 Medium |
| 8 | Viewing experience | 1 | **0.5–1** | 🟡 Medium |
| — | *Web-page subtotal* | *15* | *~9–11* | |
| 9 | Video: URL & length | 1 | **0–1** | 🔴 High |
| 10 | Video: explanation | 2 | **0–1** | 🔴 High |
| 11 | Video: takeaways | 2 | **0–1** | 🔴 High |
| 12 | Creativity bonus | +1 | **0–1** | — |
| | **Total** | **20** | **~10–13** | |

**Achievable with the remediation plan below: ~17–19 / 20.**

### Per-category detail

**1 · Web page + video + repo bundle (max 1) — est. 0–1, 🔴**
- *Requirement:* page public on GitHub Pages, **project video linked/embedded in the page**, repo public.
- *Currently:* Page loads at the Pages URL with all scenes. Repo is public. **No video is embedded anywhere in `index.html`** (grep confirms zero `iframe`/`youtube`/`video`). The rubric's "Poor (+0)" column triggers if the web page URL, **video**, or repo is broken/missing — so a missing in-page video likely zeroes this bundle.
- *Also flag:* GitHub Pages is serving the `feature-water-year-snowmelt` branch, but `origin/main` (the repo's **default** branch a grader sees first) does **not** contain Scenes 1/4/6 — `git show main:index.html` has none of the scene markers. The live page is fine; the **default branch is stale**.
- *Severity:* High — it's a guaranteed point lost now and a confusing repo state.

**2 · Hook (max 1) — est. 1, 🟢**
- *Currently:* Opens on a title card "The Peak Comes Early" + a one-sentence thesis *before* any chart. That satisfies the binary "opens with an attention-grabbing statement (not immediately a viz)."
- *Weak spot:* It's a declarative statement, not a research question or a surprising/personal number. Fine for the point; not "excellent."

**3 · Storytelling (max 3) — est. 1.5–2, 🟠**
- *Currently:* A real and-but-therefore spine exists and is well-signposted (Cause → already declining → shift+shrink → plumbing → consequence → choice).
- *What costs points:* (a) the **live "TO BUILD" placeholder** breaks the narrative mid-stream; (b) **Scene 3 and Scene 6 contradict each other** (different file/window/axis, historical peak March vs February) so the "story" doesn't hang together on inspection; (c) the planned **personalization** ending ("your city, your mountain" from the proposal) was dropped, so there's little surprise/emotion — the tone is clinical. Excellent (+3) requires surprise/personalization/emotion; this is currently a competent ABT (+2) being dragged toward +1 by the placeholder.

**4 · Visual encodings (max 3) — est. 2, 🟡**
- *Currently:* No gross expressiveness violations. Position/length for hydrographs, line width (size) for river magnitude, consistent color semantics (blue=historical, red=high emissions, green=moderate, gold=demand). Water-year axis in Scene 3 is a thoughtful, correct choice.
- *What caps it at +2:* Scene 6 uses a **calendar axis** while Scene 3 uses **water-year**, so the same phenomenon is framed two ways; Scene 4's **map implies geographic precision** the data doesn't have (rivers are partly hardcoded approximations, regions are hand-drawn blobs); Scene 1's "amount" mode is labeled **mm/day on a value that's actually a 5-month sum**.

**5 · Interaction (max 3) — est. 2, 🟡**
- *Strong:* Scene 3 scroll-morph (timing→volume→demand) and hover tooltips; Scene 4 scenario/branch/month controls; Scene 6 scenario toggle; Scene 1 share↔amount toggle.
- *What caps it at +2:* Scene 2's **year slider is close to decorative** — it just reveals the same line progressively; a static chart conveys the identical trend (the exact failure mode the rubric calls out). Scene 4's interactions are rich but ride on an abstract "proxy."

**6 · Annotations (max 1) — est. 1, 🟢**
- Peak markers, "peak shifts ~1 month earlier" arrow, "~N-month water gap" span, trend line, callout boxes, diff annotation. Comfortably earns the point.

**7 · Takeaways (max 2) — est. 1, 🟡**
- A closing card exists and restates the finding. But it doesn't sharply **explain why the visualization proves the takeaway**, and "less and sooner" isn't framed as surprising. Reads as a summary, not a punchline → +1, upgradeable to +2.

**8 · Viewing experience (max 1) — est. 0.5–1, 🟡**
- Mostly legible; has a `@media (max-width:720px)` breakpoint and sticky layout. But: the **TO-BUILD card looks unfinished**, and there's a lot of small mono caption text. Verify legibility at 1366×768.

**9–11 · Video (max 5) — est. 0–3, 🔴**
- A demo video was due **today (6/2)** but **nothing is embedded in the page**, and the final video (due 6/9) isn't represented. As deployed, the three video line-items are at or near their floor. (If a YouTube demo already exists, embedding it recovers the +1 immediately and sets up the +2/+2.)

**12 · Creativity bonus (+1) — est. 0–1**
- The CMIP6 pipeline, the water-year reframing, and the network map are genuinely ambitious and could earn the bonus once the inconsistencies are gone.

---

## 3. Major Strengths (specific to this project)

1. **Scene 3 is a legitimately good piece of scrollytelling.** The five-step build — establish the historical shape, fade in the projected curve, annotate the ~1-month leftward shift, then *switch the y-axis from "% of own peak" to raw mm/day* to reveal the volume collapse, then overlay summer demand with a shaded gap — is exactly how to use scroll to deliver one idea at a time. The normalize→raw morph is the cleverest moment in the project: it cleanly separates the *timing* story from the *volume* story instead of muddling them. (`main.js` `STEP_CONFIG`, `waterYearPoints`, lines ~560–600.)
2. **The water-year axis (Oct→Sep) is the right call** and is implemented correctly (`WY_ORDER`), putting the melt peak mid-plot so the leftward shift is visible. Most student projects would have used a Jan–Dec axis and buried the effect.
3. **Honest provenance is present in several places** — the `snm` tooltips name the 2-model GFDL ensemble and the window; Scene 4's caption says "melt proxy, not measured flow"; demand is explicitly "illustrative · not from CMIP6"; Scene 1's source note admits the regional box "includes lower, warmer terrain, so this reads the phase *shift*, not high-country totals." This is good scientific hygiene and graders notice it.
4. **Coherent, professional visual identity.** Consistent color semantics, typography, spacing, tooltip styling, and a real loading/error path (it detects `file://` and tells you to run a server). The design reads as finished and intentional.
5. **Real data engineering.** Four documented Python pipelines hitting the live CMIP6 Zarr catalog with area-weighting and proper climatology — not a toy CSV. That depth is a credible basis for the Creativity bonus.
6. **Scene 1's share↔amount toggle is a meaningful interaction**: it reframes "same total precip, but less of it is snow," which is the actual mechanism and a non-obvious point.

---

## 4. Major Weaknesses / Shortcomings (prioritized by points at risk)

1. **🔴 The "Scene 5 · the consequence · TO BUILD · OWNER: ______ / render here · `<div id="viz-scene-5">`" placeholder is LIVE on the public page.** Confirmed in the deployed HTML. This single artifact damages Storytelling, Viewing experience, and the overall "finished project" impression simultaneously. Worse, its intended content (melt-vs-demand gap) is **already delivered** by Scene 3, Step 5 — so it's both unfinished *and* redundant.
2. **🔴 Scene 2 makes a false data claim on screen:** "April 1st snowpack… **This is observed data, not a model projection. The trend is already here.**" The generator `fetch_sierra_april1_swe.py` pulls CMIP6 **model** `snw` (historical 1950–2014 + SSP2-4.5 2015–2023) across 5 models — it is *not* observed DWR/NRCS data. The page even **contradicts itself on the same screen**: the source line directly below says "Source: CMIP6 ensemble mean (IPSL-CM6A-LR)." This is the rubric's "claims that imply incorrect readings" and is an integrity risk if a grader notices.
3. **🔴 The three "melt" scenes are mutually inconsistent.** Scene 3 uses `sierra_snowmelt_profiles.csv` (variable **`snm`**, **2** models, future window **2070–2100**, **water-year** axis, historical peak **March**). Scenes 4 and 6 use `sierra_melt_timing_profiles.csv` (a **`snw`-difference proxy**, **5** models, future window **2050–2075**, Scene 6 on a **calendar** axis, historical peak **February**). So the page tells the viewer "the peak is in March" (Scene 3) and then draws the historical peak in February (Scene 6), using a different number of models and a different 30-year window, with no acknowledgement. It looks like two different analyses stitched together.
4. **🟠 Muddy variable identity behind Scenes 4 & 6.** `sierra_melt_timing_profiles.csv` carries a column `snw_index`, the current script derives it as `max(0, snw[prev]−snw[month])` (a snowpack-*decline* proxy), **but its own model-level companion file `sierra_melt_timing_model_level.csv` has a column literally named `mrro`** (runoff) — and the profile has **negative** values that the JS silently clamps with `Math.max(0, …)`. Scene 6 then labels this "**runoff index**" / "SNOWMELT RUNOFF." Snowmelt vs. snowpack-decline vs. runoff are three different things; the file, the script, and the on-screen label disagree about which one this is.
5. **🟠 No video in the page** (covered above) — guaranteed loss across up to 4–5 points until embedded.
6. **🟡 Scene 2's slider is borderline decorative**, and **Scene 4 mixes real river geometry with hardcoded approximate paths and hand-drawn region polygons** while presented as a map — implying precision the data lacks.
7. **🟡 Numeric annotation error in Scene 6:** the callout says "Apr gap: ~15 index points," but the underlying file gives SSP2-4.5 = 32.2 and SSP5-8.5 = 22.7 in April → a gap of **~9.5**, not 15. (The Feb "~10" is correct.)
8. **🟡 The narrative sags in the middle and repeats itself.** Scene 3 already delivers the whole thesis (timing + volume + demand mismatch). Then Scene 4 (geography), an empty Scene 5, and Scene 6 (re-comparison) follow — the back half re-states rather than escalates, and the planned emotional/personal payoff was cut.

---

## 5. Scene-by-Scene Audit

### Hook — "The Peak Comes Early"
- **Shows:** Title + one-sentence thesis ("snowmelt arriving earlier… carrying far less water… widens the gap"), scroll cue.
- **Viewer should learn:** There's a timing+volume problem worth scrolling for.
- **Clear?** Yes. **Encoding:** N/A (text). **Text supports?** Yes.
- **Weak/missing:** No number, question, or stakes that grab. It tells rather than hooks.
- **Change:** Lead with a concrete, surprising figure or a question (see §9). Cheap, high-value.

### Scene 1 — The Cause (snow vs rain)
- **Shows:** Three horizontal snow/rain split bars (Historical, SSP2-4.5, SSP5-8.5) with a "Share of precip" ↔ "Actual amount (mm/day)" toggle, warming chips (+2.4 °C / +3.8 °C), hover tooltip, live stat ("Snow's share… 25% → 12%").
- **Viewer should learn:** Warming converts winter precip from snow to rain even when total precip holds — it's *what* falls, not *how much*.
- **Clear?** Mostly yes; the share view lands the point well.
- **Encoding:** Stacked length bars are appropriate. ✔ Color semantics consistent.
- **Text supports?** Yes — the share stat reinforces the headline.
- **Confusing/weak:** The **"Actual amount (mm/day)" toggle shows ~20–22 mm/day** for total precip, but that figure is the **sum of five monthly means (Nov–Mar)**, not a daily rate — no Sierra location averages 20 mm/day. The unit label is wrong. The future window (2070–2100) is correct and matches Scene 3 (good).
- **Change:** Relabel the amount mode (e.g., "cold-season total, mm/day summed across Nov–Mar" or convert to a true seasonal total) so the unit isn't misleading. Keep "Share" as the default.

### Scene 2 — A Century of Storage (April-1 SWE)
- **Shows:** April-1 SWE anomaly vs 1981–2010, 1950–2023, blue/red area + OLS trend line + a year slider that reveals the series and a running stat.
- **Viewer should learn:** The decline is "already here," not a future projection — the "but wait" beat.
- **Clear?** The chart is clear; the *framing is the problem.*
- **Encoding:** Diverging area around a zero baseline is fine; trend line is a good annotation.
- **Text supports?** It **actively misleads:** "This is observed data, not a model projection" is false (CMIP6 model `snw`), and the body contradicts the CMIP6 source line beneath it.
- **Confusing/weak:** (a) the observed-vs-model lie; (b) the source line names a single model "IPSL-CM6A-LR" while the script ensembles up to 5 models; (c) the **slider is near-decorative**.
- **Change:** Decide what this data actually is and tell the truth (two honest options in §8). Make the slider earn its place (e.g., snap to drought years with annotations) or replace it with a scroll-draw.

### Scene 3 — The Shift (sticky hydrograph, 5 steps) — **the centerpiece**
- **Shows:** Historical (blue) vs SSP5-8.5 (red) `snm` on a water-year axis; steps fade in the projected curve, annotate the ~1-month earlier shift, **switch normalize→raw** to show peak melt halving (1.19→0.61 mm/day), then overlay illustrative summer demand with a shaded gap. Hover gives mm/day, "% of own peak," and the 2-model GFDL provenance.
- **Viewer should learn:** The pulse moves earlier **and** shrinks, and it's out of phase with summer demand.
- **Clear?** Yes — best-executed scene. **Encoding:** Excellent; the own-peak normalization to isolate timing, then raw to reveal volume, is the smart move and the y-axis title updates honestly ("% of each curve's own peak" vs "snowmelt (mm/day)").
- **Text supports?** Yes; callouts match this file's numbers (verified: 1.19→0.61 mm/day; Apr–Jul 16%→9%; Nov–Mar 82%→91%).
- **Confusing/weak:** Two subtleties — (1) in normalized mode *both* curves peak at 100%, which could momentarily imply equal volume; it's resolved by Step 4, but a one-line cue helps. (2) This scene's **March peak / 2070–2100 / 2-model** basis silently differs from Scene 6.
- **Change:** Keep essentially as-is. Add a half-sentence at Step 2 ("both curves are scaled to their own peak here, so watch *shape*, not height — volume comes next"). Standardize window/model wording with Scene 6.

### Scene 4 — Zoom Out: The Water Network (sticky, 7 steps)
- **Shows:** A D3 Mercator map of the Sierra with rivers whose **width scales to the melt proxy**, animated flow particles, dependency nodes (Central Valley, Bay Area, SoCal, Reno, Pyramid/Walker Lakes, LA), the LA Aqueduct as a dashed engineered link, and scenario/branch/month controls. Scroll walks west/east/Owens branches then dims everything under SSP2-4.5 / SSP5-8.5.
- **Viewer should learn:** One snowpack feeds many independent systems; warming thins all of them.
- **Clear?** The dependency story is clear and the branch highlighting is nice.
- **Encoding:** Width-for-magnitude is reasonable and evocative. **But** the map mixes **real GeoJSON rivers with hardcoded fallback coordinates** (Truckee/Carson/Walker/Owens) and **loose hand-drawn region blobs**, presented with map-level authority. The "proxy" (0–100 index) driving width is the same muddy `snw`-difference/`mrro` quantity as Scene 6.
- **Text supports?** The caption is admirably honest ("melt proxy… not exact river discharge"). Good.
- **Confusing/weak:** (1) provenance of the scaling variable; (2) the month scrubber lets you set physically odd states (e.g., midsummer when melt ≈ 0) with little payoff; (3) it arrives *after* Scene 3 has already made the volume point, so it risks feeling like a victory lap.
- **Change:** Pin down and relabel the proxy; consider trimming the month control or constraining it to the melt season; tighten its narrative role to "who is downstream" rather than re-proving "less water."

### Scene 5 — The Consequence — **EMPTY / NOT BUILT**
- **Shows:** A literal scaffold card: "Scene 5 · the consequence · TO BUILD · OWNER: ______" and "render here · `<div id="viz-scene-5">`." This is **live on the public site.**
- **Viewer should learn:** (intended) melt-vs-demand gap as rising risk.
- **Clear?** It reads as a bug/unfinished work.
- **Change:** **Either delete the section entirely** (its content already lives in Scene 3 Step 5) **or** build a distinct, non-redundant consequence scene (e.g., "how much extra storage must bridge the gap"). Do not ship the stub. Highest-leverage single fix in the project.

### Scene 6 — Two Futures
- **Shows:** Historical / SSP2-4.5 / SSP5-8.5 as a "runoff index" (% of historical peak) on a **calendar (Jan–Dec)** axis, with a Both/Moderate/High toggle, hover, and a "~10 pt gap at peak" annotation.
- **Viewer should learn:** Severity is a choice — moderate keeps ~90% of the historical peak, high ~80%.
- **Clear?** The toggle and message are clear in isolation.
- **Encoding:** Fine marks, **but the calendar axis clashes with Scene 3's water-year axis**, and the series is labeled "runoff" while Scene 3 calls the analogous thing "snowmelt (`snm`)."
- **Text supports?** Mostly, except the **"Apr gap: ~15 index points" callout is wrong (~9.5 actual).**
- **Confusing/weak:** Different file, different window (2050–2075 vs Scene 3's 2070–2100), different model count (5 vs 2), different peak month (Feb vs Mar), different axis, different variable label. This is the most jarring inconsistency for an attentive viewer.
- **Change:** Rebuild Scene 6 on the **same `snm` file and water-year axis as Scene 3**, just adding the SSP2-4.5 curve; or, at minimum, harmonize window/model/label wording and fix the April number. This also lets you delete the redundant `sierra_melt_timing_profiles.csv` dependency.

### Close — "Less Snowmelt, Arriving Sooner"
- **Shows:** Title + restatement; **no embedded video.**
- **Change:** Sharpen into a real takeaway (why the viz proves it) and **embed the YouTube video here** (rubric requires the video in the page).

---

## 6. Data and Claim Accuracy Check

| Claim / label (where) | What the data actually is | Verdict | Action before presenting |
|---|---|---|---|
| "This is **observed data, not a model projection**" (Scene 2 body) | CMIP6 **model** `snw`, 5-model mean, hist 1950–2014 + SSP2-4.5 2015–2023 (`fetch_sierra_april1_swe.py`) | **False / misleading** 🔴 | Either swap in real DWR/NRCS observations and *then* the line is true, or relabel as a model hindcast and drop "observed." |
| "Source: CMIP6 ensemble mean (**IPSL-CM6A-LR**)" (Scene 2 source) | Script ensembles up to **5** models, not IPSL alone | **Inaccurate** 🟠 | List the models actually averaged, or name the real obs source. |
| Scene 2 `main.js` comment "Source: **DWR / NRCS** … observed" | Contradicts the script (CMIP6) | **Internally contradictory** 🟠 | Reconcile comment, body text, and source line to one truth. |
| Scene 3 callouts: 1.19→0.61 mm/day; Apr–Jul 16%→9%; Nov–Mar 82%→91%; peak Mar→Feb | Recomputed from `sierra_snowmelt_profiles.csv` | **Accurate** ✅ | None — keep. |
| Scene 3 "Projected · **2070–2100**" vs Scene 6 "**2050–2075**" | Two different future windows in two files | **Inconsistent across scenes** 🔴 | Pick one window for the projected melt story. |
| Scene 3 historical peak **March** vs Scene 6 historical peak **February** | `snm` peaks Mar; `snw`-diff proxy peaks Feb | **Contradiction** 🔴 | Use one file for both. |
| Scene 4/6 "melt proxy / runoff index" (`snw_index`) | Script computes `max(0, snw[prev]−snw[m])`; companion file column is named **`mrro`**; profile has negatives clamped in JS | **Provenance unclear; label likely wrong** 🟠 | Confirm the variable, rename consistently (it is *not* `snm` and not literally runoff), regenerate cleanly, drop negatives at source. |
| Scene 6 "**Apr gap: ~15** index points" | SSP2-4.5 32.2 − SSP5-8.5 22.7 = **~9.5** | **Numeric error** 🟡 | Fix to ~10, or annotate the true largest-gap month (March, ~12). |
| Scene 1 "Actual amount (**mm/day**)" ≈ 20–22 | Sum of 5 monthly means (Nov–Mar), not a daily rate | **Unit mislabel** 🟡 | Relabel as seasonal total or average per day. |
| Scene 1 snow share 25%→12%; +2.4/+3.8 °C | Matches `sierra_snowfall_seasons.csv` + `sierra_tas_seasons.csv` | **Accurate** ✅ | None. |
| "~30% of California's water supply begins as Sierra snowpack" (Scene 3 Step 1) | External factoid, not from your data | **Plausible but uncited** 🟡 | Add a source (commonly ~30% statewide); keep "illustrative" framing for demand. |
| Model count "2-model ensemble · GFDL-CM4, GFDL-ESM4" (Scene 3 tooltip) | Matches `model_count=2` in the `snm` file | **Accurate** ✅ | Note: a 2-model ensemble is thin; state it as a limitation. |

**Things to verify before claiming confidently:** (a) what `sierra_april1_swe.csv` truly represents and re-label accordingly; (b) the exact variable behind `sierra_melt_timing_profiles.csv` (`snm`? `snw`-difference? `mrro`?) and whether Scenes 4/6 should just use the clean `snm` file; (c) a single projected window (2050–2075 *or* 2070–2100) used everywhere; (d) the "~30%" supply figure's source.

---

## 7. Storytelling / Narrative Flow Review

**Beginning — why it matters:** Partially. The hook states the thesis but doesn't make the stakes felt; Scene 1 supplies mechanism (snow→rain) before the reader is emotionally invested in *why snowpack matters to them.* The original proposal's "the West built its entire water system around this frozen reservoir" framing is stronger and is currently underused up front.

**The question being answered:** Implicit, not explicit. The page never poses a crisp question ("If the snow still falls, why is there less water in summer?"). Stating it would give the scroll a spine.

**The evidence shown:** Strong and real, but **split across inconsistent bases** (Scene 3 vs 6) and interrupted by an **empty Scene 5**. An attentive viewer hits three "wait, which window/peak/axis is this?" moments.

**Does each scene build on the last?** Through Scene 3, yes (cause → already-happening → shift+shrink+mismatch). After Scene 3 the arc **plateaus**: Scene 4 widens the geography (good, but "less water" was already proven), Scene 5 is a hole, Scene 6 re-compares scenarios on a different footing. The back half *re-states* rather than *escalates*.

**Final takeaway:** Present but soft. It summarizes ("less and sooner") instead of landing *why this visualization proves it* or *what the reader should do/feel.* The planned personalization ("your city's outlook") that would have created emotion was cut.

**Net:** A solid ABT skeleton with an excellent middle organ (Scene 3) and a weak, repetitive, partly-broken back third. The fastest narrative wins are: remove the hole (Scene 5), make Scenes 3/6 one consistent system, and give the ending a sharper, more personal point.

---

## 8. Remediation Plan

### Priority 1 — Most likely to move the grade (do these first)

**P1-A. Remove the live "TO BUILD" placeholder (Scene 5).** *Problem:* an unfinished scaffold card is on the public page. *Rubric:* Storytelling, Viewing experience, "finished project" impression. *Change:* delete the `<section class="scene-slot" data-slot="5">…</section>` block in `index.html` (and any orphaned `#viz-scene-5` CSS in `style.css`). Its content already exists in Scene 3 Step 5. *Improved state:* clean transition from Scene 4 → Scene 6. *Risk:* none; verify no JS references `viz-scene-5` (it doesn't). **If** you'd rather build it, make it a *distinct* "how much extra storage is needed" scene, not a repeat of the gap.
*Files:* `index.html`, `style.css`.

**P1-B. Fix the Scene 2 "observed vs model" integrity problem.** *Problem:* on-screen text says "observed, not a model projection," but the data is CMIP6 model output; the source line on the same screen says CMIP6. *Rubric:* misleading claims (Encodings/Storytelling), credibility. *Change — pick one:*
  - *(Option 1, strongest):* replace the data with **real observations** (CA DWR April-1 statewide snow-water-equivalent, or NRCS SNOTEL/UCLA SWE reanalysis). Then "observed… already here" becomes true and Scene 2 does exactly the rhetorical job it wants (a real "but wait, it's already happening"). Requires a new fetch + a units/baseline pass.
  - *(Option 2, fast):* keep the CMIP6 hindcast but **rewrite the text** to "CMIP6 historical simulation (1950–2014) + SSP2-4.5 (2015–2023), N-model mean" and **delete "observed, not a model projection."** Honest, ~10 minutes.
*Files:* `index.html` (Scene 2 text + source), `main.js` (the stale DWR/NRCS comment), possibly a new `fetch_*` script + CSV. *Verify:* units (inches vs mm), the 1981–2010 baseline, and the model list actually used.

**P1-C. Make Scenes 3, 4, and 6 one consistent melt system.** *Problem:* two files, two windows (2070–2100 vs 2050–2075), two model counts (2 vs 5), two axes (water-year vs calendar), two historical peak months (Mar vs Feb), and a muddy variable behind 4/6. *Rubric:* Storytelling coherence, Encodings, claim accuracy. *Change:* standardize on the **clean `snm` file (`sierra_snowmelt_profiles.csv`)** and the **water-year axis** everywhere a melt curve appears. Rebuild Scene 6 to read `snm` and add the SSP2-4.5 curve (the file already has `ssp245`), on Oct→Sep, with one stated window. Re-point Scene 4's width scaling at the same `snm` `self_index`/`melt_index`. *Improved state:* "peak in March → February," one window, one model statement, one axis, top to bottom. *Risk:* Scene 6's current "% of historical peak" cross-scenario comparison needs `melt_index` (vs historical), which the `snm` file already provides — verify before deleting `sierra_melt_timing_profiles.csv`.
*Files:* `main.js` (`initScene6`, Scene 4 loaders), `index.html` (Scene 6 subtitle/labels), data (retire the melt-timing file).

**P1-D. Embed the demo/final video in the page.** *Problem:* no video in `index.html`; the rubric's URL bundle and two video line-items depend on it. *Change:* add a responsive YouTube `<iframe>` in the closing section (the storyboard already calls for this). *Improved state:* recovers the bundled +1 and stages the +2/+2 video scores. *Risk:* ensure the video is public/unlisted and ≤2:00.
*Files:* `index.html`, `style.css`.

**P1-E. Resolve the stale `main` branch / Pages source.** *Problem:* `origin/main` (the default branch a grader opens) lacks Scenes 1/4/6; Pages serves `feature-water-year-snowmelt`. *Change:* merge the working branch into `main` and point GitHub Pages at `main` (or document clearly which branch is canonical). *Risk:* confirm Pages doesn't break after the source switch; re-test the live URL.
*Files:* git/branching + repo settings (no code).

### Priority 2 — Clarity and polish

**P2-A. Fix the Scene 6 "Apr gap ~15" number** to ~10 (or annotate March, the true widest gap ~12). *File:* `index.html`.
**P2-B. Relabel Scene 1's "Actual amount (mm/day)"** so the ~20 mm/day figure isn't read as a daily rate (seasonal total, or average per day). *Files:* `index.html`, `main.js` (`fmtMm`/tooltip).
**P2-C. Make Scene 2's slider earn its keep** — snap to/annotate notable drought and big years, or convert to a scroll-triggered draw — so it isn't "a static plot would do the same." *File:* `main.js` (Scene 2).
**P2-D. Add the one-line normalization cue at Scene 3 Step 2** ("scaled to each curve's own peak — watch shape, not height"). *File:* `index.html`.
**P2-E. Tighten Scene 4's month control** (limit to the melt season, or drop it) and add a one-line "approximate geography" note so the map's hardcoded paths aren't read as survey-accurate. *Files:* `index.html`, `main.js`.
**P2-F. Cite the "~30% of CA water" figure** and keep "demand = illustrative" labels visible. *File:* `index.html`.

### Priority 3 — Optional if time allows

**P3-A. Restore a personalization ending** (proposal's "your city → your mountain → your outlook" card) for the surprise/emotion that lifts Storytelling toward +3 and Takeaways toward +2.
**P3-B. Strengthen the hook** with a concrete number or question (see §9).
**P3-C. Widen the ensemble** beyond 2 GFDL models for the headline `snm` curves if feasible, or foreground the 2-model caveat as an explicit limitation note.
**P3-D. Legibility pass** at 1366×768 (caption sizes, contrast) for the Viewing-experience point.
**P3-E. Add a short "Data & Methods" disclosure** (variables, box, windows, models, normalization) — cheap credibility and supports the Creativity bonus.

---

## 9. Suggested Revised Story Arc

Keep the project; it's fundamentally sound. Re-sequence and consolidate around the **one consistent `snm` water-year system**, and restore a personal ending.

**Hook (sharper):** Lead with a surprising, concrete framing instead of a statement. e.g.:
> *"The snow still falls in the Sierra. So why will California have less water in summer? Because the mountains' 'reservoir' is starting to pay out a month too early — and with far less in it."*
(A question + a counter-intuitive answer = the surprise the rubric rewards.)

**Scene 1 — Why the mountain is a reservoir (AND).** Briefly establish snowpack-as-storage and that the West's plumbing assumes a slow summer release. Then the snow→rain mechanism (current Scene 1, share mode default). *One idea: warming changes what falls, not whether it falls.*

**Scene 2 — It's already happening (BUT, part 1).** April-1 snowpack decline — **with honest data and honest labels** (P1-B). This is the "but wait, this isn't hypothetical" beat. Make the interaction reveal *something* (drought-year annotations).

**Scene 3 — The shift and the shrink (BUT, part 2) — the centerpiece, unchanged.** Timing (own-peak normalize) → volume (raw mm/day) → summer-demand gap. This already does the heavy lifting; protect it.

**Scene 4 — Who's downstream (THEREFORE, made concrete).** The network map, re-scoped to "*this* is who depends on that pulse" (farms, Reno, LA via the aqueduct) rather than re-proving "less water." Same `snm` scaling, water-year-consistent.

**Scene 5 — The choice (THEREFORE, the lever).** This is the *former Scene 6*, rebuilt on `snm`/water-year: moderate vs high emissions, the gap is real but the size is chosen. Delete the empty placeholder; this becomes the real Scene 5.

**Close — Make it personal + the takeaway + the video.** Optional city-picker card (P3-A): "Your water, your mountain, your outlook." Then one crisp takeaway that says *why the hydrograph proves it*: *"Same snow year, but the payout comes a month early and half as full — which is why storage, not snowfall, becomes the thing to watch."* Embed the ≤2-min video here.

**Transition logic:** Cause → Already happening → How it shifts & shrinks → Who that hits → What we can still choose → What it means for you. Every beat escalates; nothing repeats; one data system throughout.

**Final takeaway (one sentence to design toward):**
> *"Climate change isn't just shrinking the Sierra snowpack — it's changing the schedule, moving the water to before we can use it, and that timing shift is something every reservoir downstream now has to absorb."*

---

## 10. Final Action Checklist (do in this order, before any rewrite)

**Verify first (no edits):**
- [ ] Confirm what `sierra_april1_swe.csv` should be: real observations (DWR/NRCS) **or** a CMIP6 hindcast — and decide Scene 2's honest framing (P1-B Option 1 vs 2).
- [ ] Confirm the true variable behind `sierra_melt_timing_profiles.csv` (`snm` vs `snw`-difference vs `mrro`); decide to retire it in favor of the clean `snm` file.
- [ ] Pick **one** projected window for the melt story (2050–2075 **or** 2070–2100) to use in Scenes 3/4/6.
- [ ] Confirm GitHub Pages source branch and whether `main` should be updated; re-open the live URL to confirm current state.
- [ ] Locate the demo video (due today, 6/2) and confirm it's public/unlisted and ≤2:00 for embedding.
- [ ] Re-check the Scene 6 April gap number and the Scene 1 mm/day labeling against the CSVs.

**Then execute (Priority 1):**
- [ ] P1-A Delete the live Scene 5 "TO BUILD" placeholder (and orphan CSS).
- [ ] P1-B Fix Scene 2 data/label honesty (observed vs model).
- [ ] P1-C Unify Scenes 3/4/6 on the `snm` water-year system; rebuild Scene 6.
- [ ] P1-D Embed the video in the closing section.
- [ ] P1-E Merge to `main` / fix Pages source; re-test live.

**Then polish (Priority 2):** Scene 6 number · Scene 1 units · Scene 2 slider · Scene 3 normalization cue · Scene 4 month control + geography note · "~30%" citation.

**Optional (Priority 3):** personalization ending · sharper hook · ensemble/limitations note · legibility pass · methods disclosure.

> **Single most important next step:** decide the Scene 2 data question and the Scene 3/6 unification (the two "verify first" items that unlock Priority 1), because every text and label fix downstream depends on those two decisions.
