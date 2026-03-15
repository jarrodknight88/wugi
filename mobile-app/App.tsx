import EventProfileTest from './src/screens/EventProfileTest';

import React, { useRef, useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_MAX_HEIGHT = 180;
const HEADER_MIN_HEIGHT = 90;
const HEADER_SCROLL_DISTANCE = HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT;

// ── Placeholder Data ──────────────────────────────────────────────────
const TONIGHT_PICKS = [
  { id: '1', name: 'The Ivy', neighborhood: 'Buckhead', rating: 4.8, color: '#6b4c3b' },
  { id: '2', name: 'Red Phone Booth', neighborhood: 'Midtown', rating: 4.6, color: '#8b3a3a' },
  { id: '3', name: 'Ormsby\'s', neighborhood: 'West Midtown', rating: 4.5, color: '#3a5f8b' },
  { id: '4', name: 'Jeju Sauna', neighborhood: 'Duluth', rating: 4.7, color: '#5a6b3a' },
];

const UPCOMING_EVENTS = [
  { id: '1', name: 'Jazz on the Roof', venue: 'The Roof at Ponce City', date: 'Tonight, 8PM', tonight: true, color: '#4a3a6b' },
  { id: '2', name: 'Wine & Paint', venue: 'Painted Pin', date: 'Sat, Mar 21', tonight: false, color: '#6b3a5a' },
  { id: '3', name: 'DJ Set: MVZA', venue: 'Ravine', date: 'Sun, Mar 22', tonight: false, color: '#3a6b5a' },
  { id: '4', name: 'Trivia Night', venue: 'Torched Hop', date: 'Mon, Mar 23', tonight: false, color: '#5a5a3a' },
];

const DEALS = [
  { id: '1', name: 'Ladybird', neighborhood: 'Buckhead', deal: '2-for-1 Cocktails', color: '#7a6b5a' },
  { id: '2', name: 'New Realm Brewing', neighborhood: 'Beltline', deal: '$5 Pints', color: '#5a6b7a' },
  { id: '3', name: 'Bone Garden Cantina', neighborhood: 'West Midtown', deal: 'Free Chips & Salsa', color: '#6b5a6b' },
];

const VIBES = [
  { id: '1', label: 'Boujee', color: '#c9a96e' },
  { id: '2', label: 'Divey', color: '#6b4c3b' },
  { id: '3', label: 'Speakeasy', color: '#3a3a5a' },
  { id: '4', label: 'High Energy', color: '#8b3a3a' },
  { id: '5', label: 'Brunch', color: '#d4956a' },
  { id: '6', label: 'Late Night', color: '#2a2a4a' },
];

// ── Section Header ────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

// ── Main App ──────────────────────────────────────────────────────────
// Temporarily show EventProfileTest as default screen
export default function App() {
  return <EventProfileTest />;
}

function _OriginalApp() {
  const scrollY = useRef(new Animated.Value(0)).current;
  const [activeTab, setActiveTab] = useState('Home');

  const headerHeight = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE],
    outputRange: [HEADER_MAX_HEIGHT, HEADER_MIN_HEIGHT],
    extrapolate: 'clamp',
  });

  const expandedOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const collapsedOpacity = scrollY.interpolate({
    inputRange: [HEADER_SCROLL_DISTANCE * 0.6, HEADER_SCROLL_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false }
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ── Fixed Header ──────────────────────────────── */}
      <Animated.View style={[styles.header, { height: headerHeight }]}>
        <LinearGradient
          colors={['#2a7a5a', '#2a7a5a', 'rgba(42,122,90,0.85)']}
          style={StyleSheet.absoluteFill}
        />

        {/* Expanded header content */}
        <Animated.View style={[styles.headerExpanded, { opacity: expandedOpacity }]}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar} />
            <View style={styles.headerTextGroup}>
              <Text style={styles.greeting}>GOOD EVENING</Text>
              <Text style={styles.userName}>Jarrod</Text>
              <View style={styles.locationRow}>
                <Ionicons name="location-sharp" size={13} color="#ffffffcc" />
                <Text style={styles.locationText}>Atlanta, GA</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.searchButton}>
            <Ionicons name="search" size={20} color="#fff" />
          </TouchableOpacity>
        </Animated.View>

        {/* Collapsed header content */}
        <Animated.View style={[styles.headerCollapsed, { opacity: collapsedOpacity }]}>
          <Text style={styles.collapsedTitle}>wugi</Text>
          <TouchableOpacity style={styles.searchButton}>
            <Ionicons name="search" size={20} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>

      {/* ── Scrollable Content ────────────────────────── */}
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingTop: HEADER_MAX_HEIGHT, paddingBottom: 100 }}
        scrollEventThrottle={16}
        onScroll={onScroll}
      >
        {/* Tonight's Picks */}
        <SectionHeader title="Tonight's Picks" subtitle="Curated for you in Atlanta" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
          {TONIGHT_PICKS.map((item) => (
            <TouchableOpacity key={item.id} style={styles.portraitCard} activeOpacity={0.85}>
              <View style={[styles.cardImage, { backgroundColor: item.color }]}>
                {/* Heart icon */}
                <TouchableOpacity style={styles.heartIcon}>
                  <Ionicons name="heart-outline" size={18} color="#fff" />
                </TouchableOpacity>
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.75)']}
                  style={styles.cardGradient}
                >
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardNeighborhood}>{item.neighborhood}</Text>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={12} color="#f5c518" />
                    <Text style={styles.ratingText}>{item.rating}</Text>
                  </View>
                </LinearGradient>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Upcoming Events */}
        <SectionHeader title="Upcoming Events" subtitle="Don't miss out" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
          {UPCOMING_EVENTS.map((item) => (
            <TouchableOpacity key={item.id} style={styles.eventCard} activeOpacity={0.85}>
              <View style={[styles.eventCardImage, { backgroundColor: item.color }]}>
                {item.tonight && (
                  <View style={styles.tonightBadge}>
                    <Text style={styles.tonightBadgeText}>TONIGHT</Text>
                  </View>
                )}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.75)']}
                  style={styles.cardGradient}
                >
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardNeighborhood}>{item.venue}</Text>
                  <Text style={styles.eventDate}>{item.date}</Text>
                </LinearGradient>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Deals */}
        <SectionHeader title="Deals" subtitle="Save tonight" />
        <View style={styles.dealsList}>
          {DEALS.map((item) => (
            <TouchableOpacity key={item.id} style={styles.dealCard} activeOpacity={0.85}>
              <View style={[styles.dealImage, { backgroundColor: item.color }]} />
              <View style={styles.dealInfo}>
                <Text style={styles.dealName}>{item.name}</Text>
                <Text style={styles.dealNeighborhood}>{item.neighborhood}</Text>
                <View style={styles.dealBadge}>
                  <Text style={styles.dealBadgeText}>{item.deal}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Explore by Vibe */}
        <SectionHeader title="Explore by Vibe" subtitle="What's your mood tonight?" />
        <View style={styles.vibeGrid}>
          {VIBES.map((item) => (
            <TouchableOpacity key={item.id} style={styles.vibeTile} activeOpacity={0.85}>
              <View style={[styles.vibeTileInner, { backgroundColor: item.color }]}>
                <View style={styles.vibeTileOverlay} />
                <Text style={styles.vibeLabel}>{item.label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.ScrollView>

      {/* ── Bottom Tab Bar ────────────────────────────── */}
      <View style={styles.tabBar}>
        {(['Home', 'Explore', 'For You', 'Favorite', 'Account'] as const).map((tab) => {
          const isActive = activeTab === tab;
          const isForYou = tab === 'For You';
          let iconName: keyof typeof Ionicons.glyphMap;
          switch (tab) {
            case 'Home': iconName = isActive ? 'home' : 'home-outline'; break;
            case 'Explore': iconName = isActive ? 'compass' : 'compass-outline'; break;
            case 'For You': iconName = isActive ? 'sparkles' : 'sparkles-outline'; break;
            case 'Favorite': iconName = isActive ? 'heart' : 'heart-outline'; break;
            case 'Account': iconName = isActive ? 'person' : 'person-outline'; break;
          }

          if (isForYou) {
            return (
              <TouchableOpacity
                key={tab}
                style={styles.forYouTab}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.8}
              >
                <View style={[styles.forYouPill, isActive && styles.forYouPillActive]}>
                  <Ionicons name={iconName} size={20} color={isActive ? '#fff' : '#2a7a5a'} />
                  <Text style={[styles.forYouPillText, isActive && styles.forYouPillTextActive]}>
                    For You
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={tab}
              style={styles.tabItem}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
            >
              <Ionicons name={iconName} size={24} color={isActive ? '#2a7a5a' : '#999'} />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f3ef',
  },

  // Header
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  headerExpanded: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff44',
    marginRight: 12,
  },
  headerTextGroup: {},
  greeting: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#ffffffaa',
    fontWeight: '600',
  },
  userName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginTop: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  locationText: {
    fontSize: 12,
    color: '#ffffffcc',
    marginLeft: 3,
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCollapsed: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  collapsedTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },

  // Scroll view
  scrollView: {
    flex: 1,
  },

  // Section headers
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },

  // Tonight's Picks cards
  horizontalList: {
    paddingLeft: 16,
    paddingRight: 8,
  },
  portraitCard: {
    width: 150,
    height: 210,
    marginRight: 12,
    borderRadius: 22,
    overflow: 'hidden',
  },
  cardImage: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
  },
  heartIcon: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#00000033',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 40,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  cardNeighborhood: {
    fontSize: 11,
    color: '#ccc',
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  ratingText: {
    fontSize: 12,
    color: '#f5c518',
    fontWeight: '600',
    marginLeft: 4,
  },

  // Upcoming Events cards
  eventCard: {
    width: 145,
    height: 210,
    marginRight: 12,
    borderRadius: 22,
    overflow: 'hidden',
  },
  eventCardImage: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
  },
  tonightBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 2,
    backgroundColor: '#2a7a5a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tonightBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.8,
  },
  eventDate: {
    fontSize: 11,
    color: '#ddd',
    marginTop: 3,
  },

  // Deals
  dealsList: {
    paddingHorizontal: 16,
  },
  dealCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'hidden',
  },
  dealImage: {
    width: 72,
    height: 72,
    borderRadius: 12,
    margin: 10,
  },
  dealInfo: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 12,
  },
  dealName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  dealNeighborhood: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  dealBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#e6f5ee',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dealBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2a7a5a',
  },

  // Explore by Vibe
  vibeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
  },
  vibeTile: {
    width: '50%',
    padding: 4,
  },
  vibeTileInner: {
    height: 100,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vibeTileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  vibeLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    zIndex: 1,
  },

  // Tab Bar
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabLabel: {
    fontSize: 10,
    color: '#999',
    marginTop: 3,
  },
  tabLabelActive: {
    color: '#2a7a5a',
    fontWeight: '600',
  },
  forYouTab: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    marginTop: -18,
  },
  forYouPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e6f5ee',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 6,
  },
  forYouPillActive: {
    backgroundColor: '#2a7a5a',
  },
  forYouPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2a7a5a',
  },
  forYouPillTextActive: {
    color: '#fff',
  },
});
