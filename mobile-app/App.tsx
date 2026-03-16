import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  ScrollView,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  useColorScheme,
  Linking,
  Animated,
} from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share, PanResponder, GestureResponderEvent } from 'react-native';



const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Theme ─────────────────────────────────────────────────────────────
const COLORS = {
  dark: {
    bg: '#0a0a0a', card: '#141414', surface: '#0f0f0f',
    border: '#222', text: '#f0f0f0', subtext: '#666',
    accent: '#2a7a5a', pill: '#141414', pillBorder: '#222',
    divider: '#1a1a1a',
  },
  light: {
    bg: '#fafafa', card: '#fff', surface: '#f4f4f4',
    border: '#eee', text: '#0a0a0a', subtext: '#999',
    accent: '#2a7a5a', pill: '#f4f4f4', pillBorder: '#eee',
    divider: '#f0f0f0',
  },
};

// ── Types ─────────────────────────────────────────────────────────────
type GalleryPhoto = {
  id: string;
  uri: string;
  height: number;
};

type GalleryData = {
  id: string;
  title: string;
  venue: string;
  date: string;
  coverImage: string;
  photos: GalleryPhoto[];
};

type EventData = {
  id: string; title: string; venue: string; date: string;
  time: string; age: string; about: string;
  media: { type: string; uri: string }[];
  gallery: GalleryData;
};

type VenueData = {
  id: string; name: string; category: string; address: string;
  phone: string; website: string; instagram: string;
  attributes: string[]; about: string;
  media: string[]; menuDescription: string; menuAttributes: string[];
  bestSellers: { id: string; name: string; category: string; rating: number; image: string }[];
  upcomingEvents: EventData[];
  galleries: GalleryData[];
};

type NavEntry =
  | { screen: 'home' }
  | { screen: 'event'; event: EventData }
  | { screen: 'venue'; venue: VenueData }
  | { screen: 'map'; address: string; venueName: string }
  | { screen: 'gallery'; gallery: GalleryData }
  | { screen: 'photo'; photos: GalleryPhoto[]; initialIndex: number; galleryTitle: string; venue: string; date: string };

// ── Gallery Data ──────────────────────────────────────────────────────
const makeGallery = (id: string, title: string, venue: string, date: string, seeds: string[]): GalleryData => ({
  id,
  title,
  venue,
  date,
  coverImage: `https://picsum.photos/seed/${seeds[0]}/400/400`,
  photos: seeds.map((seed, i) => ({
    id: `${id}_p${i}`,
    uri: `https://picsum.photos/seed/${seed}/400/${[500, 300, 600, 400, 350, 520, 280, 450, 380, 460][i % 10]}`,
    height: [220, 160, 260, 180, 170, 230, 150, 200, 175, 205][i % 10],
  })),
});

const GALLERIES = {
  euphoria: makeGallery('g_euphoria', 'Euphoria Fridays', 'SkyLounge ATL', 'FRI MAR 21',
    ['gp1', 'gp2', 'gp3', 'gp4', 'gp5', 'gp6', 'gp7', 'gp8', 'gp9', 'gp10', 'gp11', 'gp12']),
  bottleWars: makeGallery('g_bottle', 'Bottle Wars Sundays', 'Nite Owl Kitchen', 'SUN MAR 23',
    ['bp1', 'bp2', 'bp3', 'bp4', 'bp5', 'bp6', 'bp7', 'bp8']),
  rooftop: makeGallery('g_rooftop', 'ATL Rooftop Social', 'Ponce City Market', 'SAT MAR 22',
    ['rp1', 'rp2', 'rp3', 'rp4', 'rp5', 'rp6']),
  brunch: makeGallery('g_brunch', 'Sunday Funday Brunch', 'Stats Brewpub', 'SUN MAR 23',
    ['sp1', 'sp2', 'sp3', 'sp4', 'sp5', 'sp6', 'sp7']),
  ladies: makeGallery('g_ladies', 'Ladies Night', 'Ivy Buckhead', 'FRI MAR 28',
    ['lp1', 'lp2', 'lp3', 'lp4', 'lp5']),
  skylounge: makeGallery('g_sky', 'SkyLounge ATL', 'SkyLounge ATL', 'Mar 2026',
    ['sv1', 'sv2', 'sv3', 'sv4', 'sv5', 'sv6', 'sv7', 'sv8']),
  niteowl: makeGallery('g_nite', 'Nite Owl Kitchen', 'Nite Owl Kitchen', 'Mar 2026',
    ['nv1', 'nv2', 'nv3', 'nv4', 'nv5', 'nv6']),
};

