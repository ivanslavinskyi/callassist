import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { CreateCallBriefInput } from "@callassist/contracts";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";

const instances: CallService[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(x => x.close())); });
const input: CreateCallBriefInput = {
  recipientName: "Gemeinde", phoneNumber: "+41523686688", objective: "Ask which documents are needed for registration",
  assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Keller",
  locale: "de-CH", allowLanguageSwitch: false, allowedFacts: []
};
async function ready(service: CallService, preparationId: string, userId: string) {
  for (let i = 0; i < 60; i++) {
    const p = await service.getPreparation(preparationId, userId);
    if (p.status === "succeeded") return (await service.get(p.callBriefId!))!;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error("Preparation did not finish");
}

it("persists independent language intent and rejects idempotency reuse with another target", async () => {
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository); instances.push(service); await service.initialize();
  const owner = randomUUID(), request = randomUUID();
  const language = { preferences: { mode: "manual" as const, targetLanguage: "ru" as const, uiLocaleHint: "en" } };
  const prep = await service.prepare(input, owner, request, language);
  expect((await service.prepare(input, owner, request, language)).id).toBe(prep.id);
  await expect(service.prepare(input, owner, request, { preferences: { mode: "manual", targetLanguage: "uk" } })).rejects.toMatchObject({ code: "CALL_PREPARATION_IDEMPOTENCY_CONFLICT" });
  const snapshot = await ready(service, prep.id, owner);
  expect(snapshot.languageContext).toMatchObject({ taskContentLanguage: "ru", selectionSource: "task", selectionRevision: 1 });
  expect(snapshot.brief.locale).toBe("de-CH");
  const hash = snapshot.compilation!.snapshotHash;
  const changed = await repository.updateContentLanguage(snapshot.brief.id, "uk", 1);
  expect(changed.selectionRevision).toBe(2);
  expect((await service.get(snapshot.brief.id))?.compilation?.snapshotHash).toBe(hash);
  await expect(repository.updateContentLanguage(snapshot.brief.id, "fr", 1)).rejects.toMatchObject({ code: "CALL_LANGUAGE_STALE" });
  const recompiled = await service.recompile(snapshot.brief.id, { ...input, objective: input.objective + " tomorrow" }, owner, randomUUID(), { preferences: { mode: "auto", uiLocaleHint: "de" } });
  const second = await ready(service, recompiled.id, owner);
  expect(second.languageContext).toMatchObject({ taskContentLanguage: "uk", selectionRevision: 2, compilationRevision: 2 });
});

it("freezes the account preference accepted with a preparation", async () => {
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository); instances.push(service); await service.initialize();
  const owner = randomUUID();
  const prep = await service.prepare(input, owner, randomUUID(), { preferences: { mode: "auto", uiLocaleHint: "en" }, accountPreference: "fr" });
  const snapshot = await ready(service, prep.id, owner);
  expect(snapshot.languageContext).toMatchObject({ taskContentLanguage: "fr", selectionSource: "account" });
  await service.approveCompilation(snapshot.brief.id, { revision: snapshot.compilation!.revision, snapshotHash: snapshot.compilation!.snapshotHash,
    review: { mode: "original", language: snapshot.brief.locale, selectionRevision: snapshot.languageContext!.selectionRevision } });
  await expect(repository.updateContentLanguage(snapshot.brief.id, "ru", 1)).rejects.toMatchObject({ code: "CALL_LANGUAGE_LOCKED" });
});
