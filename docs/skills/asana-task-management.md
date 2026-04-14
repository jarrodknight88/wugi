# Asana Task Management — Wugi Sprint Standard
# This skill defines the exact rules for creating, updating, and managing
# Asana tasks for the Wugi project. Follow this precisely in every chat.

## GOLDEN RULES
1. ALWAYS use `update_tasks` for ALL task creation and updates — never `create_task_preview`
2. ALWAYS add project + section on creation via `add_projects`
3. ALWAYS use `add_comment` for completion notes — never edit the task description
4. ALWAYS use `search_objects` to find a task GID before acting on it
5. NEVER use `create_task_preview` — it cannot set parent, project, or section reliably

---

## NAMING CONVENTION

| Type        | Format                          | Example                                      |
|-------------|---------------------------------|----------------------------------------------|
| Sprint task | `[S{sprint}-{n}] Title`        | `[S1-3] Face ID saved cards — end-to-end test` |
| Subtask     | `[S{sprint}-{n}{letter}] Title` | `[S1-3a] Swap Stripe test keys → production` |
| Blocker     | `[S{sprint}-{n}] BLOCKER: Title`| `[S1-5] BLOCKER: OneSignal APNs config`      |

- Use em dash (—) not hyphen (-) in titles
- Keep titles concise but descriptive
- Match the exact style of existing tickets in the project

---

## KEY IDs (Wugi Project)

### Projects
- Consumer App:   `1214020524863095`  📱 Wugi App — Consumer (iOS/Android)
- Dashboard:      `1214020524983466`  ⚙️ Dashboard — dashboard.wugi.us (Admin)
- Wugi Door:      (search if needed)  🚪 Wugi Door — Venue Check-In
- Wugi Lens:      (search if needed)  📷 Wugi Lens — Photography Publishing
- Infrastructure: (search if needed)  🔧 Infrastructure & DevOps
- Launch:         (search if needed)  🚨 Launch — Critical Path (FIFA June 9)

### Sections (Consumer App)
- Critical/Blocking:  `1214051094219508`  🔴 Critical / Blocking
- In Development:     `1214020524865781`  🏗️ In Development
- In Review:          (search if needed)
- Done:               (search if needed)

### Custom Fields
- Priority field GID: `1214028753456693`
  - High:   `1214028753456696`
  - Medium: `1214028753456695`
  - Low:    `1214028753456694`

---

## CREATING A NEW TASK

```
Asana:update_tasks({
  tasks: [{
    task: "NEW",                          // Will be ignored — use search_objects after
    name: "[S1-X] Task title — detail",
    notes: "Full description here",
    due_on: "2026-04-25",
    add_projects: [{
      project_id: "1214020524863095",
      section_id: "1214051094219508"
    }],
    custom_fields: {
      "1214028753456693": "1214028753456696"  // High priority
    }
  }]
})
```

⚠️ update_tasks does NOT support creating brand new tasks with "NEW" as GID.
The correct flow for new tasks is:
1. Use `create_task_preview` ONLY to generate the task shell (unavoidable)
2. IMMEDIATELY after creation, use `search_objects` to find the new task GID
3. THEN use `update_tasks` to set parent, project, section, priority, and any missing fields
4. Verify with `get_task` that everything is correct

---

## CREATING A SUBTASK

```
// Step 1: Create shell via create_task_preview (note the GID from result)
// Step 2: Find GID via search_objects if needed
Asana:search_objects({ resource_type: "task", query: "task name here" })

// Step 3: Fix it up with update_tasks
Asana:update_tasks({
  tasks: [{
    task: "{new_task_gid}",
    parent: "{parent_task_gid}",           // Makes it a subtask
    add_projects: [{
      project_id: "1214020524863095",
      section_id: "1214051094219508"
    }],
    custom_fields: {
      "1214028753456693": "1214028753456696"
    }
  }]
})
```

Note: Custom fields cannot be set in the same call as `parent` — do them separately if needed.

---

## LOGGING COMPLETION (always a comment, never edit description)

```
Asana:add_comment({
  task_id: "{task_gid}",
  text: `✅ COMPLETED — {date}

Files changed:
• path/to/file.tsx — NEW FILE. Description of what was built.
• path/to/other.ts — What was changed and why.

Build: EAS TestFlight build #{n} triggered and submitted.`
})
```

---

## UPDATING AN EXISTING TASK

```
Asana:update_tasks({
  tasks: [{
    task: "{task_gid}",
    notes: "Updated description",
    due_on: "2026-05-02",
    completed: true
  }]
})
```

---

## BEFORE ACTING — ALWAYS VERIFY

Before creating or updating any task:
1. `search_objects` — confirm the task exists and get the correct GID
2. `get_task` — read current state before making changes
3. Confirm project/section GIDs match the table above

---

## WHAT NOT TO DO
- ❌ Use `create_task_preview` as the final step — always follow up with `update_tasks`
- ❌ Edit task description to log completion — use `add_comment`
- ❌ Create tasks without project + section assignment
- ❌ Create tasks without the sprint naming convention
- ❌ Assume GIDs — always look them up or use the table above
