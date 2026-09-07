from pathlib import Path
import re
R=Path(__file__).resolve().parents[1].parent; C=R/'apps/web/components'
p=R/'apps/web/app/layout.tsx';s=p.read_text(encoding='utf-8').replace('import "./globals.css";','import "./globals.css";\nimport "./emerald-paper.css";');p.write_text(s,encoding='utf-8')
p=R/'apps/web/app/globals.css';s=p.read_text(encoding='utf-8');start=s.index(':root[data-theme="dark"] {');end=s.index('@media (max-width: 980px)',start);s=s[:start]+s[end:];p.write_text(s,encoding='utf-8')
p=C/'auth-forms.tsx';s=p.read_text(encoding='utf-8').replace('import { AppShell }','import { designMessages } from "@/lib/i18n/design-messages";\nimport { AppShell }',1)
s=s.replace('function AuthFrame({ children }: { children: ReactNode }) {\n  return (','function AuthFrame({ children }: { children: ReactNode }) {\n  const { locale } = useUiLocale();\n  const design = designMessages[locale];\n  return (')
s=s.replace('<main className="auth-page" id="main-content">','''<main className="auth-page" id="main-content" tabIndex={-1}>
        <aside className="auth-aside">
          <span className="eyebrow">SHPROHLI</span>
          <h2>{design.authTitle}</h2><p>{design.authLead}</p>
          <div className="auth-aside-note"><p>{design.authCredits}</p><small>{design.authScope}</small></div>
        </aside>''')
