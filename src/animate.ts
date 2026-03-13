export type AnimationBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

export const animate = (buffer: AnimationBuffer, _dt: number) => {
  const { pixels } = buffer;

  for (let index = 0; index < pixels.length; index += 4) {
    const value = Math.floor(Math.random() * 256);
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }
};
