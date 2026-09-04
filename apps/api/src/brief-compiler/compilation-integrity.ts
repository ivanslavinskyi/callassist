import { createHash } from "node:crypto";
import {
  BRIEF_COMPILER_VERSION,
  compiledCallBriefSchema,
  createCallBriefInputSchema,
  policyDecisionSchema,
  type CallCompilation
} from "@callassist/contracts";

export type CompilationSnapshotHashInput = Pick<
  CallCompilation,
  | "rawBrief"
  | "compiledBrief"
  | "policyDecision"
  | "compilerModel"
  | "compilerVersion"
  | "revision"
>;

/**
 * This serialized shape is the existing version-one compilation hash format.
 * Parsing the structured fields first gives every producer and verifier the
 * same schema-defined property order without changing hashes already stored by
 * brief-compiler-3.
 */
export function createCompilationSnapshotHash(
  input: CompilationSnapshotHashInput
) {
  const hashPayload = JSON.stringify({
    rawBrief: createCallBriefInputSchema.parse(input.rawBrief),
    compiledBrief: input.compiledBrief
      ? compiledCallBriefSchema.parse(input.compiledBrief)
      : null,
    policyDecision: policyDecisionSchema.parse(input.policyDecision),
    compilerModel: input.compilerModel,
    compilerVersion: input.compilerVersion,
    revision: input.revision
  });
  return createHash("sha256").update(hashPayload).digest("hex");
}

export function hasValidCompilationSnapshotHash(
  compilation: CallCompilation
) {
  try {
    return (
      compilation.compilerVersion === BRIEF_COMPILER_VERSION &&
      compilation.snapshotHash === createCompilationSnapshotHash(compilation)
    );
  } catch {
    return false;
  }
}
