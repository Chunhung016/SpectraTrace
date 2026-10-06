import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('Minimal home renders only name, search and upload; search keeps catalog routing',async()=>{
  const js=await readFile(new URL('../dist/bank.js',import.meta.url),'utf8');
  const start=js.indexOf('function home(){'),end=js.indexOf('function library(){',start);
  const app={innerHTML:''},form={},input={value:'aspirin'};
  const context=vm.createContext({app,document:{querySelector:s=>s==='#home-search'?form:input},location:{hash:'#home'},query:'',collection:'old',offset:30});
  vm.runInContext(js.slice(start,end)+'\nhome();',context);
  assert.match(app.innerHTML,/<h1>Spectra<span>Trace<\/span><\/h1>/);
  assert.match(app.innerHTML,/aria-label="Search compounds"/);
  assert.match(app.innerHTML,/aria-label="Search"/);
  assert.match(app.innerHTML,/href="#upload-unknown"/);
  assert.doesNotMatch(app.innerHTML,/<p\b|class="card"|class="banner"|<nav\b|<footer\b/);
  let prevented=false;form.onsubmit({preventDefault(){prevented=true}});
  assert.equal(prevented,true);assert.equal(context.query,'aspirin');assert.equal(context.collection,'');assert.equal(context.offset,0);assert.equal(context.location.hash,'find/aspirin');
});

test('Light shell retains all research routes and accessible controls',async()=>{
  const html=await readFile(new URL('../dist/bank.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../dist/bank.css',import.meta.url),'utf8');
  for(const route of ['home','library','evidence','logic','upload-unknown','upload-reference','samples','settings'])assert.ok(html.includes('href="#'+route+'"'));
  assert.match(css,/color-scheme:light/);assert.match(css,/\.landing>header,\.landing>footer\{display:none\}/);
  assert.match(css,/@media\(max-width:650px\)/);assert.match(html,/aria-label="Close compound details"/);
});
