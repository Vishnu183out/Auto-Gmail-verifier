// mailProcessor.js
import axios from "axios";
import * as cheerio from "cheerio";

/**
 * Extracts all hyperlinks from HTML content.
 */
function extractLinksFromHtml(html) {
  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href) links.push({ href, text });
  });

  return links;
}

/**
 * Decodes Gmail message body from base64 to plain text or HTML.
 */
function decodeBase64(encoded) {
  const buff = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buff.toString("utf-8");
}

/**
 * Recursively clicks Netflix verification links until none are left
 */
async function clickNetflixLinksRecursively(html, depth = 0) {
  if (depth > 5) { // safety: avoid infinite recursion
    console.warn("⚠️ Max nested clicks reached, stopping recursion.");
    return;
  }

  const links = extractLinksFromHtml(html);
  const targetLinks = links.filter(
    (l) =>
      l.href.includes("https://www.netflix.com/") &&
      (l.text.toLowerCase().includes("yes") ||
        l.text.toLowerCase().includes("confirm") ||
        l.href.includes("update-primary-location"))
  );

  if (targetLinks.length === 0) {
    console.log("🕵️ No more verification links found at depth", depth);
    return;
  }

  for (const link of targetLinks) {
    try {
      console.log("🖱️ Clicking Netflix verification link:", link.href);
      const response = await axios.get(link.href);
      console.log("✅ Successfully clicked! Status:", response.status);

      // Check response HTML for more links
      if (response.headers["content-type"]?.includes("text/html")) {
        await clickNetflixLinksRecursively(response.data, depth + 1);
      }
    } catch (err) {
      console.error("❌ Failed to click link:", err.message);
    }
  }
}

/**
 * Processes a Gmail message:
 * - Filters for Netflix sender
 * - Extracts body & links
 * - Auto-clicks any Netflix verification links recursively
 */
export async function processEmailMessage(msg, from, subject) {
  if (!from.includes("info@account.netflix.com")) {
    console.log("📭 Ignoring non-Netflix mail from:", from);
    return;
  }

  console.log("🎯 Netflix mail detected!");
  console.log("   🧑 From:", from);
  console.log("   📝 Subject:", subject);

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

  if (!bodyHtml) {
    console.warn("⚠️ No HTML body found in this email.");
    return;
  }

  // Start recursive link clicking
  await clickNetflixLinksRecursively(bodyHtml);
}
