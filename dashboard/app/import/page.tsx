'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

// ── Types ─────────────────────────────────────────────────────────
type ImportStatus = 'idle' | 'running' | 'success' | 'error';
type Collection = 'venues' | 'events' | 'deals' | 'galleries';

interface ImportResult {
  collection: Collection;
  count: number;
  errors: string[];
}

// ── Picsum helper ─────────────────────────────────────────────────
const img = (seed: string, w = 800, h = 600) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

// ── Seed data ─────────────────────────────────────────────────────
const SEED_VENUES = [
  {
    id: 'nite-owl',
    name: 'Nite Owl Kitchen & Cocktails',
    category: 'Bar · Kitchen · Late Night',
    address: '6 Olive Street, Avondale Estates, GA 30002',
    phone: '(678) 925-4418',
    website: 'https://niteowlatl.com',
    instagram: '@niteowlatl',
    attributes: ['Open Late', 'Kid Friendly', 'Pet Friendly', 'Happy Hour'],
    about: 'Avondale Estates neighborhood gem serving elevated bar food and creative cocktails. Known for their legendary late-night happy hour.',
    media: [img('niteowl1'), img('niteowl2'), img('niteowl3')],
    menuDescription: 'Elevated bar food, craft cocktails, happy hour specials',
    vibes: ['Divey', 'Late Night'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'skylounge-atl',
    name: 'SkyLounge ATL',
    category: 'Rooftop Bar · Lounge',
    address: '3390 Peachtree Rd NE, Atlanta, GA 30326',
    phone: '(404) 555-0101',
    website: 'https://skyloungedatl.com',
    instagram: '@skyloungedatl',
    attributes: ['Rooftop', 'Bottle Service', 'Dress Code', 'Open Late'],
    about: "Atlanta's premier rooftop lounge with panoramic city views.",
    media: [img('skylounge1'), img('skylounge2'), img('skylounge3')],
    menuDescription: 'Craft cocktails, small plates, bottle service',
    vibes: ['Boujee', 'Rooftop'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'tongue-groove',
    name: 'Tongue & Groove',
    category: 'Nightclub · Live Music',
    address: '565 Main Street NE, Atlanta, GA 30324',
    phone: '(404) 261-2325',
    website: 'https://tongueandgrooveatl.com',
    instagram: '@tonguegrooveatl',
    attributes: ['Nightclub', 'Live Music', 'Dress Code', '21+'],
    about: "Atlanta's iconic nightclub. World-class DJs and live performances every weekend.",
    media: [img('tongue1'), img('tongue2'), img('tongue3')],
    menuDescription: 'Full bar, bottle service, VIP packages',
    vibes: ['High Energy', 'Boujee'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'opera-atlanta',
    name: 'Opera Atlanta',
    category: 'Nightclub · EDM',
    address: '1150 Crescent Ave NE, Atlanta, GA 30309',
    phone: '(404) 874-3006',
    website: 'https://operaatlanta.com',
    instagram: '@operaatl',
    attributes: ['Nightclub', 'EDM', 'Bottle Service', '18+'],
    about: "Atlanta's largest nightclub. World-renowned DJs and an unforgettable experience.",
    media: [img('opera1'), img('opera2'), img('opera3')],
    menuDescription: 'Full bar, VIP tables, bottle service',
    vibes: ['High Energy', 'Boujee'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'elleven45-lounge',
    name: 'Elleven45 Lounge',
    category: 'Upscale Lounge · Hip Hop',
    address: '1145 Crescent Ave NE, Atlanta, GA 30309',
    phone: '(404) 724-9495',
    website: 'https://elleven45.com',
    instagram: '@elleven45atl',
    attributes: ['Hip Hop', 'Bottle Service', 'Dress Code', '21+'],
    about: "Midtown's hottest hip-hop and R&B lounge. Celebrity sightings every weekend.",
    media: [img('elleven1'), img('elleven2'), img('elleven3')],
    menuDescription: 'Premium bottles, craft cocktails, VIP sections',
    vibes: ['Boujee', 'High Energy'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'ivy-buckhead',
    name: 'Ivy Buckhead',
    category: 'Upscale Lounge · Cocktail Bar',
    address: '48 Irby Ave NW, Atlanta, GA 30305',
    phone: '(404) 816-4690',
    website: 'https://ivybuckhead.com',
    instagram: '@ivybuckhead',
    attributes: ['Upscale', 'Cocktail Bar', 'Dress Code', 'Reservations'],
    about: "Buckhead's most sophisticated cocktail lounge.",
    media: [img('ivy1'), img('ivy2'), img('ivy3')],
    menuDescription: 'Handcrafted cocktails, wine, small plates',
    vibes: ['Boujee', 'Speakeasy'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'ponce-city-market',
    name: 'Ponce City Market',
    category: 'Food Hall · Rooftop',
    address: '675 Ponce De Leon Ave NE, Atlanta, GA 30308',
    phone: '(404) 900-7900',
    website: 'https://poncecitymarket.com',
    instagram: '@poncecitymarket',
    attributes: ['Food Hall', 'Rooftop', 'All Ages', 'Outdoor'],
    about: "Atlanta's premier food and beverage destination with rooftop views.",
    media: [img('ponce1'), img('ponce2'), img('ponce3')],
    menuDescription: 'Diverse food hall vendors, rooftop cocktails',
    vibes: ['Rooftop', 'High Energy'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'stats-brewpub',
    name: 'Stats Brewpub',
    category: 'Sports Bar · Brewpub',
    address: '300 Marietta St NW, Atlanta, GA 30313',
    phone: '(404) 885-1472',
    website: 'https://statsatlanta.com',
    instagram: '@statsatl',
    attributes: ['Sports Bar', 'Craft Beer', 'All Ages', 'Happy Hour'],
    about: 'Sports bar meets craft brewery in downtown Atlanta. 22 screens, 40+ taps.',
    media: [img('stats1'), img('stats2'), img('stats3')],
    menuDescription: 'Craft beers, burgers, wings, weekend brunch',
    vibes: ['Divey', 'High Energy'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'clermont-lounge',
    name: 'Clermont Lounge',
    category: 'Dive Bar · Entertainment',
    address: '789 Ponce de Leon Ave NE, Atlanta, GA 30306',
    phone: '(404) 874-4783',
    website: 'https://clermontlounge.net',
    instagram: '@clermontlounge',
    attributes: ['Dive Bar', 'Late Night', 'Cash Only', 'Iconic'],
    about: "Atlanta's most legendary dive bar. An institution since 1965.",
    media: [img('clermont1'), img('clermont2'), img('clermont3')],
    menuDescription: 'Cold beer, well drinks, cash only',
    vibes: ['Divey', 'Late Night'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'st-regis-bar',
    name: 'The Roof at St. Regis',
    category: 'Hotel Bar · Rooftop',
    address: '88 W Paces Ferry Rd NW, Atlanta, GA 30305',
    phone: '(404) 563-7900',
    website: 'https://stregisatlanta.com',
    instagram: '@stregisatlanta',
    attributes: ['Rooftop', 'Luxury', 'Hotel Bar', 'Dress Code'],
    about: 'The pinnacle of Atlanta rooftop dining in Buckhead.',
    media: [img('stregis1'), img('stregis2'), img('stregis3')],
    menuDescription: 'Luxury cocktails, champagne, fine dining',
    vibes: ['Boujee', 'Rooftop'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'darwin-cocktails',
    name: "Darwin's on Spring",
    category: 'Cocktail Bar · Speakeasy',
    address: '195 Spring St NW, Atlanta, GA 30303',
    phone: '(404) 835-8080',
    website: 'https://darwinsonspring.com',
    instagram: '@darwinsonspring',
    attributes: ['Craft Cocktails', 'Speakeasy', 'Happy Hour', 'Small Plates'],
    about: 'Hidden gem craft cocktail bar in downtown Atlanta.',
    media: [img('darwin1'), img('darwin2'), img('darwin3')],
    menuDescription: 'Artisanal cocktails, curated spirits, charcuterie',
    vibes: ['Speakeasy', 'Boujee'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'whiskey-bird',
    name: 'Whiskey Bird',
    category: 'Bar · Asian Fusion',
    address: '1409 N Highland Ave NE, Atlanta, GA 30306',
    phone: '(404) 996-6476',
    website: 'https://whiskeybird.com',
    instagram: '@whiskeybirdatl',
    attributes: ['Whiskey Bar', 'Late Night', 'Food', 'Virginia-Highland'],
    about: 'Virginia-Highland whiskey bar and Asian-inspired eatery.',
    media: [img('whiskey1'), img('whiskey2'), img('whiskey3')],
    menuDescription: 'Whiskey flights, Asian fusion snacks, late night menu',
    vibes: ['Divey', 'Speakeasy'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'mbar',
    name: 'MBar',
    category: 'Rooftop Bar · Hotel',
    address: '265 Peachtree Center Ave, Atlanta, GA 30303',
    phone: '(404) 521-0000',
    website: 'https://marriott.com/mbar',
    instagram: '@mbardtlatl',
    attributes: ['Rooftop', 'Hotel Bar', 'Skyline Views', 'Cocktails'],
    about: 'Perched on the 50th floor of the Marriott Marquis.',
    media: [img('mbar1'), img('mbar2'), img('mbar3')],
    menuDescription: 'Sky-high cocktails, wines, light bites',
    vibes: ['Boujee', 'Rooftop'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'age-bar',
    name: 'Age Bar',
    category: 'Cocktail Bar · Live DJ',
    address: '327 Edgewood Ave SE, Atlanta, GA 30312',
    phone: '(404) 835-8765',
    website: 'https://agebar.atl',
    instagram: '@agebar_atl',
    attributes: ['Craft Cocktails', 'DJ', 'Late Night', 'Old Fourth Ward'],
    about: "Old Fourth Ward's coolest cocktail bar. Rotating local DJs and creative cocktails.",
    media: [img('agebar1'), img('agebar2'), img('agebar3')],
    menuDescription: 'Craft cocktails, local beers, late night bites',
    vibes: ['High Energy', 'Divey'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'herban-fix',
    name: 'Herban Fix Lounge',
    category: 'Lounge · Vegan',
    address: '830 Peachtree St NE, Atlanta, GA 30308',
    phone: '(404) 875-0123',
    website: 'https://herbanfix.com',
    instagram: '@herbanfixatl',
    attributes: ['Vegan', 'Lounge', 'Live Music', 'Midtown'],
    about: "Atlanta's premier vegan lounge. Creative plant-based cocktails and live jazz.",
    media: [img('herban1'), img('herban2'), img('herban3')],
    menuDescription: 'Vegan cocktails, plant-based small plates, mocktails',
    vibes: ['Speakeasy', 'Boujee'],
    isActive: true,
    isFeatured: false,
  },
];

const SEED_EVENTS = [
  { id: 'euphoria-fridays', title: 'Euphoria Fridays', venueId: 'skylounge-atl', venueName: 'SkyLounge ATL', date: 'FRI MAR 21', time: '10 PM', age: '21+', about: 'The most immersive Friday night rooftop experience in Atlanta.', media: [img('euphoria1', 800, 1000)], isActive: true, isFeatured: true, tags: ['Rooftop', 'DJ'] },
  { id: 'bottle-wars-sundays', title: 'Bottle Wars Sundays', venueId: 'nite-owl', venueName: 'Nite Owl Kitchen & Cocktails', date: 'SUN MAR 23', time: '8 PM', age: '21+', about: "Atlanta's most legendary Sunday night experience.", media: [img('bottlewars1', 800, 1000)], isActive: true, isFeatured: true, tags: ['Sunday', 'Bottle Service'] },
  { id: 'atl-rooftop-social', title: 'ATL Rooftop Social', venueId: 'ponce-city-market', venueName: 'Ponce City Market', date: 'SAT MAR 22', time: '7 PM', age: '21+', about: "Atlanta's premier rooftop social mixer.", media: [img('rooftop1', 800, 1000)], isActive: true, isFeatured: true, tags: ['Social', 'Rooftop'] },
  { id: 'ladies-night-ivy', title: 'Ladies Night', venueId: 'ivy-buckhead', venueName: 'Ivy Buckhead', date: 'FRI MAR 28', time: '9 PM', age: '21+', about: 'Ladies get in free before 11PM.', media: [img('ladies1', 800, 1000)], isActive: true, isFeatured: false, tags: ['Ladies Night', 'Free Entry'] },
  { id: 'sunday-funday-brunch', title: 'Sunday Funday Brunch', venueId: 'stats-brewpub', venueName: 'Stats Brewpub', date: 'SUN MAR 23', time: '11 AM', age: 'All Ages', about: "Atlanta's favorite Sunday brunch with bottomless mimosas.", media: [img('brunch1', 800, 1000)], isActive: true, isFeatured: false, tags: ['Brunch', 'Bottomless'] },
  { id: 'opera-saturdays', title: 'Opera Saturdays', venueId: 'opera-atlanta', venueName: 'Opera Atlanta', date: 'SAT MAR 22', time: '10 PM', age: '18+', about: "The biggest Saturday night in Atlanta.", media: [img('opera1', 800, 1000)], isActive: true, isFeatured: true, tags: ['EDM', 'Nightclub'] },
  { id: 'hip-hop-fridays', title: 'Hip Hop Fridays', venueId: 'elleven45-lounge', venueName: 'Elleven45 Lounge', date: 'FRI MAR 21', time: '9 PM', age: '21+', about: "Midtown's hottest hip-hop night.", media: [img('hiphop1', 800, 1000)], isActive: true, isFeatured: true, tags: ['Hip Hop', 'R&B'] },
  { id: 'speakeasy-thursdays', title: 'Speakeasy Thursdays', venueId: 'darwin-cocktails', venueName: "Darwin's on Spring", date: 'THU MAR 20', time: '8 PM', age: '21+', about: 'Secret menu, live jazz, craft cocktails.', media: [img('speakeasy1', 800, 1000)], isActive: true, isFeatured: false, tags: ['Speakeasy', 'Jazz'] },
];

const SEED_DEALS = [
  { id: 'nite-owl-happy-hour', title: 'Half Off Bottles', venueId: 'nite-owl', venueName: 'Nite Owl Kitchen & Cocktails', detail: 'Before 9 PM tonight', image: img('deal1'), isActive: true },
  { id: 'ivy-ladies-free', title: 'Ladies Drink Free', venueId: 'ivy-buckhead', venueName: 'Ivy Buckhead', detail: 'Before 11 PM Fridays', image: img('deal2'), isActive: true },
  { id: 'skylounge-happy-hour', title: '2-for-1 Cocktails', venueId: 'skylounge-atl', venueName: 'SkyLounge ATL', detail: 'Happy Hour 4–7 PM', image: img('deal3'), isActive: true },
  { id: 'stats-brunch-deal', title: 'Bottomless Mimosas $25', venueId: 'stats-brewpub', venueName: 'Stats Brewpub', detail: 'Every Sunday 11AM–3PM', image: img('deal4'), isActive: true },
  { id: 'clermont-cheap-beer', title: '$3 Beers All Night', venueId: 'clermont-lounge', venueName: 'Clermont Lounge', detail: 'Every night, cash only', image: img('deal5'), isActive: true },
];

// ── Component ─────────────────────────────────────────────────────
export default function ImportPage() {
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [clearFirst, setClearFirst] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState<Collection[]>([
    'venues', 'events', 'deals',
  ]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const toggleCollection = (col: Collection) => {
    setSelectedCollections((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const clearCollection = async (col: Collection) => {
    addLog(`🗑️  Clearing ${col}...`);
    const snap = await getDocs(collection(db, col));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    addLog(`   Deleted ${snap.size} documents from ${col}`);
  };

  const importCollection = async (
    col: Collection,
    data: any[]
  ): Promise<ImportResult> => {
    const errors: string[] = [];
    let count = 0;
    addLog(`📥 Importing ${data.length} ${col}...`);
    for (const item of data) {
      try {
        const { id, ...rest } = item;
        await setDoc(doc(db, col, id), {
          ...rest,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        count++;
        addLog(`   ✅ ${item.name || item.title || item.id}`);
      } catch (e: any) {
        errors.push(`${item.id}: ${e.message}`);
        addLog(`   ❌ ${item.id}: ${e.message}`);
      }
    }
    return { collection: col, count, errors };
  };

  const runImport = async () => {
    setStatus('running');
    setResults([]);
    setLogs([]);
    const allResults: ImportResult[] = [];

    try {
      if (clearFirst) {
        addLog('🧹 Clearing existing data...');
        for (const col of selectedCollections) {
          await clearCollection(col);
        }
      }

      if (selectedCollections.includes('venues')) {
        allResults.push(await importCollection('venues', SEED_VENUES));
      }
      if (selectedCollections.includes('events')) {
        allResults.push(await importCollection('events', SEED_EVENTS));
      }
      if (selectedCollections.includes('deals')) {
        allResults.push(await importCollection('deals', SEED_DEALS));
      }

      setResults(allResults);
      setStatus('success');
      addLog('\n🎊 Import complete!');
    } catch (e: any) {
      addLog(`\n❌ Import failed: ${e.message}`);
      setStatus('error');
    }
  };

  const totalImported = results.reduce((sum, r) => sum + r.count, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Data Import</h1>
          <p className="text-gray-400">Seed Firestore with real ATL venue and event data</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Config Panel */}
          <div className="space-y-6">

            {/* Collections to import */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h2 className="text-lg font-semibold mb-4">Collections</h2>
              <div className="space-y-3">
                {(['venues', 'events', 'deals', 'galleries'] as Collection[]).map((col) => {
                  const counts: Record<Collection, number> = {
                    venues: SEED_VENUES.length,
                    events: SEED_EVENTS.length,
                    deals: SEED_DEALS.length,
                    galleries: 0,
                  };
                  const selected = selectedCollections.includes(col);
                  return (
                    <button
                      key={col}
                      onClick={() => toggleCollection(col)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
                        selected
                          ? 'bg-emerald-900/30 border-emerald-600 text-emerald-400'
                          : 'bg-gray-800 border-gray-700 text-gray-400'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-gray-500'}`}>
                          {selected && <span className="text-white text-xs">✓</span>}
                        </div>
                        <span className="capitalize font-medium">{col}</span>
                      </div>
                      <span className={`text-sm px-2 py-0.5 rounded-full ${selected ? 'bg-emerald-900 text-emerald-300' : 'bg-gray-700 text-gray-500'}`}>
                        {counts[col]} records
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Options */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h2 className="text-lg font-semibold mb-4">Options</h2>
              <button
                onClick={() => setClearFirst((p) => !p)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
                  clearFirst
                    ? 'bg-red-900/30 border-red-600 text-red-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400'
                }`}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${clearFirst ? 'bg-red-500 border-red-500' : 'border-gray-500'}`}>
                  {clearFirst && <span className="text-white text-xs">✓</span>}
                </div>
                <div className="text-left">
                  <div className="font-medium">Clear before import</div>
                  <div className="text-xs opacity-60 mt-0.5">Delete existing docs first (use carefully)</div>
                </div>
              </button>
            </div>

            {/* Summary */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h2 className="text-lg font-semibold mb-4">Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-400">
                  <span>Collections selected</span>
                  <span className="text-white font-medium">{selectedCollections.length}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Total records</span>
                  <span className="text-white font-medium">
                    {selectedCollections.reduce((sum, col) => {
                      const counts: Record<Collection, number> = { venues: SEED_VENUES.length, events: SEED_EVENTS.length, deals: SEED_DEALS.length, galleries: 0 };
                      return sum + counts[col];
                    }, 0)}
                  </span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Firebase project</span>
                  <span className="text-emerald-400 font-medium">wugi-prod</span>
                </div>
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={runImport}
              disabled={status === 'running' || selectedCollections.length === 0}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                status === 'running'
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : selectedCollections.length === 0
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40'
              }`}
            >
              {status === 'running' ? '⏳ Importing...' : '🚀 Run Import'}
            </button>

            {/* Results */}
            {status === 'success' && (
              <div className="bg-emerald-900/20 border border-emerald-700 rounded-xl p-5">
                <div className="text-emerald-400 font-bold text-lg mb-3">✅ Import Complete</div>
                <div className="space-y-2">
                  {results.map((r) => (
                    <div key={r.collection} className="flex justify-between text-sm">
                      <span className="text-gray-300 capitalize">{r.collection}</span>
                      <span className="text-emerald-400 font-medium">{r.count} imported</span>
                    </div>
                  ))}
                  <div className="border-t border-emerald-800 pt-2 mt-2 flex justify-between font-bold">
                    <span className="text-white">Total</span>
                    <span className="text-emerald-400">{totalImported} records</span>
                  </div>
                  {totalErrors > 0 && (
                    <div className="text-red-400 text-sm mt-2">{totalErrors} errors — check logs</div>
                  )}
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="bg-red-900/20 border border-red-700 rounded-xl p-5">
                <div className="text-red-400 font-bold">❌ Import Failed</div>
                <div className="text-gray-400 text-sm mt-1">Check logs for details</div>
              </div>
            )}
          </div>

          {/* Log Panel */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col" style={{ height: '680px' }}>
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Import Log</h2>
              {logs.length > 0 && (
                <button onClick={() => setLogs([])} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                  Clear
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-600 text-center mt-8">
                  Logs will appear here when you run the import
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`${
                        log.includes('✅') ? 'text-emerald-400' :
                        log.includes('❌') ? 'text-red-400' :
                        log.includes('🎊') ? 'text-yellow-400' :
                        log.includes('🗑️') ? 'text-orange-400' :
                        log.includes('📥') ? 'text-blue-400' :
                        'text-gray-400'
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* API Import section - future */}
        <div className="mt-6 bg-gray-900/50 rounded-xl p-6 border border-gray-800 border-dashed">
          <div className="flex items-start gap-4">
            <div className="text-3xl">🔌</div>
            <div>
              <h3 className="font-semibold text-white mb-1">API Import — Coming Soon</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Connect to Google Places, Yelp, or Eventbrite APIs to automatically pull in venue and event data. 
                Set up scheduled imports to keep your data fresh without manual work.
              </p>
              <div className="flex gap-2 mt-3">
                {['Google Places', 'Yelp Fusion', 'Eventbrite', 'Ticketmaster'].map((api) => (
                  <span key={api} className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full border border-gray-700">
                    {api}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
