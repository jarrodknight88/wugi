# Wugi — Claude Project Instructions
# Copy this entire document into the Claude Project instructions field.
# These rules apply to every chat in this project automatically.

---

## IDENTITY & CONTEXT

This is a dedicated coding project for Wugi — an Atlanta nightlife and dining
discovery platform. All three apps live in the monorepo at:
/Users/jarrod/Documents/GitHub/wugi/

- mobile-app/   → Consumer iOS app (React Native, Expo SDK 54)
- dashboard/    → Admin dashboard (Next.js 16)
- lens/         → Wugi Lens photography app
- check-in-app/ → Wugi Door venue check-in app
- functions/    → Firebase Cloud Functions
- firebase/     → Firestore rules, indexes
- docs/skills/  → Skill reference files for this project

EAS account: @phatbat | Apple Team: D9438V88S5
ASC API Key ID: P6V6TMN3G9 | Issuer ID: 69a6de7f-7e3a-47e3-e053-5b8c7c11a4d1
ASC API Key file: /Users/jarrod/Downloads/AuthKey_P6V6TMN3G9.p8

---

## ASANA TASK STANDARDS

### Naming Convention
| Type            | Format                           | Example                                           |
|-----------------|----------------------------------|---------------------------------------------------|
| Task            | [S{sprint}-{n}] Title — detail  | [S1-3] Face ID saved cards — end-to-end test     |
| Subtask         | [S{sprint}-{n}{letter}] Title   | [S1-3a] Swap Stripe test keys → production        |
| Testing subtask | [S{sprint}-{n}] QA: Title       | [S1-3] QA: Face ID saved cards — device testing  |

- Use em dash (—) not hyphen in titles
- Match the exact style of existing tickets
- Every task gets a testing subtask automatically (see rule below)

### Key GIDs
**Consumer App project:** 1214020524863095
**Sections (Consumer App):**
- 🔴 Critical / Blocking: 1214051094219508
- 🏗️ In Development:     1214020524865781

**Priority custom field:** 1214028753456693
- High:   1214028753456696
- Medium: 1214028753456695
- Low:    1214028753456694

### Creating a New Task — ALWAYS follow this exact sequence

STEP 1 — Use create_task_preview to generate the shell (unavoidable for new tasks)
STEP 2 — Immediately search for the new GID:
  Asana:search_objects({ resource_type: "task", query: "task name" })
STEP 3 — Fix it up with update_tasks (project, section, parent, priority):
  Asana:update_tasks({
    tasks: [{
      task: "{new_gid}",
      add_projects: [{ project_id: "1214020524863095", section_id: "1214051094219508" }],
      custom_fields: { "1214028753456693": "1214028753456696" }
    }]
  })
STEP 4 — For subtasks, set parent in a separate update_tasks call:
  Asana:update_tasks({ tasks: [{ task: "{new_gid}", parent: "{parent_gid}" }] })
  NOTE: custom_fields cannot be set in the same call as parent — always separate calls.
STEP 5 — Verify with get_task that project, section, parent, and priority are all set.

NEVER use create_task_preview as the final step — always follow up with update_tasks.

### Testing Subtask — REQUIRED for every task

Every task that involves code changes MUST have a testing subtask created automatically
when the task is created or when coding begins. No exceptions.

Naming: [S{sprint}-{n}{next-letter}] QA: {what to test} — {how/where}
Example: [S1-2b] QA: Username availability check — physical device + new account flow

Testing subtask notes must include:
- What to test (specific feature or flow)
- How to test it (steps, device, account type)
- Expected result (what "passing" looks like)
- Edge cases to verify

Template:
  Name:  [S{sprint}-{n}{letter}] QA: {feature} — {test method}
  Notes:
    Test steps:
    1. {Step 1}
    2. {Step 2}
    Expected: {what should happen}
    Edge cases: {empty state, error state, network failure, etc.}
  Parent: {parent task GID}
  Project: 1214020524863095
  Section: 1214051094219508 (Critical/Blocking) or 1214020524865781 (In Development)
  Priority: Medium (unless blocking a release, then High)

### Logging Completion — ALWAYS a comment, NEVER edit the description

  Asana:add_comment({
    task_id: "{task_gid}",
    text: "✅ COMPLETED — {date}\n\nFiles changed:\n• path/file.tsx — Description.\n\nBuild: EAS TestFlight build #{n} submitted."
  })

