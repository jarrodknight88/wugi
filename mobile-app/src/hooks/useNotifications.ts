// ─────────────────────────────────────────────────────────────────────
// Wugi — useNotifications.ts
// Push notifications via OneSignal (primary) + FCM (kept for Door compatibility)
// S1-05: Replaced unreliable FCM implementation with OneSignal SDK
//
// OneSignal App ID lives in app.json → extra.oneSignalAppId (see below).
// FCM kept in place — do not remove until [BACK-30] post-launch cleanup
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { OneSignal, LogLevel, NotificationClickedEvent } from 'react-native-onesignal'
import auth from '@react-native-firebase/auth'
import firestore from '@react-native-firebase/firestore'

// OneSignal App ID is a public client identifier (not a secret — the REST
// API key is the secret half, kept server-side as the Firebase secret
// ONESIGNAL_REST_API_KEY / ONESIGNAL_APP_ID). Sourced from app.json → extra
// so it has one canonical source, matching stripePublishableKey.
const ONESIGNAL_APP_ID = (Constants.expoConfig?.extra as { oneSignalAppId?: string } | undefined)?.oneSignalAppId ?? ''

// Callback type for handling notification taps
type NotificationHandler = (data: Record<string, string>) => void

// Global ref so App.tsx can register a handler after nav is ready
let _onNotificationTap: NotificationHandler | null = null

export function setNotificationTapHandler(handler: NotificationHandler) {
  _onNotificationTap = handler
}

// ── OneSignal initialization ──────────────────────────────────────────
function initOneSignal() {
  // Enable verbose logging in dev only
  if (__DEV__) OneSignal.Debug.setLogLevel(LogLevel.Verbose)

  OneSignal.initialize(ONESIGNAL_APP_ID)

  // Request permission — iOS shows native prompt, Android 13+ also needs this
  OneSignal.Notifications.requestPermission(true)
}

// ── Link OneSignal with Firebase UID ─────────────────────────────────
// Sets External User ID so we can target by UID from Cloud Functions
async function linkUserToOneSignal(uid: string) {
  try {
    OneSignal.login(uid)
    // Store OneSignal player ID in Firestore for server-side targeting
    const playerId = await OneSignal.User.pushSubscription.getIdAsync()
    if (playerId) {
      await firestore()
        .collection('users')
        .doc(uid)
        .set({ oneSignalPlayerId: playerId, updatedAt: firestore.FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => {})
    }
  } catch (e) {
    console.log('[OneSignal] linkUser error:', e)
  }
}

// ── Request permission (exported for Account screen toggle) ──────────
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const granted = await OneSignal.Notifications.requestPermission(true)
    return granted
  }
  return true
}

// ── Main hook ─────────────────────────────────────────────────────────
export function useNotifications() {
  const handledInitial = useRef(false)

  useEffect(() => {
    // Initialize OneSignal once on mount
    initOneSignal()

    // Link user ID when auth state changes
    const unsubscribeAuth = auth().onAuthStateChanged(user => {
      if (user) {
        linkUserToOneSignal(user.uid)
      } else {
        // Logout from OneSignal when user signs out
        OneSignal.logout()
      }
    })

    // Foreground notification received
    const foregroundSub = OneSignal.Notifications.addEventListener(
      'foregroundWillDisplay',
      (event) => {
        // Let OneSignal display it natively — no custom alert needed
        event.notification.display()
      }
    )

    // Notification tapped (foreground or background)
    const clickSub = OneSignal.Notifications.addEventListener(
      'click',
      (event: NotificationClickedEvent) => {
        const data = event.notification.additionalData as Record<string, string> | undefined
        if (data && _onNotificationTap) {
          _onNotificationTap(data)
        }
      }
    )

    // App opened from quit state via notification
    if (!handledInitial.current) {
      handledInitial.current = true
      OneSignal.Notifications.getPermissionAsync().then(() => {
        // Check for launch notification
        const launchNotif = OneSignal.Notifications.getLaunchNotification?.()
        if (launchNotif) {
          const data = launchNotif.additionalData as Record<string, string> | undefined
          if (data && _onNotificationTap) {
            setTimeout(() => _onNotificationTap?.(data), 1000)
          }
        }
      })
    }

    return () => {
      unsubscribeAuth()
      OneSignal.Notifications.removeEventListener('foregroundWillDisplay', foregroundSub as any)
      OneSignal.Notifications.removeEventListener('click', clickSub as any)
    }
  }, [])
}
