// ─────────────────────────────────────────────────────────────────────
// Wugi — sendPushNotification
// Sends FCM push notifications. Can target:
//   - A specific user by uid (looks up their fcmToken)
//   - A specific FCM token directly
//   - A topic (e.g. "atlanta-events")
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

const db = admin.firestore()
const fcm = admin.messaging()

interface SendOptions {
  title: string
  body: string
  data?: Record<string, string>
  uid?: string
  token?: string
  topic?: string
}

export async function sendToUser(
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const userDoc = await db.collection('users').doc(uid).get()
  const token = userDoc.data()?.fcmToken
  if (!token) return
  await fcm.send({
    token,
    notification: { title, body },
    data: data ?? {},
    apns: { payload: { aps: { sound: 'default' } } },
  })
}

export async function sendToTopic(
  topic: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  await fcm.send({
    topic,
    notification: { title, body },
    data: data ?? {},
    apns: { payload: { aps: { sound: 'default' } } },
  })
}

// HTTP callable for manual sends from dashboard
export const sendPushNotification = functions.https.onCall(async (request) => {
  const { title, body, data, uid, token, topic } = request.data as SendOptions

  if (!title || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'title and body are required')
  }

  try {
    if (uid) {
      await sendToUser(uid, title, body, data)
    } else if (token) {
      await fcm.send({ token, notification: { title, body }, data: data ?? {} })
    } else if (topic) {
      await sendToTopic(topic, title, body, data)
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Must provide uid, token, or topic')
    }
    return { success: true }
  } catch (e) {
    functions.logger.error('sendPushNotification error:', e)
    throw new functions.https.HttpsError('internal', 'Failed to send notification')
  }
})
