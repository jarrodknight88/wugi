// ─────────────────────────────────────────────────────────────────────
// Wugi — RootNavigator
// Wrapped with FirebaseProvider. Consumes auth + vibes from context.
//
// Key architecture:
// - Tab screens always stay MOUNTED (display:none when stack is open)
//   This preserves Discover search state when navigating back
// - Stack screens render on top via absolute positioning
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, useColorScheme } from 'react-native';
import { COLORS } from '../constants/colors';
import type { NavEntry, EventData, VenueData, GalleryData, GalleryPhoto, FavoriteItem } from '../types';
import { FirebaseProvider, useFirebase } from '../context/FirebaseContext';

// Screens
import { SplashScreen }         from '../screens/SplashScreen';
import { SignupScreen }         from '../screens/SignupScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { OnboardingScreen }     from '../screens/OnboardingScreen';
import { UsernameScreen }       from '../screens/UsernameScreen';
import { HomeScreen }       from '../screens/HomeScreen';
import { DiscoverScreen }   from '../screens/DiscoverScreen';
import { DiscoverEditorialScreen } from '../screens/DiscoverEditorialScreen';
import { ForYouScreen }     from '../screens/ForYouScreen';
import { FavoritesScreen }  from '../screens/FavoritesScreen';
import { AccountScreen }    from '../screens/AccountScreen';
import { EventScreen }      from '../screens/EventScreen';
import { VenueScreen }      from '../screens/VenueScreen';
import { MenuScreen }       from '../screens/MenuScreen';
import { MenuItemScreen }   from '../screens/MenuItemScreen';
import { GalleryScreen }    from '../screens/GalleryScreen';
import { PhotoViewer }      from '../screens/PhotoViewer';
import { MapScreen }        from '../screens/MapScreen';
import { SavedListScreen }  from '../screens/SavedListScreen';

// Features
import { CameraScreen }          from '../features/stories/CameraScreen';
import { MyPassesScreen }        from '../features/ticketing/PassScreens';
import { TicketSelectionScreen } from '../features/ticketing/TicketSelectionScreen';
import { PaymentScreen }         from '../features/ticketing/PaymentScreen';
import { PassScreen }            from '../features/ticketing/PassScreen';
import type { TicketSelection }  from '../features/ticketing/TicketSelectionScreen';

// Components
import { TabBar }              from '../components/TabBar';
import { EmailVerifyBanner }   from '../components/EmailVerifyBanner';

