import { test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { loginWebApi } from "../helpers/webSearchClient";
import { HotelApiClient, mapLimit, type HotelDetailResult, type HotelLocation, type HotelSearchResult } from "../helpers/hotelApiClient";
import {
  cheapestRoom,
  fmt,
  policyWarnings,
  selectHotelMarkupPolicy,
  stepsToText,
  tmsDetailPerNight,
  tmsListPrice,
  tmsStayTotal,
  webBooking,
  webDetailPerNight,
  webListPrice,
  type HotelFeePolicy,
  type HotelRecord,
  type MarkupContext,
} from "../helpers/hotelPricing";
import { listDetailGap, rerunCommand, writeHotelPriceReport, type HotelCondition, type HotelRow, type SystemHotelCalc, type SystemSearchInfo } from "../helpers/hotelPriceReport";

/**
 * Hiển thị giá khách sạn theo công thức của WEB (traveleasy-web-user) và TMS (tms_user) — KHÔNG so sánh,
 * chỉ show từng bước: giá gốc API → markup policy → giá hiển thị (list, detail, booking).
 *
 * Mỗi điều kiện: 1 template (số phòng/khách/đêm) + 1 địa điểm ngẫu nhiên → search lấy 10–30 khách sạn
 * → mở detail từng khách sạn → tính lại giá. Chạy qua `yarn hotel:price` (scripts/hotel-price.js đổi cờ
 * thành biến môi trường HOTEL_*). Kết quả: .test-state/hotel-price/<thời gian chạy>/report.html.
 *
 * Token: WEB dùng chung token tool flight — WEB_API_TOKEN (hoặc WEB_API_CLIENT_ID/USERNAME/PASSWORD).
 * TMS dùng TMS_API_TOKEN (hoặc TMS_API_CLIENT_ID/USERNAME/PASSWORD) — client khác → feePolicies khác.
 * Không có token TMS: dùng chung token WEB/flight (cùng dữ liệu + feePolicies, report ghi rõ).
 */

type Template = {
  id: string;
  description: string;
  rooms: number;
  adults: number;
  children: number;
  childrenAges?: number[];
  nights: [number, number];
  daysAhead: [number, number];
  region?: "domestic" | "international";
};
type Config = {
  conditionsPerRun: number;
  hotelsPerCondition: number;
  minHotels: number;
  maxHotels: number;
  fetchDetail: boolean;
  detailConcurrency: number;
  timeoutMs: number;
  locations: { domestic: string[]; international: string[] };
  templates: Template[];
};

const DATA: Config = JSON.parse(fs.readFileSync(path.join(__dirname, "hotel-price.json"), "utf-8"));
const env = process.env;
const API_URL = (env.HOTEL_API_URL || env.WEB_API_URL || "https://api-dev.triphubs.vn").replace(/\/+$/, "");
/** API hotel của TMS (tms_user: NEXT_PUBLIC_API_BASE, gọi `{url}/hotel/...`). */
const TMS_API_URL = (env.TMS_API_URL || API_URL).replace(/\/+$/, "");
/** Đăng nhập lấy token TMS (`POST {url}/auth/login`) — mặc định cùng TMS_API_URL. */
const TMS_AUTH_URL = (env.TMS_AUTH_URL || TMS_API_URL).replace(/\/+$/, "").replace(/\/auth\/login$/i, "");
const HOTELS = Math.min(DATA.maxHotels, Math.max(DATA.minHotels, Number(env.HOTEL_COUNT) || DATA.hotelsPerCondition));
const FETCH_DETAIL = env.HOTEL_NO_DETAIL === "1" ? false : DATA.fetchDetail;
const OUT_ROOT = path.join(__dirname, "..", "..", ".test-state", "hotel-price");

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
};

