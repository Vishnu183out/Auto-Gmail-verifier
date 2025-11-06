import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

/**
 * Main handler for Netflix household or verification emails.
 */
export async function processNetflixMail(email) {
  const subject = email.payload?.headers?.find(h => h.name === "Subject")?.value || "";
  const from = email.payload?.headers?.find(h => h.name === "From")?.value || "";

  console.info("🎯 Netflix email detected!");
  console.info(`🧑 From: ${from}`);
  console.info(`📝 Subject: ${subject}`);

  const yesLink = extractYesLink(email.payload);
  if (!yesLink) {
    console.warn("⚠️ No 'Yes, this was me' link found in email.");
    return;
  }

  console.info(`🖱️ Found primary Netflix action link: ${yesLink}`);
  await clickNetflixLinks(yesLink);
}

/**
 * Extract “Yes, this was me” link from email HTML.
 */
function extractYesLink(payload) {
  const parts = payload.parts || [];
  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      const html = Buffer.from(part.body.data, "base64").toString("utf8");
      const regex = /<a[^>]*href="(https:\/\/www\.netflix\.com\/[^"]+)"[^>]*>\s*Yes,?\s*this\s*was\s*me\s*<\/a>/i;
      const match = html.match(regex);
      if (match) return match[1];
    }
  }
  return null;
}

/**
 * Launch Puppeteer and handle 2-level Netflix confirmation flow.
 */
async function clickNetflixLinks(url) {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    console.info(`🌐 Navigating to: ${url}`);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await wait(4000);
    console.info("✅ First page loaded (Yes, this was me).");

    // --- LEVEL 2: Click “Confirm update” or equivalent buttons ---
    console.info("🔍 Searching for confirmation-level buttons...");

    const confirmButton = await findButton(page, [
      "confirm update",
      "confirm",
      "continue",
      "yes",
    ]);

    if (confirmButton) {
      console.info("🖱️ Clicking 'Confirm update' button...");
      await confirmButton.click();
      await wait(5000);
      console.info("✅ Successfully clicked the 'Confirm update' button!");
    } else {
      console.warn("⚠️ No 'Confirm update' button found on page.");
    }

  } catch (err) {
    console.error("❌ Puppeteer error:", err.message);
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Finds a button or link containing given keywords (case-insensitive).
 */
async function findButton(page, keywords) {
  for (const keyword of keywords) {
    const xpath = `//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')] | //a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')]`;
    const elements = await page.$x(xpath);
    if (elements.length > 0) {
      console.info(`✅ Found button matching '${keyword}'`);
      return elements[0];
    }
  }
  return null;
}

/**
 * Delay utility.
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
