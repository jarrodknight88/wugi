// ─────────────────────────────────────────────────────────────────────
// Wugi — RootNavigator
// Wrapped with FirebaseProvider. Consumes auth + vibes from context.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useCallback } from 'react';
import { View, useColorScheme } from 'react-native';
import { COLORS } from '../constants/colors';
import type { NavEntry, EventData, VenueData, GalleryData, GalleryPhoto, FavoriteItem } from '../types';
import { getVenueByName } from '../constants/mockData';
import { FirebaseProvider, useFirebase } from '../context/FirebaseContext';

// Screens
import { SplashScreen }     from '../screens/SplashScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { HomeScreen }       from '../screens/HomeScreen';
import { DiscoverScreen }   from '../screens/DiscoverScreen';
import { ForYouScreen }     from '../screens/ForYouScreen';
import { FavoritesScreen }  from '../screens/FavoritesScreen';
import { AccountScreen }    from '../screens/AccountScreen';
import { EventScreen }      from '../screens/EventScreen';
import { VenueScreen }      from '../screens/VenueScreen';
import { GalleryScreen }    from '../screens/GalleryScreen';
import { PhotoViewer }      from '../screens/PhotoViewer';
import { MapScreen }        from '../screens/MapScreen';

// Features
import { CameraScreen }   from '../features/stories/CameraScreen';
import { MyPassesScreen } from '../features/ticketing/PassScreens';

// Components
import { TabBar } from '../components/TabBar';

// ── Inner navigator — has access to FirebaseContext ───────────────────
function Navigator() {
  const scheme = useColorScheme();
  const theme  = scheme === 'dark' ? COLORS.dark : COLORS.light;
  const { userVibes } = useFirebase();

  const [appPhase,  setAppPhase]  = useState<'splash' | 'onboarding' | 'main'>('splash');
  const [activeTab, setActiveTab] = useState('home');
  const [stack,     setStack]     = useState<NavEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  const push = (entry: NavEntry) => setStack(prev => [...prev, entry]);
  const pop  = () => setStack(prev => prev.length > 1 ? prev.slice(0, -1) : []);

  const navigateToEvent   = (event: EventData)     => push({ screen: 'event', event });
  const navigateToVenue   = (venue: VenueData)     => push({ screen: 'venue', venue });
  const navigateToMap     = (address: string, venueName: string) => push({ screen: 'map', address, venueName });
  const navigateToGallery = (gallery: GalleryData)  => push({ screen: 'gallery', gallery });
  const navigateToPhoto   = (photos: GalleryPhoto[], initialIndex: number, gallery: GalleryData) =>
    push({ screen: 'photo', photos, initialIndex, galleryTitle: gallery.title, venue: gallery.venue, date: gallery.date });

  const toggleFavorite   = (item: FavoriteItem) => setFavorites(prev => { const exists = prev.find(f => f.id === item.id); if (exists) return prev.filter(f => f.id !== item.id); return [...prev, { ...item, read: false }]; });
  const removeFavorite   = (id: string) => setFavorites(prev => prev.filter(f => f.id !== id));
  const markFavoriteRead = (id: string) => setFavorites(prev => prev.map(f => f.id === id ? { ...f, read: true } : f));
  const unreadFavCount   = favorites.filter(f => !f.read).length;

  // ── App phases ───────────────────────────────────────────────────────
  if (appPhase === 'splash')     return <SplashScreen     onFinish={() => setAppPhase('onboarding')}/>;
  if (appPhase === 'onboarding') return <OnboardingScreen onFinish={() => setAppPhase('main')}/>;

  // ── Stack screens ────────────────────────────────────────────────────
  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  if (current) {
    if (current.screen === 'camera')  return <CameraScreen   onClose={pop} theme={theme}/>;
    if (current.screen === 'passes')  return <MyPassesScreen onBack={pop}  theme={theme}/>;
    if (current.screen === 'photo')   return <PhotoViewer    photos={current.photos} initialIndex={current.initialIndex} galleryTitle={current.galleryTitle} venue={current.venue} date={current.date} onBack={pop} theme={theme}/>;
    if (current.screen === 'gallery') return <GalleryScreen  gallery={current.gallery} onBack={pop} onPhotoPress={index => navigateToPhoto(current.gallery.photos, index, current.gallery)} theme={theme}/>;
    if (current.screen === 'map')     return <MapScreen      address={current.address} venueName={current.venueName} onBack={pop} theme={theme}/>;
    if (current.screen === 'event') {
      const venue = getVenueByName(current.event.venue);
      return <EventScreen
        event={current.event}
        onBack={pop}
        onVenuePress={() => venue && navigateToVenue(venue)}
        onMapPress={() => navigateToMap(venue?.address || '', current.event.venue)}
        onGalleryPress={navigateToGallery}
        onFavoriteToggle={toggleFavorite}
        theme={theme}
      />;
    }
    if (current.screen === 'venue') return <VenueScreen
      venue={current.venue}
      onBack={pop}
      onEventPress={navigateToEvent}
      onMapPress={() => navigateToMap(current.venue.address, current.venue.name)}
      onGalleryPress={navigateToGallery}
      theme={theme}
    />;
  }

  // ── Tab screens ──────────────────────────────────────────────────────
  const renderTab = () => {
    switch (activeTab) {
      case 'home':      return <HomeScreen      theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onGalleryPress={navigateToGallery} userVibes={userVibes} onCameraPress={() => push({ screen: 'camera' })}/>;
      case 'forYou':    return <ForYouScreen    theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onFavoriteToggle={toggleFavorite}/>;
      case 'discover':  return <DiscoverScreen  theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue}/>;
      case 'favorites': return <FavoritesScreen theme={theme} favorites={favorites} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onRemove={removeFavorite} onMarkRead={markFavoriteRead}/>;
      case 'account':   return <AccountScreen   theme={theme} onViewPasses={() => push({ screen: 'passes' })}/>;
      default:          return <HomeScreen      theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onGalleryPress={navigateToGallery} userVibes={userVibes} onCameraPress={() => push({ screen: 'camera' })}/>;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {renderTab()}
      <TabBar activeTab={activeTab} onTabPress={setActiveTab} theme={theme} unreadFavCount={unreadFavCount}/>
    </View>
  );
}

// ── Root — FirebaseProvider wraps everything ──────────────────────────
export function RootNavigator() {
  return (
    <FirebaseProvider>
      <Navigator/>
    </FirebaseProvider>
  );
}
