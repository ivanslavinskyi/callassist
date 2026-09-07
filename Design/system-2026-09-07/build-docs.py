from pathlib import Path
import re,json,html
R=Path(__file__).resolve().parent
E=html.escape
manifest=json.loads((R/'manifest.json').read_text(encoding='utf-8'))
screens=manifest['screens']
css='''*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 var(--font)}a{color:var(--link);text-underline-offset:4px}button,select{font:inherit;background:var(--surface);color:var(--ink);border:1px solid var(--control);border-radius:6px;padding:10px 14px;cursor:pointer;min-height:44px}a:focus-visible,button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px}header{padding:20px 5vw;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}header nav{display:flex;gap:20px;flex-wrap:wrap}header strong{letter-spacing:.04em}main{max-width:1120px;margin:56px auto;padding:0 32px 80px}h1{font-size:42px;line-height:1.15;letter-spacing:-.035em;margin:0 0 24px;max-width:26ch}h2{font-size:26px;line-height:1.3;margin:48px 0 20px;letter-spacing:-.02em;scroll-margin-top:24px}h3{font-size:20px;margin:24px 0 12px}p,li{max-width:88ch}p{margin:0 0 20px}code{font-family:Consolas,monospace;font-size:.86em;background:var(--surface);padding:2px 5px;overflow-wrap:anywhere}pre{white-space:pre-wrap;padding:20px;background:var(--surface);border:1px solid var(--line)}.table-wrap{overflow:auto;margin:24px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:16px;text-align:left;vertical-align:top;min-width:100px}th{background:var(--surface);font-weight:600}td code{white-space:normal}.toc{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:24px;margin:32px 0;columns:2;column-gap:32px}.toc a{display:block;padding:6px 0;font-size:14px;break-inside:avoid}.eyebrow{font-size:12px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:16px}.muted{color:var(--muted)}.route-item{border-bottom:1px solid var(--line);padding:24px 0}.route-item summary{font-size:20px;cursor:pointer;display:flex;gap:20px;justify-content:space-between}.route-item summary small{color:var(--muted);font-size:13px;white-space:nowrap}.state-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}.state-links a{font-size:13px;border:1px solid var(--line);border-radius:6px;padding:6px 10px;text-decoration:none}.route-item code{display:inline-block;margin:16px 0 8px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:40px 28px}.gallery figure{margin:0;min-width:0}.gallery img{width:100%;display:block;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.gallery figcaption{padding:16px 0}.gallery .mobile-image{max-width:290px;margin:auto}.gallery h3{margin:0 0 8px}.controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:24px 0 40px}.controls label{display:flex;gap:10px;align-items:center}.board-gallery{display:grid;gap:32px;margin:32px 0}.board-gallery img{width:100%;border:1px solid var(--line);border-radius:8px}.board-gallery figure{margin:0}.board-gallery figcaption{padding:12px 0}.callout{padding:24px;border-left:3px solid var(--accent);background:var(--accent-soft);margin:24px 0}.toc a,.route-item,.gallery figcaption{overflow-wrap:anywhere}@media(max-width:767px){main{padding:0 20px 48px;margin-top:32px}h1{font-size:32px}.toc{columns:1}header{padding:20px}.gallery{grid-template-columns:1fr}.route-item summary{display:block}.route-item summary small{display:block;margin-top:8px}td,th{padding:12px}.controls{display:grid}.gallery .mobile-image{max-width:320px}}@media print{header,.controls{display:none}main{margin:0;max-width:none;padding:12px}.toc{columns:2}h2{break-after:avoid}tr,img{break-inside:avoid}body{font-size:11px}h1{font-size:30px}h2{font-size:20px}.table-wrap{overflow:visible}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}'''
(R/'docs.css').write_text(css,encoding='utf-8')
def inline(s):
 s=E(s)
 s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s)
 s=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s)
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',s)
 return s
def markdown(md):
 lines=md.splitlines();out=[];toc=[];i=0;number=0
 while i<len(lines):
  line=lines[i];i+=1
  if not line.strip():continue
  if line.startswith('```'):
   block=[]
   while i<len(lines) and not lines[i].startswith('```'):block.append(lines[i]);i+=1
   i+=1;out.append('<pre><code>'+E('\n'.join(block))+'</code></pre>');continue
  m=re.match(r'^(#{1,4}) (.+)',line)
  if m:
   level=len(m[1]);number+=1;anchor='section-'+str(number)
   out.append(f'<h{level} id="{anchor}">{inline(m[2])}</h{level}>')
   if level==2:toc.append(f'<a href="#{anchor}">{E(m[2])}</a>')
   continue
  if line.startswith('|'):
   rows=[line]
   while i<len(lines) and lines[i].startswith('|'):rows.append(lines[i]);i+=1
   cells=lambda r:[inline(c.strip()) for c in r.strip('|').split('|')]
   out.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+c+'</th>' for c in cells(rows[0]))+'</tr></thead><tbody>')
   for row in rows[2:]:out.append('<tr>'+''.join('<td>'+c+'</td>' for c in cells(row))+'</tr>')
   out.append('</tbody></table></div>');continue
  if re.match(r'^[-*] |^\d+\. ',line):
   numbered=bool(re.match(r'^\d+\. ',line));tag='ol' if numbered else 'ul';items=[line]
   while i<len(lines) and re.match(r'^[-*] |^\d+\. ',lines[i]):items.append(lines[i]);i+=1
   out.append('<'+tag+'>'+''.join('<li>'+inline(re.sub(r'^[-*] |^\d+\. ','',v))+'</li>' for v in items)+'</'+tag+'>');continue
  para=[line]
  while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|[-*] |\d+\. )',lines[i]):para.append(lines[i]);i+=1
  out.append('<p>'+inline(' '.join(para))+'</p>')
 return ''.join(out),''.join(toc)
