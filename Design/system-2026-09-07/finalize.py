from pathlib import Path
import json,re,hashlib,xml.etree.ElementTree as ET
R=Path(__file__).resolve().parent
p=R/'customer.js';s=p.read_text(encoding='utf-8')
old='<${n.tag} ${n.tag==='
new='''<${n.tag} ${n.tag==='a'?`href="${esc(n.href)}"`:''} ${n.tag==='''
if new not in s:s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
for theme in ['light','dark']:
 p=R/f'assets/logo-{theme}.svg';s=p.read_text(encoding='utf-8');s=re.sub(r'<desc.*?</desc>','<desc id="logo-desc">SHPROHLI wordmark with an emerald portal inside the O. Original vector outlines.</desc>',s);p.write_text(s,encoding='utf-8')
 original=ET.parse(R.parent/'shprohli.svg').getroot();variant=ET.parse(p).getroot()
 assert [n.get('d') for n in original.iter() if n.tag.endswith('path')]==[n.get('d') for n in variant.iter() if n.tag.endswith('path')]
css=(R/'tokens.css').read_text(encoding='utf-8')
blocks=re.findall(r'(?:\:root|\[data-theme=dark\])\{([^}]+)\}',css)
themes={name:dict(re.findall(r'--([a-z0-9-]+):([^;]+)',value)) for name,value in zip(['light','dark'],blocks)}
def lum(h):
 c=[int(h[i:i+2],16)/255 for i in [1,3,5]]
 c=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c]
 return sum(a*b for a,b in zip(c,[.2126,.7152,.0722]))
def contrast(a,b):
 a,b=sorted([lum(a),lum(b)])
 return (b+.05)/(a+.05)
pairs=[('ink','bg',4.5),('muted','bg',4.5),('link','bg',4.5),('on-accent','accent',4.5),('danger','danger-bg',4.5),('warning','warning-bg',4.5),('info','info-bg',4.5),('control','input',3),('focus','bg',3)]
results=[]
for name,own in themes.items():
 vals={**themes['light'],**own}
 for fg,bg,minimum in pairs:
  ratio=contrast(vals[fg],vals[bg]);results.append({'theme':name,'foreground':fg,'background':bg,'fg':vals[fg],'bg':vals[bg],'ratio':round(ratio,3),'minimum':minimum,'pass':ratio>=minimum})
(R/'tokens.json').write_text(json.dumps({'name':'SHPROHLI Emerald Paper','version':'1.0-design-review','date':'2026-09-07','themes':themes,'typeScale':{'heroDesktop':{'size':52,'lineHeight':1.07,'weight':650},'heroMobile':{'size':38,'lineHeight':1.07,'weight':650},'page':{'size':32,'lineHeight':1.2,'weight':650},'dashboard':{'size':28,'lineHeight':1.2,'weight':600},'section':{'size':24,'lineHeight':1.3,'weight':600},'body':{'size':16,'lineHeight':1.5,'weight':400},'label':{'size':14,'lineHeight':1.5,'weight':550},'caption':{'size':13,'lineHeight':1.5,'weight':400}},'breakpoints':{'mobileMax':767,'tabletMax':1023,'desktopCompactMax':1199,'desktopWideMin':1920},'fontSha256':hashlib.sha256((R/'assets/geist-latin.woff2').read_bytes()).hexdigest()},ensure_ascii=False,indent=2),encoding='utf-8')
(R/'contrast.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
registry=(R/'registry.js').read_text(encoding='utf-8');screens=[]
for m in re.finditer(r"\['([^']+)','([^']+)','([^']+)','([^']+)','([^']+)',\[([^\]]+)\]",registry):
 screens.append(dict(zip(['id','group','title','route','source'],m.groups()[:5]))|{'states':re.findall(r"'([^']+)'",m[6])})
for screen in screens:
 for source in screen['source'].split(' + '):
  if source!='Design tokens':assert (R.parent.parent/'apps/web/components'/source).exists(),source
(R/'manifest.json').write_text(json.dumps({'repositoryCommit':'3676030e48b0b618cb4d02813fe18a233076d076','scope':'30 existing route/content screens, an additional dedicated completed-call view of the same call route, and 2 system reference sheets','screens':screens,'sourcePolicy':'Sources are repository screenshots and component code. New data are synthetic. New screens require approval.'},ensure_ascii=False,indent=2),encoding='utf-8')
print('Screens:',len(screens),'state entries:',sum(len(x['states']) for x in screens),'Contrast checks:',len(results),'Failures:',[r for r in results if not r['pass']])
