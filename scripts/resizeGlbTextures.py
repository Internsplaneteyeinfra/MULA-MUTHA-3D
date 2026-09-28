"""Downsize embedded textures of an (uncompressed) GLB. Usage: resizeGlbTextures.py in.glb out.glb 1024"""
import io
import json
import struct
import sys

from PIL import Image


def main(src, dst, max_px):
    with open(src, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise SystemExit("not a glTF 2 binary")
    off = 12
    doc = None
    bin_chunk = b""
    while off < len(data):
        length, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + length]
        if ctype == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
        off += 8 + length

    views = doc.get("bufferViews", [])
    image_views = {}
    for img in doc.get("images", []):
        bv = img.get("bufferView")
        if bv is None:
            continue
        v = views[bv]
        raw = bin_chunk[v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]]
        im = Image.open(io.BytesIO(raw))
        im.load()
        if max(im.size) > max_px:
            scale = max_px / max(im.size)
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        out = io.BytesIO()
        im.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
        image_views[bv] = out.getvalue()
        img["mimeType"] = "image/jpeg"

    new_bin = bytearray()
    for i, v in enumerate(views):
        start = v.get("byteOffset", 0)
        payload = image_views.get(i, bin_chunk[start : start + v["byteLength"]])
        while len(new_bin) % 4:
            new_bin.append(0)
        v["byteOffset"] = len(new_bin)
        v["byteLength"] = len(payload)
        new_bin.extend(payload)
    while len(new_bin) % 4:
        new_bin.append(0)
    doc["buffers"] = [{"byteLength": len(new_bin)}]

    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(new_bin)
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(new_bin), 0x004E4942))
        f.write(new_bin)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024)
