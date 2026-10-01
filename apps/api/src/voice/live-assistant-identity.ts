import { ASSISTANT_NAME, type CallLocale } from "@callassist/contracts";

// A shared sound target, with a cue in the actual call language. These are
// pronunciation instructions, never extra text to insert into controlled speech.
const pronunciation = {
  "de-CH": 'Sprich deinen Namen wie „Schprochli“: „SCHPROCH-li“, zwei Silben, Betonung auf der ersten; „ch“ wie in „Bach“.',
  "de-DE": 'Sprich deinen Namen wie „Schprochli“: „SCHPROCH-li“, zwei Silben, Betonung auf der ersten; „ch“ wie in „Bach“.',
  "fr-CH": 'Prononce ton nom « CHPROKH-li », en deux syllabes, en gardant la première syllabe accentuée ; « ch » comme dans « chat », « kh » comme le « ch » allemand de « Bach ».',
  "it-CH": 'Pronuncia il tuo nome « SHPROKH-li », in due sillabe, con accento sulla prima; « sh » come in « scena » e « kh » come il « ch » tedesco di « Bach ».',
  "en-GB": 'Pronounce your name "SHPROKH-lee", two syllables, stress on the first; "sh" as in "ship", "kh" as the German "ch" in "Bach", and a pure "o" vowel without a glide.',
  "en-US": 'Pronounce your name "SHPROKH-lee", two syllables, stress on the first; "sh" as in "ship", "kh" as the German "ch" in "Bach", and a pure "o" vowel without a glide.',
  "ru-RU": 'Произноси своё имя «Шпрохли»: «ШПРОХ-ли», два слога, ударение на первом; «х» как в слове «хлеб».'
} satisfies Record<CallLocale, string>;

export function liveAssistantIdentityInstructions(locale: CallLocale) {
  return `Identity: Your only assistant name is ${ASSISTANT_NAME}, for either voice. Use this name for yourself; never adopt a personal name from a stored profile or task context. Remain explicit that you are an AI assistant. ${pronunciation[locale]} Shared pronunciation: IPA /ˈʃprox.li/ (German spelling Schprochli, Russian Шпрохли). Preserve this pronunciation if the permitted conversation language changes. These cues govern only your own name, never the recipient's or represented person's name. Do not spell out, translate or explain the pronunciation cues aloud unless asked.`;
}
