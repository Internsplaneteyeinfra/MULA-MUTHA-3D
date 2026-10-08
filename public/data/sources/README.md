RIVEREYE / MULA-MUTHA-3D
FINAL ROOT-CAUSE DEBUG + COMPLETE FIX
CROSS-SECTION & HYDRAULIC PROFILE MODAL

PROJECT:
C:\Users\Sahil.Rajankar\Desktop\Shweta\RIVEREYE\MULA-MUTHA-3D

IMPORTANT:
THE FEATURE IS STILL NOT WORKING.

DO NOT DECLARE SUCCESS BECAUSE npm run build PASSES.

The browser screenshot proves:

1. The modal opens.
2. The X close button works.
3. The modal header displays:
   CH 0+000
   PARAMETRIC
4. Hydraulic values remain "—".
5. The cross-section graph is empty.
6. The Longitudinal Slope Profile graph is also empty.
7. The console repeatedly shows:
   [CrossSectionModal] CLOSE BUTTON CLICKED
   [CrossSectionModal] hide() called
8. There is no evidence in the visible console that a valid currentStation is actually being rendered into the displayed modal.

Therefore STOP applying speculative patches.

Perform a COMPLETE runtime data-flow investigation and fix the actual root cause.

============================================================
PHASE 1 — FIND THE ACTUAL LOADED crossSectionModal MODULE
============================================================

Search the ENTIRE PROJECT for:

crossSectionModal.js

and all imports/references containing:

CrossSectionModal
crossSectionModal
new CrossSectionModal
createCrossSectionModal
showCrossSection
View Channel Cross-Sections & Profile

IMPORTANT:

Determine whether there are MULTIPLE copies of crossSectionModal.js.

Search for files such as:

src/ui/crossSectionModal.js
src/ui/components/crossSectionModal.js
src/components/crossSectionModal.js
etc.

There MUST NOT be confusion about which file the browser is actually loading.

Use the browser stack trace/source location to identify the exact loaded file.

The screenshot currently references:

crossSectionModal.js:117
crossSectionModal.js:202

Determine the exact physical source file behind those lines.

Then identify the exact import path used by the Digital Twin.

DO NOT edit a possible duplicate file without proving that it is the module actually loaded by the browser.

============================================================
PHASE 2 — FIND THE ACTUAL MODAL INSTANCE
============================================================

Determine where the modal DOM is created.

Search for:

cross-section-backdrop
cross-section-modal
cs-modal-title
Cross-Section Transect
Longitudinal Slope Profile

Determine exactly which JavaScript function creates:

the backdrop
the dialog
the close button
the graph container
the hydraulic geometry panel

Add a temporary unique runtime marker:

data-cross-section-modal-instance="RIVEREYE-HYDROLOGY-V1"

to the actual modal root.

Then inspect the DOM and confirm there is EXACTLY ONE active cross-section modal instance.

If multiple modal DOM trees exist, fix the duplicate initialization.

There must be exactly one active modal.

============================================================
PHASE 3 — VERIFY THE BUTTON CALLER
============================================================

Find the exact button:

View Channel Cross-Sections & Profile

Inspect its event listener.

DO NOT assume the callback signature.

If it currently does:

button.addEventListener('click', crossSectionModal.show)

then the browser passes a PointerEvent.

Fix it to:

button.addEventListener('click', () => {
    crossSectionModal.show();
});

However, keep show() defensive against Event objects.

Immediately before opening, log:

console.log('[HYDROLOGY MODAL] OPEN REQUEST', {
    source: 'View Channel Cross-Sections & Profile',
    profile: hydrologyStore.getProfile()
});

============================================================
PHASE 4 — VERIFY HYDROLOGY STORE AT RUNTIME
============================================================

Do not rely on Node tests only.

The browser has its own runtime/module state.

Inside the ACTUAL loaded crossSectionModal module, inspect:

const profileState = hydrologyStore.getProfile();

Log:

console.log('[HYDROLOGY MODAL] RUNTIME PROFILE', {
    profileState,
    records: profileState?.records,
    recordCount: profileState?.records?.length,
    firstRecord: profileState?.records?.[0],
    lastRecord: profileState?.records?.[profileState?.records?.length - 1]
});

CRITICAL:

The browser runtime must show:

recordCount: 1698

If Node reports 1698 but browser reports:

undefined
0
null
different structure

then this is a runtime initialization/import/state problem.

