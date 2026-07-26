#!/usr/bin/env node
/**
 * Wugi — rerank-venue-heroes.js
 *
 * Fixes the "blurry stranger as venue profile image" defect. The cause is NOT
 * blur (only 4% of the library fails a blur gate) — it is ASPECT RATIO.
 * VenueScreen renders the hero at HERO_HEIGHT = SCREEN_WIDTH / 1.2, so any
 * image with aspect < 1.2 is vertically centre-cropped, slicing a portrait
 * phone photo of people down to a torso.
 *
 * Reorders `media` so the best landscape candidate is first (fixes the app
 * with NO client change, since VenueScreen reads venue.media directly) and
 * additionally writes an explicit `heroImage` for future use.
 *
 * Requires the scored dataset produced by the photo audit:
 *   /tmp/scored_all.json  [{v,i,uri,w,h,lap,ok}]
 *
 * Usage (from repo root):
 *   NODE_PATH=./functions/node_modules node scripts/rerank-venue-heroes.js
 *   NODE_PATH=./functions/node_modules node scripts/rerank-venue-heroes.js --execute
 */
const path=require('path'), fs=require('fs');
const admin=require('firebase-admin');
const EXECUTE=process.argv.includes('--execute');
admin.initializeApp({credential:admin.credential.cert(require(path.join(__dirname,'serviceAccount.json'))),projectId:'wugi-prod'});
const db=admin.firestore(), FV=admin.firestore.FieldValue;

const MIN_ASPECT=1.2, MIN_EDGE=600, MIN_LAP=150;
const scored=JSON.parse(fs.readFileSync('/tmp/scored_all.json','utf8'));
const byUri={}; scored.forEach(r=>{ if(r.ok) byUri[r.uri]=r; });

const acceptable=r=>r && (r.w/r.h)>=MIN_ASPECT && Math.max(r.w,r.h)>=MIN_EDGE && r.lap>=MIN_LAP;
// rank: landscape first, then sharper, then larger
const rank=(a,b)=>{
  const A=acceptable(a)?1:0, B=acceptable(b)?1:0;
  if(A!==B) return B-A;
  const ar=(a.w/a.h)>=MIN_ASPECT?1:0, br=(b.w/b.h)>=MIN_ASPECT?1:0;
  if(ar!==br) return br-ar;
  if(Math.abs(b.lap-a.lap)>50) return b.lap-a.lap;
  return (b.w*b.h)-(a.w*a.h);
};

(async()=>{
 console.log(`\n${'='.repeat(72)}\n  HERO RE-RANK — ${EXECUTE?'EXECUTE':'DRY RUN'}  (aspect>=${MIN_ASPECT}, edge>=${MIN_EDGE}, lap>=${MIN_LAP})\n${'='.repeat(72)}`);
 const vs=await db.collection('venues').get();
 const plan=[]; let already=0, noneOk=0, noMedia=0, placeholder=0;
 vs.forEach(d=>{
  const x=d.data(); const m=x.media;
  if(!Array.isArray(m)||!m.length){noMedia++;return;}
  const items=m.map(it=>({raw:it,uri:typeof it==='string'?it:(it&&it.uri)}));
  if(items.some(i=>/picsum\.photos|images\.unsplash\.com/.test(i.uri||''))) placeholder++;
  const withScore=items.map(i=>({...i,s:byUri[i.uri]})).filter(i=>i.s);
  if(!withScore.length) return;
  const ok=withScore.filter(i=>acceptable(i.s));
  if(!ok.length){ noneOk++; plan.push({id:d.id,name:x.name,action:'FLAG_NO_HERO'}); return; }
  // Only intervene when the CURRENT hero actually fails. Re-ranking an
  // already-acceptable hero is pure churn and (via the sharpness tiebreak)
  // can make it worse — e.g. swapping a 2.12 banner for a 1.33 crop.
  const cur=withScore.find(i=>i.s.i===0) || withScore[0];
  if(acceptable(cur.s)){ already++; return; }
  const sorted=[...withScore].sort((a,b)=>rank(a.s,b.s));
  plan.push({id:d.id,name:x.name,action:'REORDER',
    from:cur?{ar:(cur.s.w/cur.s.h).toFixed(2),lap:Math.round(cur.s.lap),dim:`${cur.s.w}x${cur.s.h}`}:null,
    to:{ar:(sorted[0].s.w/sorted[0].s.h).toFixed(2),lap:Math.round(sorted[0].s.lap),dim:`${sorted[0].s.w}x${sorted[0].s.h}`},
    order:sorted.map(i=>i.raw), hero:sorted[0].uri});
 });
 const reorder=plan.filter(p=>p.action==='REORDER'), flag=plan.filter(p=>p.action==='FLAG_NO_HERO');
 console.log(`\n  hero already best      : ${already}`);
 console.log(`  REORDER (hero swapped) : ${reorder.length}`);
 console.log(`  FLAG no usable hero    : ${flag.length}`);
 console.log(`  venues w/ no media     : ${noMedia}`);
 console.log(`  venues w/ placeholder  : ${placeholder}`);
 console.log(`\n  ── sample reorders (current hero -> new hero) ──`);
 reorder.slice(0,18).forEach(p=>console.log(`   ${String(p.name).slice(0,30).padEnd(32)} ar ${p.from?p.from.ar:'?'} (${p.from?p.from.dim:'?'})  ->  ar ${p.to.ar} (${p.to.dim})`));
 console.log(`\n  ── flagged, no landscape photo at all ──`);
 flag.slice(0,12).forEach(p=>console.log(`   ${String(p.name).slice(0,42)}`));
 if(!EXECUTE){ console.log(`\n  DRY RUN — no writes. Re-run with --execute.\n`); process.exit(0); }
 let batch=db.batch(), n=0, done=0;
 for(const p of reorder){
   batch.set(db.collection('venues').doc(p.id),{media:p.order,heroImage:p.hero,heroSelectedBy:'hero-rerank-2026-07',heroSelectedAt:FV.serverTimestamp(),updatedAt:FV.serverTimestamp()},{merge:true});
   if(++n>=400){await batch.commit();done+=n;batch=db.batch();n=0;}
 }
 for(const p of flag){
   batch.set(db.collection('venues').doc(p.id),{heroImage:null,needsPhotoRepull:true,heroSelectedBy:'hero-rerank-2026-07',updatedAt:FV.serverTimestamp()},{merge:true});
   if(++n>=400){await batch.commit();done+=n;batch=db.batch();n=0;}
 }
 if(n)await batch.commit();
 console.log(`\n  DONE — ${reorder.length} reordered, ${flag.length} flagged.\n`);
 process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
