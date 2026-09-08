import type { CreateCallBriefInput, User } from "@callassist/contracts";

export type ProfileName = Pick<User, "firstName" | "lastName">;

/** Stored plans take precedence, including empty fields requiring correction. */
export function representedPersonDefaults(
  initialValue?: CreateCallBriefInput,
  profile?: ProfileName
) {
  return {
    representedPersonFirstName: initialValue
      ? initialValue.representedPersonFirstName
      : profile?.firstName ?? "",
    representedPersonLastName: initialValue
      ? initialValue.representedPersonLastName
      : profile?.lastName ?? ""
  };
}