Fix THAT problem.

Do not patch the UI around it.

============================================================
PHASE 5 — VERIFY ACTUAL PROFILE SCHEMA
============================================================

Print the COMPLETE first record:

console.log(
    '[HYDROLOGY MODAL] FIRST RECORD FULL',
    JSON.stringify(profileState?.records?.[0], null, 2)
);

Print the complete record at approximately:

3450m
8000m
12000m
16960m

using the canonical profile.

Determine the exact property names.

Do not assume names such as:

width_m
water_depth_m
hydraulic_depth_m
wse_m
bed_elevation_m_msl

unless the actual canonical object contains them.

Use the actual schema.

============================================================
PHASE 6 — RESOLVE CURRENT STATION BEFORE render()
============================================================

The current failure must not reach:

render()

with:

currentStation = null

Implement this exact lifecycle:

show(input)
    ↓
get runtime canonical profile
    ↓
extract records
    ↓
resolve station
    ↓
assign currentStation
    ↓
update header
    ↓
render
    ↓
render graph
    ↓
render hydraulic values

NEVER:

show()
    ↓
render()
    ↓
try to find currentStation later

The first render must already have a valid canonical station.

============================================================
PHASE 7 — RESOLVE EVENT INPUT CORRECTLY
============================================================

If:

input instanceof Event

or:

input instanceof MouseEvent

or:

input instanceof PointerEvent

then:

input = null

Do not treat the browser event as station data.

If input is null:

currentStation = records[0]

where records[0] is the ACTUAL canonical profile record.

Do not create a fake:

{
    chainage_m: 0
}

Use:

records[0]

directly.

============================================================
PHASE 8 — RESOLVE EXPLICIT STATIONS
============================================================

Support all of these:

show()

show(undefined)

show(null)

show(0)

show(3450)

show(8000)

show(12000)

show(16960)

show({ chainage_m: 3450 })

show(existingCanonicalRecord)

For each one:

resolve against the canonical 1,698 records.

Use nearest station matching if exact floating point equality is not available.

Do NOT create another station array.

============================================================
PHASE 9 — FORCE AN UNAMBIGUOUS RUNTIME TEST
============================================================

Immediately after station resolution, log:

console.log('[HYDROLOGY MODAL] STATION RESOLVED', {
    input,
    profileLength: records.length,
    currentStation,
    chainage: currentStation?.chainage_m,
    objectIdentityIsCanonical:
        records.includes(currentStation)
});

The last property is important.

For CH 0+000 it should be:

objectIdentityIsCanonical: true

If false, resolve the station to the canonical record.

============================================================
PHASE 10 — DO NOT ALLOW render() TO SILENTLY ABORT
============================================================

Current code appears to have logic equivalent to:

if (!currentStation) {
    console.warn('[CrossSectionModal] No currentStation, abort render');
    return;
}

Keep the guard for invalid states, BUT do not silently leave an empty modal.

If currentStation is null while records.length > 0:

THROW/LOG a clear diagnostic:

console.error(
    '[HYDROLOGY MODAL] INVALID STATE: PROFILE EXISTS BUT STATION IS NULL',
    {
        recordCount: records.length,
        currentStation,
        records
    }
);

Then resolve records[0] and retry render exactly once.

Do not create infinite render loops.

============================================================
PHASE 11 — VERIFY THE RENDER FUNCTION ACTUALLY RUNS
============================================================

At the very first line of the ACTUAL render function:

console.log('[HYDROLOGY MODAL] REAL RENDER ENTERED', {
    currentStation,
    recordCount: records?.length
});

At the end:

console.log('[HYDROLOGY MODAL] REAL RENDER COMPLETED');

The browser MUST show:

REAL RENDER ENTERED
...
REAL RENDER COMPLETED

when the modal opens.

If these logs do NOT appear:

the problem is NOT hydraulic data.

The wrong module/instance/event/render lifecycle is being used.

Fix that first.

============================================================
PHASE 12 — VERIFY THE DOM ELEMENTS USED BY render()
============================================================

After render begins, explicitly locate:

- graph container
- hydraulic geometry container
- chainage value
- width value
- depth value
- WSE value
- bed elevation value
- area value
- radius value
- discharge value
- velocity value
- Froude value
- geometry priority
- confidence
- datum status

Log:

