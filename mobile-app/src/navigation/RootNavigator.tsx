// ─────────────────────────────────────────────────────────────────────
// Wugi — RootNavigator
// Wrapped with FirebaseProvider. Consumes auth + vibes from context.
//
// Key architecture:
// - Tab screens always stay MOUNTED (display:none when stack is open)
//   This preserves Discover search state when navigating back
// - Stack screens render on top via absolute positioning
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
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
import { CameraScreen }          from '../features/stories/CameraScreen';
import { MyPassesScreen }        from '../features/ticketing/PassScreens';
import { TicketSelectionScreen } from '../features/ticketing/TicketSelectionScreen';
import { PaymentScreen }         from '../features/ticketing/PaymentScreen';
import { PassScreen }            from '../features/ticketing/PassScreen';
import { ScanScreen }            from '../features/ticketing/ScanScreen';
import type { TicketSelection }  from '../features/ticketing/TicketSelectionScreen';

// Components
import { TabBar } from '../components/TabBar';

// ── Inner navigator — has access to FirebaseContext ───────────────────
function Navigator() {
  const scheme = useColorScheme();
  const theme  = scheme === 'dark' ? COLORS.dark : COLORS.light;
  const { userVibes, user } = useFirebase();

  const [appPhase,  setAppPhase]  = useState<'splash' | 'onboarding' | 'main'>('splash');
  const [activeTab, setActiveTab] = useState('home');
  const [stack,     setStack]     = useState<NavEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  const push = (entry: NavEntry) => setStack(prev => [...prev, entry]);
  // Pop one screen — if stack becomes empty, tabs are revealed
  const pop  = () => setStack(prev => prev.slice(0, -1));

  const navigateToEvent   = (event: EventData)    => push({ screen: 'event', event });
  const navigateToVenue   = (venue: VenueData)    => push({ screen: 'venue', venue });
  const navigateToMap     = (address: string, venueName: string) => push({ screen: 'map', address, venueName });
  const navigateToGallery = (gallery: GalleryData) => push({ screen: 'gallery', gallery });
  const navigateToPhoto   = (photos: GalleryPhoto[], initialIndex: number, gallery: GalleryData) =>
    push({ screen: 'photo', photos, initialIndex, galleryTitle: gallery.title, venue: gallery.venue, date: gallery.date });

  const toggleFavorite   = (item: FavoriteItem) => setFavorites(prev => { const exists = prev.find(f => f.id === item.id); if (exists) return prev.filter(f => f.id !== item.id); return [...prev, { ...item, read: false }]; });
  const removeFavorite   = (id: string) => setFavorites(prev => prev.filter(f => f.id !== id));
  const markFavoriteRead = (id: string) => setFavorites(prev => prev.map(f => f.id === id ? { ...f, read: true } : f));
  const unreadFavCount   = favorites.filter(f => !f.read).length;

  // ── App phases ───────────────────────────────────────────────────────
  if (appPhase === 'splash')     return <SplashScreen     onFinish={() => setAppPhase('onboarding')}/>;
  if (appPhase === 'onboarding') return <OnboardingScreen onFinish={() => setAppPhase('main')}/>;

  // ── Current stack screen ─────────────────────────────────────────────
  const current      = stack.length > 0 ? stack[stack.length - 1] : null;
  const stackVisible = current !== null;

  // ── Render the current stack screen ──────────────────────────────────
  const renderStackScreen = () => {
    if (!current) return null;

    if (current.screen === 'camera')  return <CameraScreen   onClose={pop} theme={theme}/>;
    if (current.screen === 'passes')  return <MyPassesScreen onBack={pop}  theme={theme}/>;
    if (current.screen === 'photo')   return <PhotoViewer    photos={current.photos} initialIndex={current.initialIndex} galleryTitle={current.galleryTitle} venue={current.venue} date={current.date} onBack={pop} theme={theme}/>;
    if (current.screen === 'gallery') return <GalleryScreen  gallery={current.gallery} onBack={pop} onPhotoPress={index => navigateToPhoto(current.gallery.photos, index, current.gallery)} theme={theme}/>;
    if (current.screen === 'map')     return <MapScreen      address={current.address} venueName={current.venueName} onBack={pop} theme={theme}/>;

    if (current.screen === 'ticketSelection') return (
      <TicketSelectionScreen
        eventId={current.eventId}
        eventName={current.eventName}
        venueName={current.venueName}
        eventDate={current.eventDate}
        eventTime={current.eventTime}
        theme={theme}
        onBack={pop}
        onContinue={(selection: TicketSelection) => push({ screen: 'payment', selection })}
      />
    );

    if (current.screen === 'payment') return (
      <PaymentScreen
        selection={current.selection}
        userId={user?.uid ?? null}
        userEmail={user?.email ?? ''}
        userName={user?.displayName ?? ''}
        theme={theme}
        onBack={pop}
        onSuccess={(orderId: string, isGuest: boolean) => {
          setStack(prev => [...prev.slice(0, -1), { screen: 'pass', orderId, isGuest }]);
        }}
      />
    );

    if (current.screen === 'pass') return (
      <PassScreen
        orderId={current.orderId}
        isGuest={current.isGuest ?? false}
        theme={theme}
        onSignUp={() => {
          // Clear ticketing stack and go to account tab
          setStack([]);
          setActiveTab('account');
        }}
        onClose={() => {
          setStack(prev => prev.filter(e =>
            e.screen !== 'pass' &&
            e.screen !== 'payment' &&
            e.screen !== 'ticketSelection'
          ));
        }}
      />
    );

    if (current.screen === 'scan') return (
      <ScanScreen
        eventId={current.eventId}
        eventName={current.eventName}
        venueName={current.venueName}
        eventDate={current.eventDate}
        eventTime={current.eventTime}
        userId={user?.uid ?? ''}
        theme={theme}
        onBack={pop}
      />
    );

    if (current.screen === 'event') {
      const venue = getVenueByName(current.event.venue);
      return (
        <EventScreen
          event={current.event}
          onBack={pop}
          onVenuePress={() => venue && navigateToVenue(venue)}
          onMapPress={() => navigateToMap(venue?.address || '', current.event.venue)}
          onGalleryPress={navigateToGallery}
          onFavoriteToggle={toggleFavorite}
          onGetTickets={current.event.hasTickets === true ? () => push({
            screen:    'ticketSelection',
            eventId:   current.event.id ?? '',
            eventName: current.event.title,
            venueName: current.event.venue,
            eventDate: current.event.date,
            eventTime: current.event.time,
          }) : undefined}
          theme={theme}
        />
      );
    }

    if (current.screen === 'venue') return (
      <VenueScreen
        venue={current.venue}
        onBack={pop}
        onEventPress={navigateToEvent}
        onMapPress={() => navigateToMap(current.venue.address, current.venue.name)}
        onGalleryPress={navigateToGallery}
        onGetTickets={(activeEvent) => push({
          screen:    'ticketSelection',
          eventId:   activeEvent.id,
          eventName: activeEvent.name,
          venueName: current.venue.name,
          eventDate: activeEvent.date,
          eventTime: activeEvent.time,
        })}
        theme={theme}
      />
    );

    return null;
  };

  // ── Tab screens — always mounted, hidden when stack is open ──────────
  // This preserves state (e.g. Discover search results) when navigating
  // to an event/venue and pressing back
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Tabs — always mounted, hidden behind stack */}
      <View style={{ flex: 1, display: stackVisible ? 'none' : 'flex' }}>
        {activeTab === 'home'      && <HomeScreen      theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onGalleryPress={navigateToGallery} userVibes={userVibes} onCameraPress={() => push({ screen: 'camera' })}/>}
        {activeTab === 'discover'  && <DiscoverScreen  theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue}/>}
        {activeTab === 'forYou'    && <ForYouScreen    theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onFavoriteToggle={toggleFavorite}/>}
        {activeTab === 'favorites' && <FavoritesScreen theme={theme} favorites={favorites} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onRemove={removeFavorite} onMarkRead={markFavoriteRead}/>}
        {activeTab === 'account'   && <AccountScreen   theme={theme} onViewPasses={() => push({ screen: 'passes' })}/>}
        <TabBar activeTab={activeTab} onTabPress={setActiveTab} theme={theme} unreadFavCount={unreadFavCount}/>
      </View>

      {/* Stack — renders on top when present */}
      {stackVisible && (
        <View style={{ flex: 1 }}>
          {renderStackScreen()}
        </View>
      )}
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
