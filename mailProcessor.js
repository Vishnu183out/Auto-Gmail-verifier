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
 * Robustly extract a 4-digit Netflix sign-in code from the HTML.
 * Tries multiple strategies and logs the snippet that yielded the code for debugging.
 */
function extractNetflixCode(html) {
  const $ = cheerio.load(html);
  let found = null;

  // Normalize phrase regex
  const phraseRegex = /enter this code to sign in/i;

  // Strategy A: find td that contains the phrase then immediate next <td>
  $("td").each((i, el) => {
    if (found) return;
    const text = $(el).text().trim();
    if (phraseRegex.test(text)) {
      // Try immediate next sibling td
      const nextTd = $(el).nextAll("td").first();
      if (nextTd && nextTd.length) {
        const maybe = nextTd.text().trim().replace(/\s+/g, " ");
        const m = maybe.match(/\b(\d{4})\b/);
        if (m) {
          found = { code: m[1], method: "nextSibling", snippet: $.html(nextTd) };
          return;
        }
      }

      // Try within same parent row: find any td in parent with 4-digit
      const parentRow = $(el).closest("tr");
      if (parentRow && parentRow.length) {
        const rowText = parentRow.text().replace(/\s+/g, " ").trim();
        const m2 = rowText.match(/\b(\d{4})\b/);
        if (m2) {
          // find the td that contains that 4-digit
          let tdWith = null;
          parentRow.find("td").each((_, td) => {
            if (tdWith) return;
            const t = $(td).text();
            if (t && t.match(/\b\d{4}\b/)) tdWith = td;
          });
          if (tdWith) {
            found = { code: rowText.match(/\b(\d{4})\b/)[1], method: "sameRow", snippet: $.html(tdWith) };
            return;
          } else {
            // fallback: record code from rowText
            found = { code: m2[1], method: "sameRow_textSearch", snippet: $.html(parentRow) };
            return;
          }
        }
      }

      // Strategy B: search within next N chars in raw HTML
      const idx = html.toLowerCase().indexOf(text.toLowerCase());
      if (idx !== -1) {
        const slice = html.slice(idx, idx + 500); // look within 500 chars after phrase
        const m3 = slice.match(/\b(\d{4})\b/);
        if (m3) {
          found = { code: m3[1], method: "nearPhraseRawHtml", snippet: slice };
          return;
        }
      }
    }
  });

  if (found) {
    console.log(`🔢 extractNetflixCode: found (${found.method}) => ${found.code}`);
    // log short snippet for debugging (truncate if large)
    const snip = typeof found.snippet === "string" ? found.snippet : (found.snippet && found.snippet.html) || "";
    console.log("🔍 snippet:", (snip && snip.toString().slice(0, 800)) || snip);
    return found.code;
  }

  // Strategy C: prefer <td> elements with large font-size style (typical OTP display)
  let candidate = null;
  $("td").each((_, el) => {
    if (candidate) return;
    const style = ($(el).attr("style") || "").toLowerCase();
    const text = $(el).text().trim();
    const m = text.match(/\b(\d{4})\b/);
    if (m) {
      // prefer those with obvious numeric styling: font-size or letter-spacing or big weight
      if (style.includes("font-size") || style.includes("letter-spacing") || style.includes("font-weight:700") || $(el).attr("class")) {
        candidate = { code: m[1], method: "largeTdPreference", snippet: $.html(el) };
      } else if (!candidate) {
        candidate = { code: m[1], method: "anyTd4digit", snippet: $.html(el) }; // fallback
      }
    }
  });

  if (candidate) {
    console.log(`🔢 extractNetflixCode: found fallback (${candidate.method}) => ${candidate.code}`);
    console.log("🔍 snippet:", (candidate.snippet && candidate.snippet.toString().slice(0, 800)) || candidate.snippet);
    return candidate.code;
  }

  // Strategy D: direct regex fallback - find phrase then digits anywhere after
  const mGlobal = html.match(/enter this code to sign in[\s\S]{0,500}?(\d{4})/i);
  if (mGlobal) {
    console.log("🔢 extractNetflixCode: found by regex fallback =>", mGlobal[1]);
    const snippet = mGlobal[0].slice(0, 800);
    console.log("🔍 snippet:", snippet);
    return mGlobal[1];
  }

  // nothing found
  console.warn("⚠️ extractNetflixCode: no 4-digit code found using heuristics.");
  return null;
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
  if (!from || !from.toLowerCase().includes("netflix.com")) {
    console.log("📭 Ignoring non-Netflix mail from:", from);
    return;
  }

  console.log("🎯 Netflix mail detected!");
  console.log("   🧑 From:", from);
  console.log("   📝 Subject:", subject);

  // Extract the HTML body
  let bodyHtml = "";
  const parts = msg.payload?.parts || [msg.payload];
  for (const part of parts) {
    if (!part) continue;
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
    } else if (part.mimeType === "text/plain" && part.body?.data && !bodyHtml) {
      // keep text fallback if no html
      // but our code extraction aims at HTML primarily
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

  // Continue with link processing (unchanged)
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
