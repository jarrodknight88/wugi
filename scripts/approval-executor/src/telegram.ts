// No Telegram integration exists elsewhere in this repo (see README "Design
// notes") — this is a minimal Bot API client, same no-SDK fetch style as
// functions/src/bridge/shared.ts uses for Asana/GitHub/Twilio.

export async function sendTelegramMessage(text: string, botToken: string, chatId: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed [${res.status}]: ${body}`);
  }
}
