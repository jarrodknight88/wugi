const admin = require('firebase-admin');
process.env.GOOGLE_APPLICATION_CREDENTIALS = '/Users/jarrod/.config/firebase/jarrod_knight88_gmail.com_application_default_credentials.json';
admin.initializeApp({ projectId: 'wugi-prod' });
const db = admin.firestore();
async function main() {
  const snap = await db.collection('venues').doc('teranga-city').get();
  const data = snap.data();
  console.log('idVerificationThreshold:', data.idVerificationThreshold);
  console.log('paymentDescriptor:', data.paymentDescriptor);
  console.log('stripeConnectAccountId:', data.stripeConnectAccountId);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