// ── Mock Data ─────────────────────────────────────────────────────────
const EVENTS: EventData[] = [
  {
    id: 'e1', title: 'Euphoria Fridays', venue: 'SkyLounge ATL',
    date: 'FRI MAR 21', time: '10 PM', age: '21+',
    about: "The most immersive Friday night experience in Atlanta. Expect surprises, amazing music and unforgettable moments.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev1a/800/1000' }, { type: 'image', uri: 'https://picsum.photos/seed/ev1b/800/1000' }],
    gallery: GALLERIES.euphoria,
  },
  {
    id: 'e2', title: 'Bottle Wars Sundays', venue: 'Nite Owl Kitchen',
    date: 'SUN MAR 23', time: '8 PM', age: '21+',
    about: "Atlanta's most legendary Sunday night experience. Bottle service specials, live DJ, and the best crowd in the city.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev2a/800/1000' }],
    gallery: GALLERIES.bottleWars,
  },
  {
    id: 'e3', title: 'ATL Rooftop Social', venue: 'Ponce City Market',
    date: 'SAT MAR 22', time: '7 PM', age: '21+',
    about: "Atlanta's premier rooftop social event. Stunning views, craft cocktails, and the city's best crowd.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev3a/800/1000' }],
    gallery: GALLERIES.rooftop,
  },
  {
    id: 'e4', title: 'Sunday Funday Brunch', venue: 'Stats Brewpub',
    date: 'SUN MAR 23', time: '11 AM', age: 'All Ages',
    about: "Atlanta's favorite Sunday brunch experience. Bottomless mimosas, live DJ, and the best brunch menu in the city.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev4a/800/1000' }],
    gallery: GALLERIES.brunch,
  },
  {
    id: 'e5', title: 'Ladies Night', venue: 'Ivy Buckhead',
    date: 'FRI MAR 28', time: '9 PM', age: '21+',
    about: "Ladies get in free before 11PM. Complimentary cocktails for the first hour. ATL's best Friday night vibes.",
    media: [{ type: 'image', uri: 'https://picsum.photos/seed/ev5a/800/1000' }],
    gallery: GALLERIES.ladies,
  },
];

const VENUES: VenueData[] = [
  {
    id: 'v1', name: 'Nite Owl Kitchen & Cocktails', category: 'Bar · Kitchen · Late Night',
    address: '6 Olive Street, Avondale Estates, GA 30002',
    phone: '(678) 925-4418', website: 'https://niteowlatl.com', instagram: '@niteowlatl',
    attributes: ['Open Late', 'Kid Friendly', 'Pet Friendly', 'Happy Hour'],
    about: "Serves Happy Hour Food · Serves Great Cocktails · Doesn't Accept Reservations",
    media: ['https://picsum.photos/seed/venue1/800/600', 'https://picsum.photos/seed/venue2/800/600', 'https://picsum.photos/seed/venue3/800/600'],
    menuDescription: "Serves Happy Hour Food · Serves Great Cocktails",
    menuAttributes: ['Open Late', 'Kid Friendly', 'Pet Friendly', 'Happy Hour'],
    bestSellers: [
      { id: 'bs1', name: 'Nacho', category: 'Appetizers', rating: 4.7, image: 'https://picsum.photos/seed/food1/300/300' },
      { id: 'bs2', name: 'Steak Dinner', category: 'Entrees', rating: 4.7, image: 'https://picsum.photos/seed/food2/300/300' },
    ],
    upcomingEvents: [EVENTS[1], EVENTS[3]],
    galleries: [GALLERIES.bottleWars, GALLERIES.niteowl],
  },
  {
    id: 'v2', name: 'SkyLounge ATL', category: 'Rooftop Bar · Lounge',
    address: '3390 Peachtree Rd NE, Atlanta, GA 30326',
    phone: '(404) 555-0101', website: 'https://skyloungedatl.com', instagram: '@skyloungedatl',
    attributes: ['Rooftop', 'Bottle Service', 'Dress Code', 'Open Late'],
    about: "Atlanta's premier rooftop lounge with panoramic city views.",
    media: ['https://picsum.photos/seed/fv1/800/600', 'https://picsum.photos/seed/fv1b/800/600'],
    menuDescription: "Craft cocktails, small plates, bottle service",
    menuAttributes: ['Bottle Service', 'Happy Hour', 'Late Night'],
    bestSellers: [
      { id: 'bs4', name: 'Sky Martini', category: 'Cocktails', rating: 4.9, image: 'https://picsum.photos/seed/food4/300/300' },
    ],
    upcomingEvents: [EVENTS[0], EVENTS[2]],
    galleries: [GALLERIES.euphoria, GALLERIES.skylounge],
  },
  {
    id: 'v3', name: 'Tongue & Groove', category: 'Nightclub',
    address: '565 Main Street NE, Atlanta, GA 30324',
    phone: '(404) 555-0202', website: 'https://tongueandgrooveatl.com', instagram: '@tonguegrooveatl',
    attributes: ['Nightclub', 'Live Music', 'Dress Code', '21+'],
    about: "Atlanta's iconic nightclub.",
    media: ['https://picsum.photos/seed/fv2/800/600', 'https://picsum.photos/seed/fv2b/800/600'],
    menuDescription: "Full bar, bottle service, VIP packages",
    menuAttributes: ['Bottle Service', 'VIP', 'Late Night'],
    bestSellers: [
      { id: 'bs6', name: 'VIP Bottle Package', category: 'Bottle Service', rating: 4.8, image: 'https://picsum.photos/seed/food6/300/300' },
    ],
    upcomingEvents: [EVENTS[4]],
    galleries: [GALLERIES.ladies],
  },
];

const getVenueByName = (name: string) => VENUES.find(v => v.name === name || v.name.includes(name) || name.includes(v.name.split(' ')[0]));

