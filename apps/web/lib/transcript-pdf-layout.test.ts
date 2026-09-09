import type { CallBrief, FinalTranscript, FinalTranscriptRevision } from "@callassist/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDerivedTranscriptPdfDefinition } from "./derived-transcript-export";
import { buildFinalTranscriptPdfDefinition } from "./final-transcript-export";

const logoSvg = readFileSync(new URL("../public/brand/logo-light.svg", import.meta.url), "utf8");
const brief = { recipientName: "Synthetic Office", agentName: "Sebastian", locale: "de-CH" } as CallBrief;
const source: FinalTranscriptRevision = {
  id: "00000000-0000-4000-8000-000000000002", transcriptId: "00000000-0000-4000-8000-000000000003",
  callAttemptId: null, revision: 2, sourceHash: "a".repeat(64), createdAt: "2026-09-09T10:15:00.000Z",
  text: "Das Original enthält andere Wörter.",
  segments: [{ id: "opaque-source-segment-17", role: "unknown", text: "Das Original enthält andere Wörter.", startSeconds: null, endSeconds: null }]
};
const translated = "Документ ещё не получен. Її ім’я потрібно перевірити.";
const derivedInput = { brief, revision: source, segments: [{ ...source.segments[0]!, text: translated }], text: translated, translationLanguage: "ru" as const, uiLocale: "de" as const };

function nodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(nodes)];
}
function visibleText(value: unknown): string {
  if (Array.isArray(value)) return value.map(visibleText).filter(Boolean).join("\n");
  if (value === null || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  return [inlineText(node.text), ...Object.entries(node).filter(([key]) => key !== "text").map(([, child]) => visibleText(child))].filter(Boolean).join("\n");
}
function inlineText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(inlineText).join("");
  return visibleText(value);
}

describe("shared transcript PDF data contract", () => {
  it("renders the displayed translation while retaining its original source provenance", () => {
    const definition = buildDerivedTranscriptPdfDefinition(derivedInput, logoSvg);
    const text = visibleText(definition.content);
    expect(definition.language).toBe("ru");
    expect(text).toContain(translated);
    expect(text).not.toContain(source.text);
    expect(text).toContain(source.id);
    expect(text).toContain(source.sourceHash);
    expect(text).toContain("Übersetzung");
  });

  it("retains exact source segment destinations without exposing technical IDs as dialogue", () => {
    const definition = buildDerivedTranscriptPdfDefinition(derivedInput, logoSvg);
    expect(nodes(definition.content).some((node) => node.id === source.segments[0]!.id)).toBe(true);
    expect(visibleText(definition.content)).not.toContain(source.segments[0]!.id);
    expect(visibleText(definition.content)).not.toContain("00:00");
  });

  it("uses the actual current vector logo for both original and translation export paths", () => {
    const original = buildFinalTranscriptPdfDefinition({
      brief, uiLocale: "en", languageLabel: "German (Switzerland)",
      finalTranscript: { segments: [], text: "Synthetic plain transcript", completedAt: source.createdAt, updatedAt: source.createdAt } as unknown as FinalTranscript
    }, logoSvg);
    const translation = buildDerivedTranscriptPdfDefinition(derivedInput, logoSvg);
    for (const definition of [original, translation]) {
      expect(nodes(definition.content).some((node) => node.svg === logoSvg)).toBe(true);
      expect(definition.defaultStyle?.font).toBe("Roboto");
    }
  });

  it("preserves text-only recordings without invented speaker or timestamp data", () => {
    const plain = "Synthetic full-recording text, with no diarization or timestamps.";
    const legacy = buildFinalTranscriptPdfDefinition({
      brief, uiLocale: "en", languageLabel: "German (Switzerland)",
      finalTranscript: { segments: [], text: plain, completedAt: source.createdAt, updatedAt: source.createdAt } as unknown as FinalTranscript
    }, logoSvg);
    const revision = buildDerivedTranscriptPdfDefinition({ ...derivedInput, revision: { ...source, segments: [], text: plain }, segments: [], text: plain, translationLanguage: null, uiLocale: "en" }, logoSvg);
    for (const definition of [legacy, revision]) {
      const text = visibleText(definition.content);
      expect(text.split(plain)).toHaveLength(2);
      expect(text).not.toContain("00:00");
      expect(text).not.toContain("Unassigned speaker");
    }
  });

  it("keeps a long turn intact and supplies pagination without making the entire turn unbreakable", () => {
    const longText = `LONG-START ${"Її заяву ще не отримано. ".repeat(1000)} LONG-END`;
    const definition = buildDerivedTranscriptPdfDefinition({ ...derivedInput, segments: [{ ...derivedInput.segments[0]!, text: longText }], text: longText }, logoSvg);
    const text = visibleText(definition.content);
    expect(text.replace(/\s+/g, " ")).toContain(longText.replace(/\s+/g, " "));
    expect(text.split("LONG-START")).toHaveLength(2);
    expect(text.split("LONG-END")).toHaveLength(2);
    expect(nodes(definition.content).some((node) => node.unbreakable === true && visibleText(node).includes(longText))).toBe(false);
    expect(typeof definition.footer).toBe("function");
    if (typeof definition.footer === "function") {
      expect(visibleText(definition.footer(2, 3, { width: 595.28, height: 841.89, orientation: "portrait" }))).toContain("2 / 3");
    }
  });
});
