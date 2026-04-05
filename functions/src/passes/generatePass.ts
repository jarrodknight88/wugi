// ─────────────────────────────────────────────────────────────────────
// Wugi — generatePass
// Generates an Apple Wallet .pkpass file for a ticket order.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { PKPass } from 'passkit-generator'
import * as path from 'path'
import * as fs from 'fs'

const db      = admin.firestore()
const storage = admin.storage()

const PASS_TYPE_ID = 'pass.com.wugimedia.wugi'
const TEAM_ID      = 'D9438V88S5'
const CERTS_DIR    = path.join(__dirname, '../../certs')

export interface PassData {
  orderId:    string
  eventTitle: string
  venueName:  string
  eventDate:  string
  eventTime:  string
  ticketType: string
  quantity:   number
  buyerName:  string
  buyerEmail: string
  totalPaid:  number
}

function buildPassJson(data: PassData): object {
  return {
    formatVersion:      1,
    passTypeIdentifier: PASS_TYPE_ID,
    serialNumber:       data.orderId,
    teamIdentifier:     TEAM_ID,
    organizationName:   'Wugi',
    description:        data.eventTitle,
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    'rgb(42, 122, 90)',
    labelColor:         'rgb(200, 240, 220)',
    logoText:           'WUGI',
    eventTicket: {
      primaryFields:   [{ key: 'event',  label: 'EVENT', value: data.eventTitle }],
      secondaryFields: [
        { key: 'venue', label: 'VENUE', value: data.venueName },
        { key: 'date',  label: 'DATE',  value: data.eventDate },
        { key: 'time',  label: 'TIME',  value: data.eventTime },
      ],
      auxiliaryFields: [
        { key: 'ticket', label: 'TICKET TYPE', value: data.ticketType },
        { key: 'qty',    label: 'QTY',          value: String(data.quantity) },
      ],
      backFields: [
        { key: 'order',   label: 'Order ID',      value: data.orderId },
        { key: 'buyer',   label: 'Name',           value: data.buyerName },
        { key: 'email',   label: 'Email',          value: data.buyerEmail },
        { key: 'total',   label: 'Total Paid',     value: `$${(data.totalPaid / 100).toFixed(2)}` },
        { key: 'reclaim', label: 'Lost your pass?', value: `wugi.us/tickets/${data.orderId}` },
        { key: 'terms',   label: 'Terms',          value: 'No refunds. Valid ID required.' },
      ],
    },
    barcodes: [{
      message:         data.orderId,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText:         `Order: ${data.orderId}`,
    }],
  }
}

export async function buildPassBuffer(data: PassData): Promise<Buffer> {
  const pass = new PKPass(
    {
      'pass.json':   Buffer.from(JSON.stringify(buildPassJson(data))),
      'icon.png':    fs.readFileSync(path.join(CERTS_DIR, 'icon.png')),
      'icon@2x.png': fs.readFileSync(path.join(CERTS_DIR, 'icon@2x.png')),
      'icon@3x.png': fs.readFileSync(path.join(CERTS_DIR, 'icon@3x.png')),
    },
    {
      wwdr:       fs.readFileSync(path.join(CERTS_DIR, 'wwdr.pem')),
      signerCert: fs.readFileSync(path.join(CERTS_DIR, 'signerCert.pem')),
      signerKey:  fs.readFileSync(path.join(CERTS_DIR, 'signerKey.pem')),
    }
  )
  return pass.getAsBuffer()
}

export async function storePass(orderId: string, passBuffer: Buffer): Promise<string> {
  const bucket   = storage.bucket()
  const filePath = `passes/${orderId}.pkpass`
  const file     = bucket.file(filePath)

  await file.save(passBuffer, {
    contentType: 'application/vnd.apple.pkpass',
    metadata:    { cacheControl: 'public, max-age=3600' },
  })

  await file.makePublic()
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`
}

// HTTP endpoint — called after Stripe checkout
export const createPass = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return }

  const data = req.body as PassData
  if (!data.orderId || !data.eventTitle) {
    res.status(400).json({ error: 'Missing required fields' }); return
  }

  try {
    functions.logger.info('Generating pass for order:', data.orderId)
    const passBuffer = await buildPassBuffer(data)
    const passUrl    = await storePass(data.orderId, passBuffer)

    // Save pass URL to order doc if it exists
    try {
      await db.collection('orders').doc(data.orderId).update({
        passUrl,
        passGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } catch { /* order doc may not exist */ }

    functions.logger.info('Pass generated:', passUrl)
    res.json({ success: true, passUrl })
  } catch (e: unknown) {
    functions.logger.error('Pass generation error:', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to generate pass' })
  }
})