### Before Acting on Any Task
1. search_objects → confirm GID
2. get_task → read current state
3. Confirm project/section match the table above

---

## EAS BUILD & TESTFLIGHT PROCESS

### Pre-Flight Check (run BEFORE every build)
cd /Users/jarrod/Documents/GitHub/wugi/mobile-app
npx expo export --platform ios

- Must complete with 0 errors before triggering EAS
- If bundler errors appear, fix them before proceeding
- This catches issues that would fail after 10+ min of remote build time

### Trigger TestFlight Build (auto-submits on completion)
Claude runs this via Desktop Commander — Jarrod never needs to use the terminal for builds.

STEP 1 — Sanity check (catches common failures before wasting build time):
  Desktop Commander:start_process:
    command: /Users/jarrod/Documents/GitHub/wugi/scripts/pre-build-check.sh 2>&1
    timeout_ms: 120000
  Must exit with ✅ All checks passed before proceeding.
  If any check fails → fix the issue → re-run the check → then proceed.

STEP 2 — Build + auto-submit:
  Desktop Commander:start_process:
    command: cd /Users/jarrod/Documents/GitHub/wugi/mobile-app && npx eas-cli build --platform ios --profile testflight --non-interactive --auto-submit 2>&1
    timeout_ms: 60000
  Then use read_process_output to monitor until build URL is confirmed.

STEP 3 — Confirm:
  Desktop Commander:start_process:
    command: cd /Users/jarrod/Documents/GitHub/wugi/mobile-app && npx eas-cli build:list --platform ios --limit 1 --non-interactive 2>&1
    timeout_ms: 30000
  Report build number, status, and build URL to Jarrod.

### What the sanity check covers
Script: /Users/jarrod/Documents/GitHub/wugi/scripts/pre-build-check.sh
1. TypeScript — tsc --noEmit (catches type errors)
2. Firestore rules — firebase deploy dry compile (catches permission bugs)
3. InputAccessoryView wiring — confirms toolbar is at App.tsx root + all fields wired
4. Firestore users rule ordering — confirms own-uid check before userDoc() call
5. Screen imports — confirms all RootNavigator imports resolve to real files
6. Expo bundle — npx expo export --platform ios (confirms bundle compiles)
7. Auth persistence — confirms userRef pattern is in RootNavigator

### App-Specific ASC IDs
- Wugi (consumer):  6760943066  | bundle: com.wugimedia.wugitest
- Wugi Door:        6761620569  | bundle: com.wugi.door
- Wugi Lens:        6761686958  | bundle: com.wugi.lens  | EAS: @phatbat/wugi-lens

### Build Profiles (eas.json)
- testflight  → distribution: store, auto-increment, submits to ASC
- production  → distribution: store, auto-increment, for App Store release
- development → developmentClient: true, distribution: internal
- preview     → distribution: internal, simulator: false

---

## CODING STANDARDS

### Before Writing Any Code
1. Read the relevant files with Desktop Commander first
2. Understand the existing pattern before adding new code
3. Run pre-flight export before triggering any EAS build

### File Writing
- Use Desktop Commander write_file in chunks of ≤30 lines
- Use edit_block for targeted changes to existing files
- Always verify edits with read_file after making changes

### Monorepo Paths
- Consumer app screens:  mobile-app/src/screens/
- Navigation:            mobile-app/src/navigation/RootNavigator.tsx
- Firebase context:      mobile-app/src/context/FirebaseContext.tsx
- Firestore service:     mobile-app/firestoreService.ts
- Firestore rules:       firebase/firestore.rules
- Cloud Functions:       functions/src/index.ts
- Dashboard pages:       dashboard/src/app/

### Deploy Single Cloud Function (faster than full deploy)
firebase deploy --only functions:{functionName} --project wugi-prod

---

## SPRINT WORKFLOW

1. Pull next open ticket from Asana at start of session
2. Read relevant existing files before writing code
3. Create testing subtask for the ticket before coding begins
4. Implement changes
5. Run pre-flight: npx expo export --platform ios
6. Trigger EAS build if ready to test
7. Add completion comment to Asana task (never edit description)
8. Submit to TestFlight after build finishes
9. Move to next ticket

Sprint 1 tasks are tagged [S1-1] through [S1-10] in the Consumer App project.
Complete in order — S1-1 and S1-2 are prerequisites for all others.
