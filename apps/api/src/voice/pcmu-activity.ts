/** Inspect G.711 energy without changing bytes on either transport. */
export class PcmuActivity {
  speaking = false;
  #voicedMs = 0;
  #quietMs = 0;

  push(bytes: Buffer): "started" | "stopped" | null {
    let energy = 0;
    for (const byte of bytes) {
      const value = (~byte) & 255;
      const magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
      energy += (magnitude - 132) ** 2;
    }
    const voiced = bytes.length > 0 && Math.sqrt(energy / bytes.length) >= 600;
    const ms = bytes.length / 8;
    this.#voicedMs = voiced ? this.#voicedMs + ms : 0;
    this.#quietMs = voiced ? 0 : this.#quietMs + ms;
    if (!this.speaking && this.#voicedMs >= 100) {
      this.speaking = true;
      return "started";
    }
    if (this.speaking && this.#quietMs >= 600) {
      this.speaking = false;
      return "stopped";
    }
    return null;
  }
}

export function decodePcmu(payload: unknown): Buffer | null {
  if (typeof payload !== "string" || !payload.length || payload.length > 128_000 ||
      payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  const bytes = Buffer.from(payload, "base64");
  return bytes.length && bytes.toString("base64") === payload ? bytes : null;
}
