# Public Data Discovery Archive & Provenance Audit

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
| **Local Bathymetric Soundings** | Local Sonar Survey | **YES** | **YES** | YES | `UNVERIFIED_DATUM` (relative depth soundings) | 16.96 km (1,698 chainage stations) | Active in `public/data/depth_pixels.csv` |

## Rules on Scientific Defensibility
1. **Never Fabricate Data**: Missing gauge feeds or HEC-RAS geometry files must return `UNAVAILABLE` or `AUTHENTICATION_REQUIRED`.
2. **Datum Integrity**: If vertical benchmark levels are documented in report text but no RTK-GNSS tie-in or leveling book is attached to soundings, absolute bed elevation is marked `UNVERIFIED_DATUM` and bed elevation MSL remains `null`.
3. **Manning Roughness**: Natural channel roughness $n = 0.035$ remains classified as `ASSUMED` until at least 3 simultaneous $(Q, \text{Stage})$ observation pairs are ingested to run calibration inversion.
