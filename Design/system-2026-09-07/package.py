from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import json,zipfile
R=Path(__file__).resolve().parent
p=R/'index.html';s=p.read_text(encoding='utf-8').replace('transition:width .2s;','');p.write_text(s,encoding='utf-8')
class Links(HTMLParser):
 def __init__(self):super().__init__();self.paths=[]
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k in ('href','src') and v and not v.startswith(('#','http:','https:','mailto:','data:')):
    self.paths.append(unquote(urlsplit(v).path))
missing=[]
for p in R.glob('*.html'):
 parser=Links();parser.feed(p.read_text(encoding='utf-8'))
 for target in parser.paths:
  if target and not (p.parent/target).exists():missing.append((p.name,target))
assert not missing,missing
manifest=json.loads((R/'manifest.json').read_text(encoding='utf-8'))
for screen in manifest['screens']:
 for theme in ['light','dark']:
  for device in ['desktop','mobile']:
   assert (R/f"screens/{screen['id']}-{device}-{theme}.png").is_file()
for file in ['contrast.json','qa-interactions.json','qa-revision-02.json']:
 assert all(x['pass'] for x in json.loads((R/file).read_text(encoding='utf-8'))),file
for file in ['qa-breakpoints.json','qa-captures.json','qa-states.json']:
 records=json.loads((R/file).read_text(encoding='utf-8'))
 assert all(x['h1']==1 and x['scrollWidth']<=x['width'] for x in records),file
 assert all(x['main']==1 and x['footer']==1 for x in records),file
summary={'date':'2026-09-07','revision':'02','screens':len(manifest['screens']),'routeContentScreens':30,'dedicatedCompletedCallViews':1,'stateEntries':sum(len(x['states']) for x in manifest['screens']),'galleryPng':len(manifest['screens'])*4,'breakpointChecks':len(json.loads((R/'qa-breakpoints.json').read_text(encoding='utf-8'))),'contrastChecks':18,'baselineInteractionChecks':10,'revisionInteractionChecks':len(json.loads((R/'qa-revision-02.json').read_text(encoding='utf-8'))),'localHtmlLinks':'pass','productionFilesChanged':False,'status':'Revision 02 ready for design review'}
(R/'qa-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
archive=R/'SHPROHLI-design-review.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(R.rglob('*')):
  if not p.is_file():continue
  rel=p.relative_to(R)
  if rel.parts[0] in ['sources','prompts'] or p.suffix in ['.py','.mjs','.zip'] or p.name=='WORK.md':continue
  z.write(p,'SHPROHLI-design-review/'+rel.as_posix())
with zipfile.ZipFile(archive) as z:
 assert not any('/sources/' in n for n in z.namelist())
 assert z.testzip() is None
print(json.dumps(summary,ensure_ascii=False))
print('Portable archive:',round(archive.stat().st_size/1024/1024,1),'MiB')
