// A resource envelope, never a benchmark or a certified maximum.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function preparationCapacityEnvelope(input) {
  const positive=["pgMaxConnections","prepPoolMax","appMemoryMiB","prepPeakMiB","hostCpuCount","prepCpuQuotaCores"];
  const nonnegative=["pgReservedConnections","fixedConnectionMax","fixedMemoryMiB","fixedCpuCores"];
  for(const key of [...positive,...nonnegative]) if(!Number.isFinite(input[key]) || input[key]<(positive.includes(key) ? .01 : 0)) throw new Error(`Invalid ${key}`);
  if(input.memoryReserveFraction<.2 || input.memoryReserveFraction>=1) throw new Error("Keep at least 20% application memory headroom");
  const connections=Math.max(0,Math.floor((input.pgMaxConnections-input.pgReservedConnections-input.fixedConnectionMax)/input.prepPoolMax));
  const memory=Math.max(0,Math.floor((input.appMemoryMiB*(1-input.memoryReserveFraction)-input.fixedMemoryMiB)/input.prepPeakMiB));
  const cpu=Math.max(0,Math.floor((input.hostCpuCount-input.fixedCpuCores)/input.prepCpuQuotaCores));
  return {resourceEnvelopeProcesses:Math.min(connections,memory,cpu),connectionBound:connections,memoryBound:memory,cpuBound:cpu,
    capacityCertified:false,note:"Use measured peak memory and CPU allocations under concurrent calls. Provider quotas, latency and event-loop thresholds can impose a lower limit."};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw new Error("Usage: node scripts/preparation-capacity.mjs <measured-profile.json>");
  console.log(JSON.stringify(preparationCapacityEnvelope(JSON.parse(readFileSync(process.argv[2],"utf8"))),null,2));
}
