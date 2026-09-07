from pathlib import Path
import json,re
R=Path(__file__).resolve().parent
p=R/'admin.js';s=p.read_text(encoding='utf-8')
s=s.replace('return form(`<div class="filters">','return `<details class="filter-panel" open><summary>Filters</summary>`+form(`<div class="filters">',1)
s=s.replace("</div>`,'filtered')+(state('empty')", "</div>`,'filtered')+'</details>'+(state('empty')",1)
s=s.replace("['demo-a1','Completed'", "['demo-a1','Completed'",1)
p.write_text(s,encoding='utf-8')
p=R/'mock.js';s=p.read_text(encoding='utf-8')
s=s.replace("${link(T('Create account','Konto erstellen'),'register','default','button primary')}</div>`:themeTools()", "${link(T('Create account','Konto erstellen'),'register','default','button primary')}<button type=\"button\" data-theme-toggle>${ctx.theme==='dark'?T('Light','Hell'):T('Dark','Dunkel')}</button></div>`:themeTools()")
p.write_text(s,encoding='utf-8')
data=json.loads((R/'content.js').read_text(encoding='utf-8').removeprefix('window.PUBLIC_CONTENT=').strip().rstrip(';'))
print('FAQ heading tags:',[(x['tag'],x['text'][:50]) for x in data['faq']['en'] if x['tag'].startswith('h')])