// ── Inner navigator — has access to FirebaseContext ───────────────────
function Navigator({ onNotificationNavigate }: { onNotificationNavigate?: (fn: (data: Record<string, string>) => void) => void }) {
  const scheme = useColorScheme();
  const theme  = scheme === 'dark' ? COLORS.dark : COLORS.light;
  const { userVibes, user, authLoading } = useFirebase();

  // Phases:
  //   splash           → always shown first (brand moment)
  //   signup           → auth gate for new/returning/guest
  //   forgot-password  → password reset (entered from signup)
  //   onboarding       → vibe selection slides (new users only)
  //   username         → username picker (new users only, after vibe slides)
  //   main             → main tab experience
  const [appPhase,           setAppPhase]           = useState<'splash' | 'signup' | 'forgot-password' | 'onboarding' | 'username' | 'main'>('splash');
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const splashDoneRef = useRef(false);
  const routedRef     = useRef(false);
  const userRef       = useRef(user); // always holds latest user value

  // Keep userRef current on every render
  useEffect(() => { userRef.current = user; }, [user]);

  const routeAfterSplash = useCallback(() => {
    if (routedRef.current) return;
    if (!splashDoneRef.current) return;
    routedRef.current = true;
    // Use ref so we always read the current user, not the captured closure value
    setAppPhase(userRef.current ? 'main' : 'signup');
  }, []); // no deps — reads from refs only

  // Fires when authLoading resolves — if splash done, route immediately
  useEffect(() => {
    if (authLoading) return;
    routeAfterSplash();
  }, [authLoading, routeAfterSplash]);

  // Safety net — never stuck on splash more than 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      if (appPhase !== 'splash') return;
      splashDoneRef.current = true;
      routeAfterSplash();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);
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

  // ── Notification deep-link handler ───────────────────────────────────
  useEffect(() => {
    if (!onNotificationNavigate) return
    onNotificationNavigate((data) => {
      const { screen, eventId } = data
      if (screen === 'EventDetail' && eventId) {
        // Navigate to home tab and show event — fetch from Firestore if needed
        setAppPhase('main')
        setActiveTab('home')
        // EventScreen requires a full EventData object; for now push a minimal one
        // In a future iteration, fetch full event data from Firestore by eventId
        push({
          screen: 'event',
          event: {
            id: eventId,
            title: data.eventTitle ?? 'Event',
            venue: data.venueName ?? '',
            // FCM payload may carry venueId so EventScreen can resolve the
            // venue identity block via useVenueById. Optional; absence is
            // a no-op (block hides) rather than a render failure.
            venueId: data.venueId ?? '',
            date: '',
            time: '',
            about: '',
            tags: [],
            media: [],
            vibes: [],
          } as EventData,
        })
      }
    })
  }, [onNotificationNavigate])

  // ── Favorites (in-memory UI + Firestore persistence) ─────────────────
  // The in-memory `favorites` array drives the UI immediately (Saved tab,
  // ForYou swipe). For logged-in users we ALSO persist to the top-level
  // `favorites` collection (fire-and-forget, guarded by uid) and hydrate
  // from it on login so saves survive reinstall / cross-device. Guests have
  // no uid → in-memory only, exactly as before.
  const uid = user?.uid ?? null;

  const toggleFavorite = (item: FavoriteItem) => {
    let willAdd = false;
    setFavorites(prev => {
      const exists = prev.find(f => f.id === item.id);
      if (exists) { willAdd = false; return prev.filter(f => f.id !== item.id); }
      willAdd = true;
      return [...prev, { ...item, read: false }];
    });
    // Persist (fire-and-forget). itemType maps from FavoriteItem.type.
    if (uid) {
      import('../../firestoreService').then(svc => {
        if (willAdd) svc.addFavorite(uid, item.type, item.id);
        else         svc.removeFavorite(uid, item.type, item.id);
      }).catch(() => { /* non-blocking */ });
    }
  };

  const removeFavorite = (id: string) => {
    const target = favorites.find(f => f.id === id);
    setFavorites(prev => prev.filter(f => f.id !== id));
    if (uid && target) {
      import('../../firestoreService')
        .then(svc => svc.removeFavorite(uid, target.type, target.id))
        .catch(() => { /* non-blocking */ });
    }
  };

  const markFavoriteRead = (id: string) => setFavorites(prev => prev.map(f => f.id === id ? { ...f, read: true } : f));
  const unreadFavCount   = favorites.filter(f => !f.read).length;

  // ── Hydrate favorites from Firestore on login ────────────────────────
  // Resolves each persisted {itemType,itemId} to a full FavoriteItem via
  // getEventById / getVenueById so the Saved tab renders title/image. Photo
  // favorites are skipped here (no consumer photo-detail screen yet); the
  // write-path still persists them. On logout (uid null) we clear the array.
  useEffect(() => {
    let cancelled = false;
    if (!uid) { setFavorites([]); return; }
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const docs = await svc.listFavorites(uid);
        const resolved = await Promise.all(docs.map(async (d): Promise<FavoriteItem | null> => {
          if (d.itemType === 'event') {
            const e = await svc.getEventById(d.itemId);
            if (!e) return null;
            const data = {
              id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
              date: e.date, time: e.time, age: e.age, about: e.about || '',
              media: (e.media || []) as any, gallery: undefined as any,
              hasTickets: (e as any).hasTickets === true,
            } as unknown as EventData;
            return {
              id: e.id, type: 'event', title: e.title,
              subtitle: e.venue || '', image: (e.media || [])[0]?.uri || '',
              read: true, data,
            };
          }
          if (d.itemType === 'venue') {
            const v = await svc.getVenueById(d.itemId);
            if (!v) return null;
            const firstMedia = (v.media || [])[0] as any;
            const image = typeof firstMedia === 'string' ? firstMedia : (firstMedia?.uri || '');
            const data = {
              id: v.id, name: v.name, category: v.category || '',
              address: v.address || '', phone: v.phone || '',
              website: v.website || '', instagram: v.instagram || '',
              attributes: v.attributes || [], about: v.about || '',
              media: (v.media || []).map((m: any) => typeof m === 'string' ? { type: 'image', uri: m } : m),
              menuDescription: '', menuAttributes: [], bestSellers: [],
              upcomingEvents: [], galleries: [],
            } as unknown as VenueData;
            return {
              id: v.id, type: 'venue', title: v.name,
              subtitle: v.category || v.neighborhood || '', image,
              read: true, data,
            };
          }
          return null; // 'photo' — persisted but not hydrated into the UI yet
        }));
        if (!cancelled) {
          const items = resolved.filter((x): x is FavoriteItem => x !== null);
          setFavorites(items);
        }
      } catch (e) {
        console.log('RootNavigator: favorites hydration failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // ── App phases ───────────────────────────────────────────────────────
  if (appPhase === 'splash') return (
    <SplashScreen onFinish={() => {
      splashDoneRef.current = true;
      routeAfterSplash();
    }}/>
  );

  if (appPhase === 'signup') return (
    <SignupScreen
      onSignupComplete={() => setAppPhase('onboarding')}
      onSignInComplete={() => setAppPhase('main')}
      onGuest={() => setAppPhase('main')}
      onForgotPassword={(currentEmail) => {
        setForgotPasswordEmail(currentEmail);
        setAppPhase('forgot-password');
      }}
    />
  );

  if (appPhase === 'forgot-password') return (
    <ForgotPasswordScreen
      initialEmail={forgotPasswordEmail}
      onBack={() => setAppPhase('signup')}
    />
  );

  if (appPhase === 'onboarding') return (
    <OnboardingScreen onFinish={() => setAppPhase('username')}/>
  );

  if (appPhase === 'username') return (
    <UsernameScreen onComplete={() => setAppPhase('main')}/>
  );

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
    // Editorial Discover: the search/filter mode is the existing DiscoverScreen,
    // pushed on top of the editorial default view. onBack returns to editorial.
    if (current.screen === 'discoverSearch') return <DiscoverScreen theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onBack={pop} initialMapOn={current.initialMapOn}/>;
    // Saved "View All" — full-list view of saved events OR saved venues.
    if (current.screen === 'savedList') return <SavedListScreen kind={current.kind} items={favorites.filter(f => f.type === current.kind)} theme={theme} onBack={pop} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onRemove={removeFavorite} onMarkRead={markFavoriteRead}/>;

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

    if (current.screen === 'event') {
      // EventScreen now resolves its own venue via useVenueById(event.venueId)
      // (2026-05-08 fix — the prior getVenueByName(eventVenueName) only matched
      // 3 hardcoded mock venues and returned undefined for every Firestore event,
      // leaving address/phone/website/logo blank). The navigator no longer needs
      // to do venue resolution for the screen's render — only for the
      // onVenuePress / onMapPress callbacks below, which are stop-gapped to use
      // event-side data until the long-term Approach 2 refactor lands (see
      // memory: approach-2-event-venue-embedding-followup).
      const eventVenueName = (current.event as any).venue ?? (current.event as any).venueName ?? '';
      return (
        <EventScreen
          event={current.event}
          onBack={pop}
          // onVenuePress: kept as a legacy no-op; onNavigateToVenue is the
          // preferred path (Wave 1 additive). When the resolved VenueData is
          // available inside EventScreen, it calls onNavigateToVenue(venue)
          // which pushes VenueScreen with a full venue object.
          onVenuePress={() => { /* legacy no-op; onNavigateToVenue preferred */ }}
          // Wave 1 (additive): EventScreen calls this with the resolved VenueData
          // from useVenueById so the navigator can push VenueScreen correctly.
          onNavigateToVenue={(resolvedVenue) => navigateToVenue(resolvedVenue)}
          // onMapPress now receives the address resolved by EventScreen's
          // useVenueById lookup — the prior `event.address` read was always
          // empty for Firestore events (events don't carry venue address;
          // only venues do).
          onMapPress={(addr, name) => navigateToMap(addr, name)}
          onGalleryPress={navigateToGallery}
          onFavoriteToggle={toggleFavorite}
          onGetTickets={current.event.hasTickets === true ? () => push({
            screen:    'ticketSelection',
            eventId:   current.event.id ?? '',
            eventName: current.event.title,
            venueName: eventVenueName,
            eventDate: current.event.date,
            eventTime: current.event.time,
          }) : undefined}
          // Wave 1 (additive): navigate to MenuScreen for this venue when the
          // venue has been resolved by EventScreen's useVenueById.
          onMenuPress={current.event.venueId ? () => push({
            screen:   'menu',
            venueId:  current.event.venueId ?? '',
            venueName: eventVenueName,
          }) : undefined}
          // UAT-V3 (additive): tapping an "Also tonight" related event card
          // pushes that event onto the stack. The navigator already exposes
          // navigateToEvent for the same shape, so we just forward it.
          onEventPress={navigateToEvent}
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
        onMenuPress={() => push({ screen: 'menu', venueId: current.venue.id, venueName: current.venue.name })}
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

    if (current.screen === 'menu') return (
      <MenuScreen
        venueId={current.venueId}
        venueName={current.venueName}
        theme={theme}
        onBack={pop}
        onItemPress={(item) => push({ screen: 'menuItem', venueId: current.venueId, venueName: current.venueName, item })}
      />
    );

    if (current.screen === 'menuItem') return (
      <MenuItemScreen
        item={current.item}
        venueName={current.venueName}
        theme={theme}
        onBack={pop}
      />
    );

    return null;
  };

  // ── Tab screens — always mounted, hidden when stack is open ──────────
  // This preserves state (e.g. Discover search results) when navigating
  // to an event/venue and pressing back
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Email verification banner — sits above tabs, hidden when stack open */}
      {!stackVisible && <EmailVerifyBanner />}

      {/* Tabs — always mounted, hidden behind stack */}
      <View style={{ flex: 1, display: stackVisible ? 'none' : 'flex' }}>
        {activeTab === 'home'      && <HomeScreen      theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onGalleryPress={navigateToGallery} userVibes={userVibes} onCameraPress={() => push({ screen: 'camera' })}/>}
        {activeTab === 'discover'  && <DiscoverEditorialScreen theme={theme} onSearchTap={() => push({ screen: 'discoverSearch' })} onMapTap={() => push({ screen: 'discoverSearch', initialMapOn: true })} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onGalleryPress={navigateToGallery}/>}
        {activeTab === 'forYou'    && <ForYouScreen    theme={theme} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onFavoriteToggle={toggleFavorite}/>}
        {activeTab === 'favorites' && <FavoritesScreen theme={theme} favorites={favorites} onEventPress={navigateToEvent} onVenuePress={navigateToVenue} onRemove={removeFavorite} onMarkRead={markFavoriteRead} onViewAllSaved={kind => push({ screen: 'savedList', kind })}/>}
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
export function RootNavigator({ onNotificationNavigate }: { onNotificationNavigate?: (fn: (data: Record<string, string>) => void) => void }) {
  return (
    <FirebaseProvider>
      <Navigator onNotificationNavigate={onNotificationNavigate}/>
    </FirebaseProvider>
  );
}