console.log('[HYDROLOGY MODAL] DOM TARGETS', {
    graph: !!graphElement,
    hydraulicPanel: !!hydraulicPanel,
    chainage: !!chainageElement,
    width: !!widthElement,
    depth: !!depthElement,
    wse: !!wseElement,
    area: !!areaElement,
    velocity: !!velocityElement
});

If any are false:

FIX THE DOM SELECTORS.

Do not change hydraulic data.

============================================================
PHASE 13 — FIX HYDRAULIC VALUE MAPPING
============================================================

Once the exact canonical record schema is known, map it correctly.

The UI must display:

Chainage
Channel Top Width
Water Depth
Water Surface (WSE)
Bed Elevation
Wetted Cross-Area
Hydraulic Radius
Discharge (Q)
Velocity (v)
Froude (Fr)

If the canonical data uses nested objects such as:

water_depth_m: {
    value: ...,
    provenance: ...
}

extract the actual numeric value.

Never render:

[object Object]

Never incorrectly display "—" when a valid nested numeric value exists.

============================================================
PHASE 14 — VERIFY THE GRAPH IS NOT JUST A CONTAINER
============================================================

The screenshot shows the graph area as a completely empty black rectangle.

Determine whether the SVG/canvas/chart element is actually being created.

After render:

console.log('[HYDROLOGY MODAL] GRAPH DOM', {
    svgCount: graphContainer?.querySelectorAll('svg').length,
    canvasCount: graphContainer?.querySelectorAll('canvas').length,
    childCount: graphContainer?.children.length,
    htmlLength: graphContainer?.innerHTML?.length
});

If all are zero:

the graph renderer was never called.

Fix the rendering lifecycle.

If an SVG exists but has zero visible content:

inspect its paths/lines.

============================================================
PHASE 15 — CROSS-SECTION GRAPH
============================================================

For PARAMETRIC geometry:

Use the existing parametricCrossSection.js output.

Do not create random SVG coordinates.

The graph must contain:

- bed curve
- water surface
- wetted region
- channel boundaries where available
- width indication
- depth indication

Use the selected canonical station.

The graph must change when station changes.

============================================================
PHASE 16 — LONGITUDINAL SLOPE PROFILE
============================================================

The screenshot also shows:

Longitudinal Slope Profile

selected.

The chart is empty.

This must be fixed independently.

Use:

hydrologyStore.getProfile().records

for the complete longitudinal dataset.

There must be 1,698 points/stations.

Render at least:

X = chainage

Y = available hydraulic depth / WSE / width

Use multiple series only when the data actually exists.

If WSE or bed elevation is unavailable, do not fabricate it.

Highlight the selected station.

When switching from CH 0+000 to CH 3+450, the highlighted position must move.

============================================================
PHASE 17 — TAB SWITCHING
============================================================

Verify:

Cross-Section Transect
and
Longitudinal Slope Profile

are real interactive tabs.

Clicking each tab must:

- update active styling
- hide inactive chart
- show active chart
- render/update active chart

Do not render into the wrong hidden container.

This is important because the screenshot currently shows the longitudinal tab active but the graph is still empty.

============================================================
PHASE 18 — HYDROLOGY STATE CHANGE
============================================================

Keep:

hydrology-state-change

subscription.

When the hydraulic profile becomes available:

- retrieve new records
- resolve current station
- update UI
- redraw chart

Do not lose station selection.

Do not create duplicate listeners.

Clean up listeners when modal is destroyed if the architecture supports destruction.

============================================================
PHASE 19 — CLOSE BUTTON
============================================================

The close button is already working.

Do not regress it.

Required:

click X:

[CrossSectionModal] CLOSE BUTTON CLICKED
[CrossSectionModal] hide() called

ESC:

hide()

Modal disappears.

Focus restores safely.

Keep:

role="dialog"
aria-modal="true"
aria-labelledby="cs-modal-title"

Do not reintroduce aria-hidden on the active modal.

============================================================
PHASE 20 — SEARCH FOR DUPLICATE STATE / DUPLICATE MODULE
============================================================

Search entire project for:

