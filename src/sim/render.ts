import { CELL_SOLID, type SimulationState } from "./types";

const clampChannel = (value: number) => {
  if (value <= 0) {
    return 0;
  }

  if (value >= 255) {
    return 255;
  }

  return value;
};

const lerp = (start: number, end: number, amount: number) => {
  return start + (end - start) * amount;
};

const sampleSpeedPalette = (normalizedSpeed: number) => {
  const t = Math.max(0, Math.min(1, normalizedSpeed));

  if (t < 0.25) {
    const localT = t / 0.25;
    return {
      blue: lerp(40, 190, localT),
      green: lerp(18, 80, localT),
      red: lerp(8, 35, localT),
    };
  }

  if (t < 0.5) {
    const localT = (t - 0.25) / 0.25;
    return {
      blue: lerp(190, 235, localT),
      green: lerp(80, 215, localT),
      red: lerp(35, 45, localT),
    };
  }

  if (t < 0.75) {
    const localT = (t - 0.5) / 0.25;
    return {
      blue: lerp(235, 70, localT),
      green: lerp(215, 225, localT),
      red: lerp(45, 250, localT),
    };
  }

  const localT = (t - 0.75) / 0.25;
  return {
    blue: lerp(70, 250, localT),
    green: lerp(225, 245, localT),
    red: lerp(250, 255, localT),
  };
};

export const renderState = (
  state: SimulationState,
  pixels: Uint8ClampedArray,
) => {
  const { flags, rho, ux, uy } = state;

  for (let cellIndex = 0; cellIndex < flags.length; cellIndex += 1) {
    const pixelBase = cellIndex * 4;

    if (flags[cellIndex] === CELL_SOLID) {
      pixels[pixelBase] = 238;
      pixels[pixelBase + 1] = 242;
      pixels[pixelBase + 2] = 245;
      pixels[pixelBase + 3] = 255;
      continue;
    }

    const density = rho[cellIndex];
    const velocityX = ux[cellIndex];
    const velocityY = uy[cellIndex];

    if (
      !Number.isFinite(density) ||
      !Number.isFinite(velocityX) ||
      !Number.isFinite(velocityY)
    ) {
      pixels[pixelBase] = 255;
      pixels[pixelBase + 1] = 0;
      pixels[pixelBase + 2] = 255;
      pixels[pixelBase + 3] = 255;
      continue;
    }

    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    const densityBias = Math.max(-0.04, Math.min(0.04, density - 1));
    const normalizedSpeed = Math.min(speed * 28, 1);
    const palette = sampleSpeedPalette(normalizedSpeed);
    const densityLift = densityBias * 700;

    pixels[pixelBase] = clampChannel(palette.red + densityLift);
    pixels[pixelBase + 1] = clampChannel(palette.green + densityLift * 0.35);
    pixels[pixelBase + 2] = clampChannel(palette.blue - densityLift * 0.5);
    pixels[pixelBase + 3] = 255;
  }
};
