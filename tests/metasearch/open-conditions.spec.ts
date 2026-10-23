import fs from "fs";
import path from "path";
import { test } from "@playwright/test";
import { MetasearchToolPage } from "../pages/metasearch/MetasearchToolPage";
import { labelTab, launchReviewBrowser } from "../helpers/reviewBrowser";

/**
 * Mở lại điều kiện của 1 lần chạy đã có để ĐỐI CHIẾU THỦ CÔNG — KHÔNG so sánh, không ghi báo cáo:
 * mỗi điều kiện 2 tab trong 1 Chrome riêng, chạy xong vẫn mở:
 *   [cond-N META] trang tool metasearch đã đăng nhập, điền đúng điều kiện và bấm Search (live)
 *   [cond-N WEB]  trang kết quả dev.triphubs.vn cùng điều kiện (live)
 *
 * Trang tool metasearch không nhận điều kiện qua URL nên phải thao tác form như người dùng.
 * Chạy qua: yarn compare:metasearch:open <số | latest | tên thư mục> [--cond cond-2]
 * (scripts/metasearch-reports.js đặt META_OPEN_RUN_DIR / META_OPEN_CONDS). Không có env → skip.
 */
const META_API_URL = (process.env.META_API_URL || "https://api-dev.triphubs.vn").replace(/\/+$/, "");

test("mở lại điều kiện để đối chiếu thủ công", async ({}, testInfo) => {
  const runDir = process.env.META_OPEN_RUN_DIR;
  test.skip(!runDir || testInfo.project.name !== "chromium", "Chỉ chạy qua yarn compare:metasearch:open");
  const clientId = process.env.META_CLIENT_ID;
  const username = process.env.META_USERNAME;
  const password = process.env.META_PASSWORD;
  test.skip(!clientId || !username || !password, "Thiếu META_CLIENT_ID / META_USERNAME / META_PASSWORD trong .env");

  const wanted = (process.env.META_OPEN_CONDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const rawDir = path.join(runDir!, "raw");
  const conditions = fs
    .readdirSync(rawDir)
    .filter((f) => f.endsWith("-meta.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(rawDir, f), "utf-8")))
    .filter((m) => !wanted.length || wanted.includes(m.condition.id))
    .sort((a, b) => a.condition.id.localeCompare(b.condition.id, undefined, { numeric: true }));
  if (!conditions.length) throw new Error(`Không tìm thấy điều kiện ${wanted.join(", ") || ""} trong ${rawDir}`);
  test.setTimeout(conditions.length * 4 * 60_000);

  const { context } = await launchReviewBrowser(runDir!, `open-browser-${Date.now()}`);
  for (const m of conditions) {
    const c = m.condition;
    const route = `${c.from}${c.itinerary ? "<->" : "->"}${c.to}`;
    const webUrl = JSON.parse(fs.readFileSync(path.join(rawDir, `${c.id}-web.json`), "utf-8")).url;

    await test.step(`${c.id} ${route}`, async () => {
      const metaPage = await context.newPage();
      const webPage = await context.newPage();
      const tool = new MetasearchToolPage(metaPage, META_API_URL);
      await Promise.all([
        (async () => {
          await tool.goto();
          await tool.login({ clientId: clientId!, username: username!, password: password! });
          await tool.searchAndCapture(m.request, 5 * 60_000);
        })(),
        webPage.goto(webUrl, { timeout: 120_000 }),
      ]);
      await labelTab(metaPage, `[${c.id} META] ${route}`);
      await labelTab(webPage, `[${c.id} WEB] ${route}`);
      console.log(`[metasearch-open] ${c.id} ${route} ${c.departDate}${c.returnDate ? " / " + c.returnDate : ""} — đã mở META + WEB`);
    });
  }
  console.log(`[metasearch-open] Browser vẫn mở (${conditions.length * 2} tab). Đóng khi xem xong.`);
});
