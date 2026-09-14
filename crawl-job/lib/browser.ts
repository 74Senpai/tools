import fs from "fs";
import path from "path";
import puppeteer, { Browser, Page } from "puppeteer";
import { logger } from "../utils/logger";

export async function getBrowser(headless = false, userDir = "./user_profile"): Promise<Browser> {
  const absUserDir = path.resolve(userDir);
  if (!fs.existsSync(absUserDir)) {
    fs.mkdirSync(absUserDir, { recursive: true });
  }

  const executablePath = fs.existsSync("/usr/bin/google-chrome")
    ? "/usr/bin/google-chrome"
    : fs.existsSync("/snap/bin/chromium")
    ? "/snap/bin/chromium"
    : undefined;

  return await puppeteer.launch({
    headless,
    userDataDir: absUserDir,
    executablePath,
    args: [
      "--disable-notifications",
      "--start-maximized",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    defaultViewport: null,
  });
}

export async function safeGoto(page: Page, url: string, retries = 3): Promise<Page> {
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      return page;
    } catch (e: any) {
      logger.warn(`safeGoto attempt ${i + 1} failed for ${url}: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return page;
}

export async function blockUnnecessaryRequests(page: Page): Promise<void> {
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  } catch (e) {
    logger.debug("Request interception already enabled or failed to set.");
  }
}
