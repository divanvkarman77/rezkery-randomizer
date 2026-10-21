const {test}=require('node:test');
const assert=require('node:assert/strict');
require('fake-indexeddb/auto');
const {DOMParser}=require('linkedom');global.DOMParser=DOMParser;
const C=require('../suite/core.js');
const {Repository}=require('../suite/repository.js');
const {Importer}=require('../suite/importer.js');
async function* chunks(text,n=19){for(let i=0;i<text.length;i+=n)yield text.slice(i,i+n);}
const movie=(id,extra={})=>({url:`https://rezka.fi/films/drama/${id}-example-1990.html`,title:`Фильм ${id}`,year:1990,...extra});
test('numeric identity survives mirror and renamed slug; title is not an ID',()=>{
 assert.equal(C.identity(movie(123)),C.identity({...movie(123),url:'https://rezkery.com/series/123-renamed.html'}));
 assert.notEqual(C.identity(movie(123)),C.identity(movie(124)));
 assert.equal(C.normalize(movie(123)).movie.year,1990);
 assert.equal(C.normalize(movie(123,{year:'' ,url:'https://rezka.fi/films/123-unknown.html'})).movie.year,null);
});
test('JSON streaming keeps nested categories, tags, arrays and escaped strings',async()=>{
 const out=[],p=new C.JsonRecords(x=>out.push(x));
 for await(const s of chunks(JSON.stringify({format:'rezka-suite',schemaVersion:1,movies:[movie(1,{categories:[{id:'x'}],details:{cast:['A','B']},title:'а \\" <script>'})]}),1))await p.feed(s);
 await p.finish();assert.equal(out.length,1);assert.equal(out[0].value.categories.length,1);assert.equal(p.metadata.format,'rezka-suite');
});
test('streaming parser rejects invalid/truncated JSON and prototype keys are inert',async()=>{
 for(const text of ['{"movies":[{},]}','{"x":1 "y":2}','{"x":','{}{}','[1,]']){const p=new C.JsonRecords(()=>{});await assert.rejects(async()=>{await p.feed(text);await p.finish();});}
 const p=new C.JsonRecords(()=>{});await p.feed('{"__proto__":{"polluted":true}}');await p.finish();assert.equal({}.polluted,undefined);
});
test('pagination preserves current scope and query, with no fixed page cap',()=>{
 const doc=new DOMParser().parseFromString('<div class="b-navigation"><a href="/page/1/?filter=last&genre=1">1</a><a href="/page/9999/?filter=last&genre=1">9999</a><a href="/year/2026/page/2/">2</a></div>','text/html');
 assert.equal(C.pagination(doc,'https://rezkery.com/?genre=1&filter=last').max,9999);
 assert.equal(C.pageUrl('https://rezka.fi/films/best/foreign/1990/?filter=last&genre=1',7),'https://rezka.fi/films/best/foreign/1990/page/7/?filter=last&genre=1');
});
test('import is staged, idempotent, separates full catalogue and history; portable roundtrip',async()=>{
 const r=new Repository('test-'+Math.random());
 const input={version:1,categories:[{id:'https://rezka.fi/year/1990/',baseUrl:'https://rezka.fi/year/1990/',title:'1990',cards:[movie(1),movie(2)]}]};
 const i=new Importer(r);await i.json(chunks(JSON.stringify(input)));assert.equal(await r.count('movies'),0);await i.apply();
 assert.equal(await r.count('movies'),2);assert.equal(await r.count('history'),0);assert.equal(await r.count('memberships'),2);
 await r.put('userState',{id:'rezka:1',note:'Моя заметка',rating:8});
 const j=new Importer(r);await j.json(chunks(JSON.stringify(input)));await j.apply();assert.equal(await r.count('movies'),2);assert.equal((await r.get('userState','rezka:1')).note,'Моя заметка');
 const old=new Importer(r);await old.json(chunks(JSON.stringify({format:'rezkery-randomizer-db',version:1,items:[movie(1)]})));await old.apply();assert.equal(await r.count('history'),1);
 const future=new Importer(r);await assert.rejects(()=>future.json(chunks('{"format":"rezka-suite","schemaVersion":99,"movies":[]}')));assert.equal(await r.count('movies'),2);
 r.close();
});
test('HTML imports unquoted attributes, cached posters, hostile script as inert data',async()=>{
 const r=new Repository('html-'+Math.random()),i=new Importer(r);
 const s='<html><script>throw Error("never execute")</script><h1>Каталог</h1><div class=b-content__inline_item data-id=13><div class=b-content__inline_item-cover><img src="data:image/png;base64,AAAA"></div><div class=b-content__inline_item-link><a href="https://rezka.fi/films/13-film-1990.html">Название</a><div>1990, США</div></div></div></html>';
 await i.html(chunks(s,7));await i.apply();assert.equal(await r.count('movies'),1);assert.equal(await r.count('assets'),1);assert.equal((await r.get('movies','rezka:13')).year,1990);r.close();
});
