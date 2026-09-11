// Browser regression harness using the production controller; synthetic text, no calls.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import ts from "typescript";

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Transcript following regression</title>
<style>body{font:16px/1.5 system-ui;max-width:680px;margin:24px auto;padding:0 20px;color:#203b32}button{padding:12px;margin:4px}#list{height:350px;overflow-y:auto;overflow-anchor:none;scroll-behavior:auto;border:1px solid #809c90}article{padding:24px;border-bottom:1px solid #ccd9d3}pre{white-space:pre-wrap;font-size:13px}#state{padding:12px;background:#e9f5ef}</style>
<h1>Transcript following regression</h1><p>Production scroll controller with synthetic streaming text. No telephone call is made.</p>
<button id="run">Run regression</button><button id="latest">Jump to latest</button><p id="state">Ready</p><div id="list" tabindex="0"></div><pre id="results"></pre>
<script type="module">
import {createTranscriptFollower} from '/transcript-follower.js';
const list=document.querySelector('#list'), results=[], output=document.querySelector('#results'), status=document.querySelector('#state');
let following=true;
let controller=createTranscriptFollower(list,value=>{following=value});
const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function check(name,pass){results.push({name,pass});output.textContent=JSON.stringify(results,null,2);if(!pass)throw new Error(name)}
const gap=()=>Math.round(list.scrollHeight-list.clientHeight-list.scrollTop);
const row=text=>{const article=document.createElement('article');article.textContent=text;list.append(article);return article};
document.querySelector('#latest').onclick=()=>controller.follow();
document.querySelector('#run').onclick=async()=>{
document.querySelector('#run').disabled=true;status.textContent='Running';results.length=0;
try {
controller.destroy();controller=createTranscriptFollower(list,value=>{following=value});following=true;list.replaceChildren();controller.follow();
for(let n=0;n<10;n++)row('Previously finalized turn '+n);await frames();
for(let n=0;n<180;n++){
  const partial=row('Streaming '+n+' — ');
  for(let d=0;d<3;d++){partial.textContent+='New words arrive while the page follows. ';await frames();if(gap()>1)throw new Error('Streaming stopped at '+n+': '+gap());}
  partial.textContent='Finalized turn '+n;await frames();
}
check('540 streaming updates and 180 final replacements stay at the latest turn',following&&gap()<=1);
list.dispatchEvent(new WheelEvent('wheel',{deltaY:-200}));list.scrollTop-=200;list.dispatchEvent(new Event('scroll'));await frames();
const readingTop=list.scrollTop;for(let n=0;n<10;n++)row('Additional turn while reading');await frames();
check('Manual upward reading is preserved during incoming turns',!following&&list.scrollTop===readingTop);
controller.follow();await frames();check('Explicit jump resumes following',following&&gap()<=1);
list.style.height='230px';await frames();await frames();check('Viewport height change keeps latest visible',following&&gap()<=1);
list.style.width='250px';await frames();await frames();check('Text reflow keeps latest visible',following&&gap()<=1);
list.hidden=true;row('Arrived while hidden');await frames();list.hidden=false;await frames();await frames();check('Hidden to visible resumes following',following&&gap()<=1);
list.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp'}));list.scrollTop-=150;list.dispatchEvent(new Event('scroll'));await frames();
check('Keyboard reading pauses following',!following);
list.dispatchEvent(new KeyboardEvent('keydown',{key:'End'}));list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event('scroll'));await frames();
check('Manual return to bottom resumes following',following&&gap()<=1);
list.dispatchEvent(new PointerEvent('pointerdown'));list.scrollTop-=120;list.dispatchEvent(new Event('scroll'));window.dispatchEvent(new PointerEvent('pointerup'));await frames();
check('Scrollbar drag pauses following',!following);controller.follow();await frames();
list.dispatchEvent(new TouchEvent('touchstart',{touches:[new Touch({identifier:1,target:list,clientY:100})]}));
list.dispatchEvent(new TouchEvent('touchmove',{touches:[new Touch({identifier:1,target:list,clientY:180})]}));list.scrollTop-=80;list.dispatchEvent(new Event('scroll'));await frames();
check('Touch reading pauses following',!following);controller.follow();await frames();
controller.destroy();controller=createTranscriptFollower(list,value=>{following=value});row('Final turn after reconnect');await frames();
check('Reconnected controller follows new content',gap()<=1);
status.textContent='PASS — '+results.length+' checks; gap '+gap()+' px';
}catch(error){status.textContent='FAIL — '+error.message;results.push({error:error.message});output.textContent=JSON.stringify(results,null,2)}
finally{document.querySelector('#run').disabled=false}
};
</script></html>`;
createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  const name=req.url==='/transcript-follower.js'?'transcript-follower':req.url==='/transcript-scroll.js'?'transcript-scroll':null;
  if(!name){res.writeHead(404);res.end();return;}
  const source=readFileSync(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  res.setHeader('Content-Type','text/javascript');res.end(compiled.replace('"./transcript-scroll"','"./transcript-scroll.js"'));
}).listen(3011,'127.0.0.1',()=>console.log('Transcript regression: http://127.0.0.1:3011'));
