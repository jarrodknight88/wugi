// ─────────────────────────────────────────────────────────────────────
// Wugi — TabBar Component
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { Theme } from '../constants/colors';
import {
  HomeTabIcon,
  DiscoverTabIcon,
  SparkleIcon,
  FavoritesTabIcon,
  AccountTabIcon,
} from './icons';

type Props = {
  activeTab: string;
  onTabPress: (tab: string) => void;
  theme: Theme;
  unreadFavCount: number;
};

const TABS = [
  { id: 'home',      label: 'Home',    Icon: HomeTabIcon      },
  { id: 'discover',  label: 'Discover', Icon: DiscoverTabIcon },
  { id: 'forYou',    label: 'For You',  Icon: SparkleIcon     },
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
      paddingBottom: 20,
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
                  backgroundColor: '#e74c3c',
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 3,
                }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                    {unreadFavCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{
              color: isActive ? theme.accent : theme.subtext,
              fontSize: 10,
              fontWeight: isActive ? '700' : '500',
            }}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
