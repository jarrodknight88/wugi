// Deliberately duplicates the (tiny) postAsanaComment shape from
// functions/src/bridge/shared.ts rather than importing it: functions/ and
// scripts/approval-executor/ are independent packages with separate
// node_modules, and the task spec forbids touching bridge files, so this
// keeps the daemon self-contained instead of reaching into functions/src.

const ASANA_API = 'https://app.asana.com/api/1.0';

export async function postAsanaComment(taskGid: string, text: string, token: string): Promise<void> {
  const res = await fetch(`${ASANA_API}/tasks/${taskGid}/stories`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { text } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana POST /tasks/${taskGid}/stories failed [${res.status}]: ${body}`);
  }
}
