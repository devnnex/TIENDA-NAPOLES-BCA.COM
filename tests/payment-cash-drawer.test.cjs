const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const section=(start,end)=>{const from=source.indexOf('  const '+start+' ='),to=source.indexOf('  const '+end+' =',from+1);assert.ok(from>=0&&to>from);return source.slice(from,to);};
const setup=(method,closed=true,device='bridge')=>{
 const calls=[];
 const account={id:'account-8',table_id:'table-8',session_payments:[{id:'abono-1',amount:40,payment_method:'transfer',created_at:'2026-10-07T18:00:00Z'}],
  session_items:[{id:'item-1',item_name:'Producto',quantity:1,unit_price:100,status:'served'}]};
 const state={paymentProcessing:false,authToken:'valid',currentUser:{id:'staff-1'},sessions:[account],inventoryMeta:{},activePaymentBase:100,activePaymentTotal:60};
 state.posFeatures={remote_drawer:true};
 state.sb={rpc:async(name)=>{calls.push(name);return {data:{command:{id:'remote-command',status:'accepted'}}};}};
 const buttons=[{disabled:false},{disabled:false}];
 const form={session_id:{value:account.id},cash_received:{value:100,focus(){}},payment_reference:{value:''}};
 const context=vm.createContext({state,console,
  $:()=>({close(){calls.push('dialog-close');}}),$$:()=>buttons,
  window:{posCashDrawer:device==='bridge'?{open:async()=>{calls.push('drawer');return true;}}:null,open:()=>({close(){calls.push('popup-close');}})},
  navigator:{userAgent:device==='mobile'?'Android':'Windows',onLine:true},setTimeout:callback=>callback(),
  cashDrawerRequest:async()=>{if(device==='controller')return {settings:{printer:'POS'},printers:['POS']};throw Error('No local drawer');},
  sendCashDrawerPulse:async()=>{calls.push('drawer');return true;},
  dbQuiet:async query=>(await query).data,
  toast:()=>{},tipsEnabled:()=>false,integerMoney:value=>Math.max(0,Math.round(Number(value||0))),currencyInputNumber:input=>Number(input?.value||0),
  paymentFromForm:()=>({method,payments:method==='mixed'?[{method:'cash',amount:30},{method:'breb',amount:30}]:[{method,amount:60}]}),
  paidInventoryPlan:()=>[],validatePaidInventory:()=>true,
  sessionTotals:()=>({subtotal:100,total:100,discount:0,tax:0,serviceFee:0}),
  closeSession:async(id,checkout)=>{assert.equal(id,account.id);assert.equal(checkout.paid,40);return closed?{session:account,saved:{closed_at:'2026-10-07T19:00:00Z'},totals:{subtotal:100,total:100}}:null;},
  uid:()=> 'invoice-8',sessionReference:()=> 'M8',sessionLabel:()=> 'Mesa 8',paymentMethodLabel:()=>method,
  applyPaidInventoryLocally:()=>{},applyInvoiceToInventory:invoice=>calls.push(invoice),
  renderInventory:()=>calls.push('render-inventory'),renderTips:()=>{},printThermalReceipt:()=>calls.push('print')});
 vm.runInContext(section('sessionPayments','abonoRowsHtml')+section('openLocalCashDrawer','getAppsScriptUrl')
  +section('processPayment','renderConsumptionSelection')+';globalThis.process=processPayment;globalThis.openDrawer=openCashDrawer;',context);
 return {context,calls,form};
};
for(const method of ['cash','transfer','breb','mixed'])for(const action of ['save','print']){
 test('BCA '+method+'/'+action+': cobra saldo, conserva abono y abre caja una vez',async()=>{
  const app=setup(method);await app.context.process(app.form,{value:action});
  const invoice=app.calls.find(call=>typeof call==='object');
  assert.equal(invoice.remainingPaid,60);assert.equal(invoice.prepayments.length,1);
  assert.equal(invoice.payments.reduce((sum,row)=>sum+row.amount,0),100);
  assert.equal(invoice.totals.total,100);assert.equal(invoice.changeDue,method==='cash'?40:0);
  assert.equal(app.calls.filter(call=>call==='drawer').length,1);
  assert.ok(app.calls.indexOf('drawer')<app.calls.indexOf('render-inventory'),'El pulso sale antes de reconstruir la interfaz.');
  assert.equal(app.calls.filter(call=>call==='print').length,action==='print'?1:0);
 });
}
test('BCA no abre ni imprime cuando el servidor rechaza el cierre',async()=>{
 const app=setup('cash',false);await app.context.process(app.form,{value:'print'});
 assert.equal(app.calls.includes('drawer'),false);assert.equal(app.calls.includes('print'),false);
 assert.equal(app.calls.some(call=>typeof call==='object'),false);
});

for(const device of ['mobile','desktop','controller'])for(const method of ['cash','transfer','breb','mixed'])for(const action of ['save','print']){
 test('BCA '+device+' '+method+'/'+action+': apertura automática exclusivamente local',async()=>{
  const app=setup(method,true,device);await app.context.process(app.form,{value:action});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(app.calls.some(call=>typeof call==='object'),'El pago se registra.');
  assert.equal(app.calls.filter(call=>call==='drawer').length,device==='controller'?1:0);
  assert.equal(app.calls.includes('request_pos_drawer'),false,'El cobro no solicita abrir una caja remota.');
  assert.equal(app.calls.filter(call=>call==='print').length,action==='print'?1:0);
 });
}

test('La apertura manual explícita conserva su comportamiento',async()=>{
 const app=setup('cash',true,'mobile');
 assert.equal(await app.context.openDrawer(),true);
 assert.equal(app.calls.filter(call=>call==='request_pos_drawer').length,1);
});