/** Điều kiện sẽ chạy: cờ dòng lệnh (HOTEL_*) ghi đè từng phần của template ngẫu nhiên. */
function buildConditions() {
  const cases = env.HOTEL_CASES?.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  let templates = cases?.length ? DATA.templates.filter((t) => cases.some((c) => t.id === c || t.id.startsWith(c))) : DATA.templates;
  if (env.HOTEL_REGION) templates = templates.filter((t) => (t.region ?? "domestic") === env.HOTEL_REGION);
  if (!templates.length) throw new Error(`Không có template nào khớp --case ${env.HOTEL_CASES ?? ""} --region ${env.HOTEL_REGION ?? ""}`);
  const count = Number(env.HOTEL_CONDITIONS) || (cases?.length ? Math.max(cases.length, templates.length) : DATA.conditionsPerRun);

  // Chạy lần lượt các template (xáo trộn) để mỗi lượt phủ được nhiều tình huống khác nhau.
  const order = [...templates].sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => {
    const t = order[i % order.length];
    const region = t.region ?? "domestic";
    const rooms = Number(env.HOTEL_ROOMS) || t.rooms;
    const adults = Math.max(rooms, Number(env.HOTEL_ADT) || t.adults);
    const childrenAges = env.HOTEL_AGES ? env.HOTEL_AGES.split(",").map(Number) : t.childrenAges ?? [];
    const children = env.HOTEL_CHD != null ? Number(env.HOTEL_CHD) : t.children;
    const nights = Number(env.HOTEL_NIGHTS) || randInt(t.nights[0], t.nights[1]);
    const checkIn = env.HOTEL_IN || ymd(new Date(Date.now() + randInt(t.daysAhead[0], t.daysAhead[1]) * 86_400_000));
    return {
      id: `cond-${i + 1}-${t.id}`,
      template: t,
      term: env.HOTEL_LOC || pick(DATA.locations[region]),
      rooms,
      adults,
      children,
      childrenAges: Array.from({ length: children }, (_, k) => childrenAges[k] ?? 8),
      nights,
      checkIn,
      checkOut: addDays(checkIn, nights),
    };
  });
}

async function resolveToken(
  request: Parameters<typeof loginWebApi>[0],
  baseUrl: string,
  token: string | undefined,
  clientId?: string,
  username?: string,
  password?: string,
  label = "WEB"
): Promise<string> {
  const t = (token || "").replace(/^Bearer\s+/i, "").trim();
  if (t) return t;
  if (!clientId || !username || !password) return "";
  try {
    return await loginWebApi(request, baseUrl, { clientId, username, password });
  } catch (err) {
    const prefix = label === "WEB" ? "WEB_API" : "TMS_API";
    throw new Error(`Đăng nhập ${label} thất bại tại ${baseUrl}/auth/login: ${(err as Error).message.replace(/^Đăng nhập API web thất bại /, "").replace(/ — kiểm tra .*$/, "")} — kiểm tra ${prefix}_CLIENT_ID / ${prefix}_USERNAME / ${prefix}_PASSWORD${label === "TMS" ? " và TMS_AUTH_URL" : ""}`);
  }
}

function searchInfo(enabled: boolean, res: HotelSearchResult | undefined, note?: string): SystemSearchInfo {
  const policies: HotelFeePolicy[] = res?.feePolicies ?? [];
  const policy = selectHotelMarkupPolicy(policies);
  return {
    enabled,
    note,
    status: res?.status,
    ms: res?.ms,
    error: res?.error,
    count: res?.records.length ?? 0,
    policies,
    policy,
    policyWarnings: policyWarnings(policies, policy),
  };
}

/** List + detail của 1 hệ cho 1 khách sạn. `system` quyết định công thức. */
function computeSystem(system: "web" | "tms", record: HotelRecord, policy: HotelFeePolicy | null, ctx: MarkupContext, detail?: HotelDetailResult): SystemHotelCalc {
  const list = system === "web" ? webListPrice(record, policy, ctx) : tmsListPrice(record, policy, ctx);
  if (!detail) return { record, list };
  if (detail.error) return { record, list, detail: { error: detail.error, ms: detail.ms, roomCount: 0, rooms: [] } };
  const rooms = detail.rooms.filter((r) => r.perRoomPerNightRate).map((room) => ({
    room,
    perNight: system === "web" ? webDetailPerNight(room, policy, ctx).result : tmsDetailPerNight(room, policy, ctx).result,
    total: system === "web" ? webBooking(room, policy, ctx).result : tmsStayTotal(room, policy, ctx).result,
  }));
  const room = cheapestRoom(detail.rooms);
  if (!room) return { record, list, detail: { ms: detail.ms, roomCount: detail.rooms.length, rooms } };
  if (system === "web") {
    const booking = webBooking(room, policy, ctx);
    return { record, list, detail: { ms: detail.ms, roomCount: detail.rooms.length, room, perNight: webDetailPerNight(room, policy, ctx), total: booking, bookingLines: booking.lines, rooms } };
  }
  return { record, list, detail: { ms: detail.ms, roomCount: detail.rooms.length, room, perNight: tmsDetailPerNight(room, policy, ctx), total: tmsStayTotal(room, policy, ctx), rooms } };
}

