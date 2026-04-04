import { useEffect, useRef } from 'react'
import { Platform, Alert } from 'react-native'
import messaging from '@react-native-firebase/messaging'
import firestore from '@react-native-firebase/firestore'
import auth from '@react-native-firebase/auth'

// Callback type for handling notification taps
type NotificationHandler = (data: Record<string, string>) => void

// Global ref so App.tsx can register a handler after nav is ready
let _onNotificationTap: NotificationHandler | null = null

export function setNotificationTapHandler(handler: NotificationHandler) {
  _onNotificationTap = handler
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const authStatus = await messaging().requestPermission()
    return (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
    )
  }
  return true
}

export async function registerFCMToken(): Promise<void> {
  try {
    const user = auth().currentUser
    if (!user) return

    const granted = await requestNotificationPermission()
    if (!granted) return

    const token = await messaging().getToken()
    if (!token) return

    // Subscribe to Atlanta broadcast topic
    await messaging().subscribeToTopic('atlanta-events')

    // Merge so we don't overwrite other user fields
    await firestore()
      .collection('users')
      .doc(user.uid)
      .set(
        { fcmToken: token, fcmUpdatedAt: firestore.FieldValue.serverTimestamp() },
        { merge: true }
      )

    console.log('FCM token registered:', token.slice(0, 20) + '...')
  } catch (e) {
    console.log('FCM token registration error:', e)
  }
}

export function useNotifications() {
  const handledInitial = useRef(false)

  useEffect(() => {
    // Wait for auth state to be confirmed before registering FCM token
    const unsubscribeAuth = auth().onAuthStateChanged(user => {
      if (user) {
        registerFCMToken()
      }
    })

    // Refresh token if FCM rotates it
    const unsubscribeTokenRefresh = messaging().onTokenRefresh(async token => {
      const currentUser = auth().currentUser
      if (!currentUser) return
      await firestore()
        .collection('users')
        .doc(currentUser.uid)
        .set(
          { fcmToken: token, fcmUpdatedAt: firestore.FieldValue.serverTimestamp() },
          { merge: true }
        ).catch(() => {})
    })

    // Foreground notification — show an alert
    const unsubscribeForeground = messaging().onMessage(async remoteMessage => {
      const { notification } = remoteMessage
      if (notification?.title) {
        Alert.alert(
          notification.title,
          notification.body ?? '',
          [
            { text: 'Dismiss', style: 'cancel' },
            {
              text: 'View',
              onPress: () => {
                if (remoteMessage.data && _onNotificationTap) {
                  _onNotificationTap(remoteMessage.data as Record<string, string>)
                }
              },
            },
          ]
        )
      }
    })

    // Background → foreground via notification tap
    const unsubscribeBackground = messaging().onNotificationOpenedApp(remoteMessage => {
      if (remoteMessage.data && _onNotificationTap) {
        _onNotificationTap(remoteMessage.data as Record<string, string>)
      }
    })

    // Quit state → app opened via notification tap (only handle once)
    if (!handledInitial.current) {
      handledInitial.current = true
      messaging().getInitialNotification().then(remoteMessage => {
        if (remoteMessage?.data && _onNotificationTap) {
          // Small delay to let navigation initialize
          setTimeout(() => {
            _onNotificationTap?.(remoteMessage.data as Record<string, string>)
          }, 1000)
        }
      })
    }

    return () => {
      unsubscribeAuth()
      unsubscribeTokenRefresh()
      unsubscribeForeground()
      unsubscribeBackground()
    }
  }, [])
}
