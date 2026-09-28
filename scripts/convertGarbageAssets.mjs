/**
 * Web-ready garbage pile GLBs from the source scans in src/data/Garbage.
 * Textures are downsized with Pillow (scripts/resizeGlbTextures.py), then
 * geometry is simplified + meshopt-compressed with gltf-transform.
 * Usage: npm run convert:garbage
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public/assets/garbage");
const targets = [
  { src: "src/data/Garbage/trash-garbage-002-3d-scan/source/Trash 002.glb", out: "trash_pile.glb", ratio: "0.35", error: "0.004", tex: "1024" },
  { src: "src/data/Garbage/e-waste-by-the-river/source/model.glb", out: "ewaste_pile.glb", ratio: "0.03", error: "0.05", tex: "1024" },
];

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("failed:", cmd, args.join(" "));
    process.exit(r.status || 1);
  }
};

fs.mkdirSync(outDir, { recursive: true });
for (const t of targets) {
  const src = path.join(root, t.src);
  const out = path.join(outDir, t.out);
  if (!fs.existsSync(src)) {
    console.warn("skip missing", t.src);
    continue;
  }
  const tmp = path.join(os.tmpdir(), `garbage_${t.out}`);
  run("python", [`"${path.join(root, "scripts/resizeGlbTextures.py")}"`, `"${src}"`, `"${tmp}"`, t.tex]);
  run("npx", [
    "--yes", "@gltf-transform/cli@4.1.1", "optimize", `"${tmp}"`, `"${out}"`,
    "--compress", "meshopt",
    "--simplify", "true", "--simplify-ratio", t.ratio, "--simplify-error", t.error,
    "--texture-compress", "false",
  ]);
  fs.rmSync(tmp, { force: true });
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2);
  console.log(`${t.out}: ${mb(src)} MB → ${mb(out)} MB`);
}
