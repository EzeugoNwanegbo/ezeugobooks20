import{_ as l}from"./index-C1yyw-5Y.js";function m(t){return t.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(r,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-fA-F]+);/g,(r,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,"&")}function u(t,r){return m(t.replace(r,`
`).replace(/<[^>]+>/g,"")).replace(/\r/g,"").replace(/[ \t]+\n/g,`
`).replace(/\n{3,}/g,`

`).trim()}function p(t){return Number(t.match(/slide(\d+)\.xml$/)?.[1]??0)}async function f(t){const{unzipSync:r,strFromU8:n}=await l(async()=>{const{unzipSync:c,strFromU8:e}=await import("./browser-c3U3mMxj.js");return{unzipSync:c,strFromU8:e}},[]),a=r(new Uint8Array(await t.arrayBuffer()))["word/document.xml"];return a?u(n(a),/<\/w:p>|<w:br\s*\/?>/g):""}async function g(t){const{unzipSync:r,strFromU8:n}=await l(async()=>{const{unzipSync:e,strFromU8:o}=await import("./browser-c3U3mMxj.js");return{unzipSync:e,strFromU8:o}},[]),i=r(new Uint8Array(await t.arrayBuffer())),a=Object.keys(i).filter(e=>/^ppt\/slides\/slide\d+\.xml$/.test(e)).sort((e,o)=>p(e)-p(o)),c=[];return a.forEach((e,o)=>{const s=u(n(i[e]),/<\/a:p>|<a:br\s*\/?>/g);s&&c.push(`[Slide ${o+1}]
${s}`)}),{text:c.join(`

`),slideCount:a.length}}export{f as extractDocxText,g as extractPptxText};
