import { describe, expect, it } from "vitest";
import { uiLocales, uiLocaleRegistry } from "@callassist/contracts";
import { userCallEmail, userCallEmailMessages, type UserCallReport } from "./user-call-email";

const report: UserCallReport = {
  callId: "11111111-1111-4111-8111-111111111111", attemptId: "22222222-2222-4222-8222-222222222222",
  locale: "ru", recipient: 'Gemeinde <script>alert("x")</script>', endedAt: "2026-10-07T12:00:00Z",
  callLanguage: "de-CH", assessmentLanguage: "uk", goal: "achieved", assessmentParagraphs: ["Заяву отримано. Наступний крок — очікувати відповідь."], partial: false,
  transcript: { id: "33333333-3333-4333-8333-333333333333", transcriptId: "44444444-4444-4444-8444-444444444444", callAttemptId: "22222222-2222-4222-8222-222222222222",
    revision: 1, source: "live_native", sourceHash: "a".repeat(64), createdAt: "2026-10-07T12:00:00Z", text: "Ist der Antrag da? Ja, er ist angekommen.",
    segments: [{ id: "a", role: "assistant", text: "Ist der Antrag da?", startSeconds: 1, endSeconds: 2 }, { id: "b", role: "recipient", text: "Ja, er ist angekommen.", startSeconds: 3, endSeconds: 4 }] }
};
describe("owner result email", () => {
  it.each(uiLocales)("localizes only the shell and constants in %s", locale => {
    const mail = userCallEmail({ ...report, locale }, { siteUrl: "https://example.test" });
    expect(mail.subject).toBe(userCallEmailMessages[locale].subject);
    expect(mail.html).toContain(`<html lang="${locale}">`);
    expect(mail.html).toContain('lang="uk"');
    expect(mail.html).toContain('lang="de-CH"');
    expect(mail.text).toContain(uiLocaleRegistry[locale].slogan);
    for (const text of [...report.assessmentParagraphs, ...report.transcript.segments.map(s => s.text)]) {
      expect(mail.text).toContain(text); expect(mail.html).toContain(text);
    }
    expect(mail.text).toContain(`https://example.test/${locale}/app/calls/${report.callId}`);
    expect(mail.html).toContain('src="cid:');
    expect(mail.attachments).toHaveLength(1); // Shared inline logo, never a transcript file.
    expect(mail.html.indexOf('src="cid:')).toBeLessThan(mail.html.indexOf('<h1'));
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).not.toContain('undefined');
  });
  it("keeps long original text and newlines without truncation in either body", () => {
    const text = `${"Originale Äußerung. ".repeat(15000)}\nLETZTE ZEILE <&>`;
    const transcript = { ...report.transcript, segments: [{ ...report.transcript.segments[1]!, text }] };
    const mail = userCallEmail({ ...report, transcript }, { siteUrl: "https://example.test" });
    expect(mail.text).toContain(text);
    expect(mail.html).toContain('LETZTE ZEILE &lt;&amp;&gt;');
    expect(mail.html).toContain('white-space:pre-wrap');
    expect(mail.html.match(/Originale Äußerung\./g)).toHaveLength(15000);
  });
  it("labels unavailable evaluation and incomplete evidence without inventing an outcome", () => {
    const mail = userCallEmail({ ...report, goal: null, assessmentParagraphs: [], partial: true }, { siteUrl: "https://example.test" });
    expect(mail.text).toContain("Оценка ИИ недоступна");
    expect(mail.text).toContain("Сохраненный транскрипт неполный.");
    expect(mail.text).not.toContain("Цель достигнута");
  });
});
