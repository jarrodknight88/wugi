// ─────────────────────────────────────────────────────────────────────
// Wugi — sendPushNotification
// Primary: OneSignal REST API (S1-05)
// Legacy: FCM admin.messaging() kept for Wugi Door compatibility
// Secrets: ONESIGNAL_REST_API_KEY, ONESIGNAL_APP_ID
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

const db = admin.firestore()

// ── OneSignal REST API helper ─────────────────────────────────────────
async function sendOneSignal(payload: object): Promise<void> {
  const apiKey = process.env.ONESIGNAL_REST_API_KEY
  const appId  = process.env.ONESIGNAL_APP_ID
  if (!apiKey || !appId) throw new Error('OneSignal secrets not configured')

  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify({ app_id: appId, ...payload }),
  })
  const data = await res.json() as any
  if (!res.ok || data.errors) {
    throw new Error(`OneSignal error: ${JSON.stringify(data.errors ?? data)}`)
  }
}

// ── Send to specific user by UID ──────────────────────────────────────
export async function sendToUser(
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  await sendOneSignal({
    headings:        { en: title },
    contents:        { en: body },
    data:            data ?? {},
    filters:         [{ field: 'external_user_id', value: uid }],
    target_channel:  'push',
  })
}

// ── Send to a topic/segment ───────────────────────────────────────────
// Topics map to the player tag the Account screen's notification toggles
// set (see mobile-app/src/screens/AccountScreen.tsx `OneSignal.User.addTag`)
// — 'events', 'deals', 'galleries', each 'on'/'off'. Filtering server-side
// on that tag (instead of a static 'All' segment) is what makes those
// toggles actually take effect; a device that never touched the toggle has
// no tag set at all, so `not_exists` keeps it opted in by default.
const TOPIC_TAG_KEY: Record<string, string> = {
  'atlanta-events': 'events',
}

export async function sendToTopic(
  topic: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const tagKey = TOPIC_TAG_KEY[topic]

  if (!tagKey) {
    // No preference toggle maps to this topic — fall back to broadcasting.
    await sendOneSignal({
      headings:          { en: title },
      contents:          { en: body },
      data:              data ?? {},
      included_segments: ['All'],
      target_channel:    'push',
    })
    return
  }

  await sendOneSignal({
    headings: { en: title },
    contents: { en: body },
    data:     data ?? {},
    filters: [
      { field: 'tag', key: tagKey, relation: '=', value: 'on' },
      { operator: 'OR' },
      { field: 'tag', key: tagKey, relation: 'not_exists' },
    ],
    target_channel: 'push',
  })
}

// ── HTTP callable for dashboard sends ────────────────────────────────
export const sendPushNotification = functions
  .runWith({ secrets: ['ONESIGNAL_REST_API_KEY', 'ONESIGNAL_APP_ID'] })
  .https.onCall(async (request) => {
    const { title, body, data, uid, topic } = request.data as {
      title: string; body: string; data?: Record<string, string>;
      uid?: string; topic?: string;
    }

    if (!title || !body) {
      throw new functions.https.HttpsError('invalid-argument', 'title and body are required')
    }

    try {
      if (uid)        await sendToUser(uid, title, body, data)
      else if (topic) await sendToTopic(topic, title, body, data)
      else throw new functions.https.HttpsError('invalid-argument', 'Must provide uid or topic')
      return { success: true }
    } catch (e) {
      functions.logger.error('sendPushNotification error:', e)
      throw new functions.https.HttpsError('internal', 'Failed to send notification')
    }
  })

// ── Legacy FCM functions — kept for Wugi Door compatibility ──────────
// DO NOT REMOVE until [BACK-30] post-launch consolidation
// These are used by Wugi Door which still uses @react-native-firebase/messaging
export async function sendToUserFCM(
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const userDoc = await db.collection('users').doc(uid).get()
  const token   = userDoc.data()?.fcmToken
  if (!token) return
  await admin.messaging().send({
    token,
    notification: { title, body },
    data: data ?? {},
    apns: { payload: { aps: { sound: 'default' } } },
  })
}
