// ─────────────────────────────────────────────────────────────────────
// Wugi — Mock Data
// Replace with live Firestore data as Firebase is wired in
// ─────────────────────────────────────────────────────────────────────
import type {
  EventData,
  VenueData,
  GalleryData,
  ForYouCard,
  PassData,
  StoryGroup,
} from '../types';

// ── Gallery factory ───────────────────────────────────────────────────
export const makeGallery = (
  id: string,
  title: string,
  venue: string,
  date: string,
  seeds: string[]
): GalleryData => ({
  id,
  title,
  venue,
  date,
  coverImage: `https://picsum.photos/seed/${seeds[0]}/400/400`,
  photos: seeds.map((seed, i) => ({
    id: `${id}_p${i}`,
    uri: `https://picsum.photos/seed/${seed}/400/${[500,300,600,400,350,520,280,450,380,460][i % 10]}`,
    height: [220,160,260,180,170,230,150,200,175,205][i % 10],
  })),
});

// ── Galleries ─────────────────────────────────────────────────────────
export const GALLERIES = {
  euphoria:   makeGallery('g_euphoria',  'Euphoria Fridays',    'SkyLounge ATL',    'FRI MAR 21', ['gp1','gp2','gp3','gp4','gp5','gp6','gp7','gp8']),
  bottleWars: makeGallery('g_bottle',   'Bottle Wars Sundays', 'Nite Owl Kitchen', 'SUN MAR 23', ['bp1','bp2','bp3','bp4','bp5','bp6']),
  rooftop:    makeGallery('g_rooftop',  'ATL Rooftop Social',  'Ponce City Market','SAT MAR 22', ['rp1','rp2','rp3','rp4','rp5']),
  brunch:     makeGallery('g_brunch',   'Sunday Funday Brunch','Stats Brewpub',    'SUN MAR 23', ['sp1','sp2','sp3','sp4','sp5']),
  ladies:     makeGallery('g_ladies',   'Ladies Night',        'Ivy Buckhead',     'FRI MAR 28', ['lp1','lp2','lp3','lp4']),
  skylounge:  makeGallery('g_sky',      'SkyLounge ATL',       'SkyLounge ATL',    'Mar 2026',   ['sv1','sv2','sv3','sv4','sv5']),
  niteowl:    makeGallery('g_nite',     'Nite Owl Kitchen',    'Nite Owl Kitchen', 'Mar 2026',   ['nv1','nv2','nv3','nv4']),
};

export const ALL_GALLERIES = Object.values(GALLERIES);

