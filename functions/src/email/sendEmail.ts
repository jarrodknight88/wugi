// ─────────────────────────────────────────────────────────────────────
// Wugi — sendEmail Cloud Function
// HTTP endpoint called after purchase/transfer/reclaim
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import {
  sendPurchaseConfirmation,
  sendTransferNotification,
  sendReclaimEmail,
} from './emailService'

export const sendEmail = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return }

  const { type, ...data } = req.body

  try {
    switch (type) {
      case 'purchase':
        await sendPurchaseConfirmation(data)
        break
      case 'transfer':
        await sendTransferNotification(data)
        break
      case 'reclaim':
        await sendReclaimEmail(data)
        break
      default:
        res.status(400).json({ error: `Unknown email type: ${type}` }); return
    }
    res.json({ success: true })
  } catch (e: unknown) {
    functions.logger.error('sendEmail error:', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Email failed' })
  }
})
