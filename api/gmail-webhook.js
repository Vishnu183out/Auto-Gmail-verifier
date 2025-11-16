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

// 🆕 Track lastHistoryId + processed Gmail message IDs.
let lastHistoryId = null;
const processedMessages = new Set();

// ✉️ recipients
const RECIPIENTS = [
  "vishnu183out@gmail.com",
  "hrushikeshpenubarthi@gmail.com",
  "amirudhshanmukha2399@gmail.com",
];

function decodeBase64(encoded) {
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

// ----------------------------
// Forward Email
// ----------------------------
async function forwardEmail(msg, from, subject) {
  console.log(`📤 Forwarding mail → ${RECIPIENTS.join(", ")}`);

  let bodyHtml = "";
  const parts = msg.payload.parts || [msg.payload];

  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      bodyHtml = decodeBase64(part.body.data);
      break;
    }
    if (part.mimeType === "multipart/alternative" && part.parts) {
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

  console.log("✅ Forwarded successfully.");
}

// ----------------------------
// Webhook Handler
// ----------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    console.log("🚨 Gmail webhook fired!");

    const pubsubMessage = req.body.message;
    if (!pubsubMessage?.data) return res.status(400).send("Invalid Pub/Sub data");

    const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf-8");
    const notification = JSON.parse(decoded);

    console.log("🔍 Pub/Sub Notification:", notification);

    const currentHistoryId = Number(notification.historyId);
    if (!currentHistoryId) return res.status(200).send("No historyId");

    // First Time Initial Load
    if (!lastHistoryId) {
      console.log("🔧 First-time initialization...");

      const list = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 1,
      });

      if (list.data.messages?.length) {
        const firstMsgId = list.data.messages[0].id;

        // 🆕 Mark as processed
        processedMessages.add(firstMsgId);

        const msg = await gmail.users.messages.get({
          userId: "me",
          id: firstMsgId,
        });

        const headers = msg.data.payload.headers;
        const from = headers.find((h) => h.name === "From")?.value || "";
        const subject = headers.find((h) => h.name === "Subject")?.value || "";

        if (from.toLowerCase().includes("info@account.netflix.com")) {
          await forwardEmail(msg.data, from, subject);
        } else {
          console.log("📭 Not Netflix mail, skipping...");
        }
      }

      lastHistoryId = currentHistoryId;
      return res.status(200).send("Initialized");
    }

    // Fetch History Events
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: lastHistoryId,
      historyTypes: ["messageAdded"],
    });

    const events = history.data.history || [];
    console.log(`📨 Found ${events.length} new messages.`);

    for (const e of events) {
      if (!e.messagesAdded) continue;

      for (const added of e.messagesAdded) {
        const msgId = added.message.id;

        // 🛑 Prevent Duplicate Forwarding
        if (processedMessages.has(msgId)) {
          console.log(`⛔ Skipping duplicate message ID: ${msgId}`);
          continue;
        }

        processedMessages.add(msgId);

        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
        });

        const headers = msg.data.payload.headers;
        const from = headers.find((h) => h.name === "From")?.value || "";
        const subject = headers.find((h) => h.name === "Subject")?.value || "";

        console.log("📧 New Email:", from, "-", subject);

        if (from.toLowerCase().includes("info@account.netflix.com")) {
          await forwardEmail(msg.data, from, subject);
        } else {
          console.log("📭 Ignored non-Netflix mail.");
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
