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
 * Delay helper
 */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Recursive Netflix link clicker (up to depth 2)
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
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
    console.log(`✅ Page loaded: ${url}`);
    await delay(4000); // allow dynamic content to load

    // Step 1️⃣ Look for primary "Yes, this was me" button
    const yesButton = await findButton(page, ["yes this was me", "yes", "continue"]);
    if (yesButton) {
      console.log("🖱️ Clicking 'Yes, this was me'...");
      await yesButton.click();
      await delay(6000); // give time for redirect
    } else {
      console.log("ℹ️ No 'Yes, this was me' button found.");
    }

    // Step 2️⃣ Wait for the "Confirm Update" button (depth 2)
    try {
      console.log("🕐 Waiting for 'Confirm Update' button...");
      await page.waitForSelector('button[data-uia="set-primary-location-action"]', { timeout: 10000 });

      const confirmButton = await page.$('button[data-uia="set-primary-location-action"]');
      if (confirmButton) {
        await page.evaluate((el) => el.scrollIntoView(), confirmButton);
        await delay(1000);
        await confirmButton.click();
        console.log("✅ 'Confirm Update' button clicked successfully!");
      } else {
        console.log("⚠️ Could not find 'Confirm Update' button after navigation.");
      }
    } catch {
      console.log("ℹ️ 'Confirm Update' button not found or page did not render it.");
    }

    // Step 3️⃣ Optional recursive follow-up
    if (depth < maxDepth) {
      const nextLinks = await page.$$eval("a[href]", (as) =>
        as.map((a) => a.href).filter((href) => href.includes("netflix.com") && !href.includes("logout"))
      );
      if (nextLinks.length > 0) {
        console.log(`🔁 Found ${nextLinks.length} nested Netflix links. Exploring...`);
        for (const nextUrl of nextLinks.slice(0, 2)) {
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
 * Find button or link element that matches keywords (case-insensitive)
 */
async function findButton(page, keywords) {
  for (const keyword of keywords) {
    const xpath = `//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')] | //a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')]`;
    const elements = await page.$x(xpath);
    if (elements.length > 0) {
      console.log(`✅ Found button matching '${keyword}'`);
      return elements[0];
    }
  }
  return null;
}

/**
 * Main exported function — called by gmail-webhook.js
 */
export async function processEmailMessage(msg, from, subject) {
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

  // Extract links
  const links = extractLinksFromHtml(bodyHtml);
  console.log(`🔗 Found ${links.length} links in email.`);

  // Filter Netflix links (Yes / Confirm / Continue / update-primary-location)
  const targetLinks = links.filter(
    (l) =>
      l.href.includes("netflix.com") &&
      (l.text.toLowerCase().includes("yes") ||
        l.text.toLowerCase().includes("confirm") ||
        l.text.toLowerCase().includes("continue") ||
        l.href.includes("update-primary-location"))
  );

  if (targetLinks.length === 0) {
    console.log("🕵️ No relevant Netflix verification links found.");
    return;
  }

  // Visit and click verification links
  for (const link of targetLinks) {
    console.log("🖱️ Attempting to click Netflix verification link:", link.href);
    await clickNetflixLinksRecursively(link.href, 2);
  }

  console.log("✅ Finished processing Netflix verification email.");
}
