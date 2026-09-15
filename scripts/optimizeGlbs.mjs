/**
 * Re-compress public GLBs with meshopt (run after converting tree sources).
 * Usage: npm run optimize:glbs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "public/assets/trees/palm.glb",
  "public/assets/trees/broadleaf.glb",
  "public/assets/trees/conifer.glb",
  "public/assets/butterfly.glb",
];

for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.warn("skip missing", rel);
    continue;
  }
  const before = fs.statSync(file).size;
  const args = [
    "--yes",
    "@gltf-transform/cli@4.1.1",
    "optimize",
    file,
    file,
    "--compress",
    "meshopt",
    "--simplify",
    "0.5",
    "--simplify-error",
    "0.002",
  ];
  if (rel.includes("butterfly")) {
    args.splice(args.indexOf("--simplify"), 4, "--simplify", "0.75", "--simplify-error", "0.001");
  }
  const r = spawnSync("npx", args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("failed", rel);
    process.exit(r.status || 1);
  }
  const after = fs.statSync(file).size;
  console.log(
    `${rel}: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`,
  );
}
