/**
 * Traceable dimensions for bridges in this scene. Values without a matching
 * primary or project source remain null; model defaults are never called surveyed.
 */
export const BRIDGE_DIMENSIONS = Object.freeze({
  "116839303": {
    name: "Mundhwa Bridge",
    lengthM: 288,
    widthM: 18.5,
    spans: { count: 9, typicalLengthM: 32 },
    structureType: "PSC cast-in-situ I-girder",
    source: "https://aturindia.com/projects/infrastructure-development/",
    sourceLabel: "Atur India project record for PMC Mundhwa river bridge",
    confidence: "medium-high",
  },
  "216506270": {
    name: "Dengle Bridge",
    lengthM: 162,
    widthM: 24,
    spans: { count: 5, pierCount: 4 },
    source: "https://timesofindia.indiatimes.com/city/pune/new-dengle-bridge-to-be-ready-by-july-say-officials/articleshow/62575424.cms",
    sourceLabel: "PMC officials quoted on new Dengle Bridge project dimensions",
    confidence: "medium",
  },
  "207164102": {
    name: "Babasaheb Ambedkar Bridge",
    lengthM: 400,
    widthM: 21,
    source: "https://timesofindia.indiatimes.com/city/pune/new-bridge-at-yerawada-to-open-soon/articleshow/10786560.cms",
    sourceLabel: "PMC officials quoted on completed bridge dimensions",
    confidence: "medium",
  },
  "1545663009": {
    name: "Kharadi–Keshavnagar Bridge",
    lengthM: 246.4,
    widthM: 24,
    source: "https://www.loksatta.com/pune/kharadi-keshavnagar-bridge-pune-traffic-relief-august-15-launch-sap-05-6050747/",
    sourceLabel: "PMC project specifications reported by Loksatta",
    confidence: "medium",
  },
  "23028035": {
    name: "Sangam Bridge",
    lengthM: 250,
    widthM: 10,
    approximate: true,
    source: "https://www.punemetrorail.org/download/PuneMetro_ESIA_ESMP.pdf",
    sourceLabel: "Maha Metro ESIA/ESMP, bridge described as about 250 m × 10 m",
    confidence: "medium",
  },
});

export const BRIDGE_ELEVATION_SOURCES = Object.freeze({
  "116839303": {
    deckM: 544.64,
    soffitM: 543.1,
    hfl25M: 540.94,
    hfl100M: 542.78,
    datum: "Not stated in source table; do not convert to scene elevation",
    source: "https://www.pcmcindia.gov.in/pdf/riverRegeneration/Mula/Mula-River-Hydrology-and-Hydraulics-Report.pdf",
  },
  "127048454": {
    deckM: 546.61,
    soffitM: 544.47,
    hfl25M: 542.33,
    hfl100M: 544.28,
    datum: "Not stated in source table; do not convert to scene elevation",
    source: "https://www.pcmcindia.gov.in/pdf/riverRegeneration/Mula/Mula-River-Hydrology-and-Hydraulics-Report.pdf",
  },
});

export function bridgeDimensionSource(id) {
  return BRIDGE_DIMENSIONS[String(id)] || null;
}

export function bridgeElevationSource(id) {
  return BRIDGE_ELEVATION_SOURCES[String(id)] || null;
}
