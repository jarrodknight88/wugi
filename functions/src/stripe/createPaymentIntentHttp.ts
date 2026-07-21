// ─────────────────────────────────────────────────────────────────────
// Wugi — createPaymentIntentHttp
// HTTP version of createPaymentIntent for direct fetch from mobile app.
// The onCall version requires the Firebase Functions SDK.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { stripe, calculateBookingFee } from '../stripe/stripeUtils';

const db = admin.firestore();

export const createPaymentIntentHttp = functions.https.onRequest(async (req, res) => {
  // Allow CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body?.data ?? req.body;
  const { eventId, ticketTypeId, quantity, userId, guestName, guestEmail, guestPhone,
          paymentMethodId, savePaymentMethod } = body;

  if (!eventId || !ticketTypeId || !quantity) {
    res.status(400).json({ error: { code: 'missing_fields', message: 'Missing required fields' } }); return;
  }
  if (!userId && (!guestEmail || !guestName)) {
    res.status(400).json({ error: { code: 'guest_info_required', message: 'Guest checkout requires name and email' } }); return;
  }

  try {
    const ticketTypeDoc = await db
      .collection('events').doc(eventId)
      .collection('ticketTypes').doc(ticketTypeId).get();

    if (!ticketTypeDoc.exists) { res.status(404).json({ error: { code: 'ticket_not_found', message: 'Ticket type not found' } }); return; }

    const ticketType = ticketTypeDoc.data()!;
    if (ticketType.status !== 'on_sale') { res.status(400).json({ error: { code: 'not_on_sale', message: 'Ticket not on sale' } }); return; }

    // Table tickets are ONE purchasable unit at a flat price that includes
    // tableCapacity passes. Decouple "units charged" (drives price + inventory)
    // from "passes issued" — both sourced from the ticket-type doc, never
    // hardcoded. Authoritative server-side: ignore any inflated client quantity
    // for tables (old clients send quantity == tableCapacity).
    const tableCapacity = Number(ticketType.tableCapacity) || 0;
    const isTable       = tableCapacity > 1;
    const purchaseUnits = isTable ? 1 : Number(quantity);   // flat price charged once for a table
    const passCount     = isTable ? tableCapacity : Number(quantity); // passes to issue

    if (ticketType.remaining < purchaseUnits) { res.status(400).json({ error: { code: 'sold_out', message: 'Not enough tickets' } }); return; }

    const [eventDoc, venueDoc] = await Promise.all([
      db.collection('events').doc(eventId).get(),
      ticketType.venueId ? db.collection('venues').doc(ticketType.venueId).get() : null,
    ]);
    const event = eventDoc.data();
    const venue = venueDoc?.data();

    const subtotal   = ticketType.price * purchaseUnits;   // flat price × units (1 for a table)
    const bookingFee = calculateBookingFee(subtotal);       // fee on the flat price, once
    const total      = subtotal + bookingFee;

    // ── Free ticket bypass — skip Stripe, create pass directly ──────────
    if (total === 0 || ticketType.isFree) {
      logger.info('Free ticket — skipping Stripe, creating pass directly', { eventId, ticketTypeId });

      const { generateTicketNumber } = await import('../stripe/stripeUtils');

      // Free/RSVP tickets are one-per-user. Query first for a fast, friendly
      // rejection of repeat claims; the deterministic passRef id below is the
      // real (atomic) guard against a race between two concurrent requests.
      if (userId) {
        const existing = await db.collection('passes')
          .where('userId', '==', userId)
          .where('eventId', '==', eventId)
          .where('ticketTypeId', '==', ticketTypeId)
          .limit(1)
          .get();
        if (!existing.empty) {
          res.status(409).json({ error: { code: 'already_claimed', message: 'You already have this ticket' } });
          return;
        }
      }

      // Free/RSVP tickets are one-per-user. Deterministic ID + create() (which
      // fails atomically if the doc exists) closes the race a plain "check
      // then write" would leave open for double-tap or concurrent requests.
      const passRef = userId
        ? db.collection('passes').doc(`free_${eventId}_${ticketTypeId}_${userId}`)
        : db.collection('passes').doc();
      const orderId = `free_${passRef.id}`;

      try {
        await passRef.create({
          id:              passRef.id,
          orderId,
          userId:          userId || null,
          eventId,
          venueId:         ticketType.venueId ?? '',
          ticketTypeId,
          ticketTypeName:  ticketType.name,
          holderName:      userId ? '' : (guestName ?? ''),
          holderEmail:     userId ? '' : (guestEmail ?? ''),
          // Denormalize event + venue so PassViewerScreen can render without extra lookups
          eventTitle:      event?.title || '',
          venueName:       venue?.name || '',
          eventDate:       event?.date || '',
          eventTime:       event?.time || '',
          ticketNumber:    generateTicketNumber(),
          isTransferred:   false,
          transferPending: false,
          scanStatus:      'valid',
          source:          'free',
          isFree:          true,
          scannedAt:       null,
          scannedBy:       null,
          appleWalletPassUrl: null,
          appleWalletAdded:   false,
          createdAt:       admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (createErr: any) {
        if (createErr?.code === 6) { // ALREADY_EXISTS — user already has this pass
          res.status(409).json({ error: { code: 'already_claimed', message: 'You already have this ticket' } });
          return;
        }
        throw createErr;
      }

      // ── Generate Apple Wallet pass for free ticket ─────────────────
      let freePassUrl: string | null = null;
      try {
        const { buildPassBuffer, storePass } = await import('../passes/generatePass');
        const crypto = await import('crypto');
        const authToken = crypto.randomBytes(20).toString('hex');
        const eventDoc = await db.collection('events').doc(eventId).get();
        const venueDoc2 = ticketType.venueId
          ? await db.collection('venues').doc(ticketType.venueId).get()
          : null;
        const passBuffer = await buildPassBuffer({
          orderId,
          passId:              passRef.id,
          eventTitle:          eventDoc.data()?.title || '',
          venueName:           venueDoc2?.data()?.name || '',
          eventDate:           eventDoc.data()?.date || '',
          eventTime:           eventDoc.data()?.time || '',
          ticketType:          ticketType.name,
          quantity:            quantity,
          buyerName:           userId ? '' : (guestName ?? ''),
          buyerEmail:          userId ? '' : (guestEmail ?? ''),
          totalPaid:           0,
          webServiceURL:       'https://us-central1-wugi-prod.cloudfunctions.net/passWebService',
          authenticationToken: authToken,
        });
        freePassUrl = await storePass(orderId, passBuffer);
        await db.collection('walletPasses').doc(orderId).set({
          orderId, passId: passRef.id, authenticationToken: authToken,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        await passRef.update({ appleWalletPassUrl: freePassUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        logger.info('Free pass Apple Wallet generated:', freePassUrl);
      } catch (passErr) {
        logger.error('Free pass Apple Wallet generation failed:', passErr);
      }

      // Decrement remaining count — guard against going below 0
      const currentDoc = await db.collection('events').doc(eventId)
        .collection('ticketTypes').doc(ticketTypeId).get();
      const currentRemaining = currentDoc.data()?.remaining ?? 0;
      if (currentRemaining <= 0) {
        res.status(400).json({ error: { code: 'sold_out', message: 'No tickets remaining' } });
        return;
      }
      await db.collection('events').doc(eventId)
        .collection('ticketTypes').doc(ticketTypeId)
        .update({
          sold:      admin.firestore.FieldValue.increment(purchaseUnits),
          remaining: admin.firestore.FieldValue.increment(-purchaseUnits),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      res.json({
        result: {
          clientSecret:        null,
          publishableKey:      null,
          customerId:          null,
          customerEphemeralKey: null,
          subtotal: 0,
          bookingFee: 0,
          total: 0,
          isGuest: !userId,
          isFree: true,
          orderId,
          passUrl: freePassUrl,
        },
      });
      return;
    }

    // Get or create Stripe customer for authenticated users
    let stripeCustomerId: string | undefined;
    let ephemeralKey: string | undefined;
    if (userId) {
      const userDoc = await db.collection('users').doc(userId).get();
      stripeCustomerId = userDoc.data()?.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({ metadata: { firebaseUID: userId } });
        stripeCustomerId = customer.id;
        await db.collection('users').doc(userId).update({ stripeCustomerId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
      const ek = await stripe.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion: '2023-10-16' }
      );
      ephemeralKey = ek.secret;
    }

    // ── setupOnly removed — PI always created here now ────────────────

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   total,
      currency: 'usd',
      // Card-only, no redirect-based methods. Removes the return-scheme
      // dependency at confirmation and matches the client's
      // intentConfiguration.paymentMethodTypes: ['card'], so the SDK can
      // complete the sheet in-app without the wugi:// redirect.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      // If paymentMethodId provided (intentConfiguration flow), attach it directly
      payment_method: paymentMethodId || undefined,
      confirm:        paymentMethodId ? true : undefined,
      // Stripe requires return_url when confirming server-side (live mode strictly
      // enforces it for cards that may need 3DS/redirect). Must match the client
      // initPaymentSheet returnURL so the SDK can route back into the app.
      // See mobile-app/src/features/ticketing/PaymentScreen.tsx.
      return_url:     paymentMethodId ? 'wugi://payment-complete' : undefined,
      setup_future_usage: (userId && (savePaymentMethod || !paymentMethodId)) ? 'on_session' as const : undefined,
      customer: stripeCustomerId,
      metadata: {
        eventId, ticketTypeId, quantity: String(purchaseUnits),
        ticketTypeName:  ticketType.name,
        venueId:         ticketType.venueId ?? '',
        subtotal:        String(subtotal),
        bookingFee:      String(bookingFee),
        taxIncluded:     String(ticketType.taxIncluded),
        userId:          userId ?? 'guest',
        guestName:       guestName ?? '',
        guestEmail:      guestEmail ?? '',
        guestPhone:      guestPhone ?? '',
        buyerName:       userId ? '' : (guestName ?? ''),
        buyerEmail:      userId ? '' : (guestEmail ?? ''),
        buyerPhone:      guestPhone ?? '',
        eventName:       event?.name ?? event?.title ?? '',
        venueName:       venue?.name ?? '',
        eventDate:       event?.date ?? '',
        eventTime:       event?.time ?? '',
        items: JSON.stringify([{
          ticketTypeId, ticketTypeName: ticketType.name,
          quantity: purchaseUnits,          // units charged (1 for a table)
          passCount,                         // passes to issue (tableCapacity for a table)
          unitPrice: ticketType.price,
          subtotal, taxIncluded: ticketType.taxIncluded,
        }]),
      },
    });

    logger.info('PaymentIntent created', { id: paymentIntent.id, amount: total });

    res.json({
      result: {
        clientSecret:        paymentIntent.client_secret,
        publishableKey:      process.env.STRIPE_PUBLISHABLE_KEY,
        customerId:          stripeCustomerId ?? null,
        customerEphemeralKey: ephemeralKey ?? null,
        subtotal, bookingFee, total,
        isGuest: !userId,
      },
    });
  } catch (e: any) {
    logger.error('createPaymentIntentHttp error', e);
    res.status(500).json({ error: { code: 'internal_error', message: e.message ?? 'Internal error' } });
  }
});
