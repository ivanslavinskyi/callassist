import { testScenarioSchema, testingAccessSchema, type TestScenarioInput } from "@callassist/contracts";
import { apiRequest } from "./api";
export async function getTestingAccess(userId?: string) {
  return testingAccessSchema.parse(await apiRequest(userId ? `/api/admin/users/${encodeURIComponent(userId)}/testing-access` : "/api/testing/access", {cache:"no-store"}));
}
export async function setTestingAccess(userId: string, enabled: boolean, expectedRevision: number) {
  return testingAccessSchema.parse(await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/testing-access`, {method:"PUT",body:JSON.stringify({enabled,expectedRevision})}));
}
export async function listTestScenarios(admin = false) {
  return testScenarioSchema.array().parse(await apiRequest(admin ? "/api/admin/testing/scenarios" : "/api/testing/scenarios",{cache:"no-store"}));
}
export async function saveTestScenario(id: string | null, input: TestScenarioInput, expectedRevision: number) {
  return testScenarioSchema.parse(await apiRequest(`/api/admin/testing/scenarios${id ? `/${id}` : ""}`, {method:id?"PUT":"POST",body:JSON.stringify({...input,expectedRevision})}));
}
