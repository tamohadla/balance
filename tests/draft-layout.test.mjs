import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/moves-entry.js',import.meta.url),'utf8');
const setup=source.slice(source.indexOf('function setupDraft(){'),source.indexOf('\nfunction summary()'));
// Minimal DOM tree: exercise the actual draft initializer without database access.
class Element {
  constructor(name){this.name=name;this.children=[];this.hidden=false;}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  before(...nodes){const i=this.parent.children.indexOf(this);for(const n of nodes)n.parent=this.parent;this.parent.children.splice(i,0,...nodes);}
  closest(selector){for(let n=this;n;n=n.parent)if(selector==='.entry-layout'&&n.className==='entry-layout')return n;return null;}
  setAttribute(){}
  addEventListener(){}
}
for(const mode of ['empty','saved','unreadable'])test(`draft notices preserve form and summary columns: ${mode}`,()=>{
  const main=new Element('main'),layout=new Element('layout'),form=new Element('form'),aside=new Element('aside');
  layout.className='entry-layout';main.append(layout);layout.append(form,aside);
  const ids={moveForm:form,entryFields:{},saveEntry:{},btnCancel:{},btnBulkImport:{}};
  const context={document:{createElement:n=>new Element(n)},$:id=>ids[id],window:{addEventListener(){}},
    localStorage:{getItem(){if(mode==='unreadable')throw Error('blocked');return mode==='saved'?JSON.stringify({lines:[{item_id:'sample'}]}):null;}},
    draftKey:'test',admin:true,pending:null,draftReady:false,persistDraft(){}};
  vm.runInNewContext(setup+'\nsetupDraft();',context);
  assert.deepEqual(layout.children,[form,aside]);
  assert.equal(main.children.length,3);
  assert.equal(main.children[2],layout);
  assert.equal(main.children[1].id,'draftStatus');
  assert.equal(main.children[0].hidden,mode!=='saved');
  if(mode==='saved')assert.equal(ids.entryFields.disabled,true);
});
