import type { User } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSessionStore, sessionForUser, type SessionSnapshot } from "./session-state";

const authenticated: SessionSnapshot = {
  status: "authenticated", user: { id: "user-1", role: "user", emailVerified: true }
};

function deferred() {
  let resolve!: (value: SessionSnapshot) => void;
  const promise = new Promise<SessionSnapshot>(done => { resolve = done; });
  return { promise, resolve };
}

describe("shared session state", () => {
  it("only exposes the identity fields needed by the shell", () => {
    expect(sessionForUser({
      id: "user-1", role: "user", emailVerifiedAt: "2026-09-16T00:00:00Z",
      email: "private@example.com", phoneE164: "+41791234567"
    } as User)).toEqual(authenticated);
    expect(sessionForUser(null)).toEqual({ status: "anonymous" });
  });

  it("keeps the server snapshot during hydration and coalesces simultaneous refreshes", async () => {
    const request = deferred();
    const load = vi.fn(() => request.promise);
    const store = createSessionStore(authenticated, load);
    const first = store.refresh();
    const second = store.refresh();
    expect(first).toBe(second);
    expect(store.getSnapshot()).toBe(authenticated);
    expect(store.getServerSnapshot()).toBe(authenticated);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    request.resolve({ status: "anonymous" });
    await first;
    expect(store.getSnapshot().status).toBe("anonymous");
    expect(store.getServerSnapshot()).toBe(authenticated);
  });

  it("never turns an unavailable session check into a guest and allows retry", async () => {
    const load = vi.fn<() => Promise<SessionSnapshot>>()
      .mockRejectedValueOnce(new Error("API unavailable"))
      .mockResolvedValueOnce(authenticated);
    const store = createSessionStore(authenticated, load);
    await store.refresh();
    expect(store.getSnapshot().status).toBe("unavailable");
    const retry = store.refresh();
    expect(store.getSnapshot().status).toBe("loading");
    await retry;
    expect(store.getSnapshot()).toBe(authenticated);
  });

  it("ignores a successful response that arrives after the session ended", async () => {
    const request = deferred();
    const store = createSessionStore(authenticated, () => request.promise);
    const pending = store.refresh();
    store.endSession();
    request.resolve(authenticated);
    await pending;
    expect(store.getSnapshot().status).toBe("anonymous");
  });

  it("does not let an older request replace or clear a newer refresh", async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    const load = vi.fn().mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const store = createSessionStore(authenticated, load);
    const first = store.refresh();
    await Promise.resolve();
    store.endSession();
    const second = store.refresh();
    oldRequest.resolve(authenticated);
    await first;
    expect(store.refresh()).toBe(second);
    expect(store.getSnapshot().status).toBe("anonymous");
    const otherUser: SessionSnapshot = { status: "authenticated", user: { ...authenticated.user, id: "user-2" } };
    newRequest.resolve(otherUser);
    await second;
    expect(store.getSnapshot()).toEqual(otherUser);
  });

  it("notifies all consumers and keeps separate shells isolated", async () => {
    const store = createSessionStore(authenticated, async () => ({ status: "anonymous" }));
    const another = createSessionStore(authenticated, async () => authenticated);
    const shellListener = vi.fn();
    const ctaListener = vi.fn();
    store.subscribe(shellListener);
    const unsubscribe = store.subscribe(ctaListener);
    await store.refresh();
    expect(shellListener).toHaveBeenCalledTimes(1);
    expect(ctaListener).toHaveBeenCalledTimes(1);
    expect(another.getSnapshot()).toBe(authenticated);
    unsubscribe();
    store.endSession();
    expect(ctaListener).toHaveBeenCalledTimes(1);
  });
});
