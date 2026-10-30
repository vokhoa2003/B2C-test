import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { openResultAndCapture, saveResponses, SystemResponse } from "./lib/searchCapture";
import { buildExpectedCards } from "./lib/expectedCards";
import { readCards, loadAllCards, CARD_SELECTOR } from "./lib/resultReader";
import { compareCards } from "./lib/compareCards";
import { CaseReport, caseState, writeReport } from "./lib/report";
import { Condition, appendHistory, buildConditions, historyKey } from "./lib/conditions";
import CONFIG from "./cases.json";

/**
 * FE flight — Mốc 1: card trang kết quả 1 chiều so với response API mà chính trang đó nhận.
 * Điều kiện search sinh theo pattern metasearch v2 (lib/conditions.ts). Chạy: yarn fe:flight (xem README).
 */

type Case = Condition;

const WEB_URL = (process.env.FE_FLIGHT_WEB_URL || process.env.META_COMPARE_WEB_URL || "https://dev.triphubs.vn").replace(/\/+$/, "");
const ROOT = path.join(__dirname, "..", "..", ".test-state", "fe-flight");
// Đặt vào env ở tiến trình chính để worker (được tạo sau) dùng CHUNG thư mục + bộ điều kiện đã chốt.
process.env.FE_FLIGHT_RUN_DIR ||= path.join(ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
const RUN_DIR = process.env.FE_FLIGHT_RUN_DIR;
const MAX_CARDS = Number(process.env.FE_FLIGHT_MAX_CARDS) || CONFIG.maxCards || 400;
const MAX_SHOTS = 20;
const paxText = (c: Case) => `${c.adults} NL ${c.children} TE ${c.infants} EB`;

/** Fixture: lấy điều kiện search từ request đã lưu trong thư mục (file đầu tiên có request). */
function fixtureCase(dir: string): Case {
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).request);
  if (!file) throw new Error(`Thư mục fixture không có file response nào có "request": ${dir}`);
  const req = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).request;
  const leg = req.flights[0];
  return {
    id: "FIXTURE",
    description: `Fixture ${path.basename(dir)}`,
    from: leg.startPoint,
    to: leg.endPoint,
    departDate: leg.departDate,
    adults: req.adt,
    children: req.chd,
    infants: req.inf,
    fixture: dir,
  };
}

/**
 * Điều kiện của lần chạy: sinh 1 lần rồi ghi `<RUN_DIR>/conditions.json`. Playwright nạp file spec ở tiến
 * trình chính VÀ ở worker (nạp lại sau mỗi test lỗi) — đọc lại file này để mọi lần nạp ra đúng cùng bộ
 * điều kiện ngẫu nhiên.
 */
function buildCases(): Case[] {
  const file = path.join(RUN_DIR, "conditions.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")).conditions;

  let cases: Case[];
  let notes: string[] = [];
  if (process.env.FE_FLIGHT_FIXTURE) {
    cases = [fixtureCase(path.resolve(process.env.FE_FLIGHT_FIXTURE))];
  } else {
    const env = process.env;
    const pax = env.FE_FLIGHT_ADT || env.FE_FLIGHT_CHD || env.FE_FLIGHT_INF
      ? { adults: Number(env.FE_FLIGHT_ADT || 1), children: Number(env.FE_FLIGHT_CHD || 0), infants: Number(env.FE_FLIGHT_INF || 0) }
      : null;
    ({ conditions: cases, notes } = buildConditions({
      count: Number(env.FE_FLIGHT_COUNT) || CONFIG.conditionsPerRun || 5,
      cases: (env.FE_FLIGHT_CASES || "").split(",").map((s) => s.trim()).filter(Boolean),
      routeType: (env.FE_FLIGHT_ROUTE as "domestic" | "international" | undefined) || "all",
      pax,
      near24h: env.FE_FLIGHT_24H === "1",
      ignoreHistory: env.FE_FLIGHT_REPEAT === "1",
      custom: env.FE_FLIGHT_FROM && env.FE_FLIGHT_TO
        ? { from: env.FE_FLIGHT_FROM.toUpperCase(), to: env.FE_FLIGHT_TO.toUpperCase(), departDate: env.FE_FLIGHT_DEPART || undefined }
        : null,
    }));
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ conditions: cases, notes }, null, 1));
  for (const n of notes) console.log(`ℹ ${n}`);
  for (const c of cases) {
    console.log(`• ${c.id}  ${c.from}→${c.to} ${c.departDate}  ${paxText(c)}${c.repeated ? "  (đã kiểm chặng này trước đây)" : ""}\n    ${c.description}`);
  }
  return cases;
}

const resultUrl = (c: Case) =>
  `${WEB_URL}/vi/flights/result?${new URLSearchParams({
    adult: String(c.adults),
    child: String(c.children),
    infant: String(c.infants),
    itinerary: "0",
    f1: c.from,
    t1: c.to,
    df1: c.departDate,
    class: "economy",
  })}`;

const systemsOf = (responses: SystemResponse[]) =>
  responses.map((r) => ({ system: r.system, status: r.status, ms: r.ms, fareCount: r.response?.fareData?.length ?? 0, error: r.error }));

