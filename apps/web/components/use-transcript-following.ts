"use client";

import { useCallback, useRef, useState } from "react";
import { createTranscriptFollower } from "@/lib/transcript-follower";

export function useTranscriptFollowing(enabled = true) {
  const [following, setFollowing] = useState(true);
  const controller = useRef<ReturnType<typeof createTranscriptFollower> | null>(null);
  const listRef = useCallback((node: HTMLDivElement | null) => {
    controller.current?.destroy();
    controller.current = node && enabled ? createTranscriptFollower(node, setFollowing) : null;
    if (node && enabled) setFollowing(true);
  }, [enabled]);
  return { following, listRef, follow: () => controller.current?.follow() };
}
