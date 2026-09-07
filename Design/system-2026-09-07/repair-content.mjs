import { readFileSync,writeFileSync } from 'node:fs';
import { seededContentPages } from '../../apps/api/src/content/seed-content.ts';
const root=new URL('./',import.meta.url);
const contentFile=new URL('content.js',root);
const content=JSON.parse(readFileSync(contentFile,'utf8').replace('window.PUBLIC_CONTENT=','').replace(/;\s*$/,''));
const repaired=[];
for(const page of seededContentPages){
 if(!content[page.key])continue;
 if(content[page.key]?.[page.locale]?.some(n=>n.tag==='h1'))continue;
 const nodes=[{tag:'h1',text:page.title},{tag:'p',text:page.summary},{tag:'p',text:`Version ${page.revision.number} · Gültig ab 2. September 2026`}];
 for(const section of page.sections){
  nodes.push({tag:'h2',text:section.heading},...section.paragraphs.map(text=>({tag:'p',text})),...section.bullets.map(text=>({tag:'li',text})));
  for(const link of section.links||[])nodes.push({tag:'a',text:link.label,href:link.kind==='email'?'mailto:'+link.address:'mock.html?id='+link.destination+'&lang='+page.locale});
 }
 content[page.key][page.locale]=nodes;
 repaired.push({key:page.key,locale:page.locale,source:'apps/api/src/content/seed-content.ts',revision:page.revision.number,reason:'Original DOM snapshot was empty. Source code is authoritative for this mock; live published revision could not be re-verified because the local app server was no longer running.'});
}
writeFileSync(contentFile,'window.PUBLIC_CONTENT='+JSON.stringify(content)+';\n');
if(repaired.length)writeFileSync(new URL('content-provenance.json',root),JSON.stringify(repaired,null,2));
console.log('Repaired:',repaired.map(x=>x.key+'/'+x.locale));
