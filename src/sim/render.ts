import { CELL_SOLID, type SimulationState } from "./types";

export type VisualizationMode = "density" | "speed";

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

const sampleDensityPalette = (normalizedDensity: number) => {
  const t = Math.max(0, Math.min(1, normalizedDensity));

  if (t < 0.5) {
    const localT = t / 0.5;
    return {
      blue: lerp(210, 184, localT),
      green: lerp(56, 172, localT),
      red: lerp(32, 180, localT),
    };
  }

  const localT = (t - 0.5) / 0.5;
  return {
    blue: lerp(184, 44, localT),
    green: lerp(172, 52, localT),
    red: lerp(180, 208, localT),
  };
};

export const renderState = (
  state: SimulationState,
  pixels: Uint8ClampedArray,
  mode: VisualizationMode,
) => {
  const { flags, rho, ux, uy } = state.domain.fields;

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

    if (mode === "density") {
      const densityDelta = Math.max(-0.03, Math.min(0.03, density - 1));
      const normalizedDensity = (densityDelta + 0.03) / 0.06;
      const palette = sampleDensityPalette(normalizedDensity);

      pixels[pixelBase] = clampChannel(palette.red);
      pixels[pixelBase + 1] = clampChannel(palette.green);
      pixels[pixelBase + 2] = clampChannel(palette.blue);
      pixels[pixelBase + 3] = 255;
      continue;
    }

    const densityBias = Math.max(-0.04, Math.min(0.04, density - 1));
    const normalizedSpeed = Math.min(speed * 28, 1);
    const palette = sampleDensityPalette(normalizedSpeed);
    const densityLift = densityBias * 700;

    pixels[pixelBase] = clampChannel(palette.red + densityLift);
    pixels[pixelBase + 1] = clampChannel(palette.green + densityLift * 0.35);
    pixels[pixelBase + 2] = clampChannel(palette.blue - densityLift * 0.5);
    pixels[pixelBase + 3] = 255;
  }
};
