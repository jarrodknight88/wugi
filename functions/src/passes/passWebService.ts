// ─────────────────────────────────────────────────────────────────────
// Wugi — Pass Update Web Service
// Implements Apple Wallet Pass Update Protocol
// Docs: https://developer.apple.com/library/archive/documentation/PassKit/Reference/PassKit_WebService/WebService.html
//
// Required endpoints:
//   POST   /v1/devices/{deviceId}/registrations/{passType}/{serial}  → register
//   DELETE /v1/devices/{deviceId}/registrations/{passType}/{serial}  → unregister
//   GET    /v1/devices/{deviceId}/registrations/{passType}?passesUpdatedSince= → list updated
//   GET    /v1/passes/{passType}/{serial}                             → get latest pass
//   POST   /v1/log                                                    → error logging
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { buildPassBuffer } from './generatePass'

const db      = admin.firestore()
const storage = admin.storage()

const PASS_TYPE = 'pass.com.wugimedia.wugi'

// ── Auth token validation ─────────────────────────────────────────────
async function validateAuthToken(serial: string, token: string): Promise<boolean> {
  try {
    const doc = await db.collection('walletPasses').doc(serial).get()
    if (!doc.exists) return false
    return doc.data()?.authenticationToken === token
  } catch { return false }
}

// ── Main web service handler ──────────────────────────────────────────
// All Apple Wallet web service requests route through this single function
export const passWebService = functions.https.onRequest(async (req, res) => {
  // Apple sends all requests to /v1/... — parse the path
  const path    = req.path  // e.g. /v1/passes/pass.com.wugimedia.wugi/order123
  const method  = req.method
  const parts   = path.split('/').filter(Boolean) // ['v1', 'passes', ...]

  functions.logger.info('PassWebService:', method, path)

  // POST /v1/log — error logging from Apple Wallet
  if (method === 'POST' && parts[1] === 'log') {
    functions.logger.warn('Apple Wallet log:', req.body)
    res.status(200).send()
    return
  }

  // GET /v1/passes/{passType}/{serial} — return latest pass
  if (method === 'GET' && parts[1] === 'passes' && parts.length === 4) {
    const [, , passType, serial] = parts
    if (passType !== PASS_TYPE) { res.status(400).send(); return }

    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace('ApplePass ', '')
    if (!await validateAuthToken(serial, token)) { res.status(401).send(); return }

    try {
      const passDoc = await db.collection('walletPasses').doc(serial).get()
      if (!passDoc.exists) { res.status(404).send(); return }

      const passData = passDoc.data()!
      const orderDoc = await db.collection('orders').doc(serial).get()
      if (!orderDoc.exists) { res.status(404).send(); return }

      const order = orderDoc.data()!
      const passBuffer = await buildPassBuffer({
        orderId:     serial,
        eventTitle:  order.eventTitle || '',
        venueName:   order.venueName  || '',
        eventDate:   order.eventDate  || '',
        eventTime:   order.eventTime  || '',
        ticketType:  order.ticketType || '',
        quantity:    order.quantity   || 1,
        buyerName:   order.buyerName  || '',
        buyerEmail:  order.buyerEmail || '',
        totalPaid:   order.totalPaid  || 0,
        passColor:   order.passColor  || null,
        colorLabel:  order.colorLabel || null,
        tableNumber: order.tableNumber || null,
        webServiceURL: `https://us-central1-wugi-prod.cloudfunctions.net/passWebService`,
        authenticationToken: passData.authenticationToken,
      })

      // Update lastModified
      await db.collection('walletPasses').doc(serial).update({
        lastFetched: admin.firestore.FieldValue.serverTimestamp()
      })

      res.set('Content-Type', 'application/vnd.apple.pkpass')
      res.set('Last-Modified', new Date().toUTCString())
      res.status(200).send(passBuffer)
    } catch (e) {
      functions.logger.error('Pass fetch error:', e)
      res.status(500).send()
    }
    return
  }

  // POST /v1/devices/{deviceId}/registrations/{passType}/{serial} — device registers
  if (method === 'POST' && parts[1] === 'devices' && parts[3] === 'registrations' && parts.length === 6) {
    const [, , deviceId, , passType, serial] = parts
    if (passType !== PASS_TYPE) { res.status(400).send(); return }

    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace('ApplePass ', '')
    if (!await validateAuthToken(serial, token)) { res.status(401).send(); return }

    const { pushToken } = req.body

    try {
      const deviceRef = db.collection('walletDevices').doc(deviceId)
      await deviceRef.set({ pushToken, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })

      const regRef = db
        .collection('walletDevices').doc(deviceId)
        .collection('registrations').doc(serial)

      const exists = (await regRef.get()).exists
      await regRef.set({ passType, serial, registeredAt: admin.firestore.FieldValue.serverTimestamp() })

      functions.logger.info('Device registered:', deviceId, 'for pass:', serial)
      res.status(exists ? 200 : 201).send()
    } catch (e) {
      functions.logger.error('Registration error:', e)
      res.status(500).send()
    }
    return
  }

  // DELETE /v1/devices/{deviceId}/registrations/{passType}/{serial} — device unregisters
  if (method === 'DELETE' && parts[1] === 'devices' && parts[3] === 'registrations' && parts.length === 6) {
    const [, , deviceId, , passType, serial] = parts
    if (passType !== PASS_TYPE) { res.status(400).send(); return }

    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace('ApplePass ', '')
    if (!await validateAuthToken(serial, token)) { res.status(401).send(); return }

    try {
      await db
        .collection('walletDevices').doc(deviceId)
        .collection('registrations').doc(serial)
        .delete()
      functions.logger.info('Device unregistered:', deviceId, 'from pass:', serial)
      res.status(200).send()
    } catch (e) {
      functions.logger.error('Unregister error:', e)
      res.status(500).send()
    }
    return
  }

  // GET /v1/devices/{deviceId}/registrations/{passType}?passesUpdatedSince=
  if (method === 'GET' && parts[1] === 'devices' && parts[3] === 'registrations' && parts.length === 5) {
    const [, , deviceId, , passType] = parts
    if (passType !== PASS_TYPE) { res.status(400).send(); return }

    const updatedSince = req.query.passesUpdatedSince as string | undefined

    try {
      const regsSnap = await db
        .collection('walletDevices').doc(deviceId)
        .collection('registrations')
        .get()

      const serials: string[] = []
      for (const reg of regsSnap.docs) {
        const serial = reg.data().serial
        const passDoc = await db.collection('walletPasses').doc(serial).get()
        if (!passDoc.exists) continue
        const lastUpdated: admin.firestore.Timestamp = passDoc.data()?.lastUpdated
        if (!updatedSince || (lastUpdated && lastUpdated.toDate() > new Date(Number(updatedSince) * 1000))) {
          serials.push(serial)
        }
      }

      if (serials.length === 0) { res.status(204).send(); return }

      const lastUpdated = Math.floor(Date.now() / 1000).toString()
      res.status(200).json({ serialNumbers: serials, lastUpdated })
    } catch (e) {
      functions.logger.error('List registrations error:', e)
      res.status(500).send()
    }
    return
  }

  res.status(404).send()
})

