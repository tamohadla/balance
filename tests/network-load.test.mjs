import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckLimiter } from '../js/check-limiter.js';
test('focus and token event bursts share one check with no automatic retry', async () => {
  let time=0,calls=0,finish;
  const limiter=createCheckLimiter(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},30000,()=>time);
  const burst=Array.from({length:40},()=>limiter.run());
  await Promise.resolve(); assert.equal(calls,1); finish(); await Promise.all(burst);
  await limiter.run(); assert.equal(calls,1);
  time=30000; const next=limiter.run(); await Promise.resolve(); assert.equal(calls,2); finish(); await next;
  limiter.markChecked(); time=40000; await limiter.run(); assert.equal(calls,2);
});
test('network failures do not trigger a retry loop', async () => {
  let calls=0; const limiter=createCheckLimiter(async()=>{calls++;throw Error('offline');});
  await assert.rejects(limiter.run(),/offline/); await limiter.run(); assert.equal(calls,1);
});

