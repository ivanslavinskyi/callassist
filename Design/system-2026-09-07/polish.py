from pathlib import Path
R=Path(__file__).resolve().parent
p=R/'mock.js';s=p.read_text(encoding='utf-8')
s=s.replace("function themeTools(){", "function languageControl(){return ctx.id.startsWith('admin-')?'':`<select aria-label=\"${T('Interface language','Oberflächensprache')}\" data-language><option ${ctx.lang==='en'?'selected':''}>EN</option><option ${ctx.lang==='de'?'selected':''}>DE</option></select>`}\nfunction themeTools(){")
s=s.replace('<select aria-label="${T(\'Interface language\',\'Oberflächensprache\')}" data-language><option ${ctx.lang===\'en\'?\'selected\':\'\'}>EN</option><option ${ctx.lang===\'de\'?\'selected\':\'\'}>DE</option></select></div>`}', '${languageControl()}</div>`}')
s=s.replace("T('Dark','Dunkel')}</button></div>`:themeTools()", "T('Dark','Dunkel')}</button>${languageControl()}</div>`:themeTools()")
s=s.replace('<select aria-label="Language" data-language><option ${ctx.lang===\'en\'?\'selected\':\'\'}>EN</option><option ${ctx.lang===\'de\'?\'selected\':\'\'}>DE</option></select>', '${languageControl()}')
p.write_text(s,encoding='utf-8')
p=R/'admin.js';s=p.read_text(encoding='utf-8')
a=s.index("section('Other landing blocks'");b=s.index(';return `<nav class="subnav">',a)
s=s[:a]+"section('Other landing blocks',landingBlockEditors())"+s[b:]
s=s.replace("${localizedFields('Badges (one per line)'", "${localizedFields('Secondary text','For everyday calls when speaking or the local language is a barrier.','Für alltägliche Anrufe, wenn das Sprechen oder die lokale Sprache eine Hürde ist.','textarea')}${localizedFields('Badges (one per line)'")
s=s.replace("en,{type})}${field(label+' · DE',de,{type})", "en,{type,maxLength:type==='textarea'?2400:180})}${field(label+' · DE',de,{type,maxLength:type==='textarea'?2400:180})")
s+='''
function landingBlockEditors(){
 const text=(label,en,de)=>localizedFields(label,en,de,'textarea');
 const heading=(en,de)=>localizedFields('Title',en,de);
 const eyebrow=(en,de)=>localizedFields('Eyebrow',en,de);
 const item=(en,de,body,bodyDe)=>`<div class="editor-item"><h3>Content item</h3><div class="stack">${heading(en,de)}${text('Text',body,bodyDe)}${btn('Remove content item')}</div></div>`;
 const items=(rows,kind='content item')=>rows.map(r=>item(...r)).join('')+btn('Add '+kind);
 const blocks=[
 ['Problem / speaking and language',eyebrow('Why SHPROHLI','Warum SHPROHLI')+heading('When a simple call is not so simple','Wenn ein einfacher Anruf nicht so einfach ist')+items([
 ['When speaking is difficult','Wenn das Sprechen schwerfällt','Explain the task in writing, then review what the assistant will say.','Beschreiben Sie die Aufgabe schriftlich und prüfen Sie den Anrufplan.'],
 ['When the local language is a barrier','Wenn die lokale Sprache eine Hürde ist','Choose one of the supported call languages.','Wählen Sie eine der unterstützten Anrufsprachen.']])],
 ['Everyday use cases',eyebrow('Everyday calls','Alltägliche Anrufe')+heading('What have you been putting off?','Welchen Anruf schieben Sie auf?')+text('Text','Small practical calls, with a clear purpose.','Kleine praktische Anrufe mit einem klaren Ziel.')+items([
 ['Doctor’s practice','Arztpraxis','Ask about an appointment or opening hours.','Nach einem Termin oder den Öffnungszeiten fragen.'],
 ['Municipal office','Gemeinde','Check whether a form or document arrived.','Prüfen, ob ein Formular oder Dokument angekommen ist.'],
 ['School or course provider','Schule oder Kursanbieter','Ask about an administrative detail.','Eine organisatorische Frage klären.'],
 ['Landlord or repair service','Vermieter oder Reparaturdienst','Coordinate a practical appointment.','Einen praktischen Termin abstimmen.'],
 ['Insurance administration','Versicherungsverwaltung','Ask about the status of a document.','Nach dem Bearbeitungsstand eines Dokuments fragen.']])],
 ['Example request and result',heading('One request. A useful answer.','Ein Anliegen. Eine hilfreiche Antwort.')+items([
 ['Your request','Ihr Anliegen','Call the municipal office and check whether my residence form has arrived.','Bei der Gemeinde anrufen und fragen, ob mein Aufenthaltsformular angekommen ist.'],
 ['The result','Das Ergebnis','The form arrived. A passport copy is missing and can be sent by email.','Das Formular ist angekommen. Eine Passkopie fehlt und kann per E-Mail nachgereicht werden.']])],
 ['How it works',eyebrow('How it works','So funktioniert es')+heading('You stay in control','Sie behalten die Kontrolle')+items([
 ['Describe your request','Anliegen beschreiben','Enter the recipient, number and purpose.','Empfänger, Nummer und Anliegen eingeben.'],
 ['Review the plan','Plan prüfen','Check the prepared wording and approved facts.','Formulierungen und freigegebene Informationen prüfen.'],
 ['Approve the call','Anruf freigeben','The assistant calls after your confirmation.','Der Assistent ruft nach Ihrer Bestätigung an.'],
 ['Read the result','Ergebnis lesen','Review the transcript and give feedback.','Transkript lesen und Feedback geben.']], 'step')],
 ['Control and transparency',eyebrow('Control and transparency','Kontrolle und Transparenz')+heading('Clear consent. Clear limits.','Klare Zustimmung. Klare Grenzen.')+text('Text','The assistant identifies itself and asks the recipient for consent. Review every call and check the result: AI can make mistakes.','Der Assistent stellt sich vor und bittet die angerufene Person um Zustimmung. Prüfen Sie jeden Anruf und das Ergebnis: KI kann Fehler machen.')+localizedFields('Limits title','What SHPROHLI is not for','Wofür SHPROHLI nicht gedacht ist')+text('Limits (one per line)','Emergencies\\nHarassment\\nMass marketing\\nHigh-risk decisions','Notfälle\\nBelästigung\\nMassenwerbung\\nEntscheidungen mit hohem Risiko')],
 ['Languages',heading('Choose the language for your call','Wählen Sie die Sprache für Ihren Anruf')+text('Text','Swiss German, German, French, Italian, British English, American English and Russian. The interface is available in English and German.','Schweizerdeutsch, Deutsch, Französisch, Italienisch, britisches Englisch, amerikanisches Englisch und Russisch. Die Oberfläche ist auf Englisch und Deutsch verfügbar.')],
 ['FAQ selection',eyebrow('Questions','Fragen')+heading('Before your first call','Vor Ihrem ersten Anruf')+field('Number of FAQ items','8',{type:'number',help:'1–12 items from the published FAQ collection.'})],
 ['Final CTA',heading('That call you have been putting off?','Der Anruf, den Sie aufschieben?')+text('Text','Try SHPROHLI with 3 included calls during the free public beta.','Testen Sie SHPROHLI mit 3 enthaltenen Anrufen während der kostenlosen öffentlichen Beta.')+localizedFields('Primary CTA','Create your account','Konto erstellen')]
 ];
 return `<div class="stack tight">${blocks.map(([name,body])=>`<details class="disclosure"><summary>${name}</summary><div class="stack">${check('Enabled',true)}<div class="row">${btn('Move up')}${btn('Move down')}${badge('Fixed block type','neutral')}</div>${form(body+submit('Save draft'),'landing')}</div></details>`).join('')}</div>`;
}
'''
p.write_text(s,encoding='utf-8')
print('Refined language controls and all eight typed editorial block editors.')
