"use client";

import type { CallTextArtifact } from "@callassist/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { listCallTextArtifacts } from "@/lib/api";

const empty: CallTextArtifact[] = [];

export function useCallTextArtifacts(callId: string, initial: CallTextArtifact[] = empty) {
  const [items, setItems] = useState(initial);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [pollingGeneration, setPollingGeneration] = useState(0);
  const readVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readVersion.current += 1; };
  }, [callId]);
  useEffect(() => {
    setItems((current) => mergeArtifacts(current, initial.filter((item) => item.callId === callId)));
  }, [callId, initial]);
  const remember = useCallback((artifact: CallTextArtifact) => {
    if (artifact.callId !== callId || !mounted.current) return;
    readVersion.current += 1;
    setItems((current) => mergeArtifacts(current, [artifact]));
    setPollingPaused(false);
  }, [callId]);
  const read = useCallback(async (resumePolling: boolean) => {
    const version = ++readVersion.current;
    const result = await listCallTextArtifacts(callId);
    if (mounted.current && version === readVersion.current) {
      setItems(result.items.filter((item) => item.callId === callId));
      setPollingPaused(false);
      if (resumePolling) setPollingGeneration((generation) => generation + 1);
    }
  }, [callId]);
  const refresh = useCallback(() => read(true), [read]);
  const pendingKey = items.filter((item) => item.status === "queued" || item.status === "processing")
    .map((item) => item.id).sort().join(":");
  useEffect(() => {
    const onFocus = () => { void refresh().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus); };
  }, [refresh]);
  useEffect(() => {
    if (!pendingKey) { setPollingPaused(false); return; }
    let attempts = 0;
    let running = false;
    const timer = window.setInterval(() => {
      if (running) return;
      if (++attempts > 60) {
        window.clearInterval(timer);
        setPollingPaused(true);
        return;
      }
      running = true;
      void read(false).catch(() => undefined).finally(() => { running = false; });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [pendingKey, read, pollingGeneration]);
  return { items, remember, refresh, pollingPaused };
}

function mergeArtifacts(current: CallTextArtifact[], incoming: CallTextArtifact[]) {
  const versions = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const previous = versions.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt) versions.set(item.id, item);
  }
  return [...versions.values()];
}
