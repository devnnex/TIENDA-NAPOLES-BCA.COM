const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
test('un rechazo de respaldo conserva la venta y permite enviar otra independiente',async()=>{
 let jobs=[{id:'first',status:'failed',lastError:'Factura rechazada',action:'record_sale',payload:{invoice:{id:'one'}}},{id:'second',status:'pending',action:'record_sale',payload:{invoice:{id:'two'}}}];
 const sent=[],state={appsScriptOutboxBusy:false};
 const context=vm.createContext({state,Date,performance,recordSyncEvent(){},updateGlobalSyncStatus(){},getOfflineSyncStatus:async()=>({blockingRecords:[]}),navigator:{onLine:true},window:{setTimeout:()=>1},clearTimeout(){},
  APPS_SCRIPT_TIMEOUT_MS:45000,scheduleAppsScriptRetry(){},
  isAppsScriptConfigured:()=>true,flushDurableWrites:async()=>true,readAppsScriptOutbox:()=>structuredClone(jobs),
  writeAppsScriptOutbox:async next=>{jobs=structuredClone(next);return true;},
  appsScriptRequest:async(action,payload)=>{sent.push(payload.invoice.id);return payload.invoice.id==='one'?{ok:false,retryable:false,error:'Factura rechazada'}:{ok:true};},
  setInventorySyncStatus(){},normalizeText:value=>String(value).toLowerCase(),toast(){},applyRemoteInventoryItems(){}});
 const start=source.indexOf('  const runAppsScriptOutbox ='),end=source.indexOf('  const bootstrapRemoteStorage =',start);
 const helpers=source.slice(source.indexOf('  const isSupabaseWriteBlockingJob ='),source.indexOf('  const isPendingInventoryJob ='));
 vm.runInContext(helpers+source.slice(start,end)+';globalThis.flush=runAppsScriptOutbox;',context);
 assert.equal(await context.flush(),false);
 assert.deepEqual(sent,['two']);
 assert.equal(jobs.length,1);assert.equal(jobs[0].payload.invoice.id,'one');
 assert.equal(jobs[0].status,'failed');assert.match(jobs[0].lastError,/rechazada/);
});
