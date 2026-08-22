export const HEIC_WORKER_SOURCE = String.raw`
const { parentPort } = require('node:worker_threads');
const libheif = require('libheif-js/wasm-bundle');
parentPort.once('message', (input) => {
  try {
    const images = new libheif.HeifDecoder().decode(input);
    if (images.length !== 1 || !images[0]) throw new Error('invalid_image_count');
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();
    if (width <= 0 || height <= 0 || width > 20000 || height > 20000 || width * height > 40000000)
      throw new Error('invalid_dimensions');
    const target = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    };
    image.display(target, (result) => {
      if (!result) {
        parentPort.postMessage({ error: 'decode_failed' });
        return;
      }
      const data = new Uint8ClampedArray(result.data);
      parentPort.postMessage({ width, height, data }, [data.buffer]);
    });
  } catch {
    parentPort.postMessage({ error: 'decode_failed' });
  }
});
`;
