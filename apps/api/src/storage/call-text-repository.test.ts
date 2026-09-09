import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { createTranscriptRevision } from "./call-text-repository";
import { callTextRepositorySuite } from "./call-text-repository.test-suite";

describe("memory text artifact storage",()=>{
  const repository=new InMemoryCallRepository();
  const owner=randomUUID();
  callTextRepositorySuite(()=>repository,()=>owner);
});

it.each(["Received. ".repeat(8000)+"🙂","a".repeat(12000)+"\nNext paragraph."])("splits unsegmented long transcript without dropping characters or inventing speakers",(text)=>{
  const revision=createTranscriptRevision({transcriptId:randomUUID(),callAttemptId:null,revision:1,text,segments:[],createdAt:new Date().toISOString()});
  expect(revision.segments.map(s=>s.text).join("")).toBe(text);
  expect(revision.segments.every(s=>s.role==="unknown"&&s.text.length<=12000)).toBe(true);
  expect(new Set(revision.segments.map(s=>s.id)).size).toBe(revision.segments.length);
});
