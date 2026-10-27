import test from 'node:test';
import assert from 'node:assert/strict';
import {accountsFresh,quotaFresh,routingReady} from '../availability.mjs';
const clock=Date.parse('2026-10-06T20:00:00Z');
const a={provider:'codex',disabled:false,unavailable:false,cooldowns:[],limity:{odczytano:new Date(clock-1000).toISOString()}};
test('provider quota availability cannot hide routing cooldowns; blockers and expiry are model-specific',()=>{
 const blocked={...a,cooldowns:[{scope:'model',model_key:'gpt-6.1-sol',retry_at:new Date(clock+86400000).toISOString()}]};
 assert.equal(quotaFresh(blocked,clock),true);assert.equal(routingReady(blocked,'gpt-6.1-sol',clock),false);
 assert.equal(routingReady(blocked,'gpt-image-2.5-flare',clock),true);
 assert.equal(routingReady(blocked,'gpt-6.1-sol',clock+86400001),true);
 assert.equal(routingReady({...blocked,cooldowns:[{scope:'credential'}]},'gpt-image-2.5-flare',clock),false);
 assert.equal(routingReady({...a,disabled:true},'gpt-6.1-sol',clock),false);
 assert.equal(routingReady({...a,odczyt_swiezy:false},'gpt-6.1-sol',clock),null);
});
test('failed, expired, missing and future snapshots are not current availability',()=>{
 assert.equal(accountsFresh({ostatniOdczytKont:clock-1000},clock),true);
 for(const s of [{ostatniOdczytKont:clock-1000,bladKont:'HTTP 503'},{ostatniOdczytKont:clock-90001},{ostatniOdczytKont:clock+60000},{}])assert.equal(accountsFresh(s,clock),false);
 assert.equal(quotaFresh(a,clock),true);
 for(const limity of [{...a.limity,blad:'HTTP 429'},{...a.limity,nieswiezy:true},{odczytano:new Date(clock-90001).toISOString()},{}])assert.equal(quotaFresh({...a,limity},clock),false);
});
