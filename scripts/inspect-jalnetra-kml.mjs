import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("src/jalnetra kml");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".kml"))) {
  const buf = fs.readFileSync(path.join(dir, f));
  const text = buf.subarray(0, 12000).toString("utf8");
  const name = (text.match(/<(?:ns0:)?name>([^<]+)<\/(?:ns0:)?name>/i) || [])[1];
  const desc = (text.match(/<(?:ns0:)?description>([\s\S]*?)<\/(?:ns0:)?description>/i) || [])[1] || "";
  const styles = [...text.matchAll(/<(?:ns0:)?Style\s+id="([^"]+)"/gi)].map((m) => m[1]);
  const placemarkNames = [...text.matchAll(/<(?:ns0:)?Placemark[\s\S]*?<(?:ns0:)?name>([^<]*)<\/(?:ns0:)?name>/gi)]
    .slice(0, 8)
    .map((m) => m[1]);
  console.log("\n====", f, "size=", buf.length, "====");
  console.log("name:", name);
  console.log("desc:", desc.replace(/\s+/g, " ").trim().slice(0, 700));
  console.log("styles:", styles.slice(0, 20).join(", "));
  console.log("placemark names sample:", placemarkNames.join(" | "));
}
