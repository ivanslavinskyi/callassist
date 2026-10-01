import type { TranscriptSegment } from "./call-brief";

/** Arrival order is authoritative within a speaker. Timings position display rows. */
export function transcriptArrivalOrder(a: TranscriptSegment, b: TranscriptSegment) {
  if (a.ingestionSequence !== undefined && b.ingestionSequence !== undefined)
    return a.ingestionSequence - b.ingestionSequence;
  return (a.receivedAt ?? a.createdAt).localeCompare(b.receivedAt ?? b.createdAt);
}

export function groupNativeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const rows: TranscriptSegment[] = [];
  const seen = new Set<string>();
  const lastBySpeaker = new Map<string, TranscriptSegment>();
  for (const segment of [...segments].sort(transcriptArrivalOrder)) {
    const timing = segment.nativeTiming;
    const identity = timing ? `native:${timing.sessionId}:${timing.eventId}`
      : segment.applicationPlayback ? `playback:${segment.applicationPlayback.sessionId}:${segment.applicationPlayback.markId}` : segment.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (!timing) { rows.push({ ...segment }); lastBySpeaker.clear(); continue; }
    const key = `${timing.sessionId}:${segment.role}:${segment.locale}`;
    const previous = lastBySpeaker.get(key);
    if (previous?.nativeTiming && timing.startMs - previous.nativeTiming.endMs <= 1500 && timing.endMs >= previous.nativeTiming.startMs) {
      previous.text += segment.text;
      previous.nativeTiming.startMs = Math.min(previous.nativeTiming.startMs, timing.startMs);
      previous.nativeTiming.endMs = Math.max(previous.nativeTiming.endMs, timing.endMs);
      previous.final = previous.final && segment.final;
    } else {
      const row = { ...segment, nativeTiming: { ...timing } };
      rows.push(row); lastBySpeaker.set(key, row);
    }
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || transcriptArrivalOrder(a, b));
}

export const consentTimeline = {
  en: { system: "Call event", granted: "Consent to recording and transcription received", voice: "Voice confirmation", dtmf: "Keypad confirmation" },
  de: { system: "Anrufereignis", granted: "Einwilligung zur Aufnahme und Transkription erhalten", voice: "Mündliche Bestätigung", dtmf: "Bestätigung per Telefontaste" },
  fr: { system: "Événement de l’appel", granted: "Consentement à l’enregistrement et à la transcription reçu", voice: "Confirmation vocale", dtmf: "Confirmation par touche" },
  it: { system: "Evento della chiamata", granted: "Consenso alla registrazione e trascrizione ricevuto", voice: "Conferma vocale", dtmf: "Conferma tramite tastiera" },
  ru: { system: "Событие звонка", granted: "Получено согласие на запись и транскрипцию", voice: "Голосовое подтверждение", dtmf: "Подтверждение клавишей" },
  uk: { system: "Подія дзвінка", granted: "Отримано згоду на запис і транскрипцію", voice: "Голосове підтвердження", dtmf: "Підтвердження клавішею" },
  rm: { system: "Eveniment dal telefonat", granted: "Consentiment per registrar e transcriver retschavì", voice: "Conferma a bucca", dtmf: "Conferma cun tasta" }
};
