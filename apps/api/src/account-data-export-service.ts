import {
  ACCOUNT_DATA_EXPORT_SCHEMA_VERSION,
  accountDataExportSchema,
  type AccountDataExport,
  type CallSnapshot,
  type User
} from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import type { AuthService } from "./auth/auth-service";
import type { ContentRepository } from "./content/content-repository";
import type { CallRepository } from "./storage/call-repository";

const exportCallPageSize = 100;

export class AccountDataExportService {
  readonly #authService: AuthService;
  readonly #callRepository: CallRepository;
  readonly #contentRepository: ContentRepository;
  readonly #now: () => Date;

  constructor(options: {
    authService: AuthService;
    callRepository: CallRepository;
    contentRepository: ContentRepository;
    now?: () => Date;
  }) {
    this.#authService = options.authService;
    this.#callRepository = options.callRepository;
    this.#contentRepository = options.contentRepository;
    this.#now = options.now ?? (() => new Date());
  }

  async generate(user: User, currentSessionId: string): Promise<AccountDataExport> {
    const exportId = randomUUID();
    const generatedAt = this.#now().toISOString();
    const [activeSessions, credits, onboardingAcceptances, calls] = await Promise.all([
      this.#authService.listSessions(user.id, currentSessionId),
      this.#callRepository.getCreditUsage(user.id),
      this.#contentRepository.listOnboardingAcceptances(user.id),
      this.#listCalls(user.id)
    ]);
    const data = accountDataExportSchema.parse({
      schemaVersion: ACCOUNT_DATA_EXPORT_SCHEMA_VERSION,
      exportId,
      generatedAt,
      account: user,
      activeSessions,
      credits: sanitizeCredits(credits),
      onboardingAcceptances,
      calls: calls.map(({ snapshot, outcome }) => ({
        snapshot: sanitizeSnapshot(snapshot),
        outcome: {
          ...outcome,
          latestOutcome: outcome.latestOutcome ? {
            ...outcome.latestOutcome,
            actorUserId: outcome.latestOutcome.actorUserId === user.id
              ? user.id
              : null
          } : null
        }
      }))
    });
    await this.#authService.repository.recordAccountDataExport({
      exportId,
      userId: user.id,
      schemaVersion: data.schemaVersion,
      callCount: data.calls.length,
      byteCount: Buffer.byteLength(JSON.stringify(data), "utf8"),
      createdAt: generatedAt
    });
    return data;
  }

  async #listCalls(userId: string) {
    const result: Array<{
      snapshot: NonNullable<Awaited<ReturnType<CallRepository["get"]>>>;
      outcome: Awaited<ReturnType<CallRepository["getCallOutcome"]>>;
    }> = [];
    let cursor: { createdAt: string; id: string } | undefined;
    do {
      const page = await this.#callRepository.list({
        userId,
        limit: exportCallPageSize,
        cursor
      });
      const records = await Promise.all(page.items.map(async (brief) => {
        const snapshot = await this.#callRepository.get(brief.id);
        if (!snapshot || !(await this.#callRepository.isOwnedBy(brief.id, userId))) {
          return null;
        }
        return {
          snapshot,
          outcome: await this.#callRepository.getCallOutcome(brief.id)
        };
      }));
      result.push(...records.filter((record) => record !== null));
      const last = page.items.at(-1);
      cursor = page.nextCursor && last
        ? { createdAt: last.createdAt, id: last.id }
        : undefined;
      if (!page.nextCursor) break;
    } while (cursor);
    return result;
  }
}

function sanitizeSnapshot(snapshot: CallSnapshot): CallSnapshot {
  return {
    ...snapshot,
    compilation: snapshot.compilation ? {
      ...snapshot.compilation,
      compilerResponseId: null
    } : null,
    recording: snapshot.recording ? {
      ...snapshot.recording,
      providerRecordingId: null
    } : null
  };
}

function sanitizeCredits(
  credits: Awaited<ReturnType<CallRepository["getCreditUsage"]>>
) {
  return {
    ...credits,
    transactions: credits.transactions.map((transaction) => ({
      ...transaction,
      adminId: null
    }))
  };
}
