import type { AdminCallPreparationInspector, PreparationRequestTrace } from "@callassist/contracts";

const seconds = (ms: number | null | undefined) => ms == null ? "Unknown" : `${(Math.max(0, ms) / 1000).toFixed(3)} s`;
const count = (value: number | null | undefined) => value == null ? "Unknown" : String(value);

type TimingInspector = Pick<AdminCallPreparationInspector, "preparation" | "generatedAt" | "timeline" | "workerAttempts" | "initialQueueMs">;
export function AdminPreparationTiming({ inspector }: { inspector: TimingInspector }) {
  const { preparation, timeline = [], workerAttempts = [] } = inspector;
  const origin = Date.parse(preparation.createdAt);
  const elapsed = Date.parse(preparation.completedAt ?? inspector.generatedAt) - origin;
  const measured = timeline.reduce((sum, request) => sum + (request.durationMs ?? 0), 0);
  const retryGap = workerAttempts.slice(1).reduce((sum, attempt, index) => {
    const previousEnd = workerAttempts[index]?.completedAt;
    return sum + (previousEnd ? Math.max(0, Date.parse(attempt.startedAt) - Date.parse(previousEnd)) : 0);
  }, 0);
  return <section className="admin-inspector-summary" aria-labelledby="preparation-timing-title">
    <h2 id="preparation-timing-title">Preparation timing</h2>
    <p>Times cover preparation through plan publication. Review translation and browser polling may finish afterward.
      Historical requests may lack transport details or stage labels. Unknown means unobserved, not zero.</p>
    <dl>
      <Fact label="Preparation elapsed" value={seconds(elapsed)} />
      <Fact label="Initial queue wait" value={seconds(inspector.initialQueueMs)} />
      <Fact label="Recorded provider time" value={seconds(measured)} />
      <Fact label="Recorded gaps between worker attempts" value={workerAttempts.length ? seconds(retryGap) : "Unknown"} />
    </dl>
    {workerAttempts.length ? <div style={{ overflowX: "auto" }}><table>
      <caption>Worker attempts (includes provider time and local work)</caption>
      <thead><tr><th>Generation / attempt</th><th>Started after</th><th>Elapsed</th><th>Gap after previous attempt</th><th>Outcome</th></tr></thead>
      <tbody>{workerAttempts.map((attempt, index) => {
        const previous = workerAttempts[index - 1];
        return <tr key={`${attempt.generation}:${attempt.attemptNumber}`}>
          <td>{attempt.generation} / {attempt.attemptNumber}</td>
          <td>{seconds(Date.parse(attempt.startedAt) - origin)}</td>
          <td>{seconds(attempt.completedAt ? Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt) : null)}</td>
          <td>{index === 0 ? "—" : seconds(previous?.completedAt ? Date.parse(attempt.startedAt) - Date.parse(previous.completedAt) : null)}</td>
          <td>{attempt.outcome ?? "In progress"}{attempt.errorCode ? <><br /><code>{attempt.errorCode}</code></> : null}</td>
        </tr>;
      })}</tbody>
    </table></div> : <p>No worker attempt records retained.</p>}
    {timeline.length ? <div style={{ overflowX: "auto" }}><table>
      <caption>Provider requests in execution order</caption>
      <thead><tr><th>Stage / model</th><th>Started after</th><th>Duration</th><th>Outcome</th><th>Attempt / repair</th><th>Diagnostics</th></tr></thead>
      <tbody>{timeline.map((request, index) => <tr key={request.id}>
        <td>{request.stage.replaceAll("_", " ")}<br /><small>{request.model}</small></td>
        <td>{seconds(Date.parse(request.startedAt) - origin)}</td>
        <td>{request.durationMs === null ? "Pending / unknown" : seconds(request.durationMs)}</td>
        <td>{request.outcome ?? "No final response"}{request.errorCode ? <><br /><code>{request.errorCode}</code></> : null}</td>
        <td>{request.metadata ? `${request.metadata.transportAttempt} / ${request.metadata.repairKind} ${request.metadata.repairNumber}` : "Not recorded"}</td>
        <td><RequestDetails request={request} previous={timeline[index - 1]} /></td>
      </tr>)}</tbody>
    </table></div> : <p>No provider timing records retained.</p>}
    <p>Transport offsets start at dispatch, after the database reservation. They overlap and must not be added together.
      Time to headers includes network and provider waiting; it does not identify the provider’s internal queue.
      Gaps between requests can include validation, database writes and worker retries.</p>
  </section>;
}

function RequestDetails({ request, previous }: { request: PreparationRequestTrace; previous?: PreparationRequestTrace }) {
  const data = request.diagnostics;
  const afterSend = data?.responseHeadersMs != null && data.requestBodySentMs != null
    && data.responseHeadersMs >= data.requestBodySentMs ? data.responseHeadersMs - data.requestBodySentMs : null;
  return <details><summary>Request details</summary><dl>
    <Fact label="Client request ID" value={request.clientRequestId ?? "Unknown"} />
    <Fact label="Provider request ID" value={request.providerRequestId ?? "Unknown"} />
    <Fact label="HTTP status" value={count(request.statusCode)} />
    <Fact label="Worker generation" value={count(request.generation)} />
    <Fact label="Gap since previous response" value={seconds(previous?.completedAt ? Date.parse(request.startedAt) - Date.parse(previous.completedAt) : null)} />
    <Fact label="Database reservation" value={seconds(data?.reservationMs)} />
    <Fact label="Actual request timeout" value={seconds(data?.actualTimeoutMs)} />
    <Fact label="Request size (bytes)" value={count(data?.requestBytes)} />
    <Fact label="Request created at" value={seconds(data?.requestCreatedMs)} />
    <Fact label="Socket write began at" value={seconds(data?.socketWriteMs)} />
    <Fact label="Request body sent at" value={seconds(data?.requestBodySentMs)} />
    <Fact label="Response headers at" value={seconds(data?.responseHeadersMs)} />
    <Fact label="Wait after body sent" value={seconds(afterSend)} />
    <Fact label="Response body read / parse" value={seconds(data?.bodyReadMs)} />
    <Fact label="Provider processing (reported)" value={seconds(data?.providerProcessingMs)} />
    <Fact label="Transport failure phase" value={data?.failurePhase?.replaceAll("_", " ") ?? "None observed / unknown"} />
    <Fact label="Network error code" value={data?.networkErrorCode ?? "None observed / unknown"} />
    <Fact label="Rate limit remaining requests / tokens" value={`${count(data?.remainingRequests)} / ${count(data?.remainingTokens)}`} />
    <Fact label="Input / cached input tokens" value={`${count(request.tokens?.input)} / ${count(request.tokens?.cachedInput)}`} />
    <Fact label="Output / reasoning tokens" value={`${count(request.tokens?.output)} / ${count(request.tokens?.reasoning)}`} />
  </dl>{data ? null : <p>Transport diagnostics were not recorded for this request.</p>}</details>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
