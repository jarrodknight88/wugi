// ─────────────────────────────────────────────────────────────────────
// Wugi — Asana Webhook Types
// ─────────────────────────────────────────────────────────────────────

export interface AsanaWebhookEvent {
  action: string;
  created_at: string;
  change?: {
    field: string;
    action: string;
    new_value?: AsanaStory;
  };
  resource: AsanaResource;
  parent?: AsanaResource;
}

export interface AsanaResource {
  gid: string;
  resource_type: string;
  resource_subtype?: string;
  name?: string;
}

export interface AsanaStory {
  gid: string;
  resource_type: string;
  resource_subtype?: string;
  text?: string;
  html_text?: string;
  created_by?: AsanaUser;
  created_at?: string;
  type?: string;
}

export interface AsanaUser {
  gid: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  html_notes?: string;
  completed: boolean;
  projects: Array<{ gid: string; name: string }>;
  memberships: Array<{
    project: { gid: string; name: string };
    section: { gid: string; name: string } | null;
  }>;
  assignee?: AsanaUser | null;
  due_on?: string | null;
}

export interface AsanaWebhookPayload {
  events: AsanaWebhookEvent[];
}