const FEATURED_PICKS = [EVENTS[0], EVENTS[1], EVENTS[2]];
const TONIGHT_PICKS = [
  { ...EVENTS[0], image: 'https://picsum.photos/seed/tp1/400/600' },
  { ...EVENTS[1], image: 'https://picsum.photos/seed/tp2/400/600' },
  { ...EVENTS[2], image: 'https://picsum.photos/seed/tp3/400/600' },
  { ...EVENTS[3], image: 'https://picsum.photos/seed/tp4/400/600' },
];
const UPCOMING_EVENTS_LIST = [
  { ...EVENTS[3], image: 'https://picsum.photos/seed/ue1/400/560' },
  { ...EVENTS[4], image: 'https://picsum.photos/seed/ue2/400/560' },
  { ...EVENTS[2], image: 'https://picsum.photos/seed/ue3/400/560' },
];
const DEALS = [
  { id: 'd1', title: 'Half Off Bottles', venueName: 'Nite Owl Kitchen & Cocktails', detail: 'Before 9 PM tonight', image: 'https://picsum.photos/seed/deal1/600/400' },
  { id: 'd2', title: 'Ladies Drink Free', venueName: 'Tongue & Groove', detail: 'Before 11 PM Fridays', image: 'https://picsum.photos/seed/deal2/600/400' },
  { id: 'd3', title: '2-for-1 Cocktails', venueName: 'SkyLounge ATL', detail: 'Happy Hour 4–7 PM', image: 'https://picsum.photos/seed/deal3/600/400' },
];
const VIBES = [
  { id: 'v1', label: 'Boujee', color: '#1a0a2e', accent: '#9b59b6', image: 'https://picsum.photos/seed/vb1/400/200' },
  { id: 'v2', label: 'Divey', color: '#1a0a00', accent: '#e67e22', image: 'https://picsum.photos/seed/vb2/400/200' },
  { id: 'v3', label: 'Speakeasy', color: '#0a0a0a', accent: '#95a5a6', image: 'https://picsum.photos/seed/vb3/400/200' },
  { id: 'v4', label: 'High Energy', color: '#1a0000', accent: '#e74c3c', image: 'https://picsum.photos/seed/vb4/400/200' },
  { id: 'v5', label: 'Rooftop', color: '#00051a', accent: '#3498db', image: 'https://picsum.photos/seed/vb5/400/200' },
  { id: 'v6', label: 'Late Night', color: '#050510', accent: '#2980b9', image: 'https://picsum.photos/seed/vb6/400/200' },
];
const NEAR_ME = [
  { id: 'n1', venueName: 'Nite Owl Kitchen & Cocktails', category: 'Bar · Kitchen', distance: '0.3 mi', open: true, image: 'https://picsum.photos/seed/nm1/120/120' },
  { id: 'n2', venueName: 'SkyLounge ATL', category: 'Rooftop Bar', distance: '0.5 mi', open: true, image: 'https://picsum.photos/seed/nm2/120/120' },
  { id: 'n3', venueName: 'Tongue & Groove', category: 'Nightclub', distance: '0.8 mi', open: false, image: 'https://picsum.photos/seed/nm3/120/120' },
];

// ── All galleries for homepage ────────────────────────────────────────
const ALL_GALLERIES = Object.values(GALLERIES);

