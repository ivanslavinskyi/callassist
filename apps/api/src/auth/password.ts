import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
  type ScryptOptions
} from "node:crypto";
const keyLength = 64;
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const maxmem = 64 * 1024 * 1024;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem
  });
  return [
    "scrypt-v1",
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string) {
  const [version, costText, blockSizeText, parallelizationText, saltText, hashText] =
    encoded.split("$");
  if (
    version !== "scrypt-v1" ||
    !costText ||
    !blockSizeText ||
    !parallelizationText ||
    !saltText ||
    !hashText
  ) {
    return false;
  }
  const parameters = [costText, blockSizeText, parallelizationText].map(Number);
  if (parameters.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    return false;
  }
  const [storedCost, storedBlockSize, storedParallelization] = parameters as [
    number,
    number,
    number
  ];
  if (storedCost > cost || storedBlockSize > blockSize || storedParallelization > 4) {
    return false;
  }
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    if (salt.length !== 16 || expected.length !== keyLength) return false;
    const actual = await scrypt(password, salt, expected.length, {
      N: storedCost,
      r: storedBlockSize,
      p: storedParallelization,
      maxmem
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function scrypt(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions
) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
