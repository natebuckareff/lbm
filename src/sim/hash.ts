const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const HASH_MASK_64 = 0xffffffffffffffffn;

const hashBytes = (hash: bigint, bytes: Uint8Array) => {
  let nextHash = hash;

  for (let index = 0; index < bytes.length; index += 1) {
    nextHash ^= BigInt(bytes[index]);
    nextHash = (nextHash * FNV_PRIME_64) & HASH_MASK_64;
  }

  return nextHash;
};

const bigintToBytes = (value: bigint) => {
  const bytes = new Uint8Array(8);
  let remaining = value & HASH_MASK_64;

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
};

const typedArrayBytes = (array: Uint8Array | Float32Array) => {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
};

export const createHashSeed = () => FNV_OFFSET_BASIS_64;

export const formatHashHex = (hash: bigint) => {
  return hash.toString(16).padStart(16, "0");
};

export const hashSimulationTick = (
  previousHash: bigint,
  flags: Uint8Array,
  fill: Float32Array,
  ux: Float32Array,
  uy: Float32Array,
) => {
  let hash = createHashSeed();
  hash = hashBytes(hash, bigintToBytes(previousHash));
  hash = hashBytes(hash, typedArrayBytes(flags));
  hash = hashBytes(hash, typedArrayBytes(fill));
  hash = hashBytes(hash, typedArrayBytes(ux));
  hash = hashBytes(hash, typedArrayBytes(uy));
  return hash;
};
