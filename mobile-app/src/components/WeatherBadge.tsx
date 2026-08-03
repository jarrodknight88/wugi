// ─────────────────────────────────────────────────────────────────────
// Wugi — WeatherBadge
//
// Shared temp °F + condition-icon chip. Fetches from Open-Meteo (no API
// key, no new packages). The app has no existing location plumbing
// (expo-location is installed but unused anywhere in src/), so this
// always uses the Atlanta fallback coordinates. 30-min in-memory cache
// + in-flight de-dup so mounting the badge on both Home and Discover
// doesn't double-fetch. Fails silent — renders nothing on error.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import type { Theme } from '../constants/colors';
import { MONO } from '../constants/fonts';

const ATLANTA = { latitude: 33.749, longitude: -84.388 };
const CACHE_MS = 30 * 60 * 1000;

type WeatherState = { tempF: number; code: number };

let cache: { data: WeatherState; fetchedAt: number } | null = null;
let inFlight: Promise<WeatherState | null> | null = null;

function iconFor(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

function fetchWeather(): Promise<WeatherState | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_MS) return Promise.resolve(cache.data);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${ATLANTA.latitude}&longitude=${ATLANTA.longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`weather fetch ${res.status}`);
      const json = await res.json();
      const tempF = json?.current?.temperature_2m;
      const code = json?.current?.weather_code;
      if (typeof tempF !== 'number' || typeof code !== 'number') {
        throw new Error('malformed weather response');
      }
      const data: WeatherState = { tempF, code };
      cache = { data, fetchedAt: Date.now() };
      return data;
    } catch (e) {
      console.log('WeatherBadge: fetch failed', e);
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function WeatherBadge({ theme }: { theme: Theme }) {
  const [weather, setWeather] = useState<WeatherState | null>(cache?.data ?? null);

  useEffect(() => {
    let cancelled = false;
    fetchWeather().then(w => { if (!cancelled && w) setWeather(w); });
    return () => { cancelled = true; };
  }, []);

  if (!weather) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontSize: 13 }}>{iconFor(weather.code)}</Text>
      <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: MONO, letterSpacing: 0.2 }}>
        {Math.round(weather.tempF)}°F
      </Text>
    </View>
  );
}
