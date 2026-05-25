// ─────────────────────────────────────────────────────────────────────
// Firestore security-rules test suite (durable infra).
//
// Loads the COMMITTED firebase/firestore.rules and exercises the
// favorites/reports blocks + sanity on existing collections.
//
// "Enforced" checks MUST pass (write locks + existing read behavior).
// "gate" checks (F5, R5 = owner-only READ) are the acceptance criteria for the
// PRE-PUBLIC-LAUNCH read-hardening (Asana 1215108652658606). They currently
// FAIL on purpose — the catch-all (`match /{document=**} allow read: if isAuth()`)
// still grants any authed user read on every collection. When the catch-all is
// hardened, F5/R5 flip to PASS and the gate is closed.
//
// Run from tools/rules-test/:  npm test   (starts the emulator + runs this)
// Exit 0 iff all ENFORCED checks pass (the gate status is reported, not fatal).
// ─────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, updateDoc } = require('firebase/firestore');

const RULES = path.join(__dirname, '..', '..', 'firebase', 'firestore.rules');

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'wugi-rules-test',
    firestore: { rules: fs.readFileSync(RULES, 'utf8') },
  });

  const ownerDb = testEnv.authenticatedContext('pgtest-owner').firestore();
  const otherDb = testEnv.authenticatedContext('pgtest-other').firestore();
  const anonDb  = testEnv.unauthenticatedContext().firestore();

  // Seed existing docs (rules bypassed) so read/delete checks have a resource.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'favorites/pgtest-owner_event_pgtest'), { userId: 'pgtest-owner', itemType: 'event', itemId: 'pgtest', createdAt: new Date() });
    await setDoc(doc(db, 'reports/pgtest-report'), { photoId: 'pgtest', userId: 'pgtest-owner', reason: 'x', comment: 'x', status: 'open', createdAt: new Date() });
    await setDoc(doc(db, 'events/anyid'), { title: 'e' });
    await setDoc(doc(db, 'venues/anyid'), { name: 'v' });
    await setDoc(doc(db, 'photos/anyid'), { imageUrl: 'u' });
    await setDoc(doc(db, 'galleries/anyid'), { title: 'g' });
  });

  const results = [];
  const run = async (id, desc, expect, op, gate = false) => {
    try { await (expect === 'allow' ? assertSucceeds(op) : assertFails(op)); results.push({ id, desc, expect, gate, status: 'PASS' }); }
    catch (e) { results.push({ id, desc, expect, gate, status: 'FAIL', err: String(e.message || e).split('\n')[0] }); }
  };
  const fav = (db, id) => doc(db, 'favorites/' + id);
  const rep = (db, id) => doc(db, 'reports/' + id);

  // ── Favorites ──
  await run('F1', 'owner create own favorite', 'allow', setDoc(fav(ownerDb,'pgtest-owner_event_x'), { userId:'pgtest-owner', itemType:'event', itemId:'x', createdAt:new Date() }));
  await run('F2', 'non-owner create favorite w/ other uid', 'deny', setDoc(fav(otherDb,'pgtest-owner_event_x'), { userId:'pgtest-owner', itemType:'event', itemId:'x', createdAt:new Date() }));
  await run('F3', 'other creates their OWN favorite', 'allow', setDoc(fav(otherDb,'pgtest-other_event_x'), { userId:'pgtest-other', itemType:'event', itemId:'x', createdAt:new Date() }));
  await run('F4', 'owner read own favorite', 'allow', getDoc(fav(ownerDb,'pgtest-owner_event_pgtest')));
  await run('F5', 'non-owner read others favorite', 'deny', getDoc(fav(otherDb,'pgtest-owner_event_pgtest')), true); // GATE
  await run('F7', 'unauth read favorite', 'deny', getDoc(fav(anonDb,'pgtest-owner_event_pgtest')));
  await run('F6', 'owner delete own favorite', 'allow', deleteDoc(fav(ownerDb,'pgtest-owner_event_pgtest')));

  // ── Reports ──
  await run('R1', 'owner create report status=open', 'allow', setDoc(rep(ownerDb,'newrep'), { photoId:'p1', userId:'pgtest-owner', reason:'spam', comment:'x', status:'open', createdAt:new Date() }));
  await run('R2', 'owner create report status=resolved', 'deny', setDoc(rep(ownerDb,'newrep2'), { photoId:'p1', userId:'pgtest-owner', reason:'spam', comment:'x', status:'resolved', createdAt:new Date() }));
  await run('R3', 'other create report w/ owner uid', 'deny', setDoc(rep(otherDb,'newrep3'), { photoId:'p1', userId:'pgtest-owner', reason:'spam', comment:'x', status:'open', createdAt:new Date() }));
  await run('R4', 'owner read own report', 'allow', getDoc(rep(ownerDb,'pgtest-report')));
  await run('R5', 'non-owner read others report', 'deny', getDoc(rep(otherDb,'pgtest-report')), true); // GATE
  await run('R6', 'owner update report (client)', 'deny', updateDoc(rep(ownerDb,'pgtest-report'), { status:'resolved' }));

  // ── Sanity (existing collections / catch-all intact) ──
  await run('S1', 'unauth read events (public)', 'allow', getDoc(doc(anonDb,'events/anyid')));
  await run('S2', 'unauth read venues (public)', 'allow', getDoc(doc(anonDb,'venues/anyid')));
  await run('S3', 'auth read photos (catch-all)', 'allow', getDoc(doc(ownerDb,'photos/anyid')));
  await run('S4', 'unauth read photos', 'deny', getDoc(doc(anonDb,'photos/anyid')));
  await run('S5', 'auth create photo (admin-only)', 'deny', setDoc(doc(ownerDb,'photos/anyid2'), { imageUrl:'u' }));
  await run('S6', 'auth read galleries (catch-all)', 'allow', getDoc(doc(ownerDb,'galleries/anyid')));

  await testEnv.cleanup();

  const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
  console.log('\n  ID   EXPECT RESULT GATE  CHECK');
  for (const r of results) console.log(`  ${pad(r.id,4)} ${pad(r.expect,6)} ${pad(r.status,6)} ${pad(r.gate?'gate':'',5)} ${r.desc}${r.err ? '  [' + r.err + ']' : ''}`);

  const enforced = results.filter(r => !r.gate);
  const enforcedFail = enforced.filter(r => r.status === 'FAIL');
  const gate = results.filter(r => r.gate);
  const gateMet = gate.every(r => r.status === 'PASS');
  console.log(`\n  Enforced: ${enforced.length - enforcedFail.length}/${enforced.length} pass.`);
  console.log(`  Pre-launch read-hardening gate (Asana 1215108652658606): ${gateMet ? 'CLOSED — reads are owner-only' : 'OPEN — F5/R5 broadly readable (expected until catch-all is hardened)'}`);
  if (enforcedFail.length) { console.log('  ENFORCED FAILURES: ' + enforcedFail.map(f => f.id).join(', ')); process.exit(1); }
  console.log('  All enforced checks pass.');
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
