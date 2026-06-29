import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const gmail = google.gmail({
  version: "v1",
  auth: oauth2Client,
});

export default async function handler(req, res) {
  try {
    const response = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: `projects/${process.env.GCP_PROJECT_ID}/topics/${process.env.GMAIL_TOPIC_NAME}`,
        labelIds: ["INBOX"],
      },
    });

    res.status(200).json({
      success: true,
      expiration: response.data.expiration,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
