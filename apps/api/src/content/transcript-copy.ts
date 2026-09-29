import rules from "./transcript-copy-migration.json";
/** Exact leaf updates shared by fresh seeds and migration verification. */
export function updateTranscriptCopy<T>(value:T,group:string):T {
 const replacements=rules.filter(rule=>rule.group===group);
 function visit(item:unknown):unknown {
  if(typeof item === "string") return replacements.find(rule=>rule.old.includes(item))?.next ?? item;
  if(Array.isArray(item))return item.map(visit);
  if(item && typeof item === "object")return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,visit(child)]));
  return item;
 }
 return visit(value) as T;
}
