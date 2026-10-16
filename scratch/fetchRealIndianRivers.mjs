import fs from "fs";

async function main() {
  console.log("Fetching Natural Earth 10m rivers...");
  const res = await fetch("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson");
  const neData = await res.json();
  console.log(`Loaded ${neData.features.length} features from Natural Earth.`);

  const targetRivers = {
    Ganga: ["Ganges", "Ganga"],
    Yamuna: ["Yamuna", "Jamuna"],
    Brahmaputra: ["Brahmaputra"],
    Narmada: ["Narmada", "Narbada"],
    Krishna: ["Krishna"],
  };

  const extracted = {};

  for (const [key, aliases] of Object.entries(targetRivers)) {
    const matches = neData.features.filter(f => {
      const p = f.properties;
      const str = `${p.name || ""} ${p.name_en || ""} ${p.NAME || ""}`.toLowerCase();
      return aliases.some(a => str.includes(a.toLowerCase()));
    });
    console.log(`Found ${matches.length} matches for ${key}`);
    if (matches.length > 0) {
      // Pick coordinates
      let coords = [];
      matches.forEach(m => {
        if (m.geometry.type === "LineString") {
          coords.push(m.geometry.coordinates);
        } else if (m.geometry.type === "MultiLineString") {
          m.geometry.coordinates.forEach(c => coords.push(c));
        }
      });
      extracted[key] = {
        name: key,
        coordinates: coords
      };
    }
  }

  // Also fetch Godavari from Overpass or authoritative coordinates
  console.log("Fetching Godavari from Overpass API...");
  try {
    const opQuery = `[out:json][timeout:30];
      relation["waterway"="river"]["name:en"="Godavari"];
      out geom;`;
    const opRes = await fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(opQuery));
    const opData = await opRes.json();
    if (opData.elements && opData.elements.length > 0) {
      console.log(`Found ${opData.elements.length} Godavari elements in OSM`);
      const godavariLines = [];
      opData.elements.forEach(el => {
        if (el.members) {
          el.members.filter(m => m.geometry).forEach(m => {
            godavariLines.push(m.geometry.map(pt => [pt.lon, pt.lat]));
          });
        }
      });
      extracted["Godavari"] = {
        name: "Godavari",
        coordinates: godavariLines
      };
    }
  } catch (err) {
    console.error("OSM Godavari fetch error:", err.message);
  }

  // Load Mula-Mutha from local authoritative GeoJSON
  if (fs.existsSync("public/data/river.geojson")) {
    const localMm = JSON.parse(fs.readFileSync("public/data/river.geojson", "utf-8"));
    const mmLine = localMm.features.find(f => f.id === "kml_river_centerline");
    if (mmLine) {
      extracted["Mula-Mutha"] = {
        name: "Mula-Mutha",
        coordinates: [mmLine.geometry.coordinates]
      };
      console.log("Loaded Mula-Mutha from public/data/river.geojson:", mmLine.geometry.coordinates.length, "points");
    }
  }

  // Also fetch India Boundary
  console.log("Fetching India official boundary...");
  const boundaryRes = await fetch("https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson");
  const boundaryData = await boundaryRes.json();
  const indiaFeature = boundaryData.features.find(f => f.properties.name === "India" || f.id === "IND");

  const outputData = {
    indiaBoundary: indiaFeature ? indiaFeature.geometry : null,
    rivers: extracted
  };

  fs.writeFileSync("public/data/real_indian_rivers.json", JSON.stringify(outputData, null, 2));
  console.log("Successfully wrote public/data/real_indian_rivers.json with rivers:", Object.keys(extracted));
}

main().catch(console.error);