def shell(title,body,script=''):
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+E(title)+' · SHPROHLI</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="docs.css"></head><body><header><strong>SHPROHLI / DESIGN</strong><nav><a href="index.html">Атлас</a><a href="boards.html">Макеты</a><a href="guidelines.html">Гайдлайн</a><a href="page-specs.html">Страницы</a><a href="coverage.html">Покрытие</a><button id="doc-theme" aria-label="Сменить тему">Сменить тему</button></nav></header><main>'+body+'</main><script>document.getElementById("doc-theme").onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";</script>'+script+'</body></html>'
for file,output in [('GUIDELINES.md','guidelines.html'),('PAGE-SPECS.md','page-specs.html'),('QA.md','qa.html')]:
 if not (R/file).exists():continue
 md=(R/file).read_text(encoding='utf-8');body,toc=markdown(md)
 pos=body.find('</h1>')+5
 body=body[:pos]+'<nav class="toc" aria-label="Содержание">'+toc+'</nav>'+body[pos:]
 (R/output).write_text(shell(file,body),encoding='utf-8')
body='<p class="eyebrow">Полнота и источники</p><h1>Каждая страница на своём месте.</h1><p>30 существующих маршрутных/контентных экранов, отдельное представление завершённого звонка, 2 системных листа — 33 пункта и 162 просмотрочных состояния. Откройте группу, чтобы перейти к конкретному макету. Оба цветовых режима доступны в атласе.</p><div class="callout">Новые страницы ожидают утверждения. Полный контракт полей — в <a href="page-specs.html">спецификациях страниц</a>, результаты проверки — в <a href="qa.html">QA</a>. DE Privacy и Terms восстановлены из seed-content.ts; их опубликованная ревизия повторно не проверена.</div>'
for group in dict.fromkeys(s['group'] for s in screens):
 body+='<h2>'+E(group)+'</h2>'
 for s in screens:
  if s['group']!=group:continue
  body+='<details class="route-item"><summary>'+E(s['title'])+'<small>'+str(len(s['states']))+' состояний</small></summary><code>'+E(s['route'])+'</code><p class="muted">Источник: '+E(s['source'])+'</p><div class="state-links">'+''.join('<a href="index.html#id='+s['id']+'&amp;state='+state+'">'+E(state)+'</a>' for state in s['states'])+'</div></details>'
(R/'coverage.html').write_text(shell('Покрытие экранов',body),encoding='utf-8')
body='<p class="eyebrow">Emerald Paper · 2026</p><h1>Полный комплект макетов.</h1><p>Сначала обзор композиции, затем реальные снимки адаптивного атласа. PNG показывает первый viewport; полная длина страницы и остальные состояния доступны по ссылке под макетом.</p><details><summary>Ранние обзорные композиции — до редакции 02</summary><div class="board-gallery">'+''.join('<figure><a href="boards/'+path+'"><img loading="lazy" src="boards/'+path+'" alt="'+E(title)+'"></a><figcaption>'+E(title)+' · ImageGen, направление композиции. Точные спецификации — в атласе.</figcaption></figure>' for path,title in [('landing.png','Лендинг'),('call-completed.png','Итог звонка'),('admin-calls.png','Административные звонки')])+'</div></details><div class="controls"><label>Тема <select id="gallery-theme"><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><label>Устройство <select id="gallery-device"><option value="desktop">Desktop · 1440</option><option value="mobile">Mobile · 390</option></select></label><label>Раздел <select id="gallery-group"><option value="all">Все</option>'+''.join('<option>'+E(g)+'</option>' for g in dict.fromkeys(s['group'] for s in screens))+'</select></label></div><div class="gallery" id="gallery"></div>'
script='''<script src="registry.js"></script><script>function gallery(){const theme=document.getElementById('gallery-theme').value,device=document.getElementById('gallery-device').value,group=document.getElementById('gallery-group').value;document.getElementById('gallery').innerHTML=SCREENS.filter(s=>group==='all'||s.group===group).map(s=>{const image='screens/'+s.id+'-'+device+'-'+theme+'.png?v=02b',url='index.html#'+new URLSearchParams({id:s.id,state:s.states[0],theme,width:device==='mobile'?'390':'1440'});return `<figure><a href="${image}"><img loading="lazy" class="${device==='mobile'?'mobile-image':''}" src="${image}" alt="${s.title} · ${device} · ${theme}"></a><figcaption><h3>${s.title}</h3><p class="muted">${s.group} · ${s.states[0]}</p><a href="${url}">Открыть полный макет и состояния</a></figcaption></figure>`}).join('')}document.querySelectorAll('.controls select').forEach(x=>x.onchange=gallery);gallery();</script>'''
(R/'boards.html').write_text(shell('Обзор макетов',body,script),encoding='utf-8')
print('Built documentation, source coverage and screenshot gallery.')
