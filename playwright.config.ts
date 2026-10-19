import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const START_WEB_SERVER = process.env.START_WEB_SERVER === "true";

export default defineConfig({
  testDir: "./tests",
  // Môi trường dev chậm (Next.js dev mode compile on-demand) nên nới timeout
  // rộng hơn mức mặc định để tránh fail giả do chờ phản hồi lâu.
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Mỗi test case được gọi lại tối đa 9 lần nếu fail (1 lần chạy đầu + 9 lần
  // retry = tối đa 10 lần/luồng) để chịu được flaky do tốc độ máy/dev server.
  retries: 9,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { open: "never" }],
    ["list"],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "vi-VN",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],

  // Tự động start dev server của web-user khi chạy test, nếu bật START_WEB_SERVER=true trong .env
  webServer: START_WEB_SERVER
    ? {
        command: "yarn dev",
        cwd: "../traveleasy-web-user",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
