import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  GMAIL_TOPIC_NAME,
} = process.env;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

async function startWatch() {
  try {
    const res = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: `projects/${process.env.GCP_PROJECT_ID}/topics/${GMAIL_TOPIC_NAME}`,
        labelIds: ["INBOX"],
      },
    });
    console.log("✅ Gmail watch started successfully!");
    console.log("Response:", res.data);
  } catch (err) {
    console.error("❌ Failed to start Gmail watch:", err);
  }
}

startWatch();
