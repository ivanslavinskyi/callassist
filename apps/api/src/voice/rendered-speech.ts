const PCM_SAMPLE_RATE = 24_000;
const PCMU_SAMPLE_RATE = 8_000;
const PCMU_FRAME_BYTES = 160;
const MAX_PCM_BYTES = 12 * 1024 * 1024;

export type RenderedSpeech = {
  frames: string[];
  durationMs: number;
  model: string;
  providerRequestId: string | null;
};

export type RenderSpeechInput = {
  apiKey: string;
  text: string;
  locale: string;
  voice: string;
  model?: string;
  speechFetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Renders application-owned speech before playback. The Speech API returns raw
 * mono PCM16 at 24 kHz; Twilio's bidirectional stream accepts G.711 mu-law at
 * 8 kHz, so conversion stays local and never passes through Live.
 */
export async function renderSpeech(input: RenderSpeechInput): Promise<RenderedSpeech> {
  const model = input.model?.trim() || "gpt-4o-mini-tts";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  timer.unref?.();
  let response: Response;
  try {
    response = await (input.speechFetch ?? fetch)("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        voice: input.voice,
        input: input.text,
        instructions: `Speak in ${input.locale}. Read the input exactly once, word for word, in a calm, clear and unhurried manner. Do not add, omit or paraphrase anything.`,
        response_format: "pcm"
      }),
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(controller.signal.aborted ? "SPEECH_RENDER_TIMEOUT" : "SPEECH_RENDER_NETWORK_ERROR", { cause: error });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`SPEECH_RENDER_PROVIDER_ERROR_${response.status}`);
  const pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length || pcm.length > MAX_PCM_BYTES || pcm.length % 2 !== 0) throw new Error("SPEECH_RENDER_INVALID_AUDIO");
  const pcmu = pcm24kToPcmu8k(pcm);
  if (!pcmu.length) throw new Error("SPEECH_RENDER_INVALID_AUDIO");
  const frames: string[] = [];
  for (let offset = 0; offset < pcmu.length; offset += PCMU_FRAME_BYTES)
    frames.push(pcmu.subarray(offset, offset + PCMU_FRAME_BYTES).toString("base64"));
  return { frames, durationMs: Math.ceil(pcmu.length * 1_000 / PCMU_SAMPLE_RATE), model,
    providerRequestId: response.headers.get("x-request-id") };
}

export function pcm24kToPcmu8k(pcm: Buffer): Buffer {
  if (pcm.length % 2 !== 0) throw new Error("PCM16_LENGTH_REQUIRED");
  const inputSamples = pcm.length / 2;
  const outputSamples = Math.floor(inputSamples / (PCM_SAMPLE_RATE / PCMU_SAMPLE_RATE));
  const output = Buffer.allocUnsafe(outputSamples);
  for (let index = 0; index < outputSamples; index++) {
    const offset = index * 3;
    // A three-sample box filter is sufficient anti-aliasing for narrow-band
    // telephony speech and avoids an external media pipeline at call time.
    const sample = Math.round((pcm.readInt16LE(offset * 2) + pcm.readInt16LE((offset + 1) * 2) +
      pcm.readInt16LE((offset + 2) * 2)) / 3);
    output[index] = linear16ToMulaw(sample);
  }
  return output;
}

function linear16ToMulaw(value: number) {
  const sign = value < 0 ? 0x80 : 0;
  let magnitude = Math.min(Math.abs(value), 32_635) + 0x84;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); exponent--, mask >>= 1) { /* scan */ }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}
