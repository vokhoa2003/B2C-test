import fs from "fs";
import path from "path";
import { Browser, BrowserContext, Page } from "@playwright/test";
import { FareItem } from "./metasearchCompareV2";

/**
 * Bước "đặt chỗ" của tool metasearch v2: mở deeplink từng item meta trên web, đợi kết quả rồi ghi lại trang có chuyển
 * thành công không, kèm thông báo hoặc giá mới nếu có. Không so giá, không điền hành khách, không tạo đơn.
 *
 * Nghiệp vụ lấy từ traveleasy-cms (src/modules/metasearch/docs/caching.md §4, §6, §7) và traveleasy-web-user
 * (useMetasearchBookingDeeplink.ts) — đã đọc để chốt:
 * - Trang đặt chỗ gọi POST /v1/flights/metasearch/booking. Backend search lại vendor và tự so giá với `total_amount`.
 * - Phiên chỉ sống một thời gian ngắn kể từ lúc search (`sessionTtlSeconds`) và không gia hạn, nên bước này tự search
 *   meta lại; hết phiên giữa chừng thì search tiếp và chạy phần còn lại. "HẾT PHIÊN" không tính là lỗi.
 * - Mọi lỗi trên web đều hiện chung 1 popup, nên phân loại theo response API: `20001` = đổi giá (kèm giá cũ/mới),
 *   404 = hết phiên hoặc offer không còn.
 * - Deeplink meta trỏ tới production (`deeplink.booking.baseUrl`), nên luôn đổi host sang web đang test và chặn mọi
 *   request tới production. Deeplink không có `skyscanner_redirectid` nên backend không gửi gì sang Skyscanner.
 */

export type BookingStatus = "OK" | "GIÁ ĐỔI" | "HẾT CHUYẾN" | "LỖI" | "HẾT PHIÊN" | "KHÔNG CÒN TRONG SEARCH";

export type BookingRow = {
  key: string;
  system: string;
  flights: string;
  status: BookingStatus;
  /** Thông báo backend hoặc popup trên trang. */
  note: string;
  /** Giá meta báo (`total_amount` của deeplink). */
  metaTotal: number | null;
  /** Giá mới backend trả khi đổi giá. */
  newTotal: number | null;
  apiStatus: number | null;
  apiCode: number | null;
  apiMs: number | null;
  /** Body response lỗi (cắt ngắn) để tra nguyên nhân. */
  apiError?: string;
  /** Mở sau khi search bao lâu (giây) — để đọc được lỗi có liên quan tới hết phiên không. */
  sinceSearchS: number;
  url: string;
  screenshot?: string;
};

export type BookingSummary = {
  /** Số item meta trả về / số item chọn kiểm. */
  items: number;
  planned: number;
  ok: number;
  priceChanged: number;
  offerGone: number;
  errors: number;
  expired: number;
  notFound: number;
  /** Số lần search meta thêm cho bước này. */
  searches: number;
  ms: number;
  rows: BookingRow[];
};

export type BookingOptions = {
  browser: Browser;
  webUrl: string;
  /** Search meta mới, trả về item kèm deeplink. */
  search: () => Promise<FareItem[]>;
  /** null = mọi item. */
  limit: number | null;
  concurrency: number;
  /** Thư mục lưu ảnh màn hình deeplink trỏ tới của từng item. */
  shotDir: string;
  log: (message: string) => void;
};

const BOOKING_API = "/v1/flights/metasearch/booking";
const PRODUCTION_HOST = "traveleasy.vn";
const PRICE_INCONSISTENCY = 20001;
/** Gồm cả thời gian backend search lại vendor. */
const API_TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 30_000;
const POPUP_TIMEOUT_MS = 5_000;
const VOUCHER_API = "/vouchers/get-all";
const VOUCHER_TIMEOUT_MS = 20_000;
/** Sau request voucher cuối, đợi thêm chừng này mà không có request mới thì coi như trang đã chốt giá. */
const VOUCHER_QUIET_MS = 2_500;
const MAX_NOTE = 300;
const SHOT_QUALITY = 60;

