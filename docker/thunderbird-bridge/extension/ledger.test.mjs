import assert from 'node:assert/strict';
import {test} from 'node:test';
import './protocol.js';
import './ledger.js';
function storage() {
  const values = {};
  return { values, async get(key) { return key === null ? {...values} : {[key]:values[key]}; }, async set(next) { Object.assign(values,next); } };
}
const command = {type:'createFolder',operationId:'0123456789abcdef',nonce:'abcdefghijklmnop',accountId:'account1',name:'Category'};
test('completed writes return durable acknowledgement after restart without native replay', async () => {
  const store = storage(); let calls = 0;
  const execute = async () => { calls++; return {accountId:'account1',folder:{id:'folder1'}}; };
  const first = globalThis.InboxZeroThunderbirdLedger.createLedger(store,execute);
  const result = await first(command);
  const restarted = globalThis.InboxZeroThunderbirdLedger.createLedger(store,execute);
  assert.deepEqual(await restarted({...command,nonce:'newnonce012345678'}),result);
  assert.equal(calls,1);
  await assert.rejects(restarted({...command,name:'different'}),{message:'WRITE_UNKNOWN'});
});
test('interrupted or failed native writes never replay automatically', async () => {
  const store = storage(); let calls = 0;
  const execute = async () => { calls++; throw new Error('lost native acknowledgement'); };
  await assert.rejects(globalThis.InboxZeroThunderbirdLedger.createLedger(store,execute)(command));
  await assert.rejects(globalThis.InboxZeroThunderbirdLedger.createLedger(store,execute)(command),{message:'WRITE_UNKNOWN'});
  assert.equal(calls,1);
});
test('failed intent persistence prevents native writes', async () => {
  let calls = 0;
  const store = {async get(){return {};},async set(){throw new Error('disk failure');}};
  await assert.rejects(globalThis.InboxZeroThunderbirdLedger.createLedger(store,async()=>{calls++;})(command));
  assert.equal(calls,0);
});
