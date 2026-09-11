/** Delta and final events identify the same content part, not the whole response. */
export function transcriptPartKey(session: string, role: "assistant" | "recipient", event: {
  response_id?: string; item_id?: string; content_index?: number; output_index?: number;
}) {
  return JSON.stringify([session, role, event.response_id ?? null, event.item_id ?? null,
    event.output_index ?? 0, event.content_index ?? 0]);
}
