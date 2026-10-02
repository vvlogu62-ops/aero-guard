export async function sendExpoPush(
  tokens: string[],
  notification: { title: string; body: string; data?: Record<string, string> },
) {
  const messages = tokens
    .filter((token) => token.startsWith("ExponentPushToken["))
    .map((to) => ({ to, sound: "default", ...notification }));
  if (!messages.length) return;

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    console.warn("Expo push delivery failed", response.status);
  }
}