// ── pushPassUpdate ────────────────────────────────────────────────────
// Sends APNs push to Apple Wallet when a pass needs updating.
// Triggered when venue changes table color in admin dashboard.
export const onTableColorChange = functions.firestore
  .document('venues/{venueId}/tableColors/{tableId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after  = change.after.data()

    // Only proceed if color actually changed
    if (before.color === after.color && before.label === after.label) return

    const venueId     = context.params.venueId
    const tableNumber = after.tableNumber

    functions.logger.info('Table color changed:', venueId, tableNumber, after.color)

    try {
      // Find all orders with this venue + table number that have passes
      const ordersSnap = await db.collection('orders')
        .where('venueId', '==', venueId)
        .where('tableNumber', '==', tableNumber)
        .where('passUrl', '!=', null)
        .where('checkedIn', '==', false)
        .get()

      if (ordersSnap.empty) {
        functions.logger.info('No active passes for table', tableNumber)
        return
      }

      const batch = db.batch()
      const pushPromises: Promise<unknown>[] = []

      for (const orderDoc of ordersSnap.docs) {
        const orderId = orderDoc.id

        // Update order with new color
        batch.update(orderDoc.ref, {
          passColor:   after.color,
          colorLabel:  after.label,
          tableNumber: after.tableNumber,
        })

        // Mark walletPass as updated so Apple Wallet knows to re-fetch
        const passRef = db.collection('walletPasses').doc(orderId)
        batch.update(passRef, {
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          passColor:   after.color,
          colorLabel:  after.label,
        })

        // Regenerate and re-store the pass file
        const order = orderDoc.data()
        pushPromises.push(
          buildPassBuffer({
            orderId,
            eventTitle:  order.eventTitle || '',
            venueName:   order.venueName  || '',
            eventDate:   order.eventDate  || '',
            eventTime:   order.eventTime  || '',
            ticketType:  order.ticketType || '',
            quantity:    order.quantity   || 1,
            buyerName:   order.buyerName  || '',
            buyerEmail:  order.buyerEmail || '',
            totalPaid:   order.totalPaid  || 0,
            passColor:   after.color,
            colorLabel:  after.label,
            tableNumber: after.tableNumber,
            webServiceURL: `https://us-central1-wugi-prod.cloudfunctions.net/passWebService`,
            authenticationToken: order.authenticationToken || '',
          }).then(async buf => {
            // Store updated pass
            const bucket   = storage.bucket()
            const file     = bucket.file(`passes/${orderId}.pkpass`)
            await file.save(buf, {
              contentType: 'application/vnd.apple.pkpass',
              metadata:    { cacheControl: 'no-cache' },
            })
            await file.makePublic()

            // Push APNs notification to all registered devices for this pass
            await pushApnsToWalletDevices(orderId)
          }).catch(e => functions.logger.error('Pass regen error for', orderId, e))
        )
      }

      await batch.commit()
      await Promise.all(pushPromises)
      functions.logger.info('Updated', ordersSnap.size, 'passes for table', tableNumber)
    } catch (e) {
      functions.logger.error('onTableColorChange error:', e)
    }
  })

// ── APNs push to wallet devices ───────────────────────────────────────
async function pushApnsToWalletDevices(orderId: string): Promise<void> {
  const devicesSnap = await db.collection('walletDevices').get()

  for (const deviceDoc of devicesSnap.docs) {
    const regRef = deviceDoc.ref.collection('registrations').doc(orderId)
    const reg    = await regRef.get()
    if (!reg.exists) continue

    const pushToken = deviceDoc.data().pushToken
    if (!pushToken) continue

    // Send APNs push via Firebase Messaging (using the pass APNs topic)
    try {
      await admin.messaging().send({
        token:  pushToken,
        apns: {
          headers: { 'apns-topic': 'pass.com.wugimedia.wugi', 'apns-push-type': 'background' },
          payload: { aps: { 'content-available': 1 } },
        },
      })
      functions.logger.info('APNs push sent to device for pass:', orderId)
    } catch (e) {
      functions.logger.warn('APNs push failed for device:', deviceDoc.id, e)
    }
  }
}
