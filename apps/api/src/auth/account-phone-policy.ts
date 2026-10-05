import { isSwissDestinationPhone, type RegistrationPolicy } from "@callassist/contracts";
import type postgres from "postgres";
import { lockBetaControls } from "../beta/beta-controls";
import { AuthRepositoryError } from "./auth-repository";

export function assertAccountPhonePolicy(phone: string, policy?: Pick<RegistrationPolicy, "swissPhonesOnly">) {
  if (policy?.swissPhonesOnly && !isSwissDestinationPhone(phone)) {
    throw new AuthRepositoryError("SWISS_PHONE_REQUIRED");
  }
}

// Acquire policy before user/challenge locks, matching the admin policy update lock order.
export async function lockAccountPhonePolicy(tx: postgres.TransactionSql, enabled: boolean) {
  return enabled ? (await lockBetaControls(tx)).settings.registration : undefined;
}
