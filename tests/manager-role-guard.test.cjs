const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('la recuperación de cobros reconoce a Jefe y Administrador y rechaza Mesero o sesión ausente',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const start=source.indexOf('  const isManager ='),end=source.indexOf('  const isWaiter =',start);
 assert.ok(start>=0 && end>start,'La función usada por recuperación y reportes debe existir en la aplicación');
 const state={currentUser:null},context=vm.createContext({state});
 vm.runInContext(source.slice(start,end)+';globalThis.guard=isManager;',context);
 assert.equal(context.guard(),false);
 for(const role of ['boss','admin']){state.currentUser={role};assert.equal(context.guard(),true);}
 state.currentUser=null;
 for(const user of [{role:'waiter'},{role:'unknown'},{},null,undefined])assert.equal(context.guard(user),false);
 state.currentUser={role:'waiter'};assert.equal(context.guard(),false);
});
