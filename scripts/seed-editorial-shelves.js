#!/usr/bin/env node
/**
 * seed-editorial-shelves.js — creates neighborhoodGuides + photographerFeatures.
 *
 * These are the two editorial collections DiscoverEditorialScreen renders that
 * are currently EMPTY (0 docs each), which is why Discover shows "No guides yet".
 *
 * Deliberately selects only venues whose first media entry is a REHOSTED
 * Firebase Storage URL — never a Google Places URL, because those carry the
 * API key in the query string and these docs are publicly readable.
 *
 *   node scripts/seed-editorial-shelves.js            (dry run)
 *   node scripts/seed-editorial-shelves.js --execute
 */
const path=require('path'), admin=require('firebase-admin');
const EXECUTE=process.argv.includes('--execute');
admin.initializeApp({credential:admin.credential.cert(require(path.join(__dirname,'serviceAccount.json'))),projectId:'wugi-prod'});
const db=admin.firestore(), FV=admin.firestore.FieldValue;
const KEYRE=/[?&]key=AIza/;
const clean=u=>typeof u==='string'&&!KEYRE.test(u)&&/storage\.googleapis|firebasestorage/.test(u);
const NIGHT=['Bar','Nightclub','Lounge','Live Music','Comedy','Brewery/Distillery','Hotel Bar/Rooftop Pool'];

async function pickVenues(hood,n){
  const s=await db.collection('venues').where('neighborhood','==',hood).get();
  const out=[];
  s.forEach(d=>{const x=d.data();
    if(['closed','archived'].includes(x.status))return;
    if(!NIGHT.includes(x.primaryCategory))return;
    // review-count ranking alone surfaces tourist destinations over nightlife.
    if(/market|food hall|mall|hotel$|museum|park$/i.test(x.name||''))return;
    const img=(x.media||[]).map(i=>typeof i==='string'?i:i&&i.uri).find(clean);
    if(!img)return;
    out.push({id:d.id,name:x.name,cat:x.primaryCategory,img,rating:x.rating||0,reviews:x.userRatingsTotal||0});
  });
  out.sort((a,b)=>(b.reviews)-(a.reviews));
  return out.slice(0,n);
}

(async()=>{
console.log(`\n${'='.repeat(70)}\n  SEED EDITORIAL SHELVES — ${EXECUTE?'EXECUTE':'DRY RUN'}\n${'='.repeat(70)}`);
const docs=[];

for (const [hood,meta] of [
  ['Old Fourth Ward',{id:'o4w-after-dark',kicker:'NEIGHBOURHOOD GUIDE',title:'Old Fourth Ward after dark',subtitle:'Beltline-adjacent bars, listening rooms and late kitchens.',order:20}],
  ['Buckhead',       {id:'buckhead-nights',kicker:'NEIGHBOURHOOD GUIDE',title:'Buckhead, properly',subtitle:'Where Buckhead actually goes out — not where it says it does.',order:30}],
]) {
  const picks=await pickVenues(hood,6);
  if(picks.length<3){console.log(`  SKIP ${hood} — only ${picks.length} usable venues`);continue;}
  docs.push({col:'neighborhoodGuides',id:meta.id,data:{
    id:meta.id,kicker:meta.kicker,title:meta.title,subtitle:meta.subtitle,
    coverImage:picks[0].img,order:meta.order,status:'live',source:'pm-seed-2026-07-27',
    neighborhood:hood, venueIds:picks.map(p=>p.id),
    cards:picks.map((p,i)=>({kind:'venue',title:p.name,sub:p.cat,image:p.img,
      tag:p.cat==='Brewery/Distillery'?'BREWERY':p.cat.toUpperCase(),tagColor:'#2a7a5a',ratio:i===0?1.5:1,venueId:p.id})),
    createdAt:FV.serverTimestamp()}});
}

const gs=await db.collection('galleries').get();
const mine=[];
gs.forEach(d=>{const x=d.data();
  if((x.photographer?.handle||'')!=='@atlpics')return;
  if(/fifa|brunch|highlight/i.test(d.id+' '+(x.title||'')))return;
  if(!clean(x.coverImage))return;
  mine.push({id:d.id,title:x.title,cover:x.coverImage,venueId:x.venueId,date:x.date||x.event_date,count:x.photoCount});});
mine.sort((a,b)=>(b.count||0)-(a.count||0));
mine.splice(6);
const vnames={};
for(const g of mine){ if(!vnames[g.venueId]){ const v=await db.collection('venues').doc(g.venueId).get(); vnames[g.venueId]=v.exists?(v.data().name||g.venueId):g.venueId; } }
if(mine.length>=3){
  docs.push({col:'photographerFeatures',id:'atlpics-feature',data:{
    id:'atlpics-feature',kicker:'PHOTOGRAPHER',title:'Shot by Prince Williams',
    subtitle:'Nights at Teranga and Opium, through @atlpics.',
    coverImage:mine[0].cover,order:40,status:'live',source:'pm-seed-2026-07-27',
    photographerHandle:'@atlpics',photographerName:'Prince Williams',
    galleryIds:mine.map(g=>g.id),
    cards:mine.map((g,i)=>({kind:'gallery',title:g.title,sub:`${g.count||''} photos`.trim(),
      image:g.cover,tag:'GALLERY',tagColor:'#7c3aed',ratio:i===0?1.5:1,
      galleryId:g.id,venueName:vnames[g.venueId],date:String(g.date||'')})),
    createdAt:FV.serverTimestamp()}});
}

docs.forEach(d=>{
  console.log(`\n  [${d.col}/${d.id}]  order=${d.data.order}  status=${d.data.status}`);
  console.log(`    ${d.data.kicker} — ${d.data.title}`);
  console.log(`    "${d.data.subtitle}"`);
  console.log(`    cover clean: ${clean(d.data.coverImage)?'YES':'*** NO — KEYED URL ***'}`);
  d.data.cards.forEach(c=>console.log(`      · ${c.kind.padEnd(8)} ${String(c.title).slice(0,34).padEnd(36)} [${c.tag}] clean=${clean(c.image)?'y':'N'}`));
});
const dirty=docs.flatMap(d=>[d.data.coverImage,...d.data.cards.map(c=>c.image)]).filter(u=>!clean(u));
console.log(`\n  SUMMARY: ${docs.length} shelves · ${docs.reduce((a,d)=>a+d.data.cards.length,0)} cards · keyed URLs: ${dirty.length}`);
if(dirty.length){console.log('  ABORT — refusing to write keyed URLs into public docs.');process.exit(1);}
if(!EXECUTE){console.log('\n  DRY RUN — nothing written.\n');process.exit(0);}
const b=db.batch();
docs.forEach(d=>b.set(db.collection(d.col).doc(d.id),d.data,{merge:true}));
await b.commit();
console.log(`\n  WROTE ${docs.length} shelves.\n`);
process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
