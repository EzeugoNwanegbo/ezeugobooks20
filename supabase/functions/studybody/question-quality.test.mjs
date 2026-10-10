import assert from 'node:assert/strict';
import {test} from 'node:test';
import {balanceMcqs,validMcq,questionDifficulty,difficultyLabel} from './question-quality.ts';
const question=()=>({prompt:'Which change increases cardiac output?',options:[{id:'A',text:'A faster heart rate'},{id:'B',text:'A slower heart rate'},{id:'C',text:'A lower stroke volume'},{id:'D',text:'A smaller stroke volume'}],correct_answer:'A',explanation:'Option A increases output; choice B and (C) reduce it.',source_refs:[{file:'Physiology.pdf',page:'Page 5'}]});
function seeded(seed){let s=seed;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
test('only Recall and Applied survive legacy values and adaptive hints',()=>{
 assert.equal(questionDifficulty('easy'),'medium');assert.equal(questionDifficulty('recall','harder'),'medium');assert.equal(questionDifficulty('applied'),'hard');assert.equal(questionDifficulty(undefined,'easier'),'medium');assert.equal(questionDifficulty(undefined,'harder'),'hard');assert.equal(difficultyLabel('medium'),'Recall');assert.equal(difficultyLabel('hard'),'Applied');
});
test('rejects long-answer giveaways, duplicates, missing options and invalid keys',()=>{
 assert.equal(validMcq(question()),true);
 const long=question();long.options[0].text='The heart beats at an increased rate in order to raise the delivery of oxygenated blood to the working skeletal muscles.';assert.equal(validMcq(long),false);
 const duplicate=question();duplicate.options[1].text=duplicate.options[0].text;assert.equal(validMcq(duplicate),false);
 const missing=question();missing.options.pop();assert.equal(validMcq(missing),false);
 const wrong=question();wrong.correct_answer='E';assert.equal(validMcq(wrong),false);
 const all=question();all.options[3].text='All of the above';assert.equal(validMcq(all),false);
});
test('all full and partial set sizes are balanced without changing what is correct',()=>{
 for(let size=1;size<=80;size++)for(let seed=1;seed<=5;seed++){
  const originals=Array.from({length:size},()=>question()),output=balanceMcqs(originals,seeded(seed));
  const counts=Object.fromEntries(['A','B','C','D'].map(id=>[id,output.filter(q=>q.correct_answer===id).length]));
  assert.ok(Math.max(...Object.values(counts))-Math.min(...Object.values(counts))<=1);
  for(const q of output){
   assert.deepEqual(q.options.map(o=>o.id),['A','B','C','D']);
   assert.equal(q.options.find(o=>o.id===q.correct_answer).text,'A faster heart rate');
   assert.ok(q.explanation.startsWith(`Option ${q.correct_answer} increases`));
   const slow=q.options.find(o=>o.text==='A slower heart rate').id;
   const lower=q.options.find(o=>o.text==='A lower stroke volume').id;
   assert.ok(q.explanation.includes(`choice ${slow}`));assert.ok(q.explanation.includes(`(${lower})`));
  }
  assert.equal(originals[0].correct_answer,'A');
 }
});
test('shuffle varies with seed and does not force each group of four to be one of each',()=>{
 const qs=Array.from({length:20},()=>question());
 const a=balanceMcqs(qs,seeded(1)).map(q=>q.correct_answer),b=balanceMcqs(qs,seeded(5)).map(q=>q.correct_answer);
 assert.notDeepEqual(a,b);assert.ok(Array.from({length:5},(_,i)=>new Set(a.slice(i*4,i*4+4)).size).some(n=>n<4));
 assert.throws(()=>balanceMcqs([{...question(),correct_answer:'X'}]),/invalid/);
});
