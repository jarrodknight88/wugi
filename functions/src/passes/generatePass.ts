// ─────────────────────────────────────────────────────────────────────
// Wugi — generatePass
// Generates an Apple Wallet .pkpass file for a ticket order.
// Supports dynamic color codes + Pass Update protocol.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { PKPass } from 'passkit-generator'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'

const db      = admin.firestore()
const storage = admin.storage()

const PASS_TYPE_ID    = 'pass.com.wugimedia.wugi'
const TEAM_ID         = 'D9438V88S5'
const CERTS_DIR       = path.join(__dirname, '../../certs')
const WEB_SERVICE_URL = 'https://us-central1-wugi-prod.cloudfunctions.net/passWebService'

export interface PassData {
  orderId:             string
  // Doc ID in the `passes` collection this wallet pass should check in as.
  // Door (check-in-app/ScannerScreen) scans the QR and looks it up as
  // `passes/{passId}` — this MUST be the value encoded in the barcode.
  // `serialNumber` and the update-protocol stay keyed on orderId; passId
  // only drives the barcode. Falls back to orderId for callers that only
  // ever issue a single pass per order (kept 1:1 historically).
  passId?:             string
  eventTitle:          string
  venueName:           string
  eventDate:           string
  eventTime:           string
  ticketType:          string
  quantity:            number
  buyerName:           string
  buyerEmail:          string
  totalPaid:           number
  passColor?:          string | null
  colorLabel?:         string | null
  tableNumber?:        number | null
  webServiceURL?:      string
  authenticationToken?: string
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

function defaultColorForTicketType(ticketType: string): string {
  const t = ticketType.toLowerCase()
  if (t.includes('vip'))       return '#7c3aed'
  if (t.includes('table'))     return '#1d4ed8'
  if (t.includes('backstage')) return '#111827'
  if (t.includes('comp'))      return '#374151'
  return '#2a7a5a'
}

function buildPassJson(data: PassData): object {
  const bgHex      = data.passColor || defaultColorForTicketType(data.ticketType)
  const bgRgb      = hexToRgb(bgHex)
  const tableLabel = data.colorLabel || (data.tableNumber ? `Table ${data.tableNumber}` : null)
  const authToken  = data.authenticationToken || ''

  // ── Field layout (Apple eventTicket) ──────────────────────────────
  // Header:    WUGI logoText
  // Primary:   Event name  (large, top)
  // Secondary: Venue | Date | Time  (below primary, 3 columns)
  // Auxiliary: Ticket type | Holder | Assignment (if any)
  // Back:      Order ID, buyer info, terms

  const secondaryFields: object[] = [
    { key: 'venue', label: 'VENUE',   value: data.venueName  || 'Wugi Event' },
    { key: 'date',  label: 'DATE',    value: data.eventDate  || '' },
    { key: 'time',  label: 'TIME',    value: data.eventTime  || '' },
  ]

  const auxiliaryFields: object[] = [
    { key: 'ticket', label: 'TICKET',  value: data.ticketType || 'General Admission' },
    { key: 'holder', label: 'HOLDER',  value: data.buyerName  || 'Guest' },
  ]
  if (tableLabel) {
    auxiliaryFields.push({ key: 'table', label: 'SEAT / TABLE', value: tableLabel })
  }
  if (data.quantity > 1) {
    auxiliaryFields.push({ key: 'qty', label: 'QTY', value: String(data.quantity) })
  }

  const passJson: Record<string, unknown> = {
    formatVersion:      1,
    passTypeIdentifier: PASS_TYPE_ID,
    serialNumber:       data.orderId,
    teamIdentifier:     TEAM_ID,
    organizationName:   'Wugi',
    description:        `${data.eventTitle} — ${data.ticketType}`,

    // Colors — dynamic from ticket type
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    bgRgb,
    labelColor:         'rgb(200, 200, 200)',

    // Logo text shown next to logo image
    logoText: 'WUGI',

    // ── eventTicket pass type ──────────────────────────────────────
    eventTicket: {
      primaryFields: [
        {
          key:            'event',
          label:          'EVENT',
          value:          data.eventTitle,
          textAlignment:  'PKTextAlignmentCenter',
        },
      ],
      secondaryFields,
      auxiliaryFields,
      backFields: [
        { key: 'order',   label: 'Order ID',        value: data.orderId },
        { key: 'buyer',   label: 'Ticket holder',   value: data.buyerName  || 'Guest' },
        { key: 'email',   label: 'Email',            value: data.buyerEmail || '' },
        { key: 'total',   label: 'Total paid',       value: data.totalPaid > 0 ? `$${(data.totalPaid / 100).toFixed(2)}` : 'Free' },
        { key: 'reclaim', label: 'Lost your pass?',  value: `wugi.us/tickets/${data.orderId}` },
        { key: 'terms',   label: 'Terms',            value: 'No refunds. Valid ID required. Wugi.us' },
      ],
      headerFields: [
        {
          key:   'status',
          label: 'STATUS',
          value: 'VALID',
        },
      ],
    },

    // ── QR code — encodes the `passes` doc ID (passId) for Door scanner ──
    // Must match what ScannerScreen looks up (`passes/{scannedValue}`), NOT
    // the order-level serialNumber above.
    barcodes: [{
      message:         data.passId || data.orderId,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText:         data.ticketType || 'Wugi Ticket',
    }],

    // ── Relevance — show pass at event location/time ──────────────
    // Can add locations/relevantDate here when event data available
  }

  // Embed web service URL for live pass updates
  if (authToken) {
    passJson.webServiceURL       = data.webServiceURL || WEB_SERVICE_URL
    passJson.authenticationToken = authToken
  }

  return passJson
}

export async function buildPassBuffer(data: PassData): Promise<Buffer> {
  const files: Record<string, Buffer> = {
    'pass.json':   Buffer.from(JSON.stringify(buildPassJson(data))),
    'icon.png':    fs.readFileSync(path.join(CERTS_DIR, 'icon.png')),
    'icon@2x.png': fs.readFileSync(path.join(CERTS_DIR, 'icon@2x.png')),
    'icon@3x.png': fs.readFileSync(path.join(CERTS_DIR, 'icon@3x.png')),
  }

  // Add logo image if available
  const logoPath = path.join(CERTS_DIR, 'logo.png')
  if (fs.existsSync(logoPath)) {
    files['logo.png']    = fs.readFileSync(logoPath)
    files['logo@2x.png'] = fs.existsSync(path.join(CERTS_DIR, 'logo@2x.png'))
      ? fs.readFileSync(path.join(CERTS_DIR, 'logo@2x.png'))
      : files['logo.png']
  }

  // Add strip image if available (event-specific or default)
  const stripPath = path.join(CERTS_DIR, 'strip.png')
  if (fs.existsSync(stripPath)) {
    files['strip.png']    = fs.readFileSync(stripPath)
    files['strip@2x.png'] = fs.existsSync(path.join(CERTS_DIR, 'strip@2x.png'))
      ? fs.readFileSync(path.join(CERTS_DIR, 'strip@2x.png'))
      : files['strip.png']
  }

  const pass = new PKPass(files, {
    wwdr:       fs.readFileSync(path.join(CERTS_DIR, 'wwdr.pem')),
    signerCert: fs.readFileSync(path.join(CERTS_DIR, 'signerCert.pem')),
    signerKey:  fs.readFileSync(path.join(CERTS_DIR, 'signerKey.pem')),
  })
  return pass.getAsBuffer()
}

// ── getPrimaryPassId ────────────────────────────────────────────────
// Resolves the `passes` doc that a wallet pass regenerated from just an
// orderId (pass-update protocol refetch, table/ticket color sync) should
// keep encoding in its barcode. Prefers the purchaser's pass — the only
// one ever linked to a wallet-issued .pkpass — falling back to any pass
// on the order for older docs written before the `role` field existed.
export async function getPrimaryPassId(orderId: string): Promise<string | null> {
  const purchaserSnap = await db.collection('passes')
    .where('orderId', '==', orderId)
    .where('role', '==', 'purchaser')
    .limit(1)
    .get()
  if (!purchaserSnap.empty) return purchaserSnap.docs[0].id

  const anySnap = await db.collection('passes')
    .where('orderId', '==', orderId)
    .limit(1)
    .get()
  return anySnap.empty ? null : anySnap.docs[0].id
}

export async function storePass(orderId: string, passBuffer: Buffer): Promise<string> {
  const bucket   = storage.bucket()
  const filePath = `passes/${orderId}.pkpass`
  const file     = bucket.file(filePath)
  await file.save(passBuffer, {
    contentType: 'application/vnd.apple.pkpass',
    metadata:    { cacheControl: 'no-cache' },
  })
  await file.makePublic()
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`
}

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
    // Generate a unique auth token for pass update protocol
    const authenticationToken = crypto.randomBytes(20).toString('hex')
    data.authenticationToken  = authenticationToken

    functions.logger.info('Generating pass for order:', data.orderId)
    const passBuffer = await buildPassBuffer(data)
    const passUrl    = await storePass(data.orderId, passBuffer)

    // Store walletPass record for update protocol
    await db.collection('walletPasses').doc(data.orderId).set({
      orderId:             data.orderId,
      authenticationToken,
      passColor:           data.passColor   || null,
      colorLabel:          data.colorLabel  || null,
      tableNumber:         data.tableNumber || null,
      lastUpdated:         admin.firestore.FieldValue.serverTimestamp(),
      passGeneratedAt:     admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

    // Update order doc
    try {
      await db.collection('orders').doc(data.orderId).update({
        passUrl,
        authenticationToken,
        passColor:       data.passColor   || null,
        colorLabel:      data.colorLabel  || null,
        tableNumber:     data.tableNumber || null,
        passGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } catch { /* order doc may not exist yet */ }

    functions.logger.info('Pass generated:', passUrl)
    res.json({ success: true, passUrl })
  } catch (e: unknown) {
    functions.logger.error('Pass generation error:', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to generate pass' })
  }
})