test.describe("Giá khách sạn — web vs TMS (chỉ hiển thị)", () => {
  test.describe.configure({ retries: 0 });

  test(`search và tính giá ${HOTELS} khách sạn mỗi điều kiện`, async ({ request }) => {
    const conditionsPlan = buildConditions();
    test.setTimeout(conditionsPlan.length * (2 * DATA.timeoutMs + Math.ceil(HOTELS / DATA.detailConcurrency) * DATA.timeoutMs) + 60_000);

    // Token WEB = token tool flight (WEB_API_*). Token TMS = TMS_API_* nếu có, không thì dùng chung token WEB.
    const webToken = await resolveToken(request, API_URL, env.WEB_API_TOKEN, env.WEB_API_CLIENT_ID, env.WEB_API_USERNAME, env.WEB_API_PASSWORD);
    if (!webToken) throw new Error("Thiếu token web (dùng chung với tool flight): đặt WEB_API_TOKEN hoặc WEB_API_CLIENT_ID / WEB_API_USERNAME / WEB_API_PASSWORD trong .env");
    const tmsOwnToken = await resolveToken(request, TMS_AUTH_URL, env.TMS_API_TOKEN, env.TMS_API_CLIENT_ID, env.TMS_API_USERNAME, env.TMS_API_PASSWORD, "TMS");
    const tmsToken = tmsOwnToken || webToken;
    // Cùng token + cùng API thì request TMS y hệt WEB → dùng lại kết quả WEB, không gọi API 2 lần.
    const tmsSharesWeb = tmsToken === webToken && TMS_API_URL === API_URL;
    const tmsNote = tmsOwnToken ? undefined : "TMS dùng chung token WEB/flight (chưa đặt TMS_API_TOKEN / TMS_API_CLIENT_ID…) → cùng dữ liệu và feePolicies với WEB, chỉ khác công thức";
    console.log(`WEB: ${API_URL} · token ${env.WEB_API_TOKEN ? "WEB_API_TOKEN" : "đăng nhập WEB_API_CLIENT_ID"}`);
    console.log(
      `TMS: ${TMS_API_URL} · token ${tmsOwnToken ? (env.TMS_API_TOKEN ? "TMS_API_TOKEN" : `đăng nhập TMS_API_CLIENT_ID tại ${TMS_AUTH_URL}/auth/login`) : "dùng chung token WEB/flight"}`
    );

    const web = new HotelApiClient(request, API_URL, webToken, DATA.timeoutMs);
    const tms = tmsSharesWeb ? null : new HotelApiClient(request, TMS_API_URL, tmsToken, DATA.timeoutMs);
    const startedAt = new Date();
    const outDir = path.join(OUT_ROOT, startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19));
    const locationCache = new Map<string, HotelLocation | null>();
    const conditions: HotelCondition[] = [];
    const raw: unknown[] = [];

    for (const plan of conditionsPlan) {
      const ctx: MarkupContext = { roomsNum: plan.rooms, nights: plan.nights };
      if (!locationCache.has(plan.term)) locationCache.set(plan.term, await web.findLocation(plan.term).catch(() => null));
      const location = locationCache.get(plan.term) ?? null;
      const condition: HotelCondition = {
        id: plan.id,
        description: plan.template.description,
        location: {
          term: plan.term,
          id: location?.id,
          name: location ? location.textTranslate || location.displayName || location.text || location.cityName || plan.term : plan.term,
          searchType: location?.searchType,
          isDomestic: location?.isDomestic,
        },
        checkIn: plan.checkIn,
        checkOut: plan.checkOut,
        nights: plan.nights,
        rooms: plan.rooms,
        adults: plan.adults,
        children: plan.children,
        childrenAges: plan.childrenAges,
        searchedAt: new Date().toLocaleString("vi-VN"),
        web: searchInfo(true, undefined),
        tms: searchInfo(true, undefined, tmsNote),
        hotels: [],
      };
      conditions.push(condition);
      console.log(`\n▶ ${plan.id} ${condition.location.name} — ${plan.checkIn}→${plan.checkOut} (${plan.nights} đêm), ${plan.rooms} phòng, ${plan.adults} NL${plan.children ? ` + ${plan.children} TE` : ""}`);
      if (!location) {
        const candidates = await web.searchLocations(plan.term).catch(() => []);
        condition.error = `Không tìm thấy thành phố/khu vực "${plan.term}" (GET /hotel/location/search trả: ${
          candidates.slice(0, 5).map((l) => `${l.text ?? l.displayName} [${l.searchType}]`).join(", ") || "rỗng"
        })`;
        console.log(`  ⚠ ${condition.error}`);
        continue;
      }

      const body = {
        locationId: location.id,
        searchType: location.searchType || "CITY",
        checkInDate: plan.checkIn,
        checkOutDate: plan.checkOut,
        roomsNum: plan.rooms,
        adults: plan.adults,
        children: plan.children,
        childrenAges: plan.childrenAges,
        page: 0,
        pageSize: HOTELS,
        locale: "vn" as const,
        searchMode: "OTA",
        filter: [],
      };
      const [webRes, tmsRes] = await Promise.all([web.search(body), tms ? tms.search(body) : Promise.resolve(undefined)]);
      const tmsData = tmsRes ?? webRes;
      condition.web = searchInfo(true, webRes);
      condition.tms = searchInfo(true, tmsData, tmsNote);
      console.log(`  WEB: ${webRes.records.length} KS, ${webRes.ms} ms${webRes.error ? ` ⚠ ${webRes.error}` : ""} · policy: ${condition.web.policy?.name ?? "không có"}`);
      console.log(`  TMS: ${tmsData.records.length} KS${tmsRes ? `, ${tmsRes.ms} ms` : " (chung token WEB)"}${tmsRes?.error ? ` ⚠ ${tmsRes.error}` : ""} · policy: ${condition.tms.policy?.name ?? "không có"}`);

      const webRecords = webRes.records.slice(0, HOTELS);
      const tmsRecords = tmsData.records.slice(0, HOTELS);
      const tmsById = new Map(tmsRecords.map((r) => [r.hotelId, r]));
      const webIds = new Set(webRecords.map((r) => r.hotelId));
      const ordered = [...webRecords.map((r) => ({ webRec: r as HotelRecord | undefined, tmsRec: tmsById.get(r.hotelId) })), ...tmsRecords.filter((r) => !webIds.has(r.hotelId)).map((r) => ({ webRec: undefined, tmsRec: r as HotelRecord | undefined }))];

      condition.hotels = await mapLimit(ordered, FETCH_DETAIL ? DATA.detailConcurrency : ordered.length || 1, async ({ webRec, tmsRec }) => {
        const [webDetail, tmsOwnDetail] = FETCH_DETAIL
          ? await Promise.all([
              webRec?.searchId != null ? web.detail(webRec.hotelId, webRec.searchId) : undefined,
              tms && tmsRec?.searchId != null ? tms.detail(tmsRec.hotelId, tmsRec.searchId) : undefined,
            ])
          : [undefined, undefined];
        const tmsDetail = tms ? tmsOwnDetail : webDetail;
        raw.push({ condition: plan.id, hotelId: (webRec ?? tmsRec)!.hotelId, webRecord: webRec, tmsRecord: tms ? tmsRec : undefined, webDetail, tmsDetail: tms ? tmsDetail : undefined });
        const rec = (webRec ?? tmsRec)!;
        const row: HotelRow = {
          hotelId: rec.hotelId,
          name: rec.translatedName || rec.hotelName || String(rec.hotelId),
          web: webRec ? computeSystem("web", webRec, condition.web.policy, ctx, webDetail) : undefined,
          tms: tmsRec ? computeSystem("tms", tmsRec, condition.tms.policy, ctx, tmsDetail) : undefined,
        };
        return row;
      });

      for (const [i, h] of condition.hotels.entries()) {
        console.log(`  ${String(i + 1).padStart(2)}. ${h.name} #${h.hotelId}`);
        if (h.web) console.log(`      WEB list   ${fmt(h.web.list.result)} = ${stepsToText(h.web.list.steps)}`);
        if (h.web?.detail?.perNight) console.log(`      WEB detail ${fmt(h.web.detail.perNight.result)}/đêm · booking ${fmt(h.web.detail.total!.result)}`);
        if (h.tms) console.log(`      TMS list   ${fmt(h.tms.list.result)} = ${stepsToText(h.tms.list.steps)}`);
        if (h.tms?.detail?.perNight) console.log(`      TMS detail ${fmt(h.tms.detail.perNight.result)}/đêm · tổng ${fmt(h.tms.detail.total!.result)}`);
        const gap = h.web ? listDetailGap(h.web.record, h.web.detail?.room) : null;
        if (gap) console.log(`      ⚠ ${gap}`);
        const detailError = h.web?.detail?.error ?? h.tms?.detail?.error;
        if (detailError) console.log(`      ⚠ detail: ${detailError}`);
      }
      console.log(`  ↻ Chạy lại: ${rerunCommand(condition, { hotels: HOTELS, noDetail: !FETCH_DETAIL })}`);
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "raw.json"), JSON.stringify({ conditions: conditions.map((c) => ({ ...c, hotels: undefined })), responses: raw }, null, 2), "utf-8");
    const report = writeHotelPriceReport(outDir, conditions, {
      startedAt: startedAt.toLocaleString("vi-VN"),
      apiUrl: API_URL,
      hotels: HOTELS,
      noDetail: !FETCH_DETAIL,
    });
    console.log(`\n📄 Báo cáo: ${report}`);
  });
});
