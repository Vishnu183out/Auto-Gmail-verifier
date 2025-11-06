// api/gmail-webhook.js
import { google } from "googleapis";
import dotenv from "dotenv";
import { processEmailMessage } from "../mailProcessor.js";

dotenv.config();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// In-memory lastHistoryId (serverless functions are stateless)
let lastHistoryId = null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    console.log("✅ Gmail webhook hit!");
    const pubsubMessage = req.body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      console.error("❌ Invalid Pub/Sub message format");
      return res.status(400).send("Invalid message");
    }

    const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf-8");
    const notification = JSON.parse(decoded);
    console.log("🔍 Decoded Data:", notification);

    const currentHistoryId = Number(notification.historyId);
    if (!currentHistoryId) {
      console.warn("⚠️ No historyId found in notification");
      return res.status(200).send("No historyId");
    }

    // First webhook: fetch latest email if no lastHistoryId
    if (!lastHistoryId) {
      console.log("🧭 Fetching latest email since no previous historyId...");
      const messagesList = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 1,
      });

      if (messagesList.data.messages?.length) {
        const msgId = messagesList.data.messages[0].id;
        const msg = await gmail.users.messages.get({ userId: "me", id: msgId });
        const headers = msg.data.payload.headers;

        const from = headers.find((h) => h.name === "From")?.value || "(Unknown)";
        const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
        const date = headers.find((h) => h.name === "Date")?.value || "(Unknown)";

        console.log("📧 First Email Captured:");
        console.log("   🧑 From:", from);
        console.log("   📝 Subject:", subject);
        console.log("   📅 Date:", date);
        console.log("--------------------------------------");

        // Call Netflix processor
        await processEmailMessage(msg.data, from, subject);
      } else {
        console.log("⚠️ No messages found in inbox yet.");
      }

      lastHistoryId = currentHistoryId;
      console.log("💾 Initialized lastHistoryId →", currentHistoryId);
      return res.status(200).send("Initialized with first mail");
    }

    // --- Process Gmail history
    console.log(`📜 Fetching Gmail history from ${lastHistoryId} → ${currentHistoryId}`);
    const historyResponse = await gmail.users.history.list({
      userId: "me",
      startHistoryId: lastHistoryId,
      historyTypes: ["messageAdded"],
    });

    const histories = historyResponse.data.history || [];
    console.log(`📬 Found ${histories.length} new history records.`);

    for (const event of histories) {
      if (event.messagesAdded) {
        for (const added of event.messagesAdded) {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: added.message.id,
          });

          const headers = msg.data.payload.headers;
          const from = headers.find((h) => h.name === "From")?.value || "(Unknown Sender)";
          const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";

          console.log("📧 New Email Received:");
          console.log("   🧑 From:", from);
          console.log("   📝 Subject:", subject);
          console.log("--------------------------------------");

          // Call Netflix processor
          await processEmailMessage(msg.data, from, subject);
        }
      }
    }

    lastHistoryId = currentHistoryId;
    console.log("🔁 Updated lastHistoryId →", currentHistoryId);
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error processing Gmail webhook:", err);
    res.status(500).send("Error: " + err.message);
  }
}
