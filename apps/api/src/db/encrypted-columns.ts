// Keep rotation and restore verification on the same inventory. Feedback also
// needs special fingerprint handling in the rotation command.
export const genericCiphertextColumns = [
  ["call_briefs", "allowed_facts_ciphertext"],
  ["call_briefs", "context_ciphertext"],
  ["call_briefs", "compilation_ciphertext"],
  ["call_briefs", "assistance_reason_ciphertext"],
  ["call_briefs", "assistance_disclosure_ciphertext"],
  ["call_compilations", "compilation_ciphertext"],
  ["call_compilation_approvals", "execution_snapshot_ciphertext"],
  ["call_attempts", "execution_snapshot_ciphertext"],
  ["final_transcripts", "text_ciphertext"],
  ["final_transcripts", "segments_ciphertext"],
  ["final_transcript_revisions", "payload_ciphertext"],
  ["call_text_artifacts", "payload_ciphertext"],
  ["call_text_artifact_chunks", "payload_ciphertext"],
  ["call_plan_review_receipts", "payload_ciphertext"],
  ["post_call_transcription_chunks", "text_ciphertext"],
  ["call_preparation_requests", "input_ciphertext"]
] as const;

export const encryptedColumns = [
  ...genericCiphertextColumns,
  ["call_feedback_revisions", "comment_ciphertext"]
] as const;
