import { evaluateAppointmentCalendar } from "../appointments/appointment-calendar";
import {
  appointmentAuthorizationSchema,
  type AppointmentAuthorization
} from "@callassist/contracts";

export interface AppointmentProposal {
  operation: "book" | "confirm_existing";
  date: string;
  startTime: string;
  timeZone: string;
  serviceMatches: boolean;
  recipientMatches: boolean;
  requiresPaymentOrNewTerms: boolean;
  detailsConfirmed: boolean;
}

export type AppointmentRejectionReason =
  | "missing_authorization"
  | "invalid_authorization"
  | "invalid_arguments"
  | "invalid_clock"
  | "unconfirmed_details"
  | "operation_mismatch"
  | "service_mismatch"
  | "recipient_mismatch"
  | "financial_terms_not_allowed"
  | "time_zone_mismatch"
  | "outside_authorized_window"
  | "nonexistent_local_time"
  | "ambiguous_local_time"
  | "past_time";

type Rejection = { ok: false; reason: AppointmentRejectionReason };
type ParsedProposal = { ok: true; proposal: AppointmentProposal } | Rejection;
export type AppointmentValidationResult =
  | { ok: true; proposal: AppointmentProposal; startsAt: string }
  | Rejection;

const proposalFields = [
  "operation", "date", "startTime", "timeZone", "serviceMatches",
  "recipientMatches", "requiresPaymentOrNewTerms", "detailsConfirmed"
] as const;

export const APPOINTMENT_AUTHORIZATION_TOOL = {
  type: "function",
  name: "check_appointment",
  description: "Check one proposed appointment or personal meeting against the user's approved permission BEFORE committing to it. Use the recipient's explicit full date and start time after reading the details back; use the approved time zone unless a discrepancy needs clarification, without asking the recipient to name an IANA identifier. Ambiguous or unconfirmed replies must set detailsConfirmed false. serviceMatches means the approved purpose/service matches, including a personal meeting; recipientMatches means the intended person or organisation. These are your observations, not external verification. Payment, a deposit or new financial/cancellation terms require requiresPaymentOrNewTerms true. An accepted check is permission only: it does not arrange or verify an appointment.",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["book", "confirm_existing"] },
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Full local calendar date, YYYY-MM-DD; never infer an ambiguous relative date." },
      startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Exact local start time, HH:mm in 24-hour format." },
      timeZone: { type: "string", minLength: 1, maxLength: 100, description: "The exact approved IANA time zone for the agreed local start time. Clarify any conflicting zone mentioned by the recipient." },
      serviceMatches: { type: "boolean" },
      recipientMatches: { type: "boolean" },
      requiresPaymentOrNewTerms: { type: "boolean" },
      detailsConfirmed: { type: "boolean" }
    },
    required: proposalFields,
    additionalProperties: false
  }
} as const;

/** No coercion, omitted fields or additional claims are accepted from tool arguments. */
export function parseAppointmentProposal(raw: unknown): ParsedProposal {
  try {
    if (typeof raw === "string") {
      if (raw.length > 2_048) return reject("invalid_arguments");
      raw = JSON.parse(raw) as unknown;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("invalid_arguments");
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return reject("invalid_arguments");
    const fields = raw as Record<string, unknown>;
    const keys = Object.keys(fields);
    if (keys.length !== proposalFields.length || keys.some(key => !proposalFields.includes(key as typeof proposalFields[number]))) {
      return reject("invalid_arguments");
    }
    if (
      (fields.operation !== "book" && fields.operation !== "confirm_existing") ||
      typeof fields.date !== "string" || !isCalendarDate(fields.date) ||
      typeof fields.startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.startTime) ||
      typeof fields.timeZone !== "string" || fields.timeZone.length < 1 || fields.timeZone.length > 100 ||
      typeof fields.serviceMatches !== "boolean" || typeof fields.recipientMatches !== "boolean" ||
      typeof fields.requiresPaymentOrNewTerms !== "boolean" || typeof fields.detailsConfirmed !== "boolean"
    ) return reject("invalid_arguments");
    return { ok: true, proposal: {
      operation: fields.operation, date: fields.date, startTime: fields.startTime,
      timeZone: fields.timeZone, serviceMatches: fields.serviceMatches,
      recipientMatches: fields.recipientMatches, requiresPaymentOrNewTerms: fields.requiresPaymentOrNewTerms,
      detailsConfirmed: fields.detailsConfirmed
    } };
  } catch {
    return reject("invalid_arguments");
  }
}

/** Checks permission against model-supplied facts; never proves a booking exists. */
export function validateAppointmentProposal(input: {
  authorization: AppointmentAuthorization | null | undefined;
  proposal: unknown;
  now: Date;
}): AppointmentValidationResult {
  if (input.authorization == null) return reject("missing_authorization");
  const authorizationResult = appointmentAuthorizationSchema.safeParse(input.authorization);
  if (!authorizationResult.success) return reject("invalid_authorization");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) return reject("invalid_clock");
  const parsed = parseAppointmentProposal(input.proposal);
  if (!parsed.ok) return parsed;
  const { proposal } = parsed;
  const authorization = authorizationResult.data;
  if (!proposal.detailsConfirmed) return reject("unconfirmed_details");
  if (proposal.operation !== authorization.operation) return reject("operation_mismatch");
  if (!proposal.serviceMatches) return reject("service_mismatch");
  if (!proposal.recipientMatches) return reject("recipient_mismatch");
  if (proposal.requiresPaymentOrNewTerms) return reject("financial_terms_not_allowed");
  const calendar = evaluateAppointmentCalendar({ authorization, candidate: proposal, referenceAt: input.now.toISOString() });
  if (calendar.reason === "zone_conflict") return reject("time_zone_mismatch");
  if (calendar.eligibility === "outside") return reject("outside_authorized_window");
  if (calendar.reason === "nonexistent_local_time" || calendar.reason === "ambiguous_local_time") return reject(calendar.reason);
  if (calendar.eligibility !== "within" || !calendar.startsAt) return reject("invalid_authorization");
  if (calendar.pastAtReference) return reject("past_time");
  return { ok: true, proposal, startsAt: calendar.startsAt };
}

function reject(reason: AppointmentRejectionReason): Rejection {
  return { ok: false, reason };
}

function isCalendarDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}
