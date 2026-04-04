// ─────────────────────────────────────────────────────────────────────
// Wugi — onEventPublished
// Fires when an event is approved. Sends push to "atlanta-events" topic.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions'
import { sendToTopic } from './sendPushNotification'

export const onEventPublished = functions.firestore
  .document('events/{eventId}')
  .onWrite(async (change) => {
    const before = change.before.data()
    const after = change.after.data()

    // Only fire when status changes TO approved
    if (before?.status === 'approved' || after?.status !== 'approved') return

    const title = after.title ?? 'New Event on Wugi'
    const venue = after.venueName ?? after.venue ?? 'Atlanta'
    const date = after.date ?? 'Tonight'
    const body = `${venue} · ${date}`

    try {
      await sendToTopic('atlanta-events', title, body, {
        eventId: change.after.id,
        eventSlug: after.slug ?? '',
        screen: 'EventDetail',
      })
      functions.logger.info(`Sent notification for event: ${change.after.id}`)
    } catch (e) {
      functions.logger.error('onEventPublished notification error:', e)
    }
  })
