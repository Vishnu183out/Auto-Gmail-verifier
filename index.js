import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";
import { processEmailMessage } from "./mailProcessor.js";


dotenv.config();

const app = express();
app.use(bodyParser.json({ type: "application/json" }));

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  PORT = 3000,
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

const HISTORY_FILE = "lastHistory.json";
let lastHistoryId = null;

// --- Load saved history ID (if any) ---
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    if (saved.historyId) {
      lastHistoryId = saved.historyId;
      console.log("🧠 Loaded lastHistoryId from file:", lastHistoryId);
    }
  } catch (e) {
    console.warn("⚠️ Failed to read saved history:", e);
  }
}

// --- Gmail Webhook Endpoint ---
app.post("/gmail-webhook", async (req, res) => {
  console.log("✅ Incoming webhook hit!");
  console.log("🪵 Raw body:", JSON.stringify(req.body, null, 2));

  try {
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

    // First webhook (no history saved yet)
    if (!lastHistoryId) {
      console.log("🧭 No previous history found — fetching latest email directly...");
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
        const subject =
          headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
        const date = headers.find((h) => h.name === "Date")?.value || "Unknown";

        console.log("📧 First Email Captured:");
        console.log("   🧑 From:", from);
        console.log("   📝 Subject:", subject);
        console.log("   📅 Date:", date);
        console.log("--------------------------------------");
      } else {
        console.log("⚠️ No messages found in inbox yet.");
      }

      lastHistoryId = currentHistoryId;
      fs.writeFileSync(HISTORY_FILE, JSON.stringify({ historyId: currentHistoryId }));
      console.log("💾 Initialized lastHistoryId →", currentHistoryId);
      return res.status(200).send("Initialized with first mail");
    }

    // --- For subsequent notifications ---
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
          const from =
            headers.find((h) => h.name === "From")?.value || "(Unknown Sender)";
          const subject =
            headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
          const date =
            headers.find((h) => h.name === "Date")?.value || "(No Date)";
          const snippet = msg.data.snippet || "";

          console.log("📧 New Email Received:");
          console.log("   🧑 From:", from);
          console.log("   📝 Subject:", subject);
          console.log("   📅 Date:", date);
console.log("--------------------------------------");

// Call Netflix processor
await processEmailMessage(msg.data, from, subject);

        }
      }
    }

    // --- Update stored history ID ---
    lastHistoryId = currentHistoryId;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ historyId: currentHistoryId }));
    console.log("🔁 Updated lastHistoryId →", currentHistoryId);

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error processing Gmail webhook:", err);
    res.status(500).send("Error: " + err.message);
  }
});

// --- Gmail Watch Starter ---
app.get("/start-watch", async (req, res) => {
  try {
    const watchResponse = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: "projects/sixth-decoder-476816-s9/topics/gmail-notifications",
        labelIds: ["INBOX"],
      },
    });

    console.log("✅ Gmail Watch started:", watchResponse.data);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ historyId: watchResponse.data.historyId }));
    lastHistoryId = watchResponse.data.historyId;
    res.json(watchResponse.data);
  } catch (error) {
    console.error("❌ Error starting watch:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Gmail Webhook Server running on port ${PORT}`);
  console.log(`📡 Listening for Gmail Pub/Sub notifications at /gmail-webhook`);
});
