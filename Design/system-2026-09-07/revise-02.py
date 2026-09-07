from pathlib import Path
import json,hashlib
R=Path(__file__).resolve().parent
icons={name:(R/f'assets/heroicons/{name}.svg').read_text(encoding='utf-8').strip() for name in ['sun','moon','bars-3','x-mark']}
(R/'icons.js').write_text('// Heroicons 2.2.0 outline, MIT, Tailwind Labs. Original SVG paths; see assets/heroicons/LICENSE.\nwindow.HERO_ICONS='+json.dumps(icons)+';\n',encoding='utf-8')
(R/'assets/heroicons/provenance.json').write_text(json.dumps({'library':'Heroicons','version':'2.2.0','style':'24 outline','license':'MIT','source':'https://github.com/tailwindlabs/heroicons/tree/v2.2.0/optimized/24/outline','sha256':{n:hashlib.sha256((R/f'assets/heroicons/{n}.svg').read_bytes()).hexdigest() for n in icons}},indent=2),encoding='utf-8')
p=R/'mock.html';s=p.read_text(encoding='utf-8').replace('<script src="mock.js">','<script src="icons.js"></script><script src="mock.js">');p.write_text(s,encoding='utf-8')
p=R/'registry.js';s=p.read_text(encoding='utf-8')
done=['completed','provisional','transcribing','transcript-failed','no-recording','recording-deleted','delete-recording','delete-call','feedback-saved']
old="['review','edit','clarification','blocked','confirm-start','dialing','live','approval','reconnecting','completed','transcribing','transcript-failed','no-recording','recording-deleted','failed','stopped','archived','delete-recording','delete-call','feedback-saved']"
s=s.replace("'Страница звонка'","'Подготовка и ход звонка'").replace(old,"['review','edit','clarification','blocked','confirm-start','dialing','live','approval','reconnecting','failed','stopped','archived']")
pos=s.index(" ['account'")
s=s[:pos]+" ['call-completed','Звонки','Завершённый звонок и оценка качества','/:locale/app/calls/:id','live-call.tsx + call-feedback.tsx',"+str(done).replace(' ', '')+"],\n"+s[pos:]
s+='\nwindow.COMPLETED_CALL_STATES='+json.dumps(done)+';\nfunction resolveDesignScreen(id,state){if(id===\'call\'&&COMPLETED_CALL_STATES.includes(state))id=\'call-completed\';if(id===\'call-completed\'&&state===\'default\')state=\'completed\';return {id,state}}\n'
p.write_text(s,encoding='utf-8')
p=R/'mock.js';s=p.read_text(encoding='utf-8')
s=s.replace("const esc=s=>", "Object.assign(ctx,resolveDesignScreen(ctx.id,ctx.state));\nconst esc=s=>")
s=s.replace("function href(id,s='default'){return", "function href(id,s='default'){({id,state:s}=resolveDesignScreen(id,s));return")
s=s.replace("data-page=\"${id}\" data-state=\"${s}\"", "data-page=\"${resolveDesignScreen(id,s).id}\" data-state=\"${resolveDesignScreen(id,s).state}\"")
start=s.index('function themeTools()');end=s.index('function footer()',start)
s=s[:start]+'''function icon(name,extra=''){return HERO_ICONS[name].replace('<svg',`<svg class="ui-icon ${extra}" width="24" height="24" aria-hidden="true" focusable="false"`)}
function themeButton(){const label=ctx.theme==='dark'?T('Switch to light theme','Zur hellen Ansicht wechseln'):T('Switch to dark theme','Zur dunklen Ansicht wechseln');return `<button type="button" class="icon-button" data-theme-toggle aria-label="${label}" title="${label}">${icon(ctx.theme==='dark'?'sun':'moon')}</button>`}
function themeTools(){return `<div class="tools">${ctx.id.startsWith('admin-')?'':link(T('2 call credits','2 Anrufguthaben'),'account','usage','credits')}${themeButton()}${languageControl()}</div>`}
function header(kind='public'){
 const admin=kind==='admin',signed=kind==='customer';
 const publicLinks=`<a href="${href('landing')}#how-it-works">${T('How it works','So funktioniert es')}</a>${link('FAQ','faq')}${link(T('Support','Hilfe'),'support')}`;
 const more=`${link(T('Redeem code','Code einlösen'),'redeem')}${link(T('Block calls','Anrufe blockieren'),'opt-out')}${link('FAQ','faq')}${link(T('Support','Hilfe'),'support')}${link('Admin','admin-overview')}`;
 const customerLinks=`${link(T('New call','Neuer Anruf'),'new-call','default',ctx.id==='new-call'?'active':'')}${link(T('History','Verlauf'),'new-call','history',ctx.id.startsWith('call')?'active':'')}${link(T('Account','Konto'),'account','default',ctx.id==='account'?'active':'')}`;
 const nav=signed?customerLinks+`<details class="dropdown"><summary>${T('More','Mehr')}</summary><nav>${more}</nav></details>`:publicLinks;
 const mobileNav=admin?adminLinks()+link('Customer app','new-call')+link('Sign out','login'):signed?customerLinks+more:publicLinks+link(T('Block calls','Anrufe blockieren'),'opt-out')+link(T('Sign in','Anmelden'),'login')+link(T('Create account','Konto erstellen'),'register');
 return `<a class="skip" href="#main-content">${T('Skip to main content','Zum Hauptinhalt')}</a><header class="topbar"><div class="brand">${link(`<img class="logo" src="assets/logo-${ctx.theme}.svg" alt="SHPROHLI">`,admin?'admin-overview':'landing')}${admin?'<span class="admin-label">Admin</span>':''}</div>${admin?`<div class="toplinks"><div><strong>Alex Morgan</strong><br><small>Superadmin</small></div>${link('Customer app','new-call')}${btn('Sign out','default','','login')}</div>`:`<nav class="toplinks" aria-label="${T('Main navigation','Hauptnavigation')}">${nav}</nav>`}${!signed&&!admin?`<div class="tools">${link(T('Sign in','Anmelden'),'login')}${link(T('Create account','Konto erstellen'),'register','default','button primary')}${themeButton()}${languageControl()}</div>`:themeTools()}<div class="mobile-actions">${themeButton()}<details class="dropdown mobile-menu"><summary class="icon-button" aria-label="${T('Open menu','Menü öffnen')}" title="${T('Open menu','Menü öffnen')}" aria-controls="mobile-navigation" aria-expanded="false">${icon('bars-3','menu-closed-icon')}${icon('x-mark','menu-open-icon')}</summary><nav id="mobile-navigation" aria-label="${T('Main navigation','Hauptnavigation')}">${mobileNav}${!admin?'<div class="menu-language">'+languageControl()+'</div>':''}</nav></details></div></header>`;
}
''' + s[end:]
p.write_text(s,encoding='utf-8')
p=R/'boot.js';s=p.read_text(encoding='utf-8')
s=s.replace("function navigate(id=ctx.id,s='default'){const", "function navigate(id=ctx.id,s='default'){({id,state:s}=resolveDesignScreen(id,s));const")
s=s.replace('call:callPage,account:',"call:callPage,'call-completed':callPage,account:")
s=s.replace("document.title='SHPROHLI", "if(!document.querySelector('#app > .footer'))document.getElementById('app').insertAdjacentHTML('beforeend',footer());document.title='SHPROHLI")
s=s.replace("ctx.theme=ctx.theme==='dark'?'light':'dark';navigate(ctx.id,ctx.state);return", "applyMockTheme(ctx.theme==='dark'?'light':'dark');return")
s=s.replace("const form=e.target;if(form.reportValidity())navigate", "const form=e.target;if(form.hasAttribute('data-feedback-form')){saveMockFeedback(form);return}if(form.reportValidity())navigate")
s=s.replace('render();setupMockControls();','render();setupMockControls();setupRevisionControls();')
s+='''
function applyMockTheme(theme){
 ctx.theme=theme;document.documentElement.dataset.theme=theme;
 document.querySelectorAll('.logo').forEach(i=>i.src='assets/logo-'+theme+'.svg');
 document.querySelectorAll('[data-theme-toggle]').forEach(b=>{const label=theme==='dark'?T('Switch to light theme','Zur hellen Ansicht wechseln'):T('Switch to dark theme','Zur dunklen Ansicht wechseln');b.innerHTML=icon(theme==='dark'?'sun':'moon');b.setAttribute('aria-label',label);b.title=label});
 document.querySelectorAll('a[href]').forEach(a=>{const url=new URL(a.href);if(url.pathname.endsWith('/mock.html')){url.searchParams.set('theme',theme);a.href=url.pathname.split('/').at(-1)+url.search+url.hash}});
 const url=new URL(location.href);url.searchParams.set('theme',theme);history.replaceState(null,'',url);
 if(window.parent!==window)window.parent.postMessage({type:'design-theme',theme},'*');
}
function setupRevisionControls(){
 const menu=document.querySelector('.mobile-menu');if(menu){const button=menu.querySelector('summary');menu.addEventListener('toggle',()=>{button.setAttribute('aria-expanded',String(menu.open));const label=menu.open?T('Close menu','Menü schliessen'):T('Open menu','Menü öffnen');button.setAttribute('aria-label',label);button.title=label});document.addEventListener('click',e=>{if(menu.open&&!menu.contains(e.target))menu.open=false});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open&&!document.querySelector('[role=dialog]')){menu.open=false;button.focus()}})}
 const feedback=document.querySelector('[data-feedback-form]');if(feedback){const comment=feedback.querySelector('textarea'),counter=feedback.querySelector('[data-feedback-count]');const update=()=>{feedback.querySelector('[type=submit]').disabled=!feedback.querySelector('[name=goal-result]:checked');counter.textContent=comment.value.length+' / 500';};feedback.addEventListener('input',update);update()}
}
function saveMockFeedback(form){
 if(!form.reportValidity())return;
 const selected=form.querySelector('[name=goal-result]:checked');if(!selected)return;
 form.querySelector('[data-feedback-status]').textContent=T('Your feedback was saved.','Ihre Rückmeldung wurde gespeichert.');
 form.querySelector('[type=submit]').textContent=T('Update feedback','Rückmeldung aktualisieren');
 ctx.state='feedback-saved';const url=new URL(location.href);url.searchParams.set('state',ctx.state);history.replaceState(null,'',url);
 if(window.parent!==window)window.parent.postMessage({type:'design-state',id:ctx.id,state:ctx.state},'*');
}
'''
p.write_text(s,encoding='utf-8')
p=R/'atlas.js';s=p.read_text(encoding='utf-8').replace("function update(nav=false){const", "function update(nav=false){Object.assign(settings,resolveDesignScreen(settings.id,settings.state));const")
s += '''
window.addEventListener('message',e=>{if(e.source!==$('preview').contentWindow)return;if(e.data?.type==='design-theme'){settings.theme=e.data.theme;$('theme').value=settings.theme}else if(e.data?.type==='design-state'){settings.state=e.data.state;$('state').value=settings.state}else return;const q=new URLSearchParams({id:settings.id,state:settings.state,theme:settings.theme,lang:settings.lang});$('open-frame').href='mock.html?'+q;history.replaceState(null,'','#'+new URLSearchParams(settings))});
'''
p.write_text(s,encoding='utf-8')
p=R/'customer.js';s=p.read_text(encoding='utf-8')
s=s.replace("done=['completed','transcribing'", "done=['completed','provisional','transcribing'")
s=s.replace("if(done){main=", "if(done){main=")
start=s.index(" if(done){main=");end=s.index(" }else if(live)",start)
s=s[:start]+''' if(done){
 const provisional=state('provisional'),hasFinal=!['transcribing','transcript-failed','no-recording'].includes(s);
 main=`<nav class="subnav transcript-tabs" aria-label="${T('Transcript version','Transkriptversion')}">${btn(T('Final transcript','Endgültiges Transkript'),'completed',!provisional?'active':'')}${btn(T('Provisional transcript','Vorläufiges Transkript'),'provisional',provisional?'active':'')}<a class="feedback-jump" href="#call-feedback">${T('Rate call quality','Anrufqualität bewerten')}</a></nav><div class="row between transcript-heading"><div><h2>${provisional?T('Provisional transcript','Vorläufiges Transkript'):T('Final transcript','Endgültiges Transkript')}</h2><p class="help">${provisional?T('Captured during the call. Wording may differ from the final transcript.','Während des Anrufs erfasst. Der Wortlaut kann vom endgültigen Transkript abweichen.'):T('Created from the call recording.','Aus der Anrufaufnahme erstellt.')}</p></div>${hasFinal&&!provisional?`<div class="actions">${btn(T('Copy transcript','Transkript kopieren'))}${btn(T('Download PDF','PDF herunterladen'))}</div>`:''}</div>`;
 main+=provisional?transcript(false):state('transcribing')?note(T('The final transcript is being created. The provisional transcript remains available below.','Das endgültige Transkript wird erstellt. Das vorläufige Transkript bleibt unten verfügbar.'),'info')+transcript(false):state('transcript-failed')?note(T('Final transcription failed. You can retry while the recording is available.','Die endgültige Transkription ist fehlgeschlagen. Solange die Aufnahme verfügbar ist, können Sie es erneut versuchen.'),'error')+`<div class="actions">${btn(T('Retry final transcript','Transkription erneut versuchen'),'transcribing','primary')}</div>`:state('no-recording')?empty(T('No recording available','Keine Aufnahme verfügbar'),T('A final transcript cannot be created without a recording. The provisional transcript may still be available.','Ohne Aufnahme kann kein endgültiges Transkript erstellt werden. Das vorläufige Transkript ist möglicherweise noch verfügbar.')):transcript(true)+`<details class="disclosure" style="margin-top:24px"><summary>${T('How this transcript was created','So wurde dieses Transkript erstellt')}</summary><div><p class="help">${T('Generated after the call from the recording. Speaker labels and timestamps are approximate.','Nach dem Anruf aus der Aufnahme erstellt. Sprecherzuordnung und Zeitstempel sind ungefähr.')}</p>${btn(T('Regenerate final transcript','Endgültiges Transkript neu erstellen'),'transcribing','quiet')}</div></details>`;
 aside=section(T('Recording','Aufnahme'),state('recording-deleted')?note(T('The recording has been deleted.','Die Aufnahme wurde gelöscht.')):state('no-recording')?'<p class="help">'+T('No recording is available.','Keine Aufnahme verfügbar.')+'</p>':recording())+completedFeedback(hasFinal)+section(T('Call goal','Anrufziel'),'<p>'+T('Check whether the residence form arrived and whether documents are missing.','Prüfen, ob das Formular eingegangen ist und ob Unterlagen fehlen.')+'</p>')+section(T('Call data','Anrufdaten'),btn(T('Delete call data','Anrufdaten löschen'),'delete-call','danger'));
''' +s[end:]
s=s.replace('<div class="call-layout"><section class="stack">${main}', '<div class="call-layout ${done?\'completed-layout\':\'\'}"><section class="stack">${main}')
s+='''
function completedFeedback(hasFinal){
 const saved=state('feedback-saved');
 const group=(legend,name,values,labels)=>`<fieldset class="feedback-fieldset"><legend>${legend}</legend><div class="segmented">${values.map((value,i)=>`<label><input type="radio" name="${name}" value="${value}" ${name==='goal-result'?'required':''} ${saved&&i===0?'checked':''}><span>${labels[i]}</span></label>`).join('')}</div></fieldset>`;
 return `<section class="section feedback-section" id="call-feedback" aria-labelledby="feedback-title" tabindex="-1"><div><span class="eyebrow">${T('Call quality','Anrufqualität')}</span><h2 id="feedback-title">${T('Your feedback','Ihre Rückmeldung')}</h2><p class="help">${T('Tell us how the call went and how accurate the transcript is.','Teilen Sie uns mit, wie der Anruf verlief und wie genau das Transkript ist.')}</p></div><form class="stack" data-feedback-form>${group(T('Was your goal achieved?','Wurde Ihr Ziel erreicht?'),'goal-result',['yes','partly','no'],[T('Yes','Ja'),T('Partly','Teilweise'),T('No','Nein')])}${hasFinal?group(T('Transcript quality','Transkriptqualität'),'transcript-quality',['good','some_errors','poor'],[T('Good','Gut'),T('Some errors','Einige Fehler'),T('Poor','Schlecht')]):`<div><strong class="help">${T('Transcript quality','Transkriptqualität')}</strong><p class="help">${T('Available when the final transcript is ready.','Verfügbar, sobald das endgültige Transkript bereit ist.')}</p></div>`}${field(T('Comment','Kommentar'),saved?T('The answer was clear and the names were correct.','Die Antwort war klar und die Namen waren korrekt.'):'',{type:'textarea',rows:3,maxLength:500,optional:true})}<small data-feedback-count>0 / 500</small><div class="stack tight"><button class="primary" type="submit" ${saved?'':'disabled'}>${saved?T('Update feedback','Rückmeldung aktualisieren'):T('Save feedback','Rückmeldung speichern')}</button><p class="help" data-feedback-status role="status">${saved?T('Your feedback was saved.','Ihre Rückmeldung wurde gespeichert.'):''}</p></div></form></section>`;
}
'''
p.write_text(s,encoding='utf-8')
p=R/'styles.css';s=p.read_text(encoding='utf-8');s+='''
/* Revision 02: shared footer, library icons, completed-call view. */
#app{min-height:100dvh;display:flex;flex-direction:column}#app>main,#app>.admin-layout{flex:1;width:100%}#app>.footer{flex:none}
.ui-icon{width:24px;height:24px;display:block;flex:none}.icon-button,.tools .icon-button{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;min-height:44px;padding:10px;border:0;border-radius:8px;background:transparent;color:var(--ink);cursor:pointer}.icon-button:hover{background:var(--surface)}.mobile-actions{display:none;align-items:center;gap:8px}.mobile-menu summary::-webkit-details-marker{display:none}.mobile-menu summary .menu-open-icon{display:none}.mobile-menu[open] summary .menu-closed-icon{display:none}.mobile-menu[open] summary .menu-open-icon{display:block}.mobile-menu[open]>nav{width:min(320px,calc(100vw - 40px));min-width:0;max-height:calc(100dvh - 104px);overflow-y:auto}.menu-language{padding:12px}.menu-language select{width:100%}.transcript-tabs{margin-bottom:0;align-items:center}.feedback-jump{font-size:14px;margin-left:auto;padding:12px 0}.transcript-heading{align-items:flex-start}.completed-layout>section.stack{align-content:start;gap:24px}.completed-layout aside .section{padding:24px 0}.feedback-fieldset{border:0;padding:0;margin:0;min-width:0}.feedback-fieldset legend{font-size:14px;line-height:1.5;margin-bottom:10px}.feedback-section{scroll-margin-top:24px}.feedback-section .eyebrow{display:block;margin-bottom:8px}.feedback-section h2{margin-bottom:8px}.feedback-section form{gap:20px}.feedback-section [data-feedback-count]{margin-top:-12px;color:var(--muted)}.feedback-section [data-feedback-status]:empty{display:none}
@media(max-width:1023px){.mobile-actions{display:flex}.mobile-menu{display:block}.admin-mobile-nav{display:none}.completed-layout{gap:32px}.completed-layout aside{padding:0;border:0}.feedback-jump{margin-left:0}.transcript-tabs{gap:8px}}
@media(max-width:767px){.completed-layout .transcript-heading{display:grid;gap:12px}.completed-layout .transcript-heading .actions{padding-top:0}.transcript-tabs button{flex:1;min-width:130px}.feedback-jump{flex-basis:100%}.footer nav{width:100%}.footer{row-gap:24px}.topbar{gap:12px}.mobile-actions{gap:4px}}
@media(max-width:359px){.topbar .admin-label{display:none}.topbar .brand{gap:0}}
''';p.write_text(s,encoding='utf-8')
print('Updated shared shell, icons, completed-call navigation, transcript versions and feedback.')
