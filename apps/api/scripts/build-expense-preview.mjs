import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('tsup')] }));
const root = resolve('../..');
const out = resolve(root, 'docs/cost-audit-2026-09-17/qa');
await mkdir(resolve(out, 'brand/expense-icons'), { recursive: true });
for (const file of ['globals.css', 'emerald-paper.css', 'admin-expenses.css']) await copyFile(resolve(root, 'apps/web/app', file), resolve(out, file));
for (const name of ['phone','document-text','language','clipboard-document-list','microphone','signal','chevron-right','exclamation-triangle','information-circle']) await copyFile(resolve(root, 'apps/web/public/brand/expense-icons', `${name}.svg`), resolve(out, 'brand/expense-icons', `${name}.svg`));
await writeFile(resolve(out, 'image.tsx'), 'import React from "react"; export default function Image(props){return <img {...props}/>;}');
await writeFile(resolve(out, 'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{AdminExpenseExplorer}from'${resolve(root,'apps/web/components/admin-expense-explorer').replaceAll('\\','/')}';
import data from '../implemented-data.json';
function Preview(){const[view,setView]=useState('overview');const[locale,setLocale]=useState('en');const[dark,setDark]=useState(false);
return <main style={{maxWidth:1380,margin:'0 auto',padding:24}}><nav style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:20}} aria-label="QA scenarios">
<select aria-label="Scenario" value={view} onChange={e=>setView(e.target.value)}><option value="overview">Service overview</option><option value="call">Call inspector</option><option value="empty">Empty period</option></select>
<select aria-label="Language" value={locale} onChange={e=>setLocale(e.target.value)}><option value="en">English</option><option value="de">Deutsch</option></select>
<button onClick={()=>{document.documentElement.dataset.theme=dark?'light':'dark';setDark(!dark)}}>Toggle theme</button></nav>
<AdminExpenseExplorer key={view} locale={locale} scope={view==='call'?'record':'period'} cost={view==='call'?(data.callCost??data.cost):view==='empty'?${JSON.stringify(null)}??emptyCost():data.cost}/></main>}
function emptyCost(){const c=structuredClone(data.cost);c.providerUsage.calculatedUsdMicros=null;c.providerUsage.missingUsageOperations=0;c.providerUsage.records=[];c.providerUsage.firstRecordedAt=null;c.providerReported.usdMicros=null;c.providerReported.recordCount=0;c.providerReported.pendingOperations=0;c.billing=[];for(const v of Object.values(c.providerUsage.components)){for(const k of Object.keys(v)) if(typeof v[k]==='number')v[k]=0;v.calculatedUsdMicros=null;v.models=[];}return c;}
createRoot(document.getElementById('root')).render(<Preview/>);`);
await build({ entryPoints: [resolve(out,'entry.tsx')], outfile: resolve(out,'app.js'), bundle: true, jsx:'automatic', platform:'browser',
  alias:{'@':resolve(root,'apps/web'),'next/image':resolve(out,'image.tsx')},nodePaths:[resolve(root,'apps/web/node_modules')],define:{'process.env.NODE_ENV':'"development"'} });
await writeFile(resolve(out,'index.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Expense implementation review</title><link rel="stylesheet" href="globals.css"><link rel="stylesheet" href="emerald-paper.css"><link rel="stylesheet" href="admin-expenses.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
console.log('Expense component preview built from the live read model. Authentication routes unchanged.');