new HydrologyStore
new HydraulicProfileEngine
HydrologyStore(
HydraulicProfileEngine(
hydrologyStore =
crossSectionModal =
new CrossSectionModal

There must be ONE canonical hydrology store used by:

hydraulic profile engine
Digital Twin
cross-section modal
3D hydraulic rendering

If there are multiple HydrologyStore instances:

FIX THE ARCHITECTURE.

A very likely failure mode is:

Instance A:
contains 1,698 records

Instance B:
used by crossSectionModal

contains no profile.

If this exists, eliminate the split state.

The modal MUST use the SAME store instance that receives:

setHydraulicProfile(profile)

============================================================
PHASE 21 — VERIFY PROFILE STORE IDENTITY
============================================================

Add a temporary runtime identifier to the hydrology store:

for example:

store.__debugId = 'RIVEREYE_CANONICAL_HYDROLOGY_STORE';

Then log it wherever the profile is:

- generated
- stored
- read by crossSectionModal

The IDs MUST MATCH.

If:

Hydraulic engine store = A

CrossSection modal store = B

then this is the actual root cause.

Fix the singleton/import architecture.

============================================================
PHASE 22 — VERIFY HYDRAULIC PROFILE ENGINE
============================================================

Do NOT rewrite the engine.

Verify it produces:

1698 records

and each record contains the required hydraulic values.

Check:

records[0]
records[1]
records[500]
records[1000]
records[1697]

Print:

chainage
width
depth
Q
area
velocity
Froude
provenance

Confirm values are not all identical unless physically expected.

============================================================
PHASE 23 — VERIFY STATION VARIATION
============================================================

The modal must not show the same values at every chainage.

Test:

CH 0+000
CH 3+450
CH 8+000
CH 12+000
CH 16+960

For each log:

console.log('[HYDROLOGY MODAL] STATION TEST', {
    chainage,
    width,
    depth,
    area,
    discharge,
    velocity,
    froude
});

Confirm values come from different canonical records.

============================================================
PHASE 24 — NO FAKE MSL
============================================================

Keep:

UNVERIFIED_DATUM

where appropriate.

If bed elevation is unavailable:

Bed Elevation
— UNAVAILABLE
UNVERIFIED DATUM

Do NOT create a numerical MSL value merely to populate the field.

============================================================
PHASE 25 — FINAL VISUAL RESULT
============================================================

The modal must no longer look like the screenshot.

BAD:

graph = empty
all values = —
currentStation = null

GOOD:

CH 0+000
PARAMETRIC

GRAPH:
actual parametric cross-section

RIGHT PANEL:

Chainage             0+000
Channel Top Width    [actual canonical value]
Water Depth          [actual canonical value]
Water Surface (WSE)  [actual/modelled value or unavailable]
Bed Elevation        — UNAVAILABLE if datum not tied
Wetted Cross-Area    [actual derived value]
Hydraulic Radius     [actual derived value]
Discharge             [actual modelled/assumed value]
Velocity              [actual derived value]
Froude                [actual derived value]

PROVENANCE:

Geometry Priority
Confidence
Datum Status

============================================================
PHASE 26 — REMOVE DEBUG LOG NOISE AFTER FIX
============================================================

Once the feature is verified:

Keep only useful diagnostics.

Remove repetitive logs such as:

CLOSE BUTTON CLICKED

if no longer needed.

The application console should be clean except for legitimate informational logs.

Especially eliminate unrelated repeated:

FISHING POINT

logs from affecting the hydraulic debugging output if possible.

============================================================
PHASE 27 — BUILD + RUNTIME TEST
============================================================

Run:

npm run build

Then:

npm run dev

Open the application.

Open:

View Channel Cross-Sections & Profile

Perform the following EXACT test:

TEST 1
Open default modal.

Expected:
CH 0+000
currentStation = records[0]
recordCount = 1698
graph rendered
hydraulic values rendered

TEST 2
Click Cross-Section Transect.

Expected:
cross-section graph visible.

TEST 3
Click Longitudinal Slope Profile.

Expected:
1,698-station longitudinal graph visible.

TEST 4
Switch station to:

CH 3+450

Expected:
currentStation changes
chart highlight changes
values change

TEST 5
CH 8+000

TEST 6
CH 12+000

TEST 7
CH 16+960

TEST 8
Click X.

Expected:
modal closes.

TEST 9
Reopen.

Expected:
works again.

TEST 10
Press ESC.

Expected:
closes.

============================================================
PHASE 28 — CONSOLE ACCEPTANCE
============================================================

There must be NO:

assetList is not defined

hydrologyStore.getState is not a function

No currentStation, abort render

Cannot read properties of undefined

Cannot read properties of null

profile undefined

[object Object]

duplicate modal instance

profileLength 0

profileLength undefined

============================================================
PHASE 29 — FINAL DIAGNOSTIC
============================================================

Before removing debug logs, capture:

console.log('[RIVEREYE HYDROLOGY FINAL]', {
    modalInstanceCount,
    profileLength,
    currentStation,
    canonicalStoreId,
    firstRecord,
    selectedRecord,
    graphRendered,
    longitudinalProfileRendered
});

ALL MUST BE VALID.

============================================================
PHASE 30 — FINAL REPORT
============================================================

Do NOT simply say:

"Build successful."

Return:

1. EXACT ROOT CAUSE

2. WHETHER DUPLICATE crossSectionModal FILES EXISTED

3. WHETHER DUPLICATE HydrologyStore INSTANCES EXISTED

4. ACTUAL canonical profile object structure

5. ACTUAL station resolution logic

6. ACTUAL hydraulic property mapping

7. CROSS-SECTION rendering result

8. LONGITUDINAL PROFILE rendering result

9. CHAINAGES TESTED

10. X / ESC result

11. ACCESSIBILITY result

12. npm run build result

13. BROWSER runtime result

14. Remaining scientific/data limitations

IMPORTANT:

Do not claim:

- real field measurements
- field calibration
- verified MSL bed elevation
- live telemetry
- surveyed cross-sections

unless the actual project data proves those things.

The final feature must be software-correct AND traceable to the existing canonical hydraulic profile.

FINAL SUCCESS CONDITION:

ONE canonical HydrologyStore
+
1,698 canonical hydraulic records
+
correct station resolution
+
currentStation !== null
+
actual hydraulic values rendered
+
cross-section graph rendered
+
longitudinal graph rendered
+
station changes update both
+
X works
+
ESC works
+
no runtime errors
+
no fabricated data.

DO NOT STOP UNTIL THIS CONDITION IS ACTUALLY VERIFIED IN THE RUNNING BROWSER.# Public Data Discovery Archive & Provenance Audit

## Overview
This directory serves as the immutable data discovery archive for the Mula–Mutha RiverEye Hydrological Digital Twin project.
In accordance with **Scientific Integrity Mandates 7, 8, 9, 41, and 42**, all external datasets are cataloged with strict provenance tracking distinguishing documented literature existence from raw data acquisition.

## Data Discovery Status Summary

| Dataset Identifier | Organization / Authority | Documented Existence? | Raw File Acquired? | Usable Without Fallback? | Vertical Datum | Coverage | Access / Auth Status |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| **PMC 2016 Riverfront DPR Survey** | PMC / HCP Consultants | **YES** | **NO** | NO | Documented GTS Benchmark / EGM96 | 44 km (25m cross-sections) | Proprietary / Confidential to PMC |
| **CWPRS Hydraulic Study Reports** | CWPRS Pune | **YES** | **NO** | NO | MSL (CWPRS Local Zero) | Sangam to Mundhwa | Government Technical Reports (Restricted) |
| **Irrigation Dept / WRD Survey** | Water Resources Dept, Maharashtra | **YES** | **NO** | NO | MSL | Khadakwasla to Bund Garden | Departmental Archives Only |
| **India-WRIS / CWC Hydrometry** | Central Water Commission (CWC) | **YES** | **NO** | NO | Documented Gauge Zero 540.0 m MSL | Bund Garden Gauge (028-IBHIMA) | `AUTHENTICATION_REQUIRED` (OAuth/Captcha) |
| **Local Bathymetric Soundings** | Local Sonar Survey | **YES** | **YES** | YES | `UNVERIFIED_DATUM` (relative depth soundings) | 16.96 km (1,698 chainage stations) | Active in `public/data/mula_mutha_water_depth.csv` |

## Rules on Scientific Defensibility
1. **Never Fabricate Data**: Missing gauge feeds or HEC-RAS geometry files must return `UNAVAILABLE` or `AUTHENTICATION_REQUIRED`.
2. **Datum Integrity**: If vertical benchmark levels are documented in report text but no RTK-GNSS tie-in or leveling book is attached to soundings, absolute bed elevation is marked `UNVERIFIED_DATUM` and bed elevation MSL remains `null`.
3. **Manning Roughness**: Natural channel roughness $n = 0.035$ remains classified as `ASSUMED` until at least 3 simultaneous $(Q, \text{Stage})$ observation pairs are ingested to run calibration inversion.
