import rules from "./transcript-copy-migration.json";
import optionalRules from "./optional-transcript-copy-migration.json";
/** Exact leaf updates shared by fresh seeds and migration verification. */
export function updateTranscriptCopy<T>(value:T,group:string):T {
 const replacements=rules.filter(rule=>rule.group===group);
 function visit(item:unknown):unknown {
  if(typeof item === "string") {
    const previous=replacements.find(rule=>rule.old.includes(item))?.next ?? item;
    return optionalRules.find(rule=>rule.group===group&&rule.old.includes(previous))?.next ?? previous;
  }
  if(Array.isArray(item))return item.map(visit);
  if(item && typeof item === "object")return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,visit(child)]));
  return item;
 }
 return visit(value) as T;
}
