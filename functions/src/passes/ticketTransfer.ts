// ─────────────────────────────────────────────────────────────────────
// Wugi — ticketTransfer
// Handles ticket transfers between users.
// Two functions: initiateTransfer + claimTransfer
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { buildPassBuffer, storePass } from './generatePass'

const db = admin.firestore()

function generateToken(): string {
  return Math.random().toString(36).substring(2, 10) +
         Math.random().toString(36).substring(2, 10)
}

// ── initiateTransfer ─────────────────────────────────────────────────
// Called from mobile app when user wants to transfer their ticket
export const initiateTransfer = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }

  const { orderId, toEmail } = req.body
  if (!orderId || !toEmail) {
    res.status(400).json({ error: 'orderId and toEmail required' }); return
  }

  try {
    // Verify the order exists and is not already checked in or transferred
    const orderDoc = await db.collection('orders').doc(orderId).get()
    if (!orderDoc.exists) {
      res.status(404).json({ error: 'Order not found' }); return
    }

    const order = orderDoc.data()!
    if (order.checkedIn) {
      res.status(400).json({ error: 'Cannot transfer a checked-in ticket' }); return
    }
    if (order.transferred) {
      res.status(400).json({ error: 'This ticket has already been transferred' }); return
    }

    // Create transfer record
    const token      = generateToken()
    const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours

    const transferRef = await db.collection('transfers').add({
      orderId,
      fromUid:    order.userId || null,
      fromEmail:  order.buyerEmail || null,
      toEmail:    toEmail.toLowerCase().trim(),
      eventId:    order.eventId || null,
      eventTitle: order.eventTitle || null,
      venueName:  order.venueName || null,
      eventDate:  order.eventDate || null,
      ticketType: order.ticketType || null,
      status:     'pending',
      token,
      expiresAt:  admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    })

    // Mark order as transfer-pending so it can't be transferred again
    await db.collection('orders').doc(orderId).update({
      transferPending:   true,
      transferId:        transferRef.id,
      transferInitiated: admin.firestore.FieldValue.serverTimestamp(),
    })

    const claimUrl = `https://wugi.us/tickets/claim/${token}`
    functions.logger.info('Transfer initiated:', transferRef.id, 'to:', toEmail)

    res.json({ success: true, transferId: transferRef.id, claimUrl, token })
  } catch (e: unknown) {
    functions.logger.error('initiateTransfer error:', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Transfer failed' })
  }
})

// ── claimTransfer ────────────────────────────────────────────────────
// Called from wugi.us/tickets/claim/[token]
// Works for both guests and signed-in users
export const claimTransfer = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }

  const { token, claimerName, claimerEmail, claimerUid } = req.body
  if (!token || !claimerEmail) {
    res.status(400).json({ error: 'token and claimerEmail required' }); return
  }

  try {
    // Find transfer by token
    const transferSnap = await db.collection('transfers')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get()

    if (transferSnap.empty) {
      res.status(404).json({ error: 'Transfer not found or already claimed' }); return
    }

    const transferDoc  = transferSnap.docs[0]
    const transfer     = transferDoc.data()

    // Check expiry
    if (transfer.expiresAt.toDate() < new Date()) {
      await transferDoc.ref.update({ status: 'expired' })
      res.status(400).json({ error: 'Transfer link has expired' }); return
    }

    // Get original order
    const orderDoc = await db.collection('orders').doc(transfer.orderId).get()
    if (!orderDoc.exists) {
      res.status(404).json({ error: 'Original order not found' }); return
    }
    const order = orderDoc.data()!

    // Create new order for recipient
    const newOrderRef  = db.collection('orders').doc()
    const newOrderData = {
      ...order,
      buyerName:         claimerName || claimerEmail,
      buyerEmail:        claimerEmail.toLowerCase().trim(),
      userId:            claimerUid || null,
      transferredFrom:   transfer.orderId,
      transferId:        transferDoc.id,
      isTransferred:     true,
      checkedIn:         false,
      passUrl:           null,
      passGeneratedAt:   null,
      createdAt:         admin.firestore.FieldValue.serverTimestamp(),
    }
    await newOrderRef.set(newOrderData)

    // Invalidate original order — mark as transferred + force checked-in
    // so the original QR no longer works at the door
    await db.collection('orders').doc(transfer.orderId).update({
      transferred:       true,
      transferredTo:     claimerEmail.toLowerCase().trim(),
      transferredAt:     admin.firestore.FieldValue.serverTimestamp(),
      checkedIn:         true,   // invalidates original QR
      transferPending:   false,
    })

    // Mark transfer as claimed
    await transferDoc.ref.update({
      status:          'claimed',
      claimedAt:       admin.firestore.FieldValue.serverTimestamp(),
      claimedByEmail:  claimerEmail,
      claimedByUid:    claimerUid || null,
      newOrderId:      newOrderRef.id,
    })

    // Generate a new pass for the recipient
    let passUrl: string | null = null
    try {
      const passBuffer = await buildPassBuffer({
        orderId:     newOrderRef.id,
        eventTitle:  order.eventTitle || '',
        venueName:   order.venueName || '',
        eventDate:   order.eventDate || '',
        eventTime:   order.eventTime || '',
        ticketType:  order.ticketType || '',
        quantity:    order.quantity || 1,
        buyerName:   claimerName || claimerEmail,
        buyerEmail:  claimerEmail,
        totalPaid:   order.totalPaid || 0,
        passColor:   order.passColor || null,
        colorLabel:  order.colorLabel || null,
        tableNumber: order.tableNumber || null,
      })
      passUrl = await storePass(newOrderRef.id, passBuffer)
      await newOrderRef.update({ passUrl, passGeneratedAt: admin.firestore.FieldValue.serverTimestamp() })
    } catch (passErr) {
      functions.logger.error('Pass generation during claim failed:', passErr)
    }

    functions.logger.info('Transfer claimed:', transferDoc.id, 'new order:', newOrderRef.id)
    res.json({ success: true, orderId: newOrderRef.id, passUrl })
  } catch (e: unknown) {
    functions.logger.error('claimTransfer error:', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Claim failed' })
  }
})

// ── cancelTransfer ───────────────────────────────────────────────────
export const cancelTransfer = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }

  const { transferId, orderId } = req.body
  if (!transferId || !orderId) {
    res.status(400).json({ error: 'transferId and orderId required' }); return
  }

  try {
    const transferDoc = await db.collection('transfers').doc(transferId).get()
    if (!transferDoc.exists || transferDoc.data()?.status !== 'pending') {
      res.status(400).json({ error: 'Transfer cannot be cancelled' }); return
    }

    await transferDoc.ref.update({ status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp() })
    await db.collection('orders').doc(orderId).update({ transferPending: false, transferId: null })

    res.json({ success: true })
  } catch (e: unknown) {
    functions.logger.error('cancelTransfer error:', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Cancel failed' })
  }
})