// Không dùng mode "serial": 1 case lệch sẽ làm Playwright bỏ qua các case sau. Runner chạy 1 worker nên
// vẫn tuần tự; worker bị khởi động lại sau case lỗi nên báo cáo dựng lại từ file của từng case.
test.use({ viewport: { width: 1440, height: 900 } });

/** Ghi báo cáo của 1 case ra `<case>/case-report.json` rồi dựng lại report.html từ mọi case đã xong. */
function saveCaseReport(report: CaseReport) {
  fs.writeFileSync(path.join(RUN_DIR, report.id, "case-report.json"), JSON.stringify(report));
  const all = CONDITIONS.map((c) => path.join(RUN_DIR, c.id, "case-report.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as CaseReport);
  const file = writeReport(RUN_DIR, all);
  console.log(`📄 Báo cáo (${all.length}/${CONDITIONS.length} case): ${file}`);
}

let finishCurrent: ((error?: string) => void) | null = null;
test.afterEach(({}, testInfo) => {
  finishCurrent?.(testInfo.error?.message?.split("\n")[0]);
  finishCurrent = null;
});

const CONDITIONS = buildCases();
if (process.env.FE_FLIGHT_DRY_RUN === "1") {
  // --dry-run: chỉ in điều kiện (đã in ở buildCases), không mở trình duyệt.
  test("dry-run", () => test.skip(true, "dry-run"));
} else if (!CONDITIONS.length) {
  test("không có điều kiện", () => test.skip(true, "không có mẫu nào khớp bộ lọc"));
}

for (const c of process.env.FE_FLIGHT_DRY_RUN === "1" ? [] : CONDITIONS) {
  test(`${c.id} ${c.from}→${c.to} ${c.departDate} ${paxText(c)}`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const dir = path.join(RUN_DIR, c.id);
    fs.mkdirSync(dir, { recursive: true });
    const url = resultUrl(c);
    const report: CaseReport = {
      id: c.id,
      description: `${c.description} · ${c.departDate} · ${paxText(c)}`,
      url,
      fixture: c.fixture,
      searchedAt: new Date().toLocaleString("vi-VN"),
      ms: 0,
      error: "",
      systems: [],
    };
    // Xong (kể cả lỗi): ghi báo cáo + lịch sử (lần sau ưu tiên chặng chưa kiểm — fixture không ghi lịch sử).
    // Gọi 1 lần; lỗi bất ngờ (throw giữa chừng) thì afterEach gọi kèm thông báo lỗi.
    let finished = false;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      if (error && !report.error && !report.summary) report.error = error;
      saveCaseReport(report);
      if (c.fixture) return;
      appendHistory({
        key: historyKey(c.from, c.to),
        template: c.template,
        from: c.from,
        to: c.to,
        departDate: c.departDate,
        pax: paxText(c),
        state: caseState(report),
        runDir: path.basename(RUN_DIR),
        at: new Date().toISOString(),
      });
    };
    finishCurrent = finish;

    const capture = await openResultAndCapture(page, url, { fixtureDir: c.fixture });
    Object.assign(report, { ms: capture.ms, error: capture.error, systems: systemsOf(capture.responses) });
    if (!c.fixture) saveResponses(path.join(dir, "responses"), capture.responses);
    console.log(`${c.id}: ${capture.responses.length} system, tải ${(capture.ms / 1000).toFixed(1)}s${capture.error ? ` — ${capture.error}` : ""}`);
    if (capture.error) {
      await page.screenshot({ path: path.join(dir, "page.png"), fullPage: false }).catch(() => {});
      finish();
      throw new Error(capture.error);
    }

    const loadedAll = await loadAllCards(page, MAX_CARDS);
    const uiCards = await readCards(page);
    const { cards: expected, skipped } = buildExpectedCards(capture.responses, c);
    const { rows, summary } = compareCards(uiCards, expected, loadedAll);
    Object.assign(report, { rows, summary, skipped });

    // Chụp ảnh card có vấn đề để đối chiếu nhanh.
    let shots = 0;
    for (const r of rows) {
      if (r.status === "KHỚP" || shots >= MAX_SHOTS) continue;
      const file = path.join(dir, `card-${r.ui.index + 1}.png`);
      const ok = await page.locator(CARD_SELECTOR).nth(r.ui.index).screenshot({ path: file, timeout: 10_000 }).then(() => true, () => false);
      if (ok) {
        r.screenshot = file;
        shots++;
      }
    }
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ case: c, url, summary, skipped, rows }, null, 1));
    finish();

    console.log(
      `${c.id}: card UI ${summary.uiCards} · API ${summary.apiCards} · khớp ${summary.ok} · lệch ${summary.mismatched} · ` +
        `không có trong API ${summary.notInApi}${loadedAll ? ` · UI không hiện ${summary.missingOnUi.length}` : " · chưa cuộn hết"}`
    );
    expect.soft(summary.mismatched, "card lệch so với API").toBe(0);
    expect.soft(summary.notInApi, "card không có trong API").toBe(0);
  });
}
