# Wugi Venue Intel — Standard Operating Procedure
*v1.0 — Aug 1, 2026. Owner: Jarrod. Living doc: update when the pipeline changes.*
*Everything below reflects what is deployed as of dashboard build `82eab71`.*

---

## The pipeline at a glance

```
Instagram (19 accounts)
   │  Apify scrape (Mon 6:00a ET auto; one-offs on request)
   ▼
Venue Intel — PENDING REVIEW          ← you approve/reject posts here
   │  your Approve triggers the classifier
   ├── looks like an upcoming event  → DRAFT EVENTS
   ├── recap/vibe content            → venue night observations (Media tab)
   └── can't identify the venue      → NEEDS ATTENTION
                                        │  you assign a venue + Retry
                                        └── re-classifies → drafts or observations
DRAFT EVENTS → you edit/publish → live in the app (permanent media URLs)
```

**Golden rule: nothing reaches the app without a human click.** The scrape only fills the review queue. Your Approve moves a post into the machine; your Publish puts it in front of users.

---

## 1. The scrape

- **Automatic:** every Monday 6:00a ET (Apify schedule `wugi-monday-6am-et`). 19 accounts, 15 most recent posts each, deduped against everything already seen.
- **Videos:** captured automatically since 8/1 (up to ~60MB, poster image extracted). Failures degrade to image-only — a video problem never loses the post.
- **One-off runs:** ask the PM ("run a scrape"). Useful before a big weekend or when a venue announces something.
- **Nothing to do here.** New posts appear in *Venue Intel → review queue* within a few minutes of the run.

## 2. Reviewing posts (pending review)

For each post, one question: **is this something Wugi should know about?**

- **Approve** — event flyers, party announcements, recap videos worth showing, anything real. Approving does NOT publish anything; it just lets the classifier sort it.
- **Reject** — spam, memes, personal posts, duplicates of a flyer already approved.

When in doubt, approve — the classifier and the draft review are two more filters behind you.

## 3. Where approved posts go (and why yours "disappeared")

| The post is... | It becomes... | You'll find it in... |
|---|---|---|
| A flyer for an upcoming date | a draft event | Draft Events |
| A recap of a past night (most videos) | a night observation | that venue's **Media tab** |
| Unidentifiable venue | stuck | **Needs Attention** |

Recap videos routing to the venue instead of Draft Events is **correct behavior** — there's no future event to draft from a recap.

## 4. Needs Attention — draining the queue

Each row shows the post, the **reason** it's stuck, and (since 8/1) a **venue search box**.

1. Look at the post — which venue is this?
2. **Venue exists** → search it in the picker, select. The post retries itself and routes onward. Done.
3. **Venue doesn't exist in Wugi yet** → see §5.
4. **Genuinely can't tell / not a venue** → reject the post.

Your venue picks are remembered as `manual` matches and beat the automatic matcher — fixing a post once fixes it for good.

## 5. Creating a new venue (current process — automation coming)

Until the "Create venue" button ships, new venues are created by the PM via the import pipeline:

1. Note the venue name + IG handle from the stuck post.
2. Tell the PM: *"Create venue: {name}, IG {handle}"* (chat or Asana).
3. PM runs the Google-verified import (`importPlaces` — pulls address, coordinates, photos, hours from Google Places), venue lands as **pending_review** in the quality ladder.
4. Go back to Needs Attention, assign the new venue, Retry.

Known wanted: **Tabu**, **LO KEE**. Add to this list as you hit them.

## 6. Draft Events — review and publish

Open a draft. Before publishing, check in this order:

1. **Venue** — wrong venue? Change it with the picker (unpublished drafts only; published events are locked to their live doc).
2. **Title** — generated titles auto-follow the rules: no venue name in the title ("Seductive Saturday", not "Seductive Saturday at Bamboo"); format-first ("Dinner Party: Old Kanye"). Edit freely — your edits are logged and will train the generator.
3. **Date/time** — verify against the flyer. The parser is good, not perfect.
4. **Media** — pick and order (first = hero). Videos show a ▶ badge; click to preview. The venue asset browser also offers that venue's other scraped media.
5. **✨ AI Generate** — fills title/about from the caption if the draft came in thin.
6. **Rights** — unverified-rights media blocks publish until you confirm. That's deliberate.

**Series** (weekly parties): when a draft is one edition of a recurring format — e.g. *Old Kanye* is one week of *Dinner Party* — publish it **as a series**: name the series ("Dinner Party"), set the cadence, and this draft becomes the **special edition** on its date. Generic weeks are auto-generated around it; the next themed flyer gets **attached** to the existing series and replaces its week's generic occurrence. One-offs with no recurring format publish standalone.

7. **Publish.** Media is copied to permanent storage automatically — links never expire. (Fixed 8/1; anything published before then was healed by backfill.)

## 7. Venue Media tab

*Venues → {venue} → Media*: everything scraped for that venue (recap videos live here), with rights badges. Select/order media for the venue page; hero first. *Info tab → ✨ Generate* drafts a venue description.

## 8. When something looks wrong

| Symptom | Likely cause | Do |
|---|---|---|
| Media tab errors right after a deploy | Firestore index still building | Wait 5 min, retry |
| Assigned a venue, still stuck after Retry | Post may have re-routed to observations — check the venue's Media tab | If truly stuck, flag PM |
| Draft has wrong date/year | Parser inference from caption | Fix by hand pre-publish |
| Published event missing image | Should be impossible since 8/1 | Flag PM immediately — regression |
| Nothing new after Monday 6a | Scrape or webhook failure | Flag PM: check Apify run + function logs |

## 9. What's automated vs. what's yours

**Automated:** scraping, media capture (incl. video), classification, venue matching, title cleanup, permanent media URLs, series generic-week generation.
**Yours (by design):** approve/reject posts, venue assignment for unknowns, draft review, publish, series decisions, new-venue calls.

The system proposes; you decide. Every one of your corrections (venue picks, title edits) is captured and makes it smarter.

---

*Feedback → PM. This doc lives at `docs/VENUE-INTEL-SOP.md` in the repo.*
