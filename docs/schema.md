# Wugi Firestore Database Schema

This document defines the Firestore collections and document structures for Wugi.

Wugi uses Firebase Firestore as its primary database.

## Core Collections

The following collections exist at the root level of Firestore:

- users
- venues
- venueClaims
- events
- promoters
- photographers
- albums
- stories
- checkins
- savedItems
- pushRequests
- subscriptions
- flags
- analyticsEvents
- cities

## users

Represents patrons using the Wugi app.

Document ID: userId

Fields:

- name
- username
- email
- phone
- profilePhoto
- createdAt
- interests
- homeCity
- savedVenuesCount
- savedEventsCount

## venues

Represents restaurants, lounges, and clubs.

Venues are imported from Google Places API.

Document ID: venueId

Fields:

- name
- address
- city
- state
- location (geo point)
- category
- googlePlaceId
- description
- photos
- reservationPlatform
- reservationURL
- reservationPhone
- claimed
- claimedBy
- createdAt

## events

Represents nightlife or restaurant events.

Document ID: eventId

Fields:

- title
- venueId
- promoterId
- startTime
- endTime
- flyerImage
- description
- tags
- ticketLink
- tier
- status
- createdAt

## albums

Photo albums uploaded by photographers for events.

Document ID: albumId

Fields:

- eventId
- venueId
- photographerId
- title
- photos
- createdAt

## stories

Temporary 24-hour content.

Document ID: storyId

Fields:

- userId
- venueId
- eventId
- mediaURL
- createdAt
- expiresAt

## checkins

Represents users checking in at venues.

Document ID: checkinId

Fields:

- userId
- venueId
- createdAt

## savedItems

Represents venues or events saved by users.

Document ID: saveId

Fields:

- userId
- itemType (venue | event)
- itemId
- createdAt

## pushRequests

Promotional push notification requests from venues or promoters.

Document ID: pushRequestId

Fields:

- requesterId
- message
- audience
- status
- price
- createdAt

## flags

User reports for inappropriate content.

Document ID: flagId

Fields:

- contentType
- contentId
- reason
- reportedBy
- createdAt
- status


## analyticsEvents

Tracks user interactions.

Document ID: eventId

Fields:

- type
- userId
- venueId
- eventId
- metadata
- createdAt