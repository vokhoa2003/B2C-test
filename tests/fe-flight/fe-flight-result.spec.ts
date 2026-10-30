import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { openResultAndCapture, saveResponses, SystemResponse } from "./lib/searchCapture";
import { buildExpectedCards } from "./lib/expectedCards";
import { readCards, loadAllCards, CARD_SELECTOR } from "./lib/resultReader";
import { compareCards } from "./lib/compareCards";
import { CaseReport, writeReport } from "./lib/report";
import CASES from "./cases.json";

/**
 * FE flight — Mốc 1: card trang kết quả 1 chiều so với response API mà chính trang đó nhận.
 * Chạy: yarn fe:flight (xem tests/fe-flight/README.md).
 */

type Case = { id: string; description: string; from: string; to: string; departDate: string; adults: number; children: number; infants: number; fixture?: string };

const WEB_URL = (process.env.FE_FLIGHT_WEB_URL || process.env.META_COMPARE_WEB_URL || "https://dev.triphubs.vn").replace(/\/+$/, "");
const ROOT = path.join(__dirname, "..", "..", ".test-state", "fe-flight");
const RUN_DIR = process.env.FE_FLIGHT_RUN_DIR || path.join(ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
const MAX_CARDS = Number(process.env.FE_FLIGHT_MAX_CARDS) || CASES.maxCards || 400;
const MAX_SHOTS = 20;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

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

function buildCases(): Case[] {
  if (process.env.FE_FLIGHT_FIXTURE) return [fixtureCase(path.resolve(process.env.FE_FLIGHT_FIXTURE))];
  if (process.env.FE_FLIGHT_FROM && process.env.FE_FLIGHT_TO) {
    return [{
      id: "CUSTOM",
      description: "Chỉ định từ dòng lệnh",
      from: process.env.FE_FLIGHT_FROM.toUpperCase(),
      to: process.env.FE_FLIGHT_TO.toUpperCase(),
      departDate: process.env.FE_FLIGHT_DEPART || daysFromNow(14),
      adults: Number(process.env.FE_FLIGHT_ADT ?? 1),
      children: Number(process.env.FE_FLIGHT_CHD ?? 0),
      infants: Number(process.env.FE_FLIGHT_INF ?? 0),
    }];
  }
  const only = (process.env.FE_FLIGHT_CASES || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return CASES.cases
    .filter((c) => !only.length || only.some((o) => c.id.toUpperCase().startsWith(o)))
    .map(({ daysAhead, ...c }) => ({ ...c, departDate: daysFromNow(daysAhead) }));
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

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

const reports: CaseReport[] = [];

test.afterAll(() => {
  if (!reports.length) return;
  const file = writeReport(RUN_DIR, reports);
  console.log(`\n📄 Báo cáo: ${file}`);
});

for (const c of buildCases()) {
  test(`${c.id} ${c.from}→${c.to} ${c.departDate} ${c.adults}NL ${c.children}TE ${c.infants}EB`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const dir = path.join(RUN_DIR, c.id);
    fs.mkdirSync(dir, { recursive: true });
    const url = resultUrl(c);
    const report: CaseReport = {
      id: c.id,
      description: `${c.description} · ${c.from}→${c.to} ${c.departDate} · ${c.adults} NL ${c.children} TE ${c.infants} EB`,
      url,
      fixture: c.fixture,
      searchedAt: new Date().toLocaleString("vi-VN"),
      ms: 0,
      error: "",
      systems: [],
    };
    reports.push(report);

    const capture = await openResultAndCapture(page, url, { fixtureDir: c.fixture });
    Object.assign(report, { ms: capture.ms, error: capture.error, systems: systemsOf(capture.responses) });
    if (!c.fixture) saveResponses(path.join(dir, "responses"), capture.responses);
    console.log(`${c.id}: ${capture.responses.length} system, tải ${(capture.ms / 1000).toFixed(1)}s${capture.error ? ` — ${capture.error}` : ""}`);
    if (capture.error) {
      await page.screenshot({ path: path.join(dir, "page.png"), fullPage: false }).catch(() => {});
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

    console.log(
      `${c.id}: card UI ${summary.uiCards} · API ${summary.apiCards} · khớp ${summary.ok} · lệch ${summary.mismatched} · ` +
        `không có trong API ${summary.notInApi}${loadedAll ? ` · UI không hiện ${summary.missingOnUi.length}` : " · chưa cuộn hết"}`
    );
    expect.soft(summary.mismatched, "card lệch so với API").toBe(0);
    expect.soft(summary.notInApi, "card không có trong API").toBe(0);
  });
}