// ── Icons ─────────────────────────────────────────────────────────────
function BackIcon({ color }: { color: string }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M19 12H5M5 12l7 7M5 12l7-7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function ShareIcon({ color }: { color: string }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function HeartIcon({ color, filled }: { color: string; filled?: boolean }) {
  return <Svg width={22} height={22} viewBox="0 0 24 24"><Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill={filled ? color : 'none'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function SearchIcon({ color }: { color: string }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"><Circle cx={11} cy={11} r={8} stroke={color} strokeWidth={2} /><Path d="M21 21l-4.35-4.35" stroke={color} strokeWidth={2} strokeLinecap="round" /></Svg>;
}
function ChevronRightIcon({ color }: { color: string }) {
  return <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"><Path d="M9 18l6-6-6-6" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function ChevronDownIcon({ color }: { color: string }) {
  return <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"><Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function StarIcon({ color }: { color: string }) {
  return <Svg width={11} height={11} viewBox="0 0 24 24"><Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill={color} /></Svg>;
}
function LocationIcon({ color }: { color: string }) {
  return <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"><Path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke={color} strokeWidth={1.5} /><Circle cx={12} cy={9} r={2.5} stroke={color} strokeWidth={1.5} /></Svg>;
}
function GlobeIcon({ color }: { color: string }) {
  return <Svg width={15} height={15} viewBox="0 0 24 24" fill="none"><Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={1.5} /><Path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke={color} strokeWidth={1.5} strokeLinecap="round" /></Svg>;
}
function InstagramIcon({ color }: { color: string }) {
  return <Svg width={15} height={15} viewBox="0 0 24 24" fill="none"><Path d="M17 2H7a5 5 0 00-5 5v10a5 5 0 005 5h10a5 5 0 005-5V7a5 5 0 00-5-5z" stroke={color} strokeWidth={1.5} /><Path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" stroke={color} strokeWidth={1.5} /><Line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke={color} strokeWidth={2} strokeLinecap="round" /></Svg>;
}
function CartIcon({ color }: { color: string }) {
  return <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"><Path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /><Path d="M3 6h18M16 10a4 4 0 01-8 0" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
function FlagIcon({ color }: { color: string }) {
  return <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"><Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /><Path d="M4 22v-7" stroke={color} strokeWidth={2} strokeLinecap="round" /></Svg>;
}
function InfoIcon({ color }: { color: string }) {
  return <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"><Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} /><Path d="M12 8v4M12 16h.01" stroke={color} strokeWidth={2} strokeLinecap="round" /></Svg>;
}

// ── Venue Identity Block ──────────────────────────────────────────────
function VenueIdentityBlock({ name, address, phone, website, instagram, onAddressPress, onVenuePress, theme }: {
  name: string; address: string; phone: string; website: string; instagram: string;
  onAddressPress: () => void; onVenuePress?: () => void; theme: typeof COLORS.dark;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: theme.subtext }}>LOGO</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <TouchableOpacity onPress={onVenuePress}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 3 }}>{name}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onAddressPress}>
            <Text style={{ color: theme.accent, fontSize: 12, marginBottom: 3, textDecorationLine: 'underline' }}>{address}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${phone}`)}>
            <Text style={{ color: theme.subtext, fontSize: 12, textDecorationLine: 'underline' }}>{phone}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setOpen(!open)} style={{ paddingLeft: 12, alignSelf: 'center' }}>
          {open ? <ChevronDownIcon color={theme.subtext} /> : <ChevronRightIcon color={theme.subtext} />}
        </TouchableOpacity>
      </View>
      {open && (
        <View style={{ marginTop: 14, paddingLeft: 76, gap: 12 }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => Linking.openURL(website)}>
            <GlobeIcon color={theme.accent} />
            <Text style={{ color: theme.text, fontSize: 13 }}>{website.replace('https://', '')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <InstagramIcon color={theme.accent} />
            <Text style={{ color: theme.text, fontSize: 13 }}>{instagram}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Photo Viewer ──────────────────────────────────────────────────────
function PhotoViewer({ photos, initialIndex, galleryTitle, venue, date, onBack, theme }: {
  photos: GalleryPhoto[]; initialIndex: number;
  galleryTitle: string; venue: string; date: string;
  onBack: () => void; theme: typeof COLORS.dark;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showUI, setShowUI] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [showInfo, setShowInfo] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const uiOpacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const likeScale = useRef(new Animated.Value(1)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const lastTap = useRef<number>(0);
  const gestureStartX = useRef(0);
  const gestureStartY = useRef(0);
  const isHorizontalGesture = useRef<boolean | null>(null);
  const photo = photos[currentIndex];

  // Scroll to initial index after mount
  useEffect(() => {
    if (initialIndex > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          x: initialIndex * SCREEN_WIDTH,
          animated: false,
        });
      }, 50);
    }
  }, []);

  const toggleUI = () => {
    Animated.timing(uiOpacity, {
      toValue: showUI ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    setShowUI(prev => !prev);
  };

  const animateHeart = () => {
    heartOpacity.setValue(0);
    likeScale.setValue(0.5);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(heartOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.spring(likeScale, { toValue: 1.4, useNativeDriver: true }),
      ]),
      Animated.spring(likeScale, { toValue: 1, useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(heartOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const handleShare = async () => {
  try {
    const fileName = `wugi_${photo.id}.jpg`;
    const localUri = FileSystem.cacheDirectory + fileName;
    const result = await FileSystem.downloadAsync(photo.uri, localUri);
    await Sharing.shareAsync(result.uri, {
      mimeType: 'image/jpeg',
      dialogTitle: galleryTitle,
      UTI: 'public.jpeg',
    });
  } catch (e) {
    console.log('Share error:', e);
  }
};

  const scrollToIndex = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
  };

  const goNext = () => { if (currentIndex < photos.length - 1) scrollToIndex(currentIndex + 1); };
  const goPrev = () => { if (currentIndex > 0) scrollToIndex(currentIndex - 1); };

  const onScrollEnd = (e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(index);
  };

  // PanResponder handles vertical swipe-down to dismiss
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const { dx, dy } = gestureState;
        // Only capture clearly vertical gestures
        return Math.abs(dy) > Math.abs(dx) * 2 && Math.abs(dy) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80) {
          // Swipe down enough — animate out and dismiss
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 250,
            useNativeDriver: true,
          }).start(onBack);
        } else {
          // Snap back
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleTap = () => {
    const now = Date.now();
    const isDoubleTap = now - lastTap.current < 300;
    lastTap.current = now;

    if (isDoubleTap) {
      const isLiked = liked[photo.id];
      setLiked(prev => ({ ...prev, [photo.id]: !isLiked }));
      if (!isLiked) animateHeart();
    } else {
      setTimeout(() => {
        if (Date.now() - lastTap.current >= 280) toggleUI();
      }, 300);
    }
  };

  return (
    <Animated.View
      style={{ flex: 1, backgroundColor: '#000', transform: [{ translateY }] }}
      {...panResponder.panHandlers}
    >
      {/* Horizontal ScrollView for image paging */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {photos.map((item, index) => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={1}
            onPress={handleTap}
            style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center' }}
          >
            <Image
              source={{ uri: item.uri }}
              style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.85 }}
              resizeMode="contain"
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Double-tap heart animation */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          alignSelf: 'center',
          top: SCREEN_HEIGHT / 2 - 44,
          opacity: heartOpacity,
          transform: [{ scale: likeScale }],
        }}
      >
        <HeartIcon color="#fff" filled />
      </Animated.View>

      {/* All UI tied to same animated opacity */}
      <Animated.View
        style={{ ...StyleSheet.absoluteFillObject, opacity: uiOpacity }}
        pointerEvents={showUI ? 'box-none' : 'none'}
      >
        {/* Left chevron */}
        {currentIndex > 0 && (
          <TouchableOpacity
            onPress={goPrev}
            style={{
              position: 'absolute', left: 10, top: '50%', marginTop: -22,
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* Right chevron */}
        {currentIndex < photos.length - 1 && (
          <TouchableOpacity
            onPress={goNext}
            style={{
              position: 'absolute', right: 10, top: '50%', marginTop: -22,
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* Top bar */}
        <SafeAreaView style={{
          flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16, paddingTop: 8,
        }}>
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}
            onPress={onBack}
          >
            <BackIcon color="#fff" />
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
            {currentIndex + 1} / {photos.length}
          </Text>
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}
            onPress={handleShare}
          >
            <ShareIcon color="#fff" />
          </TouchableOpacity>
        </SafeAreaView>

        {/* Bottom bar */}
        <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          {showInfo && (
            <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 14, padding: 14 }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{galleryTitle}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 2 }}>{venue}</Text>
              <Text style={{ color: theme.accent, fontSize: 12 }}>{date}</Text>
            </View>
          )}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
            paddingHorizontal: 24, paddingBottom: 32, paddingTop: 16,
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}>
            <TouchableOpacity
              style={{ alignItems: 'center', gap: 4 }}
              onPress={() => {
                const isLiked = liked[photo.id];
                setLiked(prev => ({ ...prev, [photo.id]: !isLiked }));
                if (!isLiked) animateHeart();
              }}
            >
              <HeartIcon color={liked[photo.id] ? '#e74c3c' : '#fff'} filled={liked[photo.id]} />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Like</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={handleShare}>
              <ShareIcon color="#fff" />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={() => setShowInfo(!showInfo)}>
              <InfoIcon color={showInfo ? theme.accent : '#fff'} />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Info</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }}>
              <CartIcon color="#fff" />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Buy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }}>
              <FlagIcon color="#fff" />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Report</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Animated.View>
  );
}
// ── Gallery List Screen ───────────────────────────────────────────────
function GalleryScreen({ gallery, onBack, onPhotoPress, theme }: {
  gallery: GalleryData; onBack: () => void;
  onPhotoPress: (index: number) => void;
  theme: typeof COLORS.dark;
}) {
  const COL_WIDTH = (SCREEN_WIDTH - 36) / 2;
  const leftCol = gallery.photos.filter((_, i) => i % 2 === 0);
  const rightCol = gallery.photos.filter((_, i) => i % 2 === 1);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 }}>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 }} onPress={onBack}>
            <BackIcon color={theme.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 }} numberOfLines={1}>{gallery.title}</Text>
            <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 1 }}>{gallery.venue} · {gallery.date}</Text>
          </View>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <ShareIcon color={theme.subtext} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
        <Text style={{ color: theme.subtext, fontSize: 12, marginBottom: 12, paddingHorizontal: 2 }}>
          {gallery.photos.length} photos
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            {leftCol.map((photo, i) => (
              <TouchableOpacity key={photo.id} style={{ marginBottom: 8 }} onPress={() => onPhotoPress(i * 2)} activeOpacity={0.9}>
                <Image source={{ uri: photo.uri }} style={{ width: COL_WIDTH, height: photo.height, borderRadius: 10 }} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            {rightCol.map((photo, i) => (
              <TouchableOpacity key={photo.id} style={{ marginBottom: 8 }} onPress={() => onPhotoPress(i * 2 + 1)} activeOpacity={0.9}>
                <Image source={{ uri: photo.uri }} style={{ width: COL_WIDTH, height: photo.height, borderRadius: 10 }} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}
// ── Map Screen ────────────────────────────────────────────────────────
function MapScreen({ address, venueName, onBack, theme }: { address: string; venueName: string; onBack: () => void; theme: typeof COLORS.dark }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
        <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }} onPress={onBack}>
          <BackIcon color={theme.text} />
        </TouchableOpacity>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Location</Text>
        <View style={{ width: 40 }} />
      </SafeAreaView>
      <View style={{ flex: 1, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
        <Image source={{ uri: 'https://picsum.photos/seed/mapview/800/600' }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        <View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
          <LocationIcon color="#fff" />
        </View>
      </View>
      <View style={{ margin: 16, padding: 16, borderRadius: 12, borderWidth: 1, backgroundColor: theme.card, borderColor: theme.border }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>{venueName}</Text>
        <Text style={{ color: theme.subtext, fontSize: 13, lineHeight: 18 }}>{address}</Text>
      </View>
      <SafeAreaView style={{ borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12 }}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 16, backgroundColor: theme.accent }} onPress={() => Linking.openURL(`maps://maps.apple.com/?q=${encodeURIComponent(address)}`)}>
          <LocationIcon color="#fff" />
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Get Directions</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ── Event Screen ──────────────────────────────────────────────────────
function EventScreen({ event, onBack, onVenuePress, onMapPress, onGalleryPress, theme }: {
  event: EventData; onBack: () => void; onVenuePress: () => void;
  onMapPress: () => void; onGalleryPress: (gallery: GalleryData) => void;
  theme: typeof COLORS.dark;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const venue = getVenueByName(event.venue);
  const relatedEvents = EVENTS.filter(e => e.id !== event.id).slice(0, 3);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ width: SCREEN_WIDTH }}>
          <FlatList
            data={event.media} keyExtractor={(_, i) => i.toString()}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onScroll={(e) => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
            scrollEventThrottle={16}
            renderItem={({ item }) => <Image source={{ uri: item.uri }} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }} resizeMode="cover" />}
          />
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }} onPress={onBack}><BackIcon color="#fff" /></TouchableOpacity>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><ShareIcon color="#fff" /></TouchableOpacity>
          </SafeAreaView>
          {event.media.length > 1 && (
            <View style={{ position: 'absolute', bottom: 52, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {event.media.map((_, i) => <View key={i} style={{ width: i === activeIndex ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === activeIndex ? '#fff' : 'rgba(255,255,255,0.4)' }} />)}
            </View>
          )}
          <View style={{ backgroundColor: '#111', flexDirection: 'row', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>{event.date}</Text></View>
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#333' }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>{event.time}</Text></View>
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#333' }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>{event.age}</Text></View>
          </View>
        </View>

        <VenueIdentityBlock name={event.venue} address={venue?.address || ''} phone={venue?.phone || ''} website={venue?.website || ''} instagram={venue?.instagram || ''} onAddressPress={onMapPress} onVenuePress={onVenuePress} theme={theme} />

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>About</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{event.about}</Text>
        </View>

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />

        {/* Gallery section — taps into specific gallery */}
        <TouchableOpacity
          style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}
          onPress={() => onGalleryPress(event.gallery)}
        >
          <View>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Gallery</Text>
            <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>{event.gallery.photos.length} photos</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>View all</Text>
            <ChevronRightIcon color={theme.accent} />
          </View>
        </TouchableOpacity>

        {/* Preview strip — 3 photos */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {event.gallery.photos.slice(0, 5).map((photo) => (
            <TouchableOpacity key={photo.id} onPress={() => onGalleryPress(event.gallery)}>
              <Image source={{ uri: photo.uri }} style={{ width: 100, height: 100, borderRadius: 10 }} resizeMode="cover" />
            </TouchableOpacity>
          ))}
          {event.gallery.photos.length > 5 && (
            <TouchableOpacity onPress={() => onGalleryPress(event.gallery)} style={{ width: 100, height: 100, borderRadius: 10, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>+{event.gallery.photos.length - 5}</Text>
              <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>more</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Related Events</Text>
        </View>
        <FlatList
          data={relatedEvents} keyExtractor={e => e.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 150, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
              <Image source={{ uri: item.media[0].uri }} style={{ width: 150, height: 190 }} resizeMode="cover" />
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.date}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
        <View style={{ height: 120 }} />
      </ScrollView>
      <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12 }}>
        <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>Get Tickets</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ── Venue Screen ──────────────────────────────────────────────────────
function VenueScreen({ venue, onBack, onEventPress, onMapPress, onGalleryPress, theme }: {
  venue: VenueData; onBack: () => void;
  onEventPress: (event: EventData) => void; onMapPress: () => void;
  onGalleryPress: (gallery: GalleryData) => void;
  theme: typeof COLORS.dark;
}) {
  const [selectedThumb, setSelectedThumb] = useState(0);
  const THUMB_SIZE = 60;
  const THUMB_TOTAL = venue.media.length * (THUMB_SIZE + 8) + 24;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ width: SCREEN_WIDTH, position: 'relative' }}>
          <Image source={{ uri: venue.media[selectedThumb] }} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.7 }} resizeMode="cover" />
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }} onPress={onBack}><BackIcon color="#fff" /></TouchableOpacity>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><ShareIcon color="#fff" /></TouchableOpacity>
          </SafeAreaView>
        </View>

        <View style={{ position: 'relative' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }, THUMB_TOTAL <= SCREEN_WIDTH && { flexGrow: 1, justifyContent: 'center' }]}>
            {venue.media.map((item, index) => (
              <TouchableOpacity key={index} onPress={() => setSelectedThumb(index)}>
                <Image source={{ uri: item }} style={[{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10, opacity: 0.5 }, index === selectedThumb && { opacity: 1, borderWidth: 2, borderColor: theme.accent }]} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
          {THUMB_TOTAL > SCREEN_WIDTH && (
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, opacity: 0.85 }} pointerEvents="none">
              <ChevronRightIcon color={theme.subtext} />
            </View>
          )}
        </View>

        <VenueIdentityBlock name={venue.name} address={venue.address} phone={venue.phone} website={venue.website} instagram={venue.instagram} onAddressPress={onMapPress} theme={theme} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 }}>
          {venue.attributes.map(a => <View key={a} style={{ backgroundColor: theme.pill, borderWidth: 1, borderColor: theme.pillBorder, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '500' }}>{a}</Text></View>)}
        </ScrollView>

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>About</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{venue.about}</Text>
        </View>

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Menu</Text>
          <ChevronRightIcon color={theme.subtext} />
        </View>
        <Text style={{ paddingHorizontal: 16, color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{venue.menuDescription}</Text>

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Best Sellers</Text>
        </View>
        <FlatList
          data={venue.bestSellers} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
              <Image source={{ uri: item.image }} style={{ width: 140, height: 140 }} resizeMode="cover" />
              <View style={{ padding: 8 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.name}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>{item.category}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <StarIcon color="#f5a623" />
                    <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '600' }}>{item.rating}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Upcoming Events</Text>
          <ChevronRightIcon color={theme.subtext} />
        </View>
        <FlatList
          data={venue.upcomingEvents} keyExtractor={e => e.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 150, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }} onPress={() => onEventPress(item)}>
              <Image source={{ uri: item.media[0].uri }} style={{ width: 150, height: 190 }} resizeMode="cover" />
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.date}</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }} />

        {/* Galleries — each card opens its specific gallery */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Galleries</Text>
        </View>
        <FlatList
          data={venue.galleries} keyExtractor={g => g.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{ width: 160, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}
              onPress={() => onGalleryPress(item)}
            >
              <Image source={{ uri: item.coverImage }} style={{ width: 160, height: 160 }} resizeMode="cover" />
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.photos.length} photos · {item.date}</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Featured Carousel ─────────────────────────────────────────────────
function FeaturedCarousel({ theme, onEventPress }: { theme: typeof COLORS.dark; onEventPress: (e: EventData) => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const timerRef = useRef<any>(null);
  const CARD_WIDTH = SCREEN_WIDTH - 32;
  const CARD_GAP = 12;

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setActiveIndex(prev => {
        const next = (prev + 1) % FEATURED_PICKS.length;
        flatListRef.current?.scrollToOffset({ offset: next * (CARD_WIDTH + CARD_GAP), animated: true });
        return next;
      });
    }, 5000);
  };

  useEffect(() => { startTimer(); return () => clearInterval(timerRef.current); }, []);

  const onScroll = (e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP));
    if (index !== activeIndex) { setActiveIndex(index); clearInterval(timerRef.current); startTimer(); }
  };

  return (
    <View>
      <FlatList
        ref={flatListRef} data={FEATURED_PICKS} keyExtractor={i => i.id}
        horizontal showsHorizontalScrollIndicator={false}
        onScroll={onScroll} scrollEventThrottle={16}
        snapToInterval={CARD_WIDTH + CARD_GAP} decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, gap: CARD_GAP }}
        renderItem={({ item }) => (
          <TouchableOpacity style={{ width: CARD_WIDTH, height: 260, borderRadius: 16, overflow: 'hidden', position: 'relative' }} onPress={() => onEventPress(item)} activeOpacity={0.92}>
            <Image source={{ uri: item.media[0].uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' }} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16 }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: theme.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>{item.date} · {item.time}</Text>
              </View>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 2 }}>{item.title}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>{item.venue}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        {FEATURED_PICKS.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => { flatListRef.current?.scrollToOffset({ offset: i * (CARD_WIDTH + CARD_GAP), animated: true }); setActiveIndex(i); clearInterval(timerRef.current); startTimer(); }}>
            <View style={{ width: i === activeIndex ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === activeIndex ? theme.accent : theme.subtext + '55' }} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Section Header ────────────────────────────────────────────────────
function SectionHeader({ title, theme, onSeeAll }: { title: string; theme: typeof COLORS.dark; onSeeAll?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 28, marginBottom: 12 }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 }}>{title}</Text>
      {onSeeAll && (
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} onPress={onSeeAll}>
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>See all</Text>
          <ChevronRightIcon color={theme.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Home Screen ───────────────────────────────────────────────────────
function HomeScreen({ theme, onEventPress, onVenuePress, onGalleryPress }: {
  theme: typeof COLORS.dark;
  onEventPress: (e: EventData) => void;
  onVenuePress: (v: VenueData) => void;
  onGalleryPress: (gallery: GalleryData) => void;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }} />
          <Text style={{ color: theme.accent, fontSize: 26, fontWeight: '900', letterSpacing: -1 }}>wugi</Text>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <SearchIcon color={theme.subtext} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false}>
        <SectionHeader title="Tonight's Picks" theme={theme} onSeeAll={() => {}} />
        <FeaturedCarousel theme={theme} onEventPress={onEventPress} />

        <FlatList
          data={TONIGHT_PICKS} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} style={{ marginTop: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 130, height: 200, borderRadius: 12, overflow: 'hidden', position: 'relative' }} onPress={() => onEventPress(item)} activeOpacity={0.88}>
              <Image source={{ uri: item.image }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' }} />
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
                <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>{item.time}</Text>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 15, marginBottom: 2 }} numberOfLines={2}>{item.title}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }} numberOfLines={1}>{item.venue}</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        <SectionHeader title="Upcoming Events" theme={theme} onSeeAll={() => {}} />
        <FlatList
          data={UPCOMING_EVENTS_LIST} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 150, height: 220, borderRadius: 12, overflow: 'hidden', position: 'relative' }} onPress={() => onEventPress(item)} activeOpacity={0.88}>
              <Image source={{ uri: item.image }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' }} />
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
                <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>{item.date}</Text>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 1 }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }} numberOfLines={1}>{item.venue}</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        <SectionHeader title="Deals & Specials" theme={theme} onSeeAll={() => {}} />
        <FlatList
          data={DEALS} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }) => {
            const venue = getVenueByName(item.venueName);
            return (
              <TouchableOpacity style={{ width: 220, height: 150, borderRadius: 12, overflow: 'hidden', position: 'relative' }} onPress={() => venue && onVenuePress(venue)} activeOpacity={0.88}>
                <Image source={{ uri: item.image }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' }} />
                <View style={{ position: 'absolute', top: 0, right: 0, backgroundColor: theme.accent, paddingHorizontal: 10, paddingVertical: 5, borderBottomLeftRadius: 10 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>DEAL</Text>
                </View>
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 2 }}>{item.title}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 }}>{item.venueName}</Text>
                  <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '600' }}>{item.detail}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />

        <SectionHeader title="Explore by Vibe" theme={theme} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8 }}>
          {VIBES.map(vibe => (
            <TouchableOpacity key={vibe.id} style={{ width: (SCREEN_WIDTH - 40) / 2, height: 80, borderRadius: 12, overflow: 'hidden', position: 'relative', justifyContent: 'center', paddingLeft: 14 }} activeOpacity={0.85}>
              <Image source={{ uri: vibe.image }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: vibe.color + 'cc' }} />
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: vibe.accent }} />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: -0.2 }}>{vibe.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionHeader title="Featured Venues" theme={theme} onSeeAll={() => {}} />
        <FlatList
          data={VENUES} keyExtractor={v => v.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 200, height: 160, borderRadius: 12, overflow: 'hidden', position: 'relative' }} onPress={() => onVenuePress(item)} activeOpacity={0.88}>
              <Image source={{ uri: item.media[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' }} />
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 4 }}>{item.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{item.category}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <StarIcon color="#f5a623" />
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>4.7</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />

        <SectionHeader title="Near Me" theme={theme} onSeeAll={() => {}} />
        <View style={{ marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: 'hidden', backgroundColor: theme.card, borderColor: theme.divider }}>
          {NEAR_ME.map((item, index) => {
            const venue = getVenueByName(item.venueName);
            return (
              <TouchableOpacity key={item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: index === NEAR_ME.length - 1 ? 0 : 1, borderBottomColor: theme.divider, gap: 12 }} onPress={() => venue && onVenuePress(venue)} activeOpacity={0.7}>
                <Image source={{ uri: item.image }} style={{ width: 44, height: 44, borderRadius: 8 }} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>{item.venueName}</Text>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>{item.category}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '600' }}>{item.distance}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.open ? theme.accent : '#555' }} />
                    <Text style={{ color: item.open ? theme.accent : theme.subtext, fontSize: 10, fontWeight: '600' }}>{item.open ? 'Open' : 'Closed'}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Recent Galleries on home — each opens its specific gallery */}
        <SectionHeader title="Recent Galleries" theme={theme} />
        <FlatList
          data={ALL_GALLERIES.slice(0, 6)} keyExtractor={g => g.id} horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{ width: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}
              onPress={() => onGalleryPress(item)}
              activeOpacity={0.88}
            >
              <Image source={{ uri: item.coverImage }} style={{ width: 140, height: 140 }} resizeMode="cover" />
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 10, marginTop: 2 }}>{item.photos.length} photos</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Root App ──────────────────────────────────────────────────────────
export default function App() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? COLORS.dark : COLORS.light;
  const [stack, setStack] = useState<NavEntry[]>([{ screen: 'home' }]);
  const current = stack[stack.length - 1];
  const push = (entry: NavEntry) => setStack(prev => [...prev, entry]);
  const pop = () => setStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);

  const navigateToEvent = (event: EventData) => push({ screen: 'event', event });
  const navigateToVenue = (venue: VenueData) => push({ screen: 'venue', venue });
  const navigateToMap = (address: string, venueName: string) => push({ screen: 'map', address, venueName });
  const navigateToGallery = (gallery: GalleryData) => push({ screen: 'gallery', gallery });
  const navigateToPhoto = (photos: GalleryPhoto[], initialIndex: number, gallery: GalleryData) =>
    push({ screen: 'photo', photos, initialIndex, galleryTitle: gallery.title, venue: gallery.venue, date: gallery.date });

  if (current.screen === 'photo') {
    return <PhotoViewer photos={current.photos} initialIndex={current.initialIndex} galleryTitle={current.galleryTitle} venue={current.venue} date={current.date} onBack={pop} theme={theme} />;
  }
  if (current.screen === 'gallery') {
    return (
      <GalleryScreen
        gallery={current.gallery} onBack={pop}
        onPhotoPress={(index) => navigateToPhoto(current.gallery.photos, index, current.gallery)}
        theme={theme}
      />
    );
  }
  if (current.screen === 'map') {
    return <MapScreen address={current.address} venueName={current.venueName} onBack={pop} theme={theme} />;
  }
  if (current.screen === 'event') {
    const venue = getVenueByName(current.event.venue);
    return (
      <EventScreen
        event={current.event} onBack={pop}
        onVenuePress={() => venue && navigateToVenue(venue)}
        onMapPress={() => navigateToMap(venue?.address || '', current.event.venue)}
        onGalleryPress={navigateToGallery}
        theme={theme}
      />
    );
  }
  if (current.screen === 'venue') {
    return (
      <VenueScreen
        venue={current.venue} onBack={pop}
        onEventPress={navigateToEvent}
        onMapPress={() => navigateToMap(current.venue.address, current.venue.name)}
        onGalleryPress={navigateToGallery}
        theme={theme}
      />
    );
  }

  return (
    <HomeScreen
      theme={theme}
      onEventPress={navigateToEvent}
      onVenuePress={navigateToVenue}
      onGalleryPress={navigateToGallery}
    />
  );
}

const styles = StyleSheet.create({});