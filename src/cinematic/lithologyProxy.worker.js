self.onmessage = async ({ data }) => {
  try {
    const response = await fetch(data.url);
    if (!response.ok) throw new Error(`Lithology raster HTTP ${response.status}`);
    const source = await createImageBitmap(await response.blob());
    const width = data.width || 4096;
    const height = Math.round(source.height * width / source.width);
    const bitmap = await createImageBitmap(source, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "pixelated",
    });
    source.close();
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0);
    bitmap.close();
    self.postMessage({ blob: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
