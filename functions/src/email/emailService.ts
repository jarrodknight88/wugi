// ─────────────────────────────────────────────────────────────────────
// Wugi — emailService.ts
// Sends transactional emails via Resend
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import { Resend } from 'resend'

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY || functions.config().resend?.api_key
  if (!key) throw new Error('RESEND_API_KEY not set')
  return new Resend(key)
}

const FROM   = 'Wugi Tickets <tickets@wugi.us>'
const GREEN  = '#2a7a5a'
const RADIUS = '12px'

const wrap = (body: string) => `
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wugi</title></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 16px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
<tr><td style="background:${GREEN};padding:24px 32px;text-align:center">
  <span style="color:#fff;font-size:26px;font-weight:900;letter-spacing:-1px">wugi</span>
</td></tr>
<tr><td style="padding:32px">${body}</td></tr>
<tr><td style="background:#f5f3ef;padding:20px 32px;text-align:center">
  <p style="color:#999;font-size:12px;margin:0">© 2026 Wugi LLC · Atlanta, GA · <a href="https://wugi.us" style="color:${GREEN}">wugi.us</a></p>
  <p style="color:#ccc;font-size:11px;margin:6px 0 0">No refunds · Valid ID required at door</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`

const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:${GREEN};color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:${RADIUS};text-decoration:none;margin-top:20px">${label}</a>`

const divider = `<hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0">`

const row = (label: string, value: string) =>
  `<tr><td style="color:#888;font-size:13px;padding:6px 0">${label}</td>
   <td style="color:#111;font-size:13px;font-weight:600;padding:6px 0;text-align:right">${value}</td></tr>`

// ── Purchase confirmation ─────────────────────────────────────────────
export interface PurchaseEmailData {
  to:         string
  buyerName:  string
  eventTitle: string
  venueName:  string
  eventDate:  string
  eventTime:  string
  ticketType: string
  quantity:   number
  totalPaid:  number   // cents
  orderId:    string
  passUrl?:   string | null
}

export async function sendPurchaseConfirmation(data: PurchaseEmailData): Promise<void> {
  const resend  = getResend()
  const total   = `$${(data.totalPaid / 100).toFixed(2)}`
  const reclaim = `https://wugi.us/tickets/${data.orderId}`

  const html = wrap(`
    <h2 style="color:#111;font-size:22px;font-weight:800;margin:0 0 4px">You're in! 🎟️</h2>
    <p style="color:#666;margin:0 0 24px">Your tickets are confirmed. See you there!</p>

    <div style="background:#f5f3ef;border-radius:${RADIUS};padding:20px;margin-bottom:24px">
      <p style="color:#111;font-size:18px;font-weight:800;margin:0 0 4px">${data.eventTitle}</p>
      <p style="color:#666;font-size:14px;margin:0">${data.venueName}</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Date', data.eventDate)}
      ${row('Time', data.eventTime)}
      ${row('Ticket Type', data.ticketType)}
      ${row('Quantity', String(data.quantity))}
      ${divider}
      ${row('Total Paid', total)}
      ${row('Order ID', data.orderId)}
    </table>

    <div style="text-align:center;margin-top:8px">
      ${data.passUrl
        ? btn(data.passUrl, 'Add to Apple Wallet')
        : btn(reclaim, 'View Your Tickets')
      }
    </div>

    ${divider}
    <p style="color:#999;font-size:12px;text-align:center;margin:0">
      Lost your pass? Visit <a href="${reclaim}" style="color:${GREEN}">${reclaim}</a>
    </p>
    <p style="color:#999;font-size:12px;text-align:center;margin:8px 0 0">
      Download the <a href="https://apps.apple.com/app/wugi/id829564750" style="color:${GREEN}">Wugi app</a> to manage your tickets
    </p>
  `)

  await resend.emails.send({
    from:    FROM,
    to:      data.to,
    subject: `Your tickets for ${data.eventTitle} 🎟️`,
    html,
  })
  functions.logger.info('Purchase confirmation sent to:', data.to)
}

// ── Transfer notification (to recipient) ─────────────────────────────
export interface TransferEmailData {
  to:         string
  fromEmail:  string
  eventTitle: string
  venueName:  string
  eventDate:  string
  ticketType: string
  claimUrl:   string
  expiresIn:  string  // e.g. "48 hours"
}

export async function sendTransferNotification(data: TransferEmailData): Promise<void> {
  const resend = getResend()

  const html = wrap(`
    <h2 style="color:#111;font-size:22px;font-weight:800;margin:0 0 4px">You've got a ticket! 🎟️</h2>
    <p style="color:#666;margin:0 0 24px">${data.fromEmail} sent you a ticket to ${data.eventTitle}.</p>

    <div style="background:#f5f3ef;border-radius:${RADIUS};padding:20px;margin-bottom:24px">
      <p style="color:#111;font-size:18px;font-weight:800;margin:0 0 4px">${data.eventTitle}</p>
      <p style="color:#666;font-size:14px;margin:0">${data.venueName} · ${data.eventDate}</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Ticket Type', data.ticketType)}
      ${row('Sent By', data.fromEmail)}
      ${row('Expires In', data.expiresIn)}
    </table>

    <div style="text-align:center">
      ${btn(data.claimUrl, 'Claim Your Ticket')}
    </div>

    ${divider}
    <p style="color:#999;font-size:12px;text-align:center;margin:0">
      This link expires in ${data.expiresIn}. Once claimed, the original holder loses access.
    </p>
    <p style="color:#999;font-size:12px;text-align:center;margin:8px 0 0">
      Download the <a href="https://apps.apple.com/app/wugi/id829564750" style="color:${GREEN}">Wugi app</a> after claiming for the best experience.
    </p>
  `)

  await resend.emails.send({
    from:    FROM,
    to:      data.to,
    subject: `${data.fromEmail} sent you a ticket to ${data.eventTitle}`,
    html,
  })
  functions.logger.info('Transfer notification sent to:', data.to)
}

// ── Reclaim link (lost ticket) ────────────────────────────────────────
export interface ReclaimEmailData {
  to:         string
  buyerName:  string
  eventTitle: string
  venueName:  string
  orderId:    string
  passUrl?:   string | null
}

export async function sendReclaimEmail(data: ReclaimEmailData): Promise<void> {
  const resend  = getResend()
  const reclaim = `https://wugi.us/tickets/${data.orderId}`

  const html = wrap(`
    <h2 style="color:#111;font-size:22px;font-weight:800;margin:0 0 4px">Your ticket link 🎟️</h2>
    <p style="color:#666;margin:0 0 24px">Here's the link to re-access your ticket for ${data.eventTitle}.</p>

    <div style="background:#f5f3ef;border-radius:${RADIUS};padding:20px;margin-bottom:24px">
      <p style="color:#111;font-size:18px;font-weight:800;margin:0 0 4px">${data.eventTitle}</p>
      <p style="color:#666;font-size:14px;margin:0">${data.venueName}</p>
    </div>

    <div style="text-align:center">
      ${data.passUrl
        ? btn(data.passUrl, 'Add to Apple Wallet')
        : btn(reclaim, 'View Your Tickets')
      }
    </div>

    ${divider}
    <p style="color:#999;font-size:12px;text-align:center;margin:0">
      Order ID: ${data.orderId}
    </p>
  `)

  await resend.emails.send({
    from:    FROM,
    to:      data.to,
    subject: `Your ticket link for ${data.eventTitle}`,
    html,
  })
  functions.logger.info('Reclaim email sent to:', data.to)
}
