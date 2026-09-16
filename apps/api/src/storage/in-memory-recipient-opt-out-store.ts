import { randomUUID } from "node:crypto";
import { recipientContactHash, recipientContactHashKey, recipientOptOutReason, type OptOutChallengeInput, type RecipientOptOutStore } from "../safety/recipient-opt-out-store";

type Challenge = { hash: string; createdAt: number; expiresAt: number; sent: boolean; attempts: number; claimId?: string; claimUntil?: number; consumed?: boolean };
export class InMemoryRecipientOptOutStore implements RecipientOptOutStore {
  private readonly key = recipientContactHashKey();
  private readonly contacts = new Set<string>();
  private readonly challenges = new Map<string, Challenge>();
  constructor(private readonly suppressed: (phone: string) => boolean,
    private readonly suppress: (phone: string, reason: string) => Promise<boolean>, private readonly now = Date.now) {}
  hash(phone: string) { return recipientContactHash(phone, this.key); }
  recordContact(hash: string) { this.contacts.add(hash); }
  async backfill() {}
  private eligible(phone: string) { return this.contacts.has(this.hash(phone)) && !this.suppressed(phone); }
  async reserve(input: OptOutChallengeInput) {
    const now = this.now();
    for (const [token, challenge] of this.challenges) if (challenge.expiresAt<=now) this.challenges.delete(token);
    if (!this.eligible(input.phoneE164)) return false;
    const hash = this.hash(input.phoneE164);
    if ([...this.challenges.values()].some(c=>c.hash===hash && c.createdAt>now-60_000)) return false;
    for (const [token,c] of this.challenges) if(c.hash===hash) this.challenges.delete(token);
    this.challenges.set(input.tokenHash,{hash,createdAt:now,expiresAt:now+600_000,sent:false,attempts:0});
    return true;
  }
  async activate(input: OptOutChallengeInput) {
    const c=this.challenges.get(input.tokenHash);
    if(c?.hash===this.hash(input.phoneE164) && c.expiresAt>this.now()) c.sent=true;
  }
  async claim(input: OptOutChallengeInput) {
    const c=this.challenges.get(input.tokenHash), now=this.now();
    if(!this.eligible(input.phoneE164) || !c || c.hash!==this.hash(input.phoneE164) || !c.sent || c.consumed || c.expiresAt<=now || c.attempts>=8 || (c.claimUntil??0)>now) return null;
    c.attempts++; c.claimId=randomUUID(); c.claimUntil=now+30_000;
    return c.claimId;
  }
  async finish(input: OptOutChallengeInput, claimId: string, approved: boolean) {
    const c=this.challenges.get(input.tokenHash), now=this.now();
    if(!c || c.hash!==this.hash(input.phoneE164) || c.claimId!==claimId || c.consumed || c.expiresAt<=now || (c.claimUntil??0)<=now) return false;
    delete c.claimId; delete c.claimUntil;
    if(!approved) return false;
    c.consumed=true;
    if(!this.contacts.has(this.hash(input.phoneE164))) return false;
    if(this.suppressed(input.phoneE164)) return true;
    return this.suppress(input.phoneE164,recipientOptOutReason);
  }
}
