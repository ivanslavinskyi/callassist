"use client";
import { isLiveTranscript, supportedTextLanguage, type CallSnapshot } from "@callassist/contracts";
import { transcriptTabs } from "@/lib/i18n/transcript-tabs";
import { transcriptSourceDescription } from "@/lib/i18n/transcript-source-copy";
import { formatTranscriptOffset } from "@/lib/final-transcript-export";
import { CallResultPanel } from "./call-result-panel";
import { useUiLocale } from "./ui-locale-provider";

export function CallTranscriptResult({snapshot,userId,view,busy,onRequest,onViewRecording}:{
  snapshot:CallSnapshot;userId:string;view:"live"|"recording";busy:boolean;onRequest:()=>void;onViewRecording:()=>void;
}) {
  const {locale}=useUiLocale(),copy=transcriptTabs[locale];
  const audio=view==='recording';
  const transcript=audio ? snapshot.recordingTranscript : snapshot.finalTranscript;
  const revision=audio ? snapshot.recordingTranscriptRevision : snapshot.finalTranscriptRevision;
  const ready=transcript?.status==='completed';
  const failed=transcript?.status==='failed'||(audio&&snapshot.recordingTranscriptRequest?.status==='failed');
  const recording=snapshot.recording;
  const gaps=transcript?.quality?.issues.filter(issue=>issue.startMs!==undefined).map(issue=>
    `${formatTranscriptOffset(issue.startMs!/1000)}–${formatTranscriptOffset((issue.endMs??issue.startMs!)/1000)}`)??[];
  const available=recording?.status==='available' && (!recording.deleteAfter||Date.parse(recording.deleteAfter)>Date.now());
  const cachedSummary=!!snapshot.textArtifacts?.some(a=>a.kind==='call_summary'&&a.status==='ready'&&a.transcriptRevisionId===revision?.id);
  const historicalSummary=!audio && !!snapshot.recordingTranscriptRevision && !cachedSummary &&
    !!snapshot.textArtifacts?.some(a=>a.kind==='call_summary'&&a.status==='ready'&&a.transcriptRevisionId===snapshot.recordingTranscriptRevision?.id);
  return <section className="final-transcript-card">
    <div className="final-transcript-heading"><div><h2>{audio || (ready && !isLiveTranscript(transcript.source)) ? copy.audio : copy.live}</h2>
      <p className="transcript-subtitle">{audio?copy.explanation:ready?transcriptSourceDescription(locale,transcript.source):copy.empty}</p></div></div>
    {!audio && transcript?.quality?.coverage==='partial' ? <p role="status" className="transcript-warning">{copy.partial}{gaps.length?` (${[...new Set(gaps)].join(', ')})`:''}</p>:null}
    {historicalSummary ? <p>{copy.historical} <button className="text-button" onClick={onViewRecording}>{copy.viewResult}</button></p>:null}
    {ready && revision ? <CallResultPanel key={revision.id} brief={snapshot.brief} userId={userId} revision={revision}
      taskLanguage={snapshot.languageContext?.taskContentLanguage??supportedTextLanguage(snapshot.brief.locale)??'en'}
      promptLanguage={snapshot.languageContext?.detectedInputLanguage??null} initialArtifacts={snapshot.textArtifacts}
      appointmentAction={snapshot.appointmentAction} showSummary={audio?cachedSummary:!historicalSummary}
      allowSummaryGeneration={!audio && transcript.quality?.coverage !== 'unavailable'} /> : ready ? <div className="final-transcript-body"><p>{transcript.text||copy.empty}</p></div> : audio ?
      <div className="final-transcript-state" role="status">
        {failed ? <p>{copy.failed}</p>:null}
        {available && (!transcript || failed) ? <button className="secondary-button" type="button" disabled={busy} onClick={onRequest}>{failed?copy.retry:copy.request}</button>
          : !available ? <p>{copy.unavailable}</p> : <p>{copy.pending}</p>}
      </div> : <p role="status">{copy.empty}</p>}
    {!audio && ready && !isLiveTranscript(transcript.source) ? <p>{copy.historical}</p>:null}
  </section>;
}
