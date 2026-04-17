// ─────────────────────────────────────────────────────────────────────
// Wugi — smsService.ts
// Sends transactional SMS via Twilio
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
// ─────────────────────────────────────────────────────────────────────
import * as logger from 'firebase-functions/logger';
import twilio from 'twilio';

function getTwilio() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) throw new Error('Twilio secrets not configured');
  return { client: twilio(sid, token), from };
}

// Normalize to E.164 — accepts (404) 555-0123, 404-555-0123, +14045550123 etc.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10)  return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11)    return `+${digits}`;
  return null;
}

async function sendSMS(to: string, body: string): Promise<void> {
  const normalized = normalizePhone(to);
  if (!normalized) { logger.warn('smsService: invalid phone number', { to }); return; }
  try {
    const { client, from } = getTwilio();
    await client.messages.create({ from, to: normalized, body });
    logger.info('SMS sent', { to: normalized });
  } catch (e: any) {
    // Non-blocking — SMS failure should never break a transaction
    logger.error('smsService: failed to send SMS', { to: normalized, error: e?.message });
  }
}


// ── Trigger 1: Door sale receipt ──────────────────────────────────────
// Called after walk-up ticket created at door — phone entered by staff
export interface DoorSaleSMSData {
  phone:      string;
  holderName: string;
  eventTitle: string;
  venueName:  string;
  ticketType: string;
  amountCents: number;
}
export async function sendDoorSaleReceiptSMS(data: DoorSaleSMSData): Promise<void> {
  const amount = `$${(data.amountCents / 100).toFixed(2)}`;
  await sendSMS(
    data.phone,
    `Wugi ✅ Payment confirmed!\n${data.ticketType} × 1 — ${amount}\n${data.eventTitle} @ ${data.venueName}\nEnjoy your night! 🎉`
  );
}

// ── Trigger 2: Balance paid ───────────────────────────────────────────
// Called when an existing ticket holder pays their remaining balance
export interface BalancePaidSMSData {
  phone:       string;
  holderName:  string;
  eventTitle:  string;
  amountCents: number;
}
export async function sendBalancePaidSMS(data: BalancePaidSMSData): Promise<void> {
  const amount = `$${(data.amountCents / 100).toFixed(2)}`;
  await sendSMS(
    data.phone,
    `Wugi 💳 Balance paid!\nYour balance of ${amount} has been paid for ${data.eventTitle}. You're all set!`
  );
}


// ── Trigger 3: Purchase confirmation ─────────────────────────────────
// Called after successful online ticket purchase
export interface PurchaseConfirmationSMSData {
  phone:       string;
  holderName:  string;
  eventTitle:  string;
  venueName:   string;
  ticketType:  string;
  quantity:    number;
  totalCents:  number;
}
export async function sendPurchaseConfirmationSMS(data: PurchaseConfirmationSMSData): Promise<void> {
  const total = `$${(data.totalCents / 100).toFixed(2)}`;
  const qty   = data.quantity > 1 ? ` × ${data.quantity}` : '';
  await sendSMS(
    data.phone,
    `Wugi 🎟️ You're going!\n${data.ticketType}${qty} — ${total}\n${data.eventTitle} @ ${data.venueName}\nSee you there! 🎉`
  );
}

// ── Trigger 4: Check-in confirmation ─────────────────────────────────
// Called when staff taps "Check In Now" in Wugi Door
export interface CheckInSMSData {
  phone:      string;
  holderName: string;
  eventTitle: string;
  venueName:  string;
}
export async function sendCheckInSMS(data: CheckInSMSData): Promise<void> {
  await sendSMS(
    data.phone,
    `Wugi 🎟️ You're checked in!\nWelcome to ${data.eventTitle} at ${data.venueName}. Have an amazing time!`
  );
}

// ── Trigger 4: Ticket scan confirmation ──────────────────────────────
// Called when ScannerScreen scans a QR code successfully
export interface TicketScannedSMSData {
  phone:      string;
  holderName: string;
  eventTitle: string;
  venueName:  string;
}
export async function sendTicketScannedSMS(data: TicketScannedSMSData): Promise<void> {
  await sendSMS(
    data.phone,
    `Wugi ✅ Ticket scanned!\n${data.eventTitle} @ ${data.venueName}. You're in — enjoy the night! 🙌`
  );
}
