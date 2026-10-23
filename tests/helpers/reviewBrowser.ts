import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Browser, BrowserContext, chromium } from "@playwright/test";

/**
 * Browser cho chế độ review (`yarn compare:metasearch --review`): mở Chromium của Playwright
 * như 1 tiến trình RIÊNG (detached) rồi điều khiển qua CDP. Khi test kết thúc, Playwright chỉ
 * ngắt kết nối — browser và mọi tab vẫn mở để người dùng xem lại.
 *
 * Mỗi lần chạy 1 profile riêng (không đụng profile Chrome cá nhân, không xung đột với cửa sổ
 * review của lần chạy trước). Cổng debug do Chrome tự chọn (--remote-debugging-port=0) và ghi
 * vào file DevToolsActivePort trong profile.
 */
export async function launchReviewBrowser(
  runDir: string,
  profileName = "review-browser-profile"
): Promise<{ browser: Browser; context: BrowserContext }> {
  const profileDir = path.join(runDir, profileName);
  fs.mkdirSync(profileDir, { recursive: true });
  // File cổng cũ (browser trước đã đóng) sẽ làm kết nối nhầm cổng chết.
  fs.rmSync(path.join(profileDir, "DevToolsActivePort"), { force: true });

  const child = spawn(
    chromium.executablePath(),
    [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      "--lang=vi-VN",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, "utf-8").trim()) {
    if (Date.now() > deadline) throw new Error(`Không mở được browser review (thiếu ${portFile})`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const port = fs.readFileSync(portFile, "utf-8").split("\n")[0].trim();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return { browser, context: browser.contexts()[0] };
}

/** Đặt tiêu đề tab để dễ tìm (VD "[cond-1 META] HAN→PQC"). Trang SPA có thể đổi lại title khi điều hướng. */
export async function labelTab(page: import("@playwright/test").Page, label: string) {
  await page.evaluate((l) => (document.title = `${l} · ${document.title}`), label).catch(() => {});
}