p.write_text(s,encoding='utf-8')
p=C/'public-home.tsx';s=p.read_text(encoding='utf-8').replace('import { FaqList }','import { designMessages } from "@/lib/i18n/design-messages";\nimport { FaqList }',1)
s=s.replace('          block={block}','          block={block}\n          exampleSteps={landing.blocks.find(item => item.blockType === "how_it_works")?.steps.slice(0, 3) ?? []}')
s=s.replace('function LandingBlockView({ block, faq, locale, registerHref }: {','function LandingBlockView({ block, faq, locale, registerHref, exampleSteps }: {\n  exampleSteps: Array<{ id: string; title: string; text: string }>;')
s=s.replace('<section className="public-hero">','<section className="public-hero">\n          <div className="public-hero-copy">',1)
end=s.index('        </section>',s.index('case "hero":'))
s=s[:end]+'''          </div>
          <aside className="hero-example" aria-label={designMessages[locale].example}>
            <span className="eyebrow">{designMessages[locale].example}</span>
            <h3>{designMessages[locale].exampleRecipient}</h3><p>{designMessages[locale].exampleGoal}</p>
            <ol>{exampleSteps.map(step => <li key={step.id}><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>
          </aside>
'''+s[end:]
p.write_text(s,encoding='utf-8')
p=C/'create-call-form.tsx';s=p.read_text(encoding='utf-8').replace('import { RecipientCombobox }','import { designMessages } from "@/lib/i18n/design-messages";\nimport { RecipientCombobox }',1)
s=s.replace('  heading?: string;','  heading?: string;\n  headingLevel?: 1 | 2;').replace('  heading,','  heading,\n  headingLevel = 2,',1)
s=s.replace('  const { messages } = useUiLocale();','  const { messages, locale: uiLocale } = useUiLocale();\n  const design = designMessages[uiLocale];\n  const Heading = headingLevel === 1 ? "h1" : "h2";',1)
s=s.replace('<h2>{resolvedHeading}</h2>','<Heading>{resolvedHeading}</Heading>\n          <p>{design.formLead}</p>')
s=s.replace('<div className="form-grid">\n        <RecipientCombobox','<div className="form-grid">\n        <div className="form-section-title">{design.recipient}</div>\n        <div className="field-wide"><RecipientCombobox',1)
st=s.index('<div className="field-wide"><RecipientCombobox');end=s.index('        />',st);s=s[:end]+s[end:].replace('        />','        /></div>',1)
s=s.replace('        <label className="field field-wide">\n          <span>{copy.objective}</span>','        <div className="form-section-title">{design.task}</div>\n        <label className="field field-wide">\n          <span>{copy.objective}</span>',1)
s=s.replace('        <label className="field">\n          <span>{copy.assistant}</span>','        <div className="form-section-title">{design.assistant}</div>\n        <label className="field">\n          <span>{copy.assistant}</span>',1)
p.write_text(s,encoding='utf-8')
p=C/'dashboard.tsx';s=p.read_text(encoding='utf-8');start=s.index('        <section className="hero-block">');end=s.index('        <div className="dashboard-grid">',start)
s=s[:start]+'''        <nav className="workspace-tabs" aria-label={messages.app.newCall + " / " + messages.app.history}>
          <button type="button" aria-pressed={panel === "new-call"} onClick={() => choosePanel("new-call")}>{messages.app.newCall}</button>
          <button type="button" aria-pressed={panel === "history"} onClick={() => choosePanel("history")}>{messages.app.history}</button>
        </nav>
'''+s[end:]
s=s.replace('<main className="dashboard-page"','<main data-panel={panel} className="dashboard-page"',1).replace('<CreateCallForm onCreated=','<CreateCallForm headingLevel={1} onCreated=',1)
start=s.index('  const requestId = useRef(0);')+len('  const requestId = useRef(0);')
s=s[:start]+'''
  const [panel, setPanel] = useState<"new-call" | "history">("new-call");
  function choosePanel(next: "new-call" | "history") {
    setPanel(next);
    window.history.replaceState(null, "", `${location.pathname}${location.search}#${next}`);
  }
  useEffect(() => {
    const sync = () => setPanel(location.hash === "#history" ? "history" : "new-call");
    const click = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (!link) return;
      const url = new URL(link.href);
      if (url.pathname === location.pathname && ["#history", "#new-call"].includes(url.hash)) setPanel(url.hash === "#history" ? "history" : "new-call");
    };
    sync(); window.addEventListener("hashchange", sync); document.addEventListener("click", click);
    return () => { window.removeEventListener("hashchange", sync); document.removeEventListener("click", click); };
  }, []);
'''+s[start:]
p.write_text(s,encoding='utf-8')
p=C/'call-feedback.tsx';s=p.read_text(encoding='utf-8').replace('<section className="call-feedback-card"','<section id="call-feedback" className="call-feedback-card"');p.write_text(s,encoding='utf-8')
p=C/'live-call.tsx';s=p.read_text(encoding='utf-8').replace('import { CallFeedback }','import { designMessages } from "@/lib/i18n/design-messages";\nimport { CallFeedback }',1)
s=s.replace('  const [showFullObjective, setShowFullObjective] = useState(false);','  const [showFullObjective, setShowFullObjective] = useState(false);\n  const [transcriptView, setTranscriptView] = useState<"final" | "provisional">("final");')
s=s.replace('<main className="live-page"','<main data-terminal={isTerminal} className="live-page"',1)
s=s.replace('<div className="transcript-column">','''<div className="transcript-column">
            {isTerminal && brief.status !== "blocked" ? <nav className="transcript-version-nav" aria-label={copy.finalTitle}>
              <button type="button" aria-pressed={transcriptView === "final"} onClick={() => setTranscriptView("final")}>{copy.finalTitle}</button>
              <button type="button" aria-pressed={transcriptView === "provisional"} onClick={() => setTranscriptView("provisional")}>{uiLocale === "de" ? "Vorläufiges Transkript" : "Provisional transcript"}</button>
              <a href="#call-feedback">{designMessages[uiLocale].rateCall}</a>
            </nav> : null}''',1)
s=s.replace('<section className="transcript-card" ref={transcriptCardRef}>','<section className="transcript-card" hidden={isTerminal && transcriptView !== "provisional"} ref={transcriptCardRef}>',1)
s=s.replace('<h2>{copy.liveCaptions}</h2>','<h2>{isTerminal ? (uiLocale === "de" ? "Vorläufiges Transkript" : "Provisional transcript") : copy.liveCaptions}</h2>',1)
s=s.replace('<section className="final-transcript-card">','<section className="final-transcript-card" hidden={isTerminal && transcriptView !== "final"}>',1)
st=s.index('              {recording ? (');end=s.index('            </section>',st);recording=s[st:end];s=s[:st]+s[end:]
st=s.index('            {isTerminalCallStatus(brief.status) && brief.status !== "blocked" ? (');end=s.index('          </div>\n\n          <aside className="call-sidebar">',st);terminal=s[st:end];s=s[:st]+s[end:]
# Recording and feedback remain mounted when transcript tabs change.
s=s.replace('<aside className="call-sidebar">','<aside className="call-sidebar">\n            <section className="recording-section">'+recording+'            </section>\n'+terminal,1)
p.write_text(s,encoding='utf-8')
print('Page structures migrated, domain handlers retained.')
