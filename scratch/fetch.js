import fs from "fs";

async function run() {
  const kml = fs.readFileSync("public/data/Mula_MuthaAOI_2.kml");
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const form = new FormData();
  form.append("kml", blob, "aoi.kml");
  form.append("start_date", "2024-06-01");
  form.append("end_date", "2024-07-08");

  const url = "https://jalnetra-software-production.up.railway.app/api/flood-water";
  console.log("Fetching...", url);
  const res = await fetch(url, {
    method: "POST",
    body: form,
  });
  const text = await res.text();
  console.log("Status:", res.status);
  fs.writeFileSync("scratch/api_response.json", text);
  console.log("Written to scratch/api_response.json");
}

run();
