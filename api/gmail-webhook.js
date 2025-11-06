// api/gmail-webhook.js
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, REFRESH_TOKEN } = process.env;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// store lastHistoryId in memory
let lastHistoryId = null;

// ✉️ define your recipients
const RECIPIENTS = [
  "vishnu183out@gmail.com",
  "hrushikeshpenubarthi@gmail.com",
  "amirudhshanmukha2399@gmail.com",
];

/**
 * Helper: decode Base64 URL-safe strings
 */
function decodeBase64(encoded) {
  const buff = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buff.toString("utf-8");
}

/**
 * Helper: forward message to specific recipients
 */
async function forwardEmail(msg, from, subject) {
  console.log(`📤 Forwarding email from Netflix → ${RECIPIENTS.join(", ")}`);

  let bodyHtml = "";
  const parts = msg.payload.parts || [msg.payload];

  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      bodyHtml = decodeBase64(part.body.data);
      break;
    } else if (part.mimeType === "multipart/alternative" && part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === "text/html" && sub.body?.data) {
          bodyHtml = decodeBase64(sub.body.data);
          break;
        }
      }
    }
  }

  const rawMessage = [
    `From: me`,
    `To: ${RECIPIENTS.join(", ")}`,
    `Subject: Fwd: ${subject}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    `<p><b>Forwarded message from:</b> ${from}</p><hr/>${bodyHtml}`,
  ].join("\n");

  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });

  console.log("✅ Email successfully forwarded.");
}

/**
 * Webhook Handler
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    console.log("✅ Gmail webhook triggered!");

    const pubsubMessage = req.body.message;
    if (!pubsubMessage?.data) return res.status(400).send("Invalid Pub/Sub data");

    const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf-8");
    const notification = JSON.parse(decoded);
    console.log("🔍 Decoded Data:", notification);

    const currentHistoryId = Number(notification.historyId);
    if (!currentHistoryId) return res.status(200).send("No historyId");

    // first-time setup
    if (!lastHistoryId) {
      console.log("🧭 Fetching latest email (first webhook init)...");
      const list = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 1,
      });

      if (list.data.messages?.length) {
        const msgId = list.data.messages[0].id;
        const msg = await gmail.users.messages.get({ userId: "me", id: msgId });
        const headers = msg.data.payload.headers;
        const from = headers.find((h) => h.name === "From")?.value || "(Unknown)";
        const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";

        if (from.toLowerCase().includes("info@account.netflix.com")) {
          await forwardEmail(msg.data, from, subject);
        } else {
          console.log("📭 Not a Netflix mail, skipping forward.");
        }
      }

      lastHistoryId = currentHistoryId;
      console.log("💾 Initialized history tracking:", lastHistoryId);
      return res.status(200).send("Initialized with first mail");
    }

    // process subsequent history events
    const historyResponse = await gmail.users.history.list({
      userId: "me",
      startHistoryId: lastHistoryId,
      historyTypes: ["messageAdded"],
    });

    const histories = historyResponse.data.history || [];
    console.log(`📬 Found ${histories.length} new messages.`);

    for (const event of histories) {
      if (event.messagesAdded) {
        for (const added of event.messagesAdded) {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: added.message.id,
          });

          const headers = msg.data.payload.headers;
          const from = headers.find((h) => h.name === "From")?.value || "(Unknown)";
          const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";

          console.log("📧 Received:", from, "-", subject);

          if (from.toLowerCase().includes("info@account.netflix.com")) {
            await forwardEmail(msg.data, from, subject);
          } else {
            console.log("📭 Ignored non-Netflix mail.");
          }
        }
      }
    }

    lastHistoryId = currentHistoryId;
    console.log("🔁 Updated lastHistoryId →", lastHistoryId);
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error in Gmail webhook:", err);
    res.status(500).send("Error: " + err.message);
  }
}
