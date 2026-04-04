// ─────────────────────────────────────────────────────────────────────
// Wugi — debugFCM
// Called from the app to debug FCM token registration
// Returns exactly what the server sees
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

const db = admin.firestore()
const fcm = admin.messaging()

export const debugFCM = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }

  const { uid, token } = req.body

  const result: Record<string, unknown> = {
    received: { uid, token: token ? token.slice(0, 30) + '...' : null },
    steps: [] as string[],
  }

  const steps = result.steps as string[]

  try {
    // Step 1: Check user doc exists
    const userDoc = await db.collection('users').doc(uid).get()
    steps.push(userDoc.exists ? '✅ User doc exists' : '❌ User doc MISSING')

    // Step 2: Try writing token
    await db.collection('users').doc(uid).set(
      { fcmToken: token, fcmUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    )
    steps.push('✅ Token written to Firestore')

    // Step 3: Verify it was written
    const verify = await db.collection('users').doc(uid).get()
    const savedToken = verify.data()?.fcmToken
    steps.push(savedToken === token ? '✅ Token verified in Firestore' : '❌ Token mismatch after write')

    // Step 4: Try sending a test notification
    try {
      const msgId = await fcm.send({
        token,
        notification: { title: '✅ Wugi Debug', body: 'FCM is working!' },
        apns: { payload: { aps: { sound: 'default' } } },
      })
      steps.push('✅ Test notification sent: ' + msgId)
    } catch (e: unknown) {
      steps.push('❌ FCM send failed: ' + (e instanceof Error ? e.message : String(e)))
    }

    res.json({ success: true, ...result })
  } catch (e: unknown) {
    steps.push('❌ Error: ' + (e instanceof Error ? e.message : String(e)))
    res.status(500).json({ success: false, ...result })
  }
})
