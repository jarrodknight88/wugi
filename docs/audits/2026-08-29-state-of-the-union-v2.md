# STATE OF THE UNION v2 — Board vs Codebase Reconciliation
Executed 2026-08-31 by PM session (Action env structurally blocked — see issue #251).
Evidence: 93 merge commits on wugi main since 7/15 (last: PR #248, 8/22); wugi-ops repo (founded 8/21, last merge 8/27); Asana state pulled 8/31 ~12:30p ET.

## Summary counts (open tasks classified)
| Bucket | Infra | Consumer | Door | Lens | Total |
|---|---|---|---|---|---|
| SHIPPED (close) | 44 | 5 | 4 | 2 | 55 |
| PARTIAL | 6 | 3 | 2 | 3 | 14 |
| STALE_META (close) | 12 | 8 | 1 | 3 | 24 |
| OPEN_CODE | 18 | 14 | 5 | 6 | 43 |
| OPEN_HUMAN | 22 | 17 | 5 | 6 | 50 |

Headline: the board shows ~186 open tasks; ~79 of them (SHIPPED + STALE_META) are already done or dead. True open work ≈ 107, of which ~50 are human-only.

## SHIPPED — close-list (GID → evidence)
### Infra (1214022910398008)
1217149704119966→PR#239 · 1217139347717819→PR#241 · 1217149700356712→PR#237 · 1217149654103794→PR#233 · 1217136086850090→PR#231 · 1216913378606383→7/27 capacity-gauge · 1216913738097103→7/27 checkInPass-route · 1216913737425627→7/27 Door-auth · 1216911677959106→7/27 status-ladder · 1216911482649079→7/27 device-coords · 1216911595531217→7/27 limit(5)-throttle · 1216911520099851→7/27 capture-raw · 1216887862171950→7/26 tsc-docs · 1216887844196238→7/26 COLORS.go · 1216887844185212→7/27 geofence · 1216886438472859→7/26 Door-screens · 1216886410414684→7/26 checkInPass · 1216886428359264→7/26 reader-msg · 1216886437807907→7/26 palette · 1216883671096907→PR#82 · 1216880303549570→PR#76 · 1216879795462883→PR#75 · 1216880030386006→7/27 Door-auth · 1217044040651453→PR#138 · 1217044383110955→PR#143 · 1217044582798935→PR#144 · 1217074062993847→PR#146 · 1217077717899030→PR#149 · 1217077743832876→PR#150 · 1217079609593542→PR#154 · 1217079692128457→PR#157 · 1217082794068905→PR#160 · 1217086974915634→PR#164 · 1217086974915570→PR#165 · 1217088874004742→PR#169 · 1217088873934872→PR#168 · 1217089109664088→PR#172 · 1217089370538401→PR#173 · 1217089414111771→PR#177 · 1217089612783094→PR#178 · 1217091510019986→PR#180 · 1217092359085277→PR#182 · 1217094635099425→PR#185 · 1217094673728031→PR#186 · 1217095331502468→PR#189 · 1217095402156657→PR#190 · 1217040520601811→PR#125 · 1217041499637238→PR#128 · 1217041499539308→PR#130 · 1217041751504561→PR#234 · 1217042557698356→PR#132 · 1217043783710943→PR#135 · 1217043355507926→PR#136 · 1217044512827423→PR#140 · 1217077743734204→PR#161 · 1217077915156994→PR#152 · 1217178461978658→PR#245 · 1217740304686868→PR#248 · 1215871672035815→PR#123/138 · 1216690305029672→Bridge-v1.1-retry · 1217972700469442→Approval-Executor-live-on-Air · 1217039960427028→pipeline-umbrella(children all shipped)

### Consumer (1214020524863095)
1217178359150064→PR#244 · 1216924587972264→PR#123 · 1216923537384316→7/27 Crashlytics · 1216729526587350→PR#68 · 1214105210631943→PR#72

### Door (1214028753379330)
1216689538731210→refund role-gating (S2-05 shipped + refund-function wave) · 1214020524869133→7/27 ticketColorSync + URG-22 · 1214022924107857→balanceDue/partial-payment P0 fix wave · 1216688915332718→Wallet-QR fix (shipped-through-pipeline list; verify on device)

### Lens (1214022910325851)
1216881685748865→Lens Phase 1 merge (pending pool + claim) · 1216689526214260→Lens Phase 1 merge (umbrella; deploy caveat below)

## STALE_META — close-list (reason)
Infra: 1214019620194249 (dup of S3-07) · 1214489599956460 (dup of 1214489574556285) · 1214461702570493 (Claude Code migration done in practice) · 1214461895049943 (bundle ID resolved: com.wugi.wugi prod) · 1216717747508755 (superseded by Bridge v1.1, completed) · 1216729407610745 (field-test gate removed 7/22) · 1216773194924957 (Air is live) · 1216810401620892 (baseline marker, dates superseded) · 1216773193582719 (iMessage channel superseded by Telegram; v1.4 became multi-repo #248) · 1216880019941859 (dup of 1216887862171950, shipped) · 1214026535630896 (Sentry superseded by Crashlytics) · 1217039858439896 + 1217099670953189 (superseded trackers) · DATA-01 family 1214488383284256/1214487908816579/1214487909258941/1214488382726701/1214488383380620/1214487908760842 (superseded by Apify/venueIntel pipeline: 136+ venues, 3,780+ posts, 372+ events)
Consumer: 1217206086935435 (THROWAWAY by name) · 1214022932539398 (name says SUPERSEDED) · 1214020524871016 (S3-26 targets wugitest bundle; superseded by com.wugi.wugi) · 1214107608252384 (demo weekend past) · 1216809649505333 + 1216809649390379 + 1216811606091510 (UAT-1 instruments; UAT done) · 1215736375538702 (TurboModule crash; builds #86–93 shipped since — verify then close)
Door: 1214020524873820 (dup of infra 1215264661653267)
Lens: 1214019620048050 + 1214028753451862 (June-9 scope relics) · 1214020525729803 (GL.iNet superseded by Pi 5 + LTE build)

## PARTIAL (what's in / what's not)
- 1216918565123363 repair orphaned venueIds — script merged 7/27 (dry-run default); prod execution unverified
- 1216889041040300 + 1216844677604441 /passes rules — code merged (#70/#77 wave); RULES DEPLOY still pending (denylist, Jarrod eyes)
- 1216689793903354 AUDIT-C Door — doc merged PR#58; QA half open
- 1215264661331318 Door v3 design — palette+screens shipped; full refinement open
- 1214108494068708 BACK-30 FCM removal — OneSignal swap done (S1-05); FCM remnant sweep unverified
- 1216810401431705 decision batch — bundle ID resolved; Google sign-in, slides, S1-01/02, card mgmt, email gate still open
- 1215699282736517 paid-image protection — screen-guard shipped; model doc open
- 1217099725506291 + 1217099549359765 UAT-A batch — night-daemon wave (#195–#227) likely covered; unverifiable by title, needs spot-check
- 1214019619972991 S3-11 TestFlight — v5.0.0 b93 in TestFlight; prod submission gates remain
- 1216881653889242 Lens ingest — code merged; FIRST STORAGE-RULES DEPLOY still ungated
- 1215469885076574 Lens publishing gate — review flow shipped; verify moderation actually gates gallery creation
- 1216729318653921 Studio rename — name in use; Pro scope undecided
- 1214094510005615 DOOR-07 — likely fixed by Wallet-QR fix; retest at door
- 1217095424670115 MediaManager consolidation — may be partially covered by #189

## OVERDRIVE QUEUE — OPEN_CODE by launch impact (zero-overlap groups)
### Wave 1 (day cap 4 — launch-relevant)
1. 1216729383901466 StoreKit IAP 2 SKUs (mobile-app/ payments) — GATES App Store approval if photo unlocks ship as digital goods; else gate off with ticketingEnabled-style flag
2. 1216729138352898 Lens web bulk upload (web/) — photographer supply critical path
3. 1214100370490874 S1-18 msg trigger audit (functions/ messaging) — dead SMS triggers + balance-paid email
4. 1214019642499243 S2-09 skeletons (mobile-app/ screens) — launch feel; Home/ForYou spinners
### Wave 2 (overnight cap 8 — hardening)
1214022932553948 S3-08 functions security audit · 1214020547116555 S3-06 secrets sweep · 1215699328141197 tolerant-reader audit · 1215699115748147 mobile error boundaries · 1216688698245148 AUDIT-D wallet/notification follow-ups · 1216688924474778 AUDIT-D dead-code · 1217044515393376 photographer-site crawler (atlpics/nightlifelink) · 1215695526238403 cross-page series dedup
### Parked (post-launch lot, 9/15)
FlashList migration · Node 22 upgrade (due 9/8 — schedule week after launch, HARD Oct 30) · drift detection · digest fns · App Clip · Android queue (×7) · blurhash · retention analytics · perf audit · SweetDeals · tier architecture · Door S2-01/02/03/04 · Lens tier engine/onboarding/Phase 2-4 · admin surface audit · chargeback visibility · MediaManager/component-vocabulary residuals

## OPEN_HUMAN — grouped by action owner (Jarrod unless noted)
### T-0 LAUNCH GATES (today/tomorrow)
- App Store prod submission Phase 1: Firebase iOS app in wugi-prod + GoogleService-Info.plist + REVERSED_CLIENT_ID + SIWA/Push/Assoc-Domains on App ID + OneSignal bundle swap (1215871599442662)
- App Store assets bundle (1215871472307215)
- S2-23 prod data audit — strip test/seed data (1214026557693350) + demo-data reviewer passes (1215871450992042)
- UAT-2 RC smoke 48hr (1216810402024967) — COMPRESSED; call it or waive it explicitly
- /passes + catch-all rules deploy w/ console diff (1215108652658606, gates 1216889041040300/1216844677604441) + Lens PR#43 storage-rules first deploy (1216729922825644)
- Decision batch residue: Google sign-in · 3-vs-4 slides · S1-02 username · S1-1c email gate · S1-07 card mgmt (1216810401431705 et al)
- Device tests: Face ID ×3 (1214022910325836/1214113596541610/1214019642499236), payment flow (1214107545188812), signup QA (1214026596041446/1214028828131302)
- Firebase console: email templates check (1214055147557123) · composite index verify (1216689538758352)
### APPLE (this week)
- Door Xcode archive + TestFlight (1214115845088692/1214020524816327) · TTP entitlement package, Case-ID 19309580 (1215264661653267) · TTP toolkit assets (1215264929816805) · demo iPhone registration (1215264929984234) · TestFlight external group (1216808972147688) · Rich to TestFlight (1214026535528293) · Lens/Studio submission TBD (1214022910356617)
### LEGAL/FINANCE
- GA money transmitter attorney (1214028754417938) · GA DOR sales tax (1214100366973385)
### COMMS/PARTNERS
- A2P resubmission (1216773193601711 — blocks Twilio SMS + S1-4 UAT 1214093961621373) · Amat happy-hours seed (1215871599389341) · Prince Williams agreement (1214022910359958) · Amat/JV UAT confirms
### DATA (PM-executed, Jarrod word)
- Flagged-venue upsert 22 venues (1216878669523448) · Teranga dup (1214485850667105) · 3 orphan venues (1214487000837111) · eventSeries docs (1215695340212520) · Opium coords (1216879795440927) · orphaned-venueIds prod run (1216918565123363)
### HARDWARE (Lens — post-launch OK)
- 6D Mark II receive/verify (1216689775759939) · MF833V sourcing (1216809648747981/1216729526587747) · fleet build 15 (1216729526490061) · fleet order status (1216808971794177)
### DECISIONS (non-blocking, park w/ dates)
- Series expiry policy · FIFA marquee · marketplace monetization (BACK-03) · Studio Pro scope · S1-20 notification scope · SA-OAuth verify-close (1215264689406643) · Tabū recheck · PR#36/branch hygiene (1216689310515572)

## Notes
- Nothing has merged to wugi main since 8/22 (#248) — post-UAT hardening happened in wugi-ops instead (PRs #2–#20, through 8/27)
- Night-daemon PRs #195–#227 (8/2–8/3) merged under gate names only; UAT-A coverage inferred, not proven
- Issue #251 (this audit's dispatch) parked in sweep-state; close on GitHub when convenient

---

## CORRECTION — 2026-08-31 (PM session, executed verification)

The claim above that three security fixes were "merged but never deployed" is **WRONG**. Verified 8/31 by pulling the live rulesets from the Firebase Rules API and diffing against repo main:

- Deployed firestore ruleset `c2d28f3d` (released 2026-08-03T23:54Z) is identical to `firebase/firestore.rules` on main except one mojibake character in a comment. It **contains** the /passes scoping fixes (39e8e8b, 3276fe2) and the catch-all deny-by-default (line 426, `write: if false`).
- Deployed storage ruleset `50eb0c95` (released 2026-08-01T12:54Z) is **byte-identical** to `firebase/storage.rules` on main and contains the full Lens PR #43 blocks (lens-ingest device-claim writes, lens-quarantine lockdown, lens-renditions read-only).
- Consequence: the "first-ever storage-rules deploy" human gate was already satisfied on 8/1. **No rules deploys are outstanding as of 8/31.**

Method: `firebaserules.googleapis.com` releases + rulesets fetched with service-account token, diffed on the Air. Lesson repeated: inferred deploy-state is not deploy-state; always diff the live ruleset.
