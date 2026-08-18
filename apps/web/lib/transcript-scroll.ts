export function isNearTranscriptBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 48
) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}
