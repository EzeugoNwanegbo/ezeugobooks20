import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseIntake,parseDraft,sections} from './contract.ts';
const answers=()=>Object.fromEntries(sections.map(s=>[s.id,'']));
const sample=()=>parseIntake({answers:{...answers(),biodata:'Patient says 80 years; prior summary says 58 years.',complaint:'Breathless for one month.',drugs:'Taking furosemide and spironolactone.'},clinicianFindings:'Pulse measured by clinician: 82 bpm.'});
const response=()=>({sections:sections.map(s=>({id:s.id,text:'Not obtained.',evidence:[]})),clarifications:[]});
test('blank and oversized interviews are refused before generation',()=>{
 assert.throws(()=>parseIntake({answers:answers()}),/presenting complaint/);
 assert.throws(()=>parseIntake({answers:{...answers(),complaint:'a'.repeat(8001)}}),/8,000/);
});
test('uncertainty is retained and source quotes checked; examination is never generated',()=>{
 const input=sample(),output=response();
 output.sections[0]={id:'biodata',text:'Age is unclear: 80 years in the history, 58 years in a prior summary.',evidence:[{sectionId:'biodata',quote:input.answers.biodata}]};
 output.clarifications=[{sectionId:'biodata',question:'How old are you?',reason:'The recorded ages conflict.'}];
 output.clinicianFindings='Invented normal examination';
 const result=parseDraft(output,input);
 assert.match(result.sections[0].text,/unclear/);
 assert.equal(result.clinicianFindings,input.clinicianFindings);
 assert.equal(result.sections[5].text,'Not obtained.');
});
test('fabricated evidence and unsupported findings are rejected',()=>{
 const output=response();output.sections[1]={id:'complaint',text:'No chest pain.',evidence:[{sectionId:'complaint',quote:'No chest pain.'}]};
 assert.throws(()=>parseDraft(output,sample()),/unsupported source/);
 output.sections[1].evidence=[];
 assert.throws(()=>parseDraft(output,sample()),/support its statements/);
});
test('missing/duplicate headings and invalid clarification sections are rejected',()=>{
 const output=response();output.sections[8]=output.sections[0];
 assert.throws(()=>parseDraft(output,sample()),/invalid/);
 const other=response();other.clarifications=[{sectionId:'diagnosis',question:'?',reason:'?'}];
 assert.throws(()=>parseDraft(other,sample()),/clarification/);
});
