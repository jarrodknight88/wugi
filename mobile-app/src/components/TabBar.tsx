// ─────────────────────────────────────────────────────────────────────
// Wugi — TabBar Component
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { Theme } from '../constants/colors';
import { FONTS, MONO } from '../constants/fonts';
import {
  HomeTabIcon,
  DiscoverTabIcon,
  BoltIcon,
  FavoritesTabIcon,
  AccountTabIcon,
} from './icons';

// Warm notification badge (design --notification-badge).
const BADGE_COLOR = '#d97a6a';

type Props = {
  activeTab: string;
  onTabPress: (tab: string) => void;
  theme: Theme;
  unreadFavCount: number;
};

const TABS = [
  { id: 'home',      label: 'Home',    Icon: HomeTabIcon      },
  { id: 'discover',  label: 'Discover', Icon: DiscoverTabIcon },
  { id: 'forYou',    label: 'For You',  Icon: BoltIcon        },
  { id: 'favorites', label: 'Saved',    Icon: FavoritesTabIcon },
  { id: 'account',   label: 'Account',  Icon: AccountTabIcon  },
];

export function TabBar({ activeTab, onTabPress, theme, unreadFavCount }: Props) {
  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: theme.bg,
      borderTopWidth: 1,
      borderTopColor: theme.divider,
      paddingBottom: 28,
      paddingTop: 10,
    }}>
      {TABS.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <TouchableOpacity
            key={id}
            style={{ flex: 1, alignItems: 'center', gap: 3 }}
            onPress={() => onTabPress(id)}
          >
            <View style={{ position: 'relative' }}>
              <Icon color={isActive ? theme.accent : theme.subtext}/>
              {id === 'favorites' && unreadFavCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  backgroundColor: BADGE_COLOR,
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 3,
                }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontFamily: MONO, fontWeight: '700' }}>
                    {unreadFavCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{
              color: isActive ? theme.accent : theme.subtext,
              fontSize: 10,
              fontFamily: isActive ? FONTS.display : FONTS.medium,
            }}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
