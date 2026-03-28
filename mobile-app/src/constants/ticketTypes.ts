// ─────────────────────────────────────────────────────────────────────
// Wugi — Ticket Type Configuration
// ─────────────────────────────────────────────────────────────────────
import type { TicketTypeKey } from '../types';

export const TICKET_TYPES: Record<TicketTypeKey, {
  label: string;
  color: string;
  glow: string;
  textColor: string;
  abbrev: string;
}> = {
  general_admission: { label:'General Admission', color:'#00C853', glow:'rgba(0,200,83,0.25)',    textColor:'#fff', abbrev:'GA'    },
  vip:               { label:'VIP',               color:'#E91E8C', glow:'rgba(233,30,140,0.25)',  textColor:'#fff', abbrev:'VIP'   },
  vip_table:         { label:'VIP Table',         color:'#9C27B0', glow:'rgba(156,39,176,0.25)',  textColor:'#fff', abbrev:'TABLE' },
  backstage:         { label:'Backstage',         color:'#FF6F00', glow:'rgba(255,111,0,0.25)',   textColor:'#fff', abbrev:'BKSTG' },
  early_bird:        { label:'Early Bird',        color:'#2196F3', glow:'rgba(33,150,243,0.25)',  textColor:'#fff', abbrev:'EARLY' },
};

// ── Service fee calculation ───────────────────────────────────────────
// Buyer pays all fees. Venue keeps 100% of face value.
// Formula: 12% of ticket price, floor $1.99, cap $75.00
const SERVICE_FEE_PERCENT = 0.12;
const SERVICE_FEE_MIN     = 1.99;
const SERVICE_FEE_MAX     = 75.00;

export const calculateServiceFee = (ticketPrice: number): number => {
  const fee = ticketPrice * SERVICE_FEE_PERCENT;
  return Math.min(Math.max(fee, SERVICE_FEE_MIN), SERVICE_FEE_MAX);
};

export const calculateTotalPrice = (ticketPrice: number): number =>
  ticketPrice + calculateServiceFee(ticketPrice);

// Stripe processing fee estimate (for display purposes only — actual fee
// is calculated server-side via Cloud Function)
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED   = 0.30;

export const estimateStripeFee = (totalCharged: number): number =>
  totalCharged * STRIPE_PERCENT + STRIPE_FIXED;

export const estimateWugiNet = (ticketPrice: number): number => {
  const serviceFee  = calculateServiceFee(ticketPrice);
  const total       = ticketPrice + serviceFee;
  const stripeFee   = estimateStripeFee(total);
  return serviceFee - stripeFee;
};
