import type { Chunk } from "./types";

export const createChunks = (
  width: number,
  height: number,
  chunkSize: number,
): Chunk[] => {
  const chunks: Chunk[] = [];

  for (let y = 0; y < height; y += chunkSize) {
    for (let x = 0; x < width; x += chunkSize) {
      chunks.push({
        height: Math.min(chunkSize, height - y),
        width: Math.min(chunkSize, width - x),
        x,
        y,
      });
    }
  }

  return chunks;
};
