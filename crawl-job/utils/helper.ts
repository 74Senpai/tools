import { Page } from "puppeteer";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function takeThreeScreenshots(page: Page | null): Promise<Buffer[]> {
  if (!page || page.isClosed()) return [];
  const buffers: Buffer[] = [];
  try {
    const screenshot = await page.screenshot({ fullPage: false });
    if (screenshot instanceof Buffer) {
      buffers.push(screenshot);
    }
  } catch (e) {}
  return buffers;
}

export async function sendTelegram(options: { text: string; imageBuffers?: Buffer[] }): Promise<void> {
  // Graceful no-op when Telegram bot token is not configured
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log(`[Telegram] ${options.text}`);
  }
}
