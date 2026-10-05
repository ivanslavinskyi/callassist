import { test } from "node:test";
import assert from "node:assert/strict";
import { preparationCapacityEnvelope } from "./preparation-capacity.mjs";
const profile={pgMaxConnections:100,pgReservedConnections:20,fixedConnectionMax:35,prepPoolMax:4,
  appMemoryMiB:10240,memoryReserveFraction:.2,fixedMemoryMiB:4096,prepPeakMiB:1024,hostCpuCount:8,fixedCpuCores:4,prepCpuQuotaCores:1};
test("takes the tightest resource bound and never calls it certified",()=>{
  assert.deepEqual(preparationCapacityEnvelope(profile),{resourceEnvelopeProcesses:4,connectionBound:11,memoryBound:4,cpuBound:4,capacityCertified:false,
    note:"Use measured peak memory and CPU allocations under concurrent calls. Provider quotas, latency and event-loop thresholds can impose a lower limit."});
  assert.equal(preparationCapacityEnvelope({...profile,fixedConnectionMax:79}).resourceEnvelopeProcesses,0);
});
test("refuses to erase the safety margin",()=>assert.throws(()=>preparationCapacityEnvelope({...profile,memoryReserveFraction:0})));
