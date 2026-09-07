from pathlib import Path
import re, json, base64, html

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
css = (REPO/'apps/web/app/globals.css').read_text(encoding='utf-8')
font = re.search(r'data:font/woff2;base64,([A-Za-z0-9+/=]+)', css).group(1)
(ROOT/'assets/geist-latin.woff2').write_bytes(base64.b64decode(font))
svg = (REPO/'Design/shprohli.svg').read_text(encoding='utf-8')
for theme, word, portal in [('light','#222B25','#138553'),('dark','#EDF3EF','#39B878')]:
    value = re.sub('#0048C0',word,svg,flags=re.I)
    value = re.sub('#06D2CA',portal,value,flags=re.I)
    (ROOT/f'assets/logo-{theme}.svg').write_text(value,encoding='utf-8')

docs={}
mapping={'faq':'faq','support':'hilfe','privacy':'datenschutz','terms':'nutzungsbedingungen','acceptable-use':'nutzungsregeln','imprint':'impressum'}
for key,de in mapping.items():
  docs[key]={}
  for lang,file in [('en',key),('de','de-'+de)]:
    text=(ROOT/f'sources/{file}.txt').read_text(encoding='utf-8')
    part=text.split('- main:',1)[-1].split('- contentinfo:',1)[0]
    nodes=[]
    lines=part.splitlines()
    for index,line in enumerate(lines):
      match=re.search(r'- heading "(.*)" \[level=(\d)\]',line)
      if match:
        nodes.append({'tag':'h'+match[2], 'text':match[1]});continue
      match=re.search(r'- link "(.*?)":',line)
      if match and index+1<len(lines):
        target=re.search(r'/url: (.+)',lines[index+1])
        if target:
          url=target[1].strip('"')
          aliases={v:k for k,v in mapping.items()}
          if url.startswith('/en/') or url.startswith('/de/'):
            slug=url.split('/')[-1]
            dest=aliases.get(slug,slug)
            url='mock.html?id='+dest+'&lang='+lang
          nodes.append({'tag':'a','text':match[1],'href':url})
        continue
      match=re.search(r'- (paragraph|listitem|generic|time): (.+)',line)
      if match:
        value=match[2]
        if value[0:1]=='"' and value[-1:]=='"': value=value[1:-1]
        if value[0:1]=="'" and value[-1:]=="'": value=value[1:-1]
        if match[1]=='generic' and not ('Version' in value or 'Effective' in value or 'Gültig' in value or 'Stand' in value):continue
        nodes.append({'tag':'li' if match[1]=='listitem' else 'p','text':value})
    docs[key][lang]=nodes
existing_path=ROOT/'content.js'
if existing_path.exists():
  existing=json.loads(existing_path.read_text(encoding='utf-8').replace('window.PUBLIC_CONTENT=','').rstrip(';\n'))
  for key in docs:
    for lang in docs[key]:
      if not any(n['tag']=='h1' for n in docs[key][lang]): docs[key][lang]=existing.get(key,{}).get(lang,[])
(ROOT/'content.js').write_text('window.PUBLIC_CONTENT='+json.dumps(docs,ensure_ascii=False)+';\n',encoding='utf-8')
print('Prepared original-path logos, existing Geist font and',len(docs)*2,'public document variants.')
