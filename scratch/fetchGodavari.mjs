import fs from "fs";

async function run() {
  const q = `[out:json][timeout:25];
way["waterway"="river"](19.85,73.65,20.08,73.95);
out geom;`;

  console.log("Querying Overpass for Godavari Nashik...");
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
  ];

  for (const ep of endpoints) {
    try {
      console.log("Trying endpoint:", ep);
      const res = await fetch(ep + "?data=" + encodeURIComponent(q));
      if (!res.ok) {
        console.log("Status:", res.status);
        continue;
      }
      const data = await res.json();
      console.log("Elements count:", data.elements?.length);
      if (data.elements && data.elements.length > 0) {
        // Collect coordinates of Godavari in Nashik
        const godavariCoords = [];
        data.elements.forEach(el => {
          if (el.geometry && el.geometry.length > 1) {
            godavariCoords.push(el.geometry.map(pt => [pt.lon, pt.lat]));
          }
        });

        // Add to real_indian_rivers.json
        const current = JSON.parse(fs.readFileSync("public/data/real_indian_rivers.json", "utf-8"));
        current.rivers["Godavari"] = {
          name: "Godavari",
          location: "Nashik, Maharashtra",
          coordinates: godavariCoords
        };
        fs.writeFileSync("public/data/real_indian_rivers.json", JSON.stringify(current, null, 2));
        console.log("Successfully saved Godavari Nashik river path with segments:", godavariCoords.length);
        return;
      }
    } catch (e) {
      console.error("Endpoint failed:", e.message);
    }
  }
}

run();
