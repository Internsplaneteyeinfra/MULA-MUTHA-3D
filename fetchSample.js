import fs from "fs";
import { postFloodWater } from "./src/services/jalnetraFloodService.js";

async function fetchKml() {
  try {
    const kmlBlob = fs.readFileSync("./public/data/Mula_MuthaAOI_2.kml");
    const blob = new Blob([kmlBlob], { type: "application/vnd.google-earth.kml+xml" });
    const response = await postFloodWater({
      kmlBlob: blob,
      filename: "Mula_MuthaAOI_2.kml",
      start_date: "2024-06-04",
      end_date: "2024-07-10",
    });
    
    console.log("API Response:", response);
    const scene = response.datewise.find(s => s.kml_id);
    if (!scene) {
      console.log("No KML ID found in scenes.");
      return;
    }
    console.log("KML ID:", scene.kml_id);
    
    const url = `https://jalnetra-software-production.up.railway.app/api/flood-water/kml/${scene.kml_id}`;
    const kmlRes = await fetch(url);
    if (!kmlRes.ok) {
      console.error("Failed to download KML:", kmlRes.status);
      return;
    }
    const kmlText = await kmlRes.text();
    fs.writeFileSync("sample_flood.kml", kmlText);
    console.log("Wrote sample_flood.kml");
    
  } catch(e) {
    console.error(e);
  }
}

fetchKml();
