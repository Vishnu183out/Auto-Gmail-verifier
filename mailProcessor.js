// mailProcessor.js
import * as cheerio from "cheerio";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

/**
 * Decode Gmail message body from Base64 → HTML/text
 */
function decodeBase64(encoded) {
  const buff = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buff.toString("utf-8");
}

/**
 * Extract all links from HTML body
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
 * Extract Netflix sign-in code (4 digits) from specific <td> structure
 */
function extractNetflixCode(html) {
  const $ = cheerio.load(html);
  let code = null;

  $("td").each((_, el) => {
    const text = $(el).text().trim();
    if (text.toLowerCase().includes("enter this code to sign in")) {
      // Get the next <td> that likely contains the code
      const nextTd = $(el).parent().find("td").eq(1);
      const maybeCode = nextTd.text().trim().replace(/\s+/g, "");
      const match = maybeCode.match(/\b\d{4}\b/);
      if (match) {
        code = match[0];
      }
    }
  });

  // Fallback: try regex directly if the above fails
  if (!code) {
    const match = html.match(/Enter this code to sign in.*?(\d{4})/s);
    if (match) code = match[1];
  }

  return code;
}

/**
 * Click Netflix links recursively up to 2 layers deep using Puppeteer
 */
async function clickNetflixLinksRecursively(url, maxDepth = 2, depth = 1) {
  console.log(`🌐 Navigating (depth ${depth}): ${url}`);

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    console.log(`✅ Page loaded: ${url}`);

    // Wait a bit for dynamic elements
    await page.waitForTimeout(3000);

    // Click any confirmation or continue buttons
    const buttons = await page.$x(
      "//a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'confirm') or " +
      "contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'yes') or " +
      "contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'continue')]"
    );

    if (buttons.length > 0) {
      console.log(`🖱️ Clicking ${buttons.length} confirmation buttons...`);
      for (const btn of buttons) {
        try {
          await btn.click();
          await page.waitForTimeout(2000);
        } catch (err) {
          console.warn("⚠️ Button click failed:", err.message);
        }
      }
    } else {
      console.log("ℹ️ No confirmation buttons found on this page.");
    }

    // If allowed, follow next internal Netflix links (nested click)
    if (depth < maxDepth) {
      const nextLinks = await page.$$eval("a[href]", (as) =>
        as
          .map((a) => a.href)
          .filter((href) => href.includes("netflix.com") && !href.includes("logout"))
      );

      if (nextLinks.length > 0) {
        console.log(`🔁 Found ${nextLinks.length} nested links, exploring next level...`);
        for (const nextUrl of nextLinks.slice(0, 2)) { // limit to 2 to avoid loops
          await clickNetflixLinksRecursively(nextUrl, maxDepth, depth + 1);
        }
      }
    }
  } catch (err) {
    console.error("❌ Puppeteer navigation error:", err.message);
  } finally {
    await browser.close();
  }
}

/**
 * Process Gmail message for Netflix verification
 */
export async function processEmailMessage(msg, from, subject) {
  // Only process Netflix or specific sender emails
  if (!from.toLowerCase().includes("netflix.com")) {
    console.log("📭 Ignoring non-Netflix mail from:", from);
    return;
  }

  console.log("🎯 Netflix mail detected!");
  console.log("   🧑 From:", from);
  console.log("   📝 Subject:", subject);

  // Extract the HTML body
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

  // 🧩 Extract the Netflix sign-in code
  const code = extractNetflixCode(bodyHtml);
  if (code) {
    console.log(`🔢 Netflix Sign-In Code Detected: ${code}`);
  } else {
    console.log("⚠️ No sign-in code found in this email.");
  }

  // Continue with link processing
  const links = extractLinksFromHtml(bodyHtml);
  console.log(`🔗 Found ${links.length} links in email.`);

  // Filter for Netflix verification links
  const targetLinks = links.filter(
    (l) =>
      l.href.includes("netflix.com") &&
      (l.text.toLowerCase().includes("yes") ||
        l.text.toLowerCase().includes("confirm") ||
        l.text.toLowerCase().includes("continue") ||
        l.href.includes("update-primary-location"))
  );

  if (targetLinks.length === 0) {
    console.log("🕵️ No Netflix verification links found.");
    return;
  }

  // Click each Netflix verification link using Puppeteer
  for (const link of targetLinks) {
    console.log("🖱️ Attempting to click Netflix verification link:", link.href);
    await clickNetflixLinksRecursively(link.href, 2);
  }

  console.log("✅ Finished processing Netflix verification email.");
}
