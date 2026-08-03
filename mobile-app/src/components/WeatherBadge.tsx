// ─────────────────────────────────────────────────────────────────────
// Wugi — WeatherBadge
//
// Shared temp °F + condition-icon chip for the Home and Discover headers
// (UAT-W2A). Fetches current conditions from Open-Meteo (no API key, no
// new packages: https://open-meteo.com/en/docs). Atlanta fallback coords
// are used since the app has no location plumbing wired anywhere in src/
// (expo-location is installed but unused). Fails silent — renders nothing
// while loading or on any fetch error, per spec.
//
// 30-minute in-memory cache shared across every mounted instance (Home +
// Discover headers are both alive simultaneously under RootNavigator's tab
// architecture), with in-flight de-dup so two badges mounting at once only
// issue one network request.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Theme } from '../constants/colors';
import { MONO } from '../constants/fonts';

const ATLANTA_LAT = 33.749;
const ATLANTA_LON = -84.388;
const CACHE_MS = 30 * 60 * 1000;

type WeatherReading = { temperatureF: number; weatherCode: number };

let cache: { data: WeatherReading; fetchedAt: number } | null = null;
let inFlight: Promise<WeatherReading | null> | null = null;

async function fetchWeather(): Promise<WeatherReading | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${ATLANTA_LAT}&longitude=${ATLANTA_LON}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      const temperatureF = json?.current?.temperature_2m;
      const weatherCode = json?.current?.weather_code;
      if (typeof temperatureF !== 'number' || typeof weatherCode !== 'number') return null;
      const data = { temperatureF, weatherCode };
      cache = { data, fetchedAt: Date.now() };
      return data;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// WMO weather-code → condition emoji. Grouped per open-meteo's documented
// code table (https://open-meteo.com/en/docs — "WMO Weather interpretation
// codes"), collapsed to the handful of states worth a distinct icon here.
function conditionIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function WeatherBadge({ theme }: { theme: Theme }) {
  const [reading, setReading] = useState<WeatherReading | null>(cache?.data ?? null);

  useEffect(() => {
    let cancelled = false;
    fetchWeather().then(data => { if (!cancelled && data) setReading(data); });
    return () => { cancelled = true; };
  }, []);

  if (!reading) return null;

  return (
    <View style={[styles.badge, { backgroundColor: theme.pill, borderColor: theme.pillBorder }]}>
      <Text style={styles.icon}>{conditionIcon(reading.weatherCode)}</Text>
      <Text style={[styles.temp, { color: theme.subtext, fontFamily: MONO }]}>
        {Math.round(reading.temperatureF)}°F
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  icon: {
    fontSize: 12,
  },
  temp: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
