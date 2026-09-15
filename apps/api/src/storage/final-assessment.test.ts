import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { finalAssessmentSuite } from "./final-assessment.test-suite";
describe("final assessment memory",()=>finalAssessmentSuite(async()=>({repository:new InMemoryCallRepository(),owner:randomUUID()})));