const params = (item: FareItem) => new URL(item.deeplinks!).searchParams;
const isProduction = (host: string) => host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`);
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));

/** Trang đặt chỗ phải chạy trên web test; click thật ghi vào bảng meta_search nên không chạy trên production. */
export function assertTestWeb(webUrl: string): void {
  if (isProduction(new URL(webUrl).hostname)) throw new Error(`Bước đặt chỗ không chạy trên production (${webUrl})`);
}

/** Đổi host deeplink sang web test và gắn utm_campaign để lọc được click do tool tạo trong báo cáo dev. */
export function toTestUrl(deeplink: string, webUrl: string): string {
  const url = new URL(deeplink);
  const web = new URL(webUrl);
  url.protocol = web.protocol;
  url.host = web.host;
  url.searchParams.set("utm_campaign", "auto-test");
  return url.toString();
}

/** Khoá item giữa các lần search: flight_uid đổi mỗi lần, nên so theo hành trình + hạng vé trong deeplink. */
export function itemKey(item: FareItem): string {
  return [...params(item)]
    .filter(([k]) => /^(out|in)_/.test(k) || k === "pricing_mode")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

const flightsOf = (item: FareItem) => (item.flights ?? []).map((l) => l.segments.map((s) => s.flightNumber).join("-")).join(" + ");
const systemOf = (item: FareItem) => {
  const p = params(item);
  return [p.get("out_system"), p.get("in_system")].filter(Boolean).join(" + ") || String(item.system ?? "?");
};

const emptyRow = (item: FareItem, status: BookingStatus, note: string, sinceSearchS: number, url = ""): BookingRow => ({
  key: itemKey(item), system: systemOf(item), flights: flightsOf(item), status, note,
  metaTotal: Number(params(item).get("total_amount")) || null, newTotal: null, apiStatus: null, apiCode: null, apiMs: null,
  sinceSearchS, url,
});

/** Có giới hạn số item: chia đều theo system, trong mỗi system lấy từ rẻ tới đắt. */
export function pickItems(items: FareItem[], limit: number | null): FareItem[] {
  if (limit === null || items.length <= limit) return items;
  const groups = new Map<string, FareItem[]>();
  for (const item of [...items].sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))) {
    const system = systemOf(item);
    groups.set(system, [...(groups.get(system) ?? []), item]);
  }
  const picked: FareItem[] = [];
  for (let i = 0; picked.length < limit; i++) {
    for (const list of groups.values()) if (list[i] && picked.length < limit) picked.push(list[i]);
  }
  return picked;
}

function classifyApiError(code: number, status: number, body: any): Pick<BookingRow, "status" | "note" | "newTotal"> {
  const message = String(body?.message ?? body?.error ?? "");
  if (code === PRICE_INCONSISTENCY) {
    const data = body?.data ?? {};
    return { status: "GIÁ ĐỔI", note: `Giá ${fmt(data.old?.total)} → ${fmt(data.new?.total)}`, newTotal: data.new?.total ?? null };
  }
  if (/expired/i.test(message)) return { status: "HẾT PHIÊN", note: message, newTotal: null };
  if (code === 404 || status === 404) return { status: "HẾT CHUYẾN", note: message, newTotal: null };
  return { status: "LỖI", note: `API ${status}/${code}: ${message}`.slice(0, MAX_NOTE), newTotal: null };
}

/**
 * Web tải voucher theo thị trường: lúc mount chưa có chuyến, chuyến về sau đó mới gọi lại đúng thị trường, nên trang
 * đứng yên vài giây ở giá tạm. Đợi xong để ảnh không chụp phải giá tạm.
 */
function watchVouchers(page: Page) {
  const state = { calls: 0, inFlight: 0, lastAt: Date.now() };
  const isVoucher = (r: { url(): string; method(): string }) => r.url().includes(VOUCHER_API) && r.method() === "POST";
  page.on("request", (r) => {
    if (!isVoucher(r)) return;
    state.calls++;
    state.inFlight++;
    state.lastAt = Date.now();
  });
  const done = (r: { url(): string; method(): string }) => {
    if (!isVoucher(r)) return;
    state.inFlight--;
    state.lastAt = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return async () => {
    const deadline = Date.now() + VOUCHER_TIMEOUT_MS;
    while (Date.now() < deadline && (state.calls === 0 || state.inFlight > 0 || Date.now() - state.lastAt < VOUCHER_QUIET_MS)) {
      await page.waitForTimeout(200);
    }
  };
}

async function openItem(context: BrowserContext, item: FareItem, webUrl: string, searchedAt: number): Promise<BookingRow> {
  const url = toTestUrl(item.deeplinks!, webUrl);
  const row = emptyRow(item, "LỖI", "", Math.round((Date.now() - searchedAt) / 1000), url);
  const page = await context.newPage();
  try {
    const started = Date.now();
    const vouchersSettled = watchVouchers(page);
    const api = page
      .waitForResponse((r) => r.url().includes(BOOKING_API) && r.request().method() === "POST", { timeout: API_TIMEOUT_MS })
      .catch(() => null);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const res = await api;
    if (!res) {
      row.note = `Trang không gọi ${BOOKING_API} sau ${API_TIMEOUT_MS / 1000}s`;
      return row;
    }
    row.apiMs = Date.now() - started;
    row.apiStatus = res.status();
    const text = await res.text().catch(() => "");
    const body = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    const code = Number(body?.errorCode ?? body?.code ?? 0);
    row.apiCode = code || null;
    if (!res.ok() || (code >= 400 && code !== 200)) {
      Object.assign(row, classifyApiError(code, res.status(), body));
      row.apiError = text.slice(0, MAX_NOTE);
      const popup = await page.locator(".te-result-title").first().textContent({ timeout: POPUP_TIMEOUT_MS }).catch(() => null);
      if (popup) row.note = `${row.note} · Popup: ${popup.trim()}`.slice(0, MAX_NOTE);
      return row;
    }
    await page.locator(".passenger__order--price").waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
    await vouchersSettled();
    row.status = "OK";
    return row;
  } catch (error) {
    row.note = `Trang không load xong: ${(error as Error).message.split("\n")[0]}`.slice(0, MAX_NOTE);
    return row;
  } finally {
    // HẾT PHIÊN: item được mở lại ở lần search sau nên không cần ảnh.
    if (row.status !== "HẾT PHIÊN") {
      const shots = shotsOf(context);
      const name = `${String(++shots.count).padStart(4, "0")}.jpg`;
      const saved = await page.screenshot({ path: path.join(shots.dir, name), type: "jpeg", quality: SHOT_QUALITY }).catch(() => null);
      if (saved) row.screenshot = name;
    }
    await page.close().catch(() => {});
  }
}

type ShotDir = { dir: string; count: number };
const shotDirs = new WeakMap<BrowserContext, ShotDir>();
const shotsOf = (context: BrowserContext) => shotDirs.get(context)!;

/** Mỗi luồng 1 context riêng: localStorage "flights" dùng chung trong context, mở song song sẽ ghi đè nhau. */
async function newBookingContext(browser: Browser, shotDir: ShotDir): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
  await context.route((url) => isProduction(url.hostname), (route) => route.abort());
  shotDirs.set(context, shotDir);
  return context;
}

export async function runBookingCheck(opts: BookingOptions): Promise<BookingSummary> {
  const started = Date.now();
  const rows: BookingRow[] = [];
  fs.mkdirSync(opts.shotDir, { recursive: true });
  const usable = (items: FareItem[]) => items.filter((i) => i.deeplinks);

  let searches = 1;
  let searchedAt = Date.now();
  let current = usable(await opts.search());
  const total = current.length;
  const pending = new Map(pickItems(current, opts.limit).map((i) => [itemKey(i), i]));
  const planned = pending.size;
  const shots: ShotDir = { dir: opts.shotDir, count: 0 };
  const contexts = await Promise.all(Array.from({ length: opts.concurrency }, () => newBookingContext(opts.browser, shots)));

  try {
    while (pending.size) {
      const byKey = new Map(current.map((i) => [itemKey(i), i]));
      // Search mới không còn item này: không mở được, ghi lại chứ không tính là lỗi trang đặt chỗ.
      for (const [key, item] of pending) {
        if (byKey.has(key)) continue;
        rows.push(emptyRow(item, "KHÔNG CÒN TRONG SEARCH", "Lần search sau không trả item này", 0));
        pending.delete(key);
      }
      const queue = [...pending.keys()].map((key) => byKey.get(key)!);
      let expired = false;
      let progress = 0;
      await Promise.all(
        contexts.map(async (context) => {
          while (queue.length && !expired) {
            const row = await openItem(context, queue.shift()!, opts.webUrl, searchedAt);
            if (row.status === "HẾT PHIÊN") {
              expired = true;
              continue;
            }
            rows.push(row);
            pending.delete(row.key);
            progress++;
            opts.log(`    đặt chỗ ${rows.length}/${planned} ${row.system} ${row.flights}: ${row.status}${row.note ? ` — ${row.note}` : ""}`);
          }
        })
      );
      if (!pending.size) break;
      // Không xong item nào trong 1 phiên (search + mở trang lâu hơn thời hạn phiên): dừng, tránh search lặp vô hạn.
      if (!progress) {
        for (const item of pending.values()) {
          rows.push(emptyRow(item, "HẾT PHIÊN", "Phiên hết trước khi mở được item", Math.round((Date.now() - searchedAt) / 1000)));
        }
        break;
      }
      opts.log(`    hết phiên sau ${Math.round((Date.now() - searchedAt) / 1000)}s, còn ${pending.size} item → search meta lại`);
      searches++;
      searchedAt = Date.now();
      current = usable(await opts.search());
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }

  const count = (status: BookingStatus) => rows.filter((r) => r.status === status).length;
  return {
    items: total, planned,
    ok: count("OK"), priceChanged: count("GIÁ ĐỔI"), offerGone: count("HẾT CHUYẾN"),
    errors: count("LỖI"), expired: count("HẾT PHIÊN"), notFound: count("KHÔNG CÒN TRONG SEARCH"),
    searches, ms: Date.now() - started, rows,
  };
}

/** Phần thêm vào kết luận của điều kiện; rỗng khi không có gì đáng báo. */
export function bookingVerdict(s: BookingSummary | undefined): string {
  if (!s) return "";
  const parts = [
    s.priceChanged && `đổi giá ${s.priceChanged}`,
    s.errors && `lỗi ${s.errors}`,
    s.offerGone && `hết chuyến ${s.offerGone}`,
    s.expired && `chưa kiểm được ${s.expired} (hết phiên)`,
  ].filter(Boolean);
  return parts.length ? `đặt chỗ: ${parts.join(", ")}` : "";
}