// ── Events ────────────────────────────────────────────────────────────
export const EVENTS: EventData[] = [
  {
    id: 'e1',
    title: 'Euphoria Fridays',
    venue: 'SkyLounge ATL',
    date: 'FRI MAR 21',
    time: '10 PM',
    age: '21+',
    about: "The most immersive Friday night experience in Atlanta. Featuring the city's top DJs, rooftop views, and bottle service.",
    media: [
      { type: 'image', uri: 'https://picsum.photos/seed/ev1a/800/1000' },
      { type: 'image', uri: 'https://picsum.photos/seed/ev1b/800/1000' },
      { type: 'video', uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
      { type: 'image', uri: 'https://picsum.photos/seed/ev1c/800/1000' },
    ],
    gallery: GALLERIES.euphoria,
  },
  {
    id: 'e2',
    title: 'Bottle Wars Sundays',
    venue: 'Nite Owl Kitchen',
    date: 'SUN MAR 23',
    time: '8 PM',
    age: '21+',
    about: "Atlanta's most legendary Sunday night experience.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev2a/800/1000' }],
    gallery: GALLERIES.bottleWars,
  },
  {
    id: 'e3',
    title: 'ATL Rooftop Social',
    venue: 'Ponce City Market',
    date: 'SAT MAR 22',
    time: '7 PM',
    age: '21+',
    about: "Atlanta's premier rooftop social event.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev3a/800/1000' }],
    gallery: GALLERIES.rooftop,
  },
  {
    id: 'e4',
    title: 'Sunday Funday Brunch',
    venue: 'Stats Brewpub',
    date: 'SUN MAR 23',
    time: '11 AM',
    age: 'All Ages',
    about: "Atlanta's favorite Sunday brunch experience.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev4a/800/1000' }],
    gallery: GALLERIES.brunch,
  },
  {
    id: 'e5',
    title: 'Ladies Night',
    venue: 'Ivy Buckhead',
    date: 'FRI MAR 28',
    time: '9 PM',
    age: '21+',
    about: 'Ladies get in free before 11PM.',
    media: [
      { type: 'image', uri: 'https://picsum.photos/seed/ev5a/800/1000' },
      { type: 'image', uri: 'https://picsum.photos/seed/ev5b/800/1000' },
    ],
    gallery: GALLERIES.ladies,
  },
];

// ── Venues ────────────────────────────────────────────────────────────
export const VENUES: VenueData[] = [
  {
    id: 'v1',
    name: 'Nite Owl Kitchen & Cocktails',
    category: 'Bar · Kitchen · Late Night',
    address: '6 Olive Street, Avondale Estates, GA 30002',
    phone: '(678) 925-4418',
    website: 'https://niteowlatl.com',
    instagram: '@niteowlatl',
    attributes: ['Open Late','Kid Friendly','Pet Friendly','Happy Hour'],
    about: "Serves Happy Hour Food · Serves Great Cocktails · Doesn't Accept Reservations",
    media: [
      'https://picsum.photos/seed/venue1/800/600',
      'https://picsum.photos/seed/venue2/800/600',
      'https://picsum.photos/seed/venue3/800/600',
    ],
    menuDescription: 'Serves Happy Hour Food · Serves Great Cocktails',
    menuAttributes: ['Open Late','Kid Friendly','Pet Friendly','Happy Hour'],
    bestSellers: [
      { id:'bs1', name:'Nacho',        category:'Appetizers', rating:4.7, image:'https://picsum.photos/seed/food1/300/300' },
      { id:'bs2', name:'Steak Dinner', category:'Entrees',    rating:4.7, image:'https://picsum.photos/seed/food2/300/300' },
    ],
    upcomingEvents: [EVENTS[1], EVENTS[3]],
    galleries: [GALLERIES.bottleWars, GALLERIES.niteowl],
  },
  {
    id: 'v2',
    name: 'SkyLounge ATL',
    category: 'Rooftop Bar · Lounge',
    address: '3390 Peachtree Rd NE, Atlanta, GA 30326',
    phone: '(404) 555-0101',
    website: 'https://skyloungedatl.com',
    instagram: '@skyloungedatl',
    attributes: ['Rooftop','Bottle Service','Dress Code','Open Late'],
    about: "Atlanta's premier rooftop lounge with panoramic city views.",
    media: [
      'https://picsum.photos/seed/fv1/800/600',
      'https://picsum.photos/seed/fv1b/800/600',
    ],
    menuDescription: 'Craft cocktails, small plates, bottle service',
    menuAttributes: ['Bottle Service','Happy Hour','Late Night'],
    bestSellers: [
      { id:'bs4', name:'Sky Martini', category:'Cocktails', rating:4.9, image:'https://picsum.photos/seed/food4/300/300' },
    ],
    upcomingEvents: [EVENTS[0], EVENTS[2]],
    galleries: [GALLERIES.euphoria, GALLERIES.skylounge],
  },
  {
    id: 'v3',
    name: 'Tongue & Groove',
    category: 'Nightclub',
    address: '565 Main Street NE, Atlanta, GA 30324',
    phone: '(404) 555-0202',
    website: 'https://tongueandgrooveatl.com',
    instagram: '@tonguegrooveatl',
    attributes: ['Nightclub','Live Music','Dress Code','21+'],
    about: "Atlanta's iconic nightclub.",
    media: [
      'https://picsum.photos/seed/fv2/800/600',
      'https://picsum.photos/seed/fv2b/800/600',
    ],
    menuDescription: 'Full bar, bottle service, VIP packages',
    menuAttributes: ['Bottle Service','VIP','Late Night'],
    bestSellers: [
      { id:'bs6', name:'VIP Bottle Package', category:'Bottle Service', rating:4.8, image:'https://picsum.photos/seed/food6/300/300' },
    ],
    upcomingEvents: [EVENTS[4]],
    galleries: [GALLERIES.ladies],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────
export const getVenueByName = (name: string): VenueData | undefined =>
  VENUES.find(v =>
    v.name === name ||
    v.name.includes(name) ||
    name.includes(v.name.split(' ')[0])
  );

// ── Home screen derived lists ─────────────────────────────────────────
export const FEATURED_PICKS = [EVENTS[0], EVENTS[1], EVENTS[2]];

export const DEALS = [
  { id:'d1', title:'Half Off Bottles',   venueName:'Nite Owl Kitchen & Cocktails', detail:'Before 9 PM tonight',   image:'https://picsum.photos/seed/deal1/600/400' },
  { id:'d2', title:'Ladies Drink Free',  venueName:'Tongue & Groove',              detail:'Before 11 PM Fridays',  image:'https://picsum.photos/seed/deal2/600/400' },
  { id:'d3', title:'2-for-1 Cocktails',  venueName:'SkyLounge ATL',                detail:'Happy Hour 4–7 PM',     image:'https://picsum.photos/seed/deal3/600/400' },
];

export const VIBE_LIST = [
  { id:'vb1', label:'Boujee',      color:'#1a0a2e', accent:'#9b59b6', image:'https://picsum.photos/seed/vb1/400/200' },
  { id:'vb2', label:'Divey',       color:'#1a0a00', accent:'#e67e22', image:'https://picsum.photos/seed/vb2/400/200' },
  { id:'vb3', label:'Speakeasy',   color:'#0a0a0a', accent:'#95a5a6', image:'https://picsum.photos/seed/vb3/400/200' },
  { id:'vb4', label:'High Energy', color:'#1a0000', accent:'#e74c3c', image:'https://picsum.photos/seed/vb4/400/200' },
  { id:'vb5', label:'Rooftop',     color:'#00051a', accent:'#3498db', image:'https://picsum.photos/seed/vb5/400/200' },
  { id:'vb6', label:'Late Night',  color:'#050510', accent:'#2980b9', image:'https://picsum.photos/seed/vb6/400/200' },
];

export const DISCOVER_VIBES = [
  { label:'Boujee',      accent:'#9b59b6' },
  { label:'Divey',       accent:'#e67e22' },
  { label:'Speakeasy',   accent:'#95a5a6' },
  { label:'High Energy', accent:'#e74c3c' },
  { label:'Rooftop',     accent:'#3498db' },
  { label:'Late Night',  accent:'#2980b9' },
];

// ── For You cards ─────────────────────────────────────────────────────
export const FOR_YOU_CARDS: ForYouCard[] = [
  { id:'fy1',      type:'event',  image:'https://picsum.photos/seed/ev1a/800/1200',  title:'Euphoria Fridays',     subtitle:'SkyLounge ATL · FRI MAR 21 · 10 PM', tag:'Tonight',      tagColor:'#2a7a5a', data:EVENTS[0] },
  { id:'fy_video1',type:'video',  image:'https://picsum.photos/seed/vid1/800/1200',  title:'Friday Night Vibes',   subtitle:'SkyLounge ATL · Live Now',            tag:'Video',        tagColor:'#e74c3c', data:null, videoUri:'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
  { id:'fy2',      type:'venue',  image:'https://picsum.photos/seed/fv1/800/1200',   title:'SkyLounge ATL',        subtitle:'Rooftop Bar · Buckhead',              tag:'Venue',        tagColor:'#3498db', data:VENUES[1] },
  { id:'fy3',      type:'food',   image:'https://picsum.photos/seed/food2/800/1200', title:'Wagyu Sliders',        subtitle:'Nite Owl Kitchen & Cocktails',        tag:'Food',         tagColor:'#e67e22', data:null },
  { id:'fy4',      type:'event',  image:'https://picsum.photos/seed/ev2a/800/1200',  title:'Bottle Wars Sundays',  subtitle:'Nite Owl Kitchen · SUN MAR 23',       tag:'Upcoming',     tagColor:'#9b59b6', data:EVENTS[1] },
  { id:'fy5',      type:'deal',   image:'https://picsum.photos/seed/deal1/800/1200', title:'Half Off Bottles',     subtitle:'Nite Owl Kitchen · Before 9 PM',      tag:'Deal',         tagColor:'#e74c3c', data:null },
  { id:'fy6',      type:'venue',  image:'https://picsum.photos/seed/fv2/800/1200',   title:'Tongue & Groove',      subtitle:'Nightclub · Midtown',                 tag:'Venue',        tagColor:'#3498db', data:VENUES[2] },
  { id:'fy8',      type:'event',  image:'https://picsum.photos/seed/ev3a/800/1200',  title:'ATL Rooftop Social',   subtitle:'Ponce City Market · SAT MAR 22',      tag:'This Weekend', tagColor:'#2a7a5a', data:EVENTS[2] },
  { id:'fy9',      type:'food',   image:'https://picsum.photos/seed/food4/800/1200', title:'Sky Martini',          subtitle:'SkyLounge ATL',                       tag:'Food',         tagColor:'#e67e22', data:null },
  { id:'fy10',     type:'deal',   image:'https://picsum.photos/seed/deal2/800/1200', title:'Ladies Drink Free',    subtitle:'Tongue & Groove · Before 11 PM',      tag:'Deal',         tagColor:'#e74c3c', data:null },
];

// ── Mock Stories ──────────────────────────────────────────────────────
export const MOCK_STORIES: StoryGroup[] = [
  {
    id: 's1', venueId: 'venue_skylounge', venueName: 'SkyLounge ATL',
    venueImage: 'https://picsum.photos/seed/fv1/200/200', seen: false,
    stories: [
      { id:'s1a', mediaUri:'https://picsum.photos/seed/story1/400/700', mediaType:'photo', username:'@marcusatl', timeAgo:'2m ago',  locationVerified:true },
      { id:'s1b', mediaUri:'https://picsum.photos/seed/story2/400/700', mediaType:'photo', username:'@tanyab',    timeAgo:'8m ago',  locationVerified:true },
    ],
  },
  {
    id: 's2', venueId: 'venue_niteowl', venueName: 'Nite Owl',
    venueImage: 'https://picsum.photos/seed/venue1/200/200', seen: false,
    stories: [
      { id:'s2a', mediaUri:'https://picsum.photos/seed/story3/400/700', mediaType:'photo', username:'@jknight88', timeAgo:'15m ago', locationVerified:true },
    ],
  },
  {
    id: 's3', venueId: 'venue_tonguegroove', venueName: 'Tongue & Groove',
    venueImage: 'https://picsum.photos/seed/fv2/200/200', seen: true,
    stories: [
      { id:'s3a', mediaUri:'https://picsum.photos/seed/story4/400/700', mediaType:'photo', username:'@atlatl',    timeAgo:'1h ago',  locationVerified:false },
    ],
  },
  {
    id: 's4', venueId: 'venue_ponce', venueName: 'Ponce City',
    venueImage: 'https://picsum.photos/seed/pcm1/200/200', seen: false,
    stories: [
      { id:'s4a', mediaUri:'https://picsum.photos/seed/story5/400/700', mediaType:'photo', username:'@nightlifer', timeAgo:'30m ago', locationVerified:true },
      { id:'s4b', mediaUri:'https://picsum.photos/seed/story6/400/700', mediaType:'photo', username:'@pcmatl',     timeAgo:'45m ago', locationVerified:true },
    ],
  },
  {
    id: 's_ad', venueId: 'venue_ivybuckhead', venueName: 'Ivy Buckhead',
    venueImage: 'https://picsum.photos/seed/ivy1/200/200', seen: false,
    isAd: true, ctaLabel: 'Book a Table',
    stories: [
      { id:'sad1', mediaUri:'https://picsum.photos/seed/ad1/400/700', mediaType:'photo', username:'Sponsored', timeAgo:'', locationVerified:false },
    ],
  },
];

// ── Mock Passes ───────────────────────────────────────────────────────
export const MOCK_PASSES: PassData[] = [
  {
    passId: 'pk_001',
    eventTitle: 'Euphoria Fridays',
    venueName: 'SkyLounge ATL',
    date: 'FRI MAR 21',
    time: '10 PM',
    ticketType: 'vip_table',
    holderName: 'Jarrod Knight',
    orderId: 'WGI-2026-00124',
    role: 'purchaser',
    status: 'claimed',
    totalPasses: 10,
    passNumber: 1,
    transferable: false,
  },
  {
    passId: 'pk_002',
    eventTitle: 'Euphoria Fridays',
    venueName: 'SkyLounge ATL',
    date: 'FRI MAR 21',
    time: '10 PM',
    ticketType: 'vip_table',
    holderName: 'Guest',
    orderId: 'WGI-2026-00124',
    role: 'guest',
    status: 'pending',
    totalPasses: 10,
    passNumber: 2,
    transferable: true,
  },
  {
    passId: 'pk_003',
    eventTitle: 'High Voltage Saturdays',
    venueName: 'Tongue & Groove',
    date: 'SAT MAR 29',
    time: '11 PM',
    ticketType: 'general_admission',
    holderName: 'Jarrod Knight',
    orderId: 'WGI-2026-00089',
    role: 'purchaser',
    status: 'claimed',
    totalPasses: 1,
    passNumber: 1,
    transferable: false,
  },
];
