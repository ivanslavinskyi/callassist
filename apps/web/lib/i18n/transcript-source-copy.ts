import type { UiLocale } from "@callassist/contracts";

type Copy = { title: string; native: string; recording: string; preparing: string; pending: string; raw: string };
export const transcriptSourceCopy: Record<UiLocale, Copy> = {
  en: {title:"Conversation transcript",native:"Saved from the transcript produced during the conversation.",recording:"Transcribed from the call recording.",preparing:"Preparing the conversation transcript",pending:"The transcript will be available after the conversation is saved.",raw:"Live captions"},
  de: {title:"Gesprächstranskript",native:"Aus der während des Gesprächs erstellten Transkription gespeichert.",recording:"Aus der Gesprächsaufnahme transkribiert.",preparing:"Gesprächstranskript wird vorbereitet",pending:"Das Transkript ist verfügbar, sobald das Gespräch gespeichert ist.",raw:"Live-Transkript"},
  fr: {title:"Transcription de la conversation",native:"Enregistrée à partir de la transcription produite pendant la conversation.",recording:"Transcrite à partir de l’enregistrement de l’appel.",preparing:"Préparation de la transcription",pending:"La transcription sera disponible une fois la conversation sauvegardée.",raw:"Transcription en direct"},
  it: {title:"Trascrizione della conversazione",native:"Salvata dalla trascrizione prodotta durante la conversazione.",recording:"Trascritta dalla registrazione della chiamata.",preparing:"Preparazione della trascrizione",pending:"La trascrizione sarà disponibile dopo il salvataggio della conversazione.",raw:"Trascrizione in diretta"},
  rm: {title:"Transcripziun dal discurs",native:"Memorisada a partir da la transcripziun creada durant il discurs.",recording:"Transcritta a partir da la registraziun dal clom.",preparing:"La transcripziun vegn preparada",pending:"La transcripziun è disponibla suenter che il discurs è memorisà.",raw:"Transcripziun en direct"},
  ru: {title:"Транскрипт разговора",native:"Сохранён из расшифровки, созданной во время разговора.",recording:"Получен из аудиозаписи разговора.",preparing:"Подготавливаем транскрипт разговора",pending:"Транскрипт появится после сохранения разговора.",raw:"Текст во время звонка"},
  uk: {title:"Транскрипт розмови",native:"Збережено з розшифрування, створеного під час розмови.",recording:"Отримано з аудіозапису розмови.",preparing:"Готуємо транскрипт розмови",pending:"Транскрипт з’явиться після збереження розмови.",raw:"Текст під час дзвінка"}
};
export function transcriptSourceDescription(locale: UiLocale, source?: "live_native" | "recording_asr") {
  const copy=transcriptSourceCopy[locale];
  return source === "live_native" ? copy.native : copy.recording;
}
