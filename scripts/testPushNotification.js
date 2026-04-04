/**
 * Wugi — Test Push Notification Script
 * Sends a test notification via Firebase Admin SDK
 * 
 * Usage:
 *   node scripts/testPushNotification.js topic     → sends to all atlanta-events subscribers
 *   node scripts/testPushNotification.js uid <uid> → sends to specific user
 */

const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
}

const fcm = admin.messaging();
const db  = admin.firestore();

const mode = process.argv[2] || 'topic';
const uid  = process.argv[3];

async function sendToTopic() {
  const message = {
    topic: 'atlanta-events',
    notification: {
      title: '🎉 Euphoria Fridays',
      body: 'SkyLounge ATL · Tonight · 10 PM',
    },
    data: {
      screen:     'EventDetail',
      eventId:    'euphoria-fridays',
      eventTitle: 'Euphoria Fridays',
      venueName:  'SkyLounge ATL',
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } },
    },
  };

  const response = await fcm.send(message);
  console.log('✅ Sent to topic atlanta-events:', response);
}

async function sendToUser(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  const token = userDoc.data()?.fcmToken;

  if (!token) {
    console.error('❌ No FCM token found for user:', userId);
    process.exit(1);
  }

  const message = {
    token,
    notification: {
      title: '🎟️ Your ticket is ready',
      body:  'Tap to view your pass for Euphoria Fridays',
    },
    data: {
      screen:     'EventDetail',
      eventId:    'euphoria-fridays',
      eventTitle: 'Euphoria Fridays',
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } },
    },
  };

  const response = await fcm.send(message);
  console.log('✅ Sent to user', userId, ':', response);
}

async function listUsersWithTokens() {
  const snap = await db.collection('users').where('fcmToken', '!=', '').limit(10).get();
  console.log('Users with FCM tokens:');
  snap.docs.forEach(d => {
    console.log(' -', d.id, '|', d.data().email || 'no email', '|', d.data().fcmToken?.slice(0, 20) + '...');
  });
}

async function main() {
  if (mode === 'topic') {
    await sendToTopic();
  } else if (mode === 'uid' && uid) {
    await sendToUser(uid);
  } else if (mode === 'list') {
    await listUsersWithTokens();
  } else {
    console.log('Usage:');
    console.log('  node scripts/testPushNotification.js topic        → broadcast to all');
    console.log('  node scripts/testPushNotification.js list         → show users with tokens');
    console.log('  node scripts/testPushNotification.js uid <userId> → send to specific user');
  }
  process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
