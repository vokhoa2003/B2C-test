import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { loadTestData } from "../helpers/testDataLoader";
import { daysFromNowToDate } from "../helpers/randomPassenger";
import { MetasearchBody, MetasearchClient, MetasearchResponse } from "../helpers/metasearchClient";
import { FlightSearchApiCapture } from "../pages/flight/FlightSearchApiCapture";
import { WebSearchClient, WebSystems, loginWebApi } from "../helpers/webSearchClient";
import { MetasearchToolPage } from "../pages/metasearch/MetasearchToolPage";
import { labelTab, launchReviewBrowser } from "../helpers/reviewBrowser";
import { FareItem, compareMetaAgainstWeb, markNearDeparture } from "../helpers/metasearchCompareV2";
import {
  AIRPORT_CATALOG,
  AIRPORTS_FILE,
  airportLabel,
  airportsInRegions,
  allInternational,
  domesticAirports,
  featuredInternational,
  findAirport,
  knownRegions,
} from "../helpers/airportCatalog";
import { appendHistory, historyKey, loadHistory, HISTORY_FILE } from "../helpers/metasearchHistoryV2";
import {
  ConditionReport,
  CsvFile,
  DETAIL_COLUMNS,
  createRunDir,
  detailToCsvRow,
  writeHtmlReport,
  nearDepartureText,
  writeMetaSnapshotHtml,
  writeMetaToolSnapshot,
} from "../helpers/metasearchReportV2";

/**
 * V2 của tool so sánh metasearch vs web (bản v1: tests/metasearch/, giữ nguyên) — khác v1 ở
 * CÔNG THỨC GIÁ (helpers/metasearchCompareV2.ts):
 *   Giá so sánh = totalAmount + (phí ADULT × NL + phí CHILD × TE) × (2 nếu khứ hồi), em bé không tính phí.
 * Báo cáo, lịch sử, cấu hình riêng (.test-state/metasearch-compare-v2/, metasearch-vs-web-v2.json).
 * Chạy: yarn compare:metasearch:v2 [cờ giống v1] — xem tests/metasearch-v2/README.md.
 *
 * Tool so sánh "list trả ra" giữa:
 * - Trang tool metasearch cho đối tác: https://api-dev.triphubs.vn/static/tools/metasearch/
 *   (gọi thẳng API `/v1/flights/metasearch` mà trang đó dùng — trang chỉ render y nguyên `fareData`)
 * - Trang gốc: https://dev.triphubs.vn/vi (mở trang kết quả trong browser thật, bắt các response `/flights/search/`)
 *
 * Mỗi lần chạy sinh `conditionsPerRun` (mặc định 5) điều kiện search KHÁC NHAU từ
 * danh sách `templates` (loại chặng, 1 chiều/khứ hồi, số khách) + route/ngày ngẫu
 * nhiên, rồi search CÙNG LÚC trên 2 nguồn với đúng 1 bộ điều kiện.
 *
 * Kết quả: .test-state/metasearch-compare-v2/<timestamp>/
 *   report.html  — báo cáo đọc bằng browser: tổng quan + chi tiết từng chuyến lệch giá/thiếu
 *   summary.csv  — 1 dòng / điều kiện: số hành trình meta, khớp, lệch giá, chỉ có 1 bên, verdict
 *   details.csv  — 1 dòng / hành trình (cả dòng khớp): bên nào, system, số hiệu, giờ bay, giá 2 bên
 *   raw/         — JSON gốc của cả 2 bên để tra lại
 *
 * Logic so khớp (meta làm chuẩn): xem helpers/metasearchCompareV2.ts.
 *
 * Cấu hình (route pool, template, timeout...) trong `metasearch-vs-web-v2.json`.
 * Tài khoản metasearch đọc từ .env: META_CLIENT_ID / META_USERNAME / META_PASSWORD.
 */

type RouteType = "domestic" | "international";

type ConditionTemplate = {
  /** Mã case study (VD "PAX-09", "ROUTE-07") — hiện trong báo cáo, dùng xoay vòng case chưa chạy. */
  id?: string;
  description: string;
  routeType: RouteType;
  tripType: "oneway" | "roundtrip";
  adults: number;
  children: number;
  infants: number;
  /** Nhóm chặng của case: chọn ngẫu nhiên 1 cặp (cả 2 chiều). Bỏ trống = theo `airports` như cũ. */
  routes?: [string, string][];
  /**
   * Quốc tế: đầu nước ngoài chọn ngẫu nhiên trong các vùng của danh mục sân bay (public/PLAN/airports.json,
   * khớp `subject` hoặc `continent`), VD ["Đông Nam Á", "Đông dương"], ["Châu Âu"]. Đầu Việt Nam lấy từ `vnEnd`.
   */
  region?: string[];
  /** Đầu Việt Nam cho `region` / `pool` (bỏ trống = airports.vnInternationalGateways). */
  vnEnd?: string[];
  /**
   * Quốc tế, không có `routes`/`region`: chọn đầu nước ngoài trong danh mục — "featured" (mặc định, điểm web
   * đã xếp nhóm, gần như luôn có chuyến) hoặc "all" (mọi sân bay thế giới trong file, case khám phá).
   */
  pool?: "featured" | "all";
  /**
   * Ngày bay = hôm nay + [min, max] ngày. Bỏ trống = theo defaults (nội địa 20+, quốc tế 40+).
   * [0, 1] = case 24h: search ngay hôm nay / ngày mai — chuyến cất cánh trong 24h kể từ lúc search được
   * đánh dấu "≤24h" trong báo cáo (đánh dấu cho mọi điều kiện, case này để chắc chắn có các chuyến đó).
   */
  daysAhead?: [number, number];
  /** Khứ hồi: ngày về = ngày đi + [min, max] ngày (0 = về trong ngày). Bỏ trống = theo defaults. */
  stayDays?: [number, number];
  /** Cố định route/ngày nếu muốn tái hiện 1 case cụ thể (bỏ trống = ngẫu nhiên). */
  from?: string;
  to?: string;
  departDate?: string;
  returnDate?: string;
};

type TripFilter = ConditionTemplate["tripType"] | "all";
type RouteFilter = RouteType | "all";

type TestData = {
  conditionsPerRun: number;
  /** Chỉ dùng template khớp bộ lọc. Ghi đè bằng env META_TRIP_TYPE / META_ROUTE_TYPE (cờ --trip / --route). */
  filters?: { tripType?: TripFilter; routeType?: RouteFilter; airlines?: string[] };
  templates: ConditionTemplate[];
  /** System web gọi /flights/search/ (khi gọi API trực tiếp bằng WEB_API_TOKEN) — như getAirlinesCanBeExcuted của web. */
  webSystems?: WebSystems;
  airports: {
    /** Sân bay trục nội địa — chặng nội địa luôn có 1 đầu ở đây (ghép 2 sân bay nhỏ hay không có đường bay). */
    domesticHubs: string[];
    /** Toàn bộ sân bay nội địa (isDomestic = 1) có thể làm đầu còn lại của chặng nội địa. */
    domestic: string[];
    /** Sân bay Việt Nam có đường bay quốc tế — đầu Việt Nam của chặng quốc tế. */
    vnInternationalGateways: string[];
    international: string[];
  };
  defaults: {
    domesticMinDays: number;
    internationalMinDays: number;
    randomExtraDays: number;
    returnAfterDaysMin: number;
    returnAfterDaysMax: number;
    currency: string;
    language: string;
    webTimeoutMs: number;
    metaTimeoutMs: number;
  };
};

const DEFAULT_DATA: TestData = {
  conditionsPerRun: 5,
  filters: { tripType: "all", routeType: "all" },
  templates: [
    { description: "Nội địa, 1 chiều, 1 người lớn", routeType: "domestic", tripType: "oneway", adults: 1, children: 0, infants: 0 },
    { description: "Nội địa, 1 chiều, 1 người lớn + 1 em bé", routeType: "domestic", tripType: "oneway", adults: 1, children: 0, infants: 1 },
    { description: "Nội địa, 1 chiều, 2 người lớn + 1 trẻ em + 1 em bé", routeType: "domestic", tripType: "oneway", adults: 2, children: 1, infants: 1 },
    { description: "Nội địa, khứ hồi, 1 người lớn", routeType: "domestic", tripType: "roundtrip", adults: 1, children: 0, infants: 0 },
    { description: "Nội địa, khứ hồi, 2 người lớn + 1 trẻ em", routeType: "domestic", tripType: "roundtrip", adults: 2, children: 1, infants: 0 },
    { description: "Quốc tế, 1 chiều, 1 người lớn", routeType: "international", tripType: "oneway", adults: 1, children: 0, infants: 0 },
    { description: "Quốc tế, 1 chiều, 1 người lớn + 1 em bé", routeType: "international", tripType: "oneway", adults: 1, children: 0, infants: 1 },
    { description: "Quốc tế, 1 chiều, 2 người lớn + 1 trẻ em", routeType: "international", tripType: "oneway", adults: 2, children: 1, infants: 0 },
    { description: "Quốc tế, khứ hồi, 1 người lớn", routeType: "international", tripType: "roundtrip", adults: 1, children: 0, infants: 0 },
    { description: "Quốc tế, khứ hồi, 2 người lớn + 1 trẻ em + 1 em bé", routeType: "international", tripType: "roundtrip", adults: 2, children: 1, infants: 1 },
  ],
  airports: {
    domesticHubs: ["SGN", "HAN", "DAD"],
    domestic: [
      "SGN", "HAN", "DAD", "CXR", "PQC", "HPH", "VII", "HUI", "VCA", "DLI", "BMV",
      "UIH", "VDH", "THD", "VCS", "TBB", "PXU", "CAH", "VKG", "VCL", "DIN", "VDO",
    ],
    vnInternationalGateways: ["SGN", "HAN", "DAD", "CXR", "PQC", "HPH"],
    international: [
      "TPE", "NRT", "HND", "KIX", "ICN", "PUS", "BKK", "HKT", "SIN", "KUL", "HKG", "MFM",
      "CAN", "PVG", "DPS", "CGK", "MNL", "PNH", "REP", "VTE", "SYD", "MEL", "DXB", "CDG", "FRA", "LHR", "LAX",
    ],
  },
  defaults: {
    domesticMinDays: 20,
    internationalMinDays: 40,
    randomExtraDays: 14,
    returnAfterDaysMin: 3,
    returnAfterDaysMax: 7,
    currency: "VND",
    language: "VI",
    webTimeoutMs: 5 * 60_000,
    metaTimeoutMs: 5 * 60_000,
  },
};

const DATA = loadTestData<TestData>(__filename, DEFAULT_DATA);
// Danh sách system web gọi — theo request thật của dev.triphubs.vn (26/10: quốc tế có cả VU). Sửa trong JSON nếu web đổi.
const WEB_SYSTEMS: WebSystems = {
  domestic: ["VN", "VJ", "VU", "_9G"],
  international: ["VN", "VJ", "VU", "GALILEO_NDC", "JQ", "_9G"],
  ...DATA.webSystems,
};
// loadTestData chỉ merge 1 cấp: JSON cũ thiếu key mới trong `airports` thì lấy mặc định.
// Có danh mục sân bay (public/PLAN/airports.json) thì sân bay nội địa lấy theo isDomestic của file, sân bay
// quốc tế = điểm web đã xếp nhóm + danh sách trong JSON cấu hình; không có file thì dùng JSON như cũ.
const AIRPORTS = (() => {
  const base = { ...DEFAULT_DATA.airports, ...DATA.airports };
  if (!AIRPORT_CATALOG.size) return base;
  return {
    ...base,
    domestic: [...new Set([...domesticAirports(), ...base.domestic])],
    international: [...new Set([...featuredInternational(), ...base.international])],
  };
})();
const isDomesticCode = (code: string) => findAirport(code)?.isDomestic ?? AIRPORTS.domestic.includes(code);

function parseFilter<T extends string>(name: string, value: string | undefined, allowed: T[]): T | "all" {
  const v = (value || "all").trim().toLowerCase();
  if (v === "all" || (allowed as string[]).includes(v)) return v as T | "all";
  throw new Error(`${name}="${value}" không hợp lệ — chỉ nhận: ${[...allowed, "all"].join(", ")}`);
}

// Ưu tiên env (do scripts/compare-metasearch-v2.js đặt từ cờ dòng lệnh), sau đó tới `filters` trong JSON.
const TRIP_FILTER = parseFilter("META_TRIP_TYPE", process.env.META_TRIP_TYPE || DATA.filters?.tripType, ["oneway", "roundtrip"]);
const ROUTE_FILTER = parseFilter("META_ROUTE_TYPE", process.env.META_ROUTE_TYPE || DATA.filters?.routeType, ["domestic", "international"]);
/**
 * Hành trình chỉ định bằng cờ --from/--to (env META_FROM, META_TO, META_DEPART, META_RETURN,
 * META_ADT/CHD/INF — scripts/compare-metasearch-v2.js đã kiểm tra hợp lệ): chạy đúng 1 điều kiện
 * đó, bỏ qua `templates`, cờ --route và lịch sử. Bỏ trống ngày thì chọn ngẫu nhiên như thường.
 * Không có --trip thì có --return là khứ hồi, không có là 1 chiều.
 */
/**
 * Cờ --adt/--chd/--inf (env META_ADT/CHD/INF): ghi đè số khách cho MỌI điều kiện (kể cả ngẫu nhiên).
 * Thiếu cờ nào thì mặc định 1 NL / 0 TE / 0 EB. Quy tắc đã kiểm tra ở scripts/compare-metasearch-v2.js:
 * em bé ≤ người lớn, tổng ≤ 9 (giống ô chọn khách trên web).
 */
const PAX_OVERRIDE =
  process.env.META_ADT || process.env.META_CHD || process.env.META_INF
    ? {
        adults: Number(process.env.META_ADT || 1),
        children: Number(process.env.META_CHD || 0),
        infants: Number(process.env.META_INF || 0),
      }
    : null;
const paxText = (p: { adults: number; children: number; infants: number }) =>
  [`${p.adults} người lớn`, p.children && `${p.children} trẻ em`, p.infants && `${p.infants} em bé`].filter(Boolean).join(" + ");

function customTemplate(): ConditionTemplate | null {
  const from = process.env.META_FROM?.toUpperCase();
  const to = process.env.META_TO?.toUpperCase();
  if (!from || !to) return null;
  const tripType = TRIP_FILTER !== "all" ? TRIP_FILTER : process.env.META_RETURN ? "roundtrip" : "oneway";
  const { adults, children, infants } = PAX_OVERRIDE ?? { adults: 1, children: 0, infants: 0 };
  const isDomestic = isDomesticCode(from) && isDomesticCode(to);
  return {
    description: `Chỉ định: ${from}${tripType === "roundtrip" ? "⇄" : "→"}${to}, ${tripType === "roundtrip" ? "khứ hồi" : "1 chiều"}, ${adults} NL ${children} TE ${infants} EB`,
    routeType: isDomestic ? "domestic" : "international",
    tripType,
    adults,
    children,
    infants,
    from,
    to,
    departDate: process.env.META_DEPART || undefined,
    returnDate: tripType === "roundtrip" ? process.env.META_RETURN || undefined : undefined,
  };
}
/**
 * Kiểm tra số khách của mọi template — cùng quy tắc ô chọn khách trên web (InputInfant.tsx):
 * người lớn ≥ 1, em bé ≤ người lớn, tổng người lớn + trẻ em + em bé ≤ 9. Sai thì dừng ngay, báo rõ case nào.
 */
const MAX_PAX = 9;
const invalidTemplates = DATA.templates
  .map((t) => {
    const total = t.adults + t.children + t.infants;
    const errors = [
      t.adults < 1 && "cần ít nhất 1 người lớn",
      t.infants > t.adults && `em bé (${t.infants}) > người lớn (${t.adults})`,
      total > MAX_PAX && `tổng ${total} khách > ${MAX_PAX}`,
      [t.adults, t.children, t.infants].some((n) => !Number.isInteger(n) || n < 0) && "số khách phải là số nguyên ≥ 0",
      t.tripType === "oneway" && (t.returnDate || t.stayDays) && "1 chiều không dùng returnDate/stayDays",
      (t.region || t.pool) && !AIRPORT_CATALOG.size && `cần danh mục sân bay ${AIRPORTS_FILE} cho region/pool`,
      t.region && AIRPORT_CATALOG.size && !airportsInRegions(t.region).length &&
        `region ${JSON.stringify(t.region)} không có sân bay nào — vùng có trong file: ${knownRegions().join(", ")}`,
    ].filter(Boolean);
    return errors.length ? `${t.id ?? t.description}: ${errors.join(", ")}` : null;
  })
  .filter(Boolean);
if (invalidTemplates.length) {
  throw new Error(`metasearch-vs-web-v2.json có template không hợp lệ:\n- ${invalidTemplates.join("\n- ")}`);
}
/** Mã sân bay trong template không có trong danh mục → chỉ cảnh báo (vẫn search, có thể web không hỗ trợ). */
const unknownCodes = AIRPORT_CATALOG.size
  ? [...new Set(DATA.templates.flatMap((t) => [...(t.routes ?? []).flat(), ...(t.vnEnd ?? []), t.from, t.to]).filter((c): c is string => !!c))]
      .filter((c) => !findAirport(c))
  : [];
const AIRPORT_STATUS = AIRPORT_CATALOG.size
  ? `Danh mục sân bay: ${AIRPORT_CATALOG.size} điểm (${AIRPORTS.domestic.length} nội địa, ${featuredInternational().length} quốc tế đã xếp nhóm, ${allInternational().length} sân bay quốc tế) — ${path.relative(process.cwd(), AIRPORTS_FILE)}` +
    (unknownCodes.length ? ` · ⚠ mã không có trong danh mục: ${unknownCodes.join(", ")}` : "")
  : `Không thấy danh mục sân bay ${AIRPORTS_FILE} — dùng danh sách sân bay trong metasearch-vs-web-v2.json`;

/** Khoá xoay vòng: case đã chạy (lưu trong lịch sử) thì xếp sau case chưa chạy. */
const templateKey = (t: ConditionTemplate) => t.id ?? t.description;

const CUSTOM_TEMPLATE = customTemplate();
const NEAR_24H = process.env.META_NEAR_24H === "1";
const CONDITIONS_PER_RUN = CUSTOM_TEMPLATE ? 1 : Number(process.env.META_CONDITIONS) || DATA.conditionsPerRun;
// Cờ --case PAX-09,ROUTE-07 (env META_CASES): chỉ chạy các case study này (khớp mã hoặc tiền tố, VD "PAX").
const CASE_FILTER = (process.env.META_CASES || "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const TEMPLATES = CUSTOM_TEMPLATE
  ? [CUSTOM_TEMPLATE]
  : DATA.templates
      .filter((t) => (TRIP_FILTER === "all" || t.tripType === TRIP_FILTER) && (ROUTE_FILTER === "all" || t.routeType === ROUTE_FILTER))
      .filter((t) => !CASE_FILTER.length || CASE_FILTER.some((c) => (t.id ?? "").toUpperCase() === c || (t.id ?? "").toUpperCase().startsWith(c + "-")))
      .map((t) =>
        PAX_OVERRIDE
          ? { ...t, ...PAX_OVERRIDE, description: `${t.description.split(",").slice(0, 2).join(",")}, ${paxText(PAX_OVERRIDE)} (theo cờ)` }
          : t
      )
      // Cờ --24h (env META_NEAR_24H=1): giữ ngẫu nhiên khách/chặng/hành trình của case, chỉ ép ngày bay hôm nay / ngày mai.
      .map((t) => (NEAR_24H && !t.departDate ? { ...t, daysAhead: [0, 1] as [number, number], description: `${t.description} · bay trong 24h (--24h)` } : t));

/**
 * Cờ --airline (env META_AIRLINES, VD "VN" hoặc "VN,VJ") hoặc `filters.airlines` trong JSON: chỉ so
 * các hành trình mà MỌI segment do hãng đó bán (mã IATA 2 ký tự trong segments[].airline). Lọc cả
 * 2 bên trước khi so; dữ liệu raw vẫn lưu đầy đủ.
 */
const AIRLINE_FILTER = (process.env.META_AIRLINES ? process.env.META_AIRLINES.split(",") : DATA.filters?.airlines ?? [])
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
const matchesAirline = (item: FareItem) =>
  !AIRLINE_FILTER.length ||
  (item.flights ?? []).every((leg) => (leg.segments ?? []).every((seg) => AIRLINE_FILTER.includes(String(seg.airline).toUpperCase())));

const WEB_URL = (process.env.META_COMPARE_WEB_URL || "https://dev.triphubs.vn").replace(/\/+$/, "");
const META_API_URL = (process.env.META_API_URL || "https://api-dev.triphubs.vn").replace(/\/+$/, "");
// Lấy dữ liệu web bằng cách gọi thẳng API (helpers/webSearchClient.ts) khi có WEB_API_TOKEN, hoặc có
// WEB_API_CLIENT_ID / WEB_API_USERNAME / WEB_API_PASSWORD để tự đăng nhập lấy token; không có → bắt qua browser.
const WEB_API_URL = (process.env.WEB_API_URL || "https://api-dev.triphubs.vn").replace(/\/+$/, "");
const WEB_API_TOKEN = (process.env.WEB_API_TOKEN || "").replace(/^Bearer\s+/i, "").trim();
const WEB_API_CREDENTIALS =
  process.env.WEB_API_CLIENT_ID && process.env.WEB_API_USERNAME && process.env.WEB_API_PASSWORD
    ? { clientId: process.env.WEB_API_CLIENT_ID, username: process.env.WEB_API_USERNAME, password: process.env.WEB_API_PASSWORD }
    : null;

type Condition = {
  id: string;
  description: string;
  from: string;
  to: string;
  flightType: "DOMESTIC" | "INTERNATIONAL";
  itinerary: 0 | 1;
  departDate: string;
  returnDate?: string;
  adults: number;
  children: number;
  infants: number;
  /** Route + loại hành trình này đã chạy ở lần trước (chỉ xảy ra khi đã hết tổ hợp mới). */
  repeated?: boolean;
  /** Mã case (template) sinh ra điều kiện này — ghi lịch sử để xoay vòng. */
  templateKey?: string;
};

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const shuffle = <T>(list: T[]): T[] => [...list].sort(() => Math.random() - 0.5);

function toYmd(date: Date): string {
  // Local date, không dùng toISOString() (lệch ngày với UTC+7).
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Thứ tự template cho lần chạy này: xáo riêng nhóm nội địa và quốc tế rồi xen kẽ
 * (bắt đầu ngẫu nhiên) — lần nào cũng có cả 2 loại; case chưa chạy được ưu tiên để qua nhiều
 * lần chạy là phủ hết bộ case study.
 */
function templateOrder(usedTemplates: Set<string>): ConditionTemplate[] {
  // Trong mỗi nhóm: case CHƯA chạy lần nào lên trước (xáo ngẫu nhiên), rồi tới case đã chạy.
  const rotate = (list: ConditionTemplate[]) => [
    ...shuffle(list.filter((t) => !usedTemplates.has(templateKey(t)))),
    ...shuffle(list.filter((t) => usedTemplates.has(templateKey(t)))),
  ];
  const domestic = rotate(TEMPLATES.filter((t) => t.routeType === "domestic"));
  const international = rotate(TEMPLATES.filter((t) => t.routeType === "international"));
  const [first, second] = Math.random() < 0.5 ? [domestic, international] : [international, domestic];
  const order: ConditionTemplate[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) order.push(first[i]);
    if (second[i]) order.push(second[i]);
  }
  return order;
}

/** Mọi route hợp lệ cho 1 loại chặng (có chiều), theo danh sách sân bay trong cấu hình. */
function candidateRoutes(tpl: ConditionTemplate): [string, string][] {
  const routes = new Map<string, [string, string]>();
  const add = (a: string, b: string) => {
    if (a === b) return;
    routes.set(`${a}-${b}`, [a, b]);
    routes.set(`${b}-${a}`, [b, a]);
  };
  const vnEnd = tpl.vnEnd ?? AIRPORTS.vnInternationalGateways;
  if (tpl.routes?.length || tpl.region?.length) {
    // Case có nhóm chặng riêng (VD trục chính, đường dài…) và/hoặc vùng trong danh mục sân bay.
    for (const [a, b] of tpl.routes ?? []) add(a.toUpperCase(), b.toUpperCase());
    if (tpl.region?.length) for (const vn of vnEnd) for (const intl of airportsInRegions(tpl.region)) add(vn, intl);
  } else if (tpl.routeType === "international" && tpl.pool === "all" && AIRPORT_CATALOG.size) {
    // Khám phá: mọi sân bay thế giới trong danh mục.
    for (const vn of vnEnd) for (const intl of allInternational()) add(vn, intl);
  } else if (tpl.routeType === "domestic") {
    // Nội địa: luôn có 1 đầu là sân bay trục.
    for (const hub of AIRPORTS.domesticHubs) for (const other of AIRPORTS.domestic) add(hub, other);
  } else {
    // Quốc tế: 1 đầu Việt Nam + 1 đầu nước ngoài.
    for (const vn of AIRPORTS.vnInternationalGateways) for (const intl of AIRPORTS.international) add(vn, intl);
  }
  return [...routes.values()];
}

/**
 * Sinh N điều kiện khác nhau: template xen kẽ nội địa/quốc tế, random route + ngày.
 * - Không lặp route trong 1 lần chạy (kể cả đảo chiều).
 * - Bỏ qua route + loại hành trình đã có trong `history` (các lần chạy trước). Hết tổ hợp mới
 *   thì mới cho lặp lại (đánh dấu `repeated`) để vẫn đủ số điều kiện.
 * - Template cố định from/to không bị lịch sử chặn (dùng để tái hiện case).
 */
function buildConditions(history: Set<string>, usedTemplates: Set<string>): Condition[] {
  const d = DATA.defaults;
  const order = templateOrder(usedTemplates);
  const conditions: Condition[] = [];
  const usedInRun = new Set<string>();

  const pickRoute = (tpl: ConditionTemplate, allowRepeat: boolean): [string, string] | null => {
    if (tpl.from && tpl.to) return [tpl.from, tpl.to];
    const fresh = candidateRoutes(tpl).filter(
      ([from, to]) =>
        !usedInRun.has([from, to].sort().join("-")) && (allowRepeat || !history.has(historyKey(from, to, tpl.tripType)))
    );
    return fresh.length ? pick(fresh) : null;
  };

  let cursor = 0;
  for (const allowRepeat of [false, true]) {
    for (let i = 0; conditions.length < CONDITIONS_PER_RUN && i < order.length * CONDITIONS_PER_RUN; i++) {
      const tpl = order[cursor++ % order.length];
      const route = pickRoute(tpl, allowRepeat);
      if (!route) continue;
      const [from, to] = route;
      const routeKey = [from, to].sort().join("-");
      if (usedInRun.has(routeKey)) continue;
      usedInRun.add(routeKey);

      const minDays = tpl.routeType === "domestic" ? d.domesticMinDays : d.internationalMinDays;
      const [aheadMin, aheadMax] = tpl.daysAhead ?? [minDays, minDays + d.randomExtraDays];
      const dayOffset = randInt(aheadMin, aheadMax);
      const [stayMin, stayMax] = tpl.stayDays ?? [d.returnAfterDaysMin, d.returnAfterDaysMax];
      const departDate = tpl.departDate ?? toYmd(daysFromNowToDate(dayOffset));
      const returnDate =
        tpl.tripType === "roundtrip"
          ? tpl.returnDate ?? toYmd(daysFromNowToDate(dayOffset + randInt(stayMin, stayMax)))
          : undefined;

      const isDomestic = isDomesticCode(from) && isDomesticCode(to);
      conditions.push({
        id: `cond-${conditions.length + 1}`,
        // Kèm tên thành phố/quốc gia 2 đầu (từ danh mục sân bay) cho dễ đọc báo cáo.
        description: `${tpl.id ? `${tpl.id} · ${tpl.description}` : tpl.description} — ${airportLabel(from)} → ${airportLabel(to)}`,
        templateKey: templateKey(tpl),
        from,
        to,
        flightType: isDomestic ? "DOMESTIC" : "INTERNATIONAL",
        itinerary: tpl.tripType === "roundtrip" ? 1 : 0,
        departDate,
        returnDate,
        adults: tpl.adults,
        children: tpl.children,
        infants: tpl.infants,
        repeated: history.has(historyKey(from, to, tpl.tripType)),
      });
    }
  }
  return conditions;
}

function buildWebResultUrl(c: Condition): string {
  const params = new URLSearchParams({
    adult: String(c.adults),
    child: String(c.children),
    infant: String(c.infants),
    itinerary: String(c.itinerary),
    f1: c.from,
    t1: c.to,
    df1: c.departDate,
    class: "economy",
  });
  if (c.returnDate) params.set("dt1", c.returnDate);
  return `${WEB_URL}/vi/flights/result?${params}`;
}

/** Body giống hệt body web gửi lên `/flights/search/`, chỉ bỏ field `airline` (meta tự gom mọi hãng). */
function buildMetaBody(c: Condition): MetasearchBody {
  const flights = [{ startPoint: c.from, endPoint: c.to, departDate: c.departDate }];
  if (c.returnDate) flights.push({ startPoint: c.to, endPoint: c.from, departDate: c.returnDate });
  return {
    adt: c.adults,
    chd: c.children,
    inf: c.infants,
    itinerary: c.itinerary,
    currency: DATA.defaults.currency,
    language: DATA.defaults.language,
    flightType: c.flightType,
    viewMode: "1",
    flights,
  };
}

/**
 * Kiểm tra deeplink meta trả cho đối tác có trỏ đúng route không: web hiểu
 * f1 = điểm đi, t1 = điểm đến (verify qua URL do form trang chủ submit ra).
 */
function checkDeeplink(link: string | undefined, c: Condition): string {
  if (!link) return "không có deeplink";
  const params = new URL(link).searchParams;
  const f1 = params.get("f1");
  const t1 = params.get("t1");
  if (f1 === c.from && t1 === c.to) return "OK";
  return `SAI: f1=${f1} t1=${t1} (mong đợi f1=${c.from} t1=${c.to})`;
}

test.describe("V2 — So sánh kết quả search: metasearch đối tác vs trang web gốc", () => {
  // Đây là tool thu thập/so sánh số liệu: chạy 1 lần, không retry (mỗi lần chạy = 5 search thật/bên).
  test.describe.configure({ retries: 0 });

  test(`search ${CONDITIONS_PER_RUN} điều kiện trên 2 trang và so sánh`, async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Chỉ cần chạy 1 browser");
    const clientId = process.env.META_CLIENT_ID;
    const username = process.env.META_USERNAME;
    const password = process.env.META_PASSWORD;
    test.skip(!clientId || !username || !password, "Thiếu META_CLIENT_ID / META_USERNAME / META_PASSWORD trong .env");

    expect(
      TEMPLATES.length,
      `Không có template nào khớp bộ lọc trip=${TRIP_FILTER} route=${ROUTE_FILTER} — xem "templates" trong metasearch-vs-web-v2.json`
    ).toBeGreaterThan(0);

    const d = DATA.defaults;
    test.setTimeout(CONDITIONS_PER_RUN * (Math.max(d.webTimeoutMs, d.metaTimeoutMs) + 2 * 60_000));

    // --dry-run (env META_DRY_RUN=1): chỉ in các điều kiện sẽ chạy — không đăng nhập, không search, không ghi lịch sử.
    if (process.env.META_DRY_RUN === "1") {
      const history = process.env.META_IGNORE_HISTORY === "1" ? [] : loadHistory();
      const planned = buildConditions(
        new Set(history.map((h) => h.key)),
        new Set(history.map((h) => h.template).filter((t): t is string => !!t))
      );
      console.log(`[metasearch-v2] DRY RUN — ${planned.length} điều kiện (${TEMPLATES.length} case khớp bộ lọc, lịch sử ${history.length}):`);
      console.log(`  ${AIRPORT_STATUS}`);
      for (const c of planned) {
        console.log(
          `  ${c.id.padEnd(7)} ${c.from}${c.itinerary ? "⇄" : "→"}${c.to} ${c.flightType === "DOMESTIC" ? "NĐ" : "QT"} ` +
            `${c.departDate}${c.returnDate ? " / " + c.returnDate : ""}  ${c.adults}NL ${c.children}TE ${c.infants}EB` +
            `${c.repeated ? " (lặp)" : ""}  — ${c.description}`
        );
      }
      return;
    }

    // Token đặt sẵn được ưu tiên; không có thì đăng nhập như web (lỗi đăng nhập → dừng luôn, báo rõ lý do) — làm
    // TRƯỚC khi tạo thư mục báo cáo để lỗi đăng nhập không để lại báo cáo rỗng.
    const webToken = WEB_API_TOKEN || (WEB_API_CREDENTIALS ? await loginWebApi(request, WEB_API_URL, WEB_API_CREDENTIALS) : "");
    const startedAt = new Date();
    const runDir = createRunDir();
    const summaryCsv = new CsvFile<Record<string, unknown>>(path.join(runDir, "summary.csv"), [
      "id", "description", "route", "flightType", "tripType", "departDate", "returnDate", "pax",
      "webStatus", "metaStatus", "webMs", "metaMs", "webRawItems", "metaRawItems",
      "metaOffers", "matched", "priceDiffs", "smallPriceDiffs", "feeDiffs", "withVoucher", "metaOnly", "webOnly",
      "searchedAt", "within24h", "within24hProblems", "metaDeeplinkRoute", "verdict", "webUrl",
    ]);
    const detailsCsv = new CsvFile<Record<string, unknown>>(path.join(runDir, "details.csv"), [...DETAIL_COLUMNS]);

    const credentials = { clientId: clientId!, username: username!, password: password! };
    // META_REVIEW=1 (cờ --review): mỗi điều kiện mở 2 tab (trang tool metasearch + trang web) trong
    // 1 browser riêng, KHÔNG đóng tab cũ; chạy xong browser vẫn mở để review. Dữ liệu meta lấy từ
    // đúng lượt search trên trang tool (người review thấy gì thì so cái đó).
    const review = process.env.META_REVIEW === "1";
    const reviewBrowser = review ? await launchReviewBrowser(runDir) : null;
    const tabs = reviewBrowser ? reviewBrowser.context : page.context();
    const meta = new MetasearchClient(request, META_API_URL, credentials);
    const webApi = webToken ? new WebSearchClient(request, WEB_API_URL, webToken, WEB_SYSTEMS) : null;
    console.log(
      webApi
        ? `[metasearch-v2] Web: gọi API trực tiếp ${WEB_API_URL}/flights/search/ (${WEB_API_TOKEN ? "WEB_API_TOKEN" : `đăng nhập ${WEB_API_CREDENTIALS!.username}@${WEB_API_CREDENTIALS!.clientId}`})`
        : "[metasearch-v2] Web: bắt qua browser — chưa đặt WEB_API_TOKEN hoặc WEB_API_CLIENT_ID/USERNAME/PASSWORD; response lớn (VD GALILEO_NDC) có thể không đọc được"
    );
    // HTML trang tool metasearch — dùng dựng bản sao "mở trang metaSearch" cho từng điều kiện trong report.
    const toolHtml = await request
      .get(`${META_API_URL}/static/tools/metasearch/`)
      .then((r) => (r.ok() ? r.text() : null))
      .catch(() => null);
    if (!review) await meta.login();

    // META_IGNORE_HISTORY=1 (cờ --repeat): lần này bỏ qua lịch sử, nhưng vẫn ghi thêm vào lịch sử.
    const ignoreHistory = process.env.META_IGNORE_HISTORY === "1";
    const history = loadHistory();
    const historyKeys = new Set(ignoreHistory ? [] : history.map((h) => h.key));
    const usedTemplates = new Set(history.map((h) => h.template).filter((t): t is string => !!t));
    const conditions = buildConditions(historyKeys, usedTemplates);
    const repeated = conditions.filter((c) => c.repeated).length;
    console.log(
      `[metasearch-v2] Lịch sử: ${history.length} điều kiện đã chạy (${HISTORY_FILE})` +
        (ignoreHistory ? " — lần này BỎ QUA lịch sử (--repeat)" : "") +
        (repeated ? ` — đã hết tổ hợp mới, ${repeated} điều kiện lặp lại (xoá lịch sử: yarn compare:metasearch:v2:clear)` : "")
    );
    console.log(
      `[metasearch-v2] ${conditions.length} điều kiện ` +
        (CUSTOM_TEMPLATE ? `(${CUSTOM_TEMPLATE.description})` : `(trip=${TRIP_FILTER}, route=${ROUTE_FILTER})`) +
        (PAX_OVERRIDE && !CUSTOM_TEMPLATE ? ` · khách: ${paxText(PAX_OVERRIDE)}` : "") +
        (AIRLINE_FILTER.length ? ` · chỉ hãng ${AIRLINE_FILTER.join(", ")}` : "") +
        `, báo cáo: ${runDir}`
    );
    console.log(`[metasearch-v2] ${AIRPORT_STATUS}`);
    const reports: ConditionReport[] = [];

    for (const c of conditions) {
      await test.step(`${c.id}: ${c.from}->${c.to} ${c.departDate}${c.returnDate ? "/" + c.returnDate : ""} — ${c.description}`, async () => {
        const route = `${c.from}${c.itinerary ? "<->" : "->"}${c.to}`;
        const dates = `${c.departDate}${c.returnDate ? " / " + c.returnDate : ""}`;
        const pax = `${c.adults}A ${c.children}C ${c.infants}I`;
        const webUrl = buildWebResultUrl(c);
        const metaBody = buildMetaBody(c);

        // Mỗi điều kiện dùng tab mới (sạch state/cache của lần search trước).
        const metaPage = review ? await tabs.newPage() : null;
        // Gọi API web trực tiếp thì chỉ mở tab web khi review (để xem); bắt qua browser thì luôn cần tab.
        const webPage = review || !webApi ? await tabs.newPage() : null;
        const searchWeb = webApi
          ? async () => {
              if (webPage) await webPage.goto(webUrl, { timeout: 120_000 }).catch(() => {});
              return webApi.search(metaBody, webUrl, d.webTimeoutMs);
            }
          : () => new FlightSearchApiCapture(webPage!).searchAndCapture(webUrl, d.webTimeoutMs);
        const searchMeta = metaPage
          ? async () => {
              const tool = new MetasearchToolPage(metaPage, META_API_URL);
              await tool.goto();
              await tool.login(credentials);
              return tool.searchAndCapture(metaBody, d.metaTimeoutMs);
            }
          : () => meta.search(metaBody, d.metaTimeoutMs);
        // Mốc tính "cất cánh trong 24h": lúc gửi search 2 bên.
        const searchedAt = new Date();
        const [webRes, metaRes] = await Promise.all([
          searchWeb(),
          searchMeta().catch((err: Error) => ({ status: 0, ms: 0, data: { message: err.message } as MetasearchResponse })),
        ]);
        if (metaPage) {
          await labelTab(metaPage, `[${c.id} META] ${route}`);
          if (webPage) await labelTab(webPage, `[${c.id} WEB] ${route}`);
        } else {
          await webPage?.close();
        }

        fs.writeFileSync(path.join(runDir, "raw", `${c.id}-web.json`), JSON.stringify({ condition: c, ...webRes }, null, 1));
        fs.writeFileSync(path.join(runDir, "raw", `${c.id}-meta.json`), JSON.stringify({ condition: c, request: metaBody, ...metaRes }, null, 1));

        const allWebItems: FareItem[] = webRes.searches.flatMap((s) => s.fareData);
        const allMetaItems: FareItem[] = metaRes.data.fareData ?? [];
        // --airline: chỉ so hành trình của hãng đã chọn (raw/ và trang meta vẫn giữ đủ dữ liệu).
        const webItems = allWebItems.filter(matchesAirline);
        const metaItems = allMetaItems.filter(matchesAirline);
        const description = c.description + (AIRLINE_FILTER.length ? ` · hãng ${AIRLINE_FILTER.join(", ")}` : "");
        if (AIRLINE_FILTER.length) {
          console.log(
            `    lọc hãng ${AIRLINE_FILTER.join(",")}: meta ${allMetaItems.length} → ${metaItems.length} item, web ${allWebItems.length} → ${webItems.length} item`
          );
        }
        const result = compareMetaAgainstWeb(metaItems, webItems, c.itinerary ? 2 : 1);
        markNearDeparture(result, searchedAt);
        const near = nearDepartureText(result.nearDeparture);

        const reloadNote = webRes.reloads ? `, tải lại trang ${webRes.reloads} lần` : "";
        const webStatus = webRes.timedOut
          ? `LỖI: ${webRes.error}`
          : `OK ${Math.round(webRes.ms / 1000)}s${reloadNote} (${webRes.searches.map((s) => `${(s.requestBody?.flights as { airline?: string }[] | undefined)?.[0]?.airline ?? "?"}=${s.status}/${s.fareData.length}`).join(" ")})`;
        const metaOk = metaRes.status === 200 && !metaRes.data.errorCode;
        const metaStatus = metaOk
          ? `OK ${metaRes.status} ${(metaRes.ms / 1000).toFixed(1)}s (${allMetaItems.length} item)`
          : `LỖI ${metaRes.status}: ${metaRes.data.message ?? ""}`;
        // 1 bên không lấy được dữ liệu thì không được kết luận KHỚP (0 = 0 chỉ là do thiếu dữ liệu).
        const verdict = webRes.timedOut || !metaOk
          ? `KHÔNG SO ĐƯỢC (${[webRes.timedOut && `web ${webRes.error}`, !metaOk && "meta lỗi"].filter(Boolean).join(", ")})`
          : result.priceDiffs + result.feeDiffs + result.metaOnly + result.webOnly === 0
            // Chênh < 1k là do làm tròn → vẫn KHỚP, kèm cảnh báo.
            ? "KHỚP" + (result.smallPriceDiffs ? ` · lệch giá dưới 1k: ${result.smallPriceDiffs}` : "")
            : [
                result.priceDiffs && `lệch giá ${result.priceDiffs}`,
                result.smallPriceDiffs && `lệch giá dưới 1k ${result.smallPriceDiffs}`,
                result.feeDiffs && `lệch phí ${result.feeDiffs}`,
                result.metaOnly && `chỉ meta có ${result.metaOnly}`,
                result.webOnly && `chỉ web có ${result.webOnly}`,
              ].filter(Boolean).join(", ");
        const deeplink = checkDeeplink(metaRes.data.fareData?.[0]?.dayViewDeeplinks, c);

        summaryCsv.append([{
          id: c.id,
          description,
          route,
          flightType: c.flightType,
          tripType: c.itinerary ? "roundtrip" : "oneway",
          departDate: c.departDate,
          returnDate: c.returnDate,
          pax,
          webStatus,
          metaStatus,
          webMs: webRes.ms,
          metaMs: metaRes.ms,
          webRawItems: allWebItems.length,
          metaRawItems: allMetaItems.length,
          metaOffers: result.metaOffers,
          matched: result.matched,
          priceDiffs: result.priceDiffs,
          smallPriceDiffs: result.smallPriceDiffs,
          feeDiffs: result.feeDiffs,
          withVoucher: result.withVoucher,
          metaOnly: result.metaOnly,
          webOnly: result.webOnly,
          searchedAt: searchedAt.toLocaleString("vi-VN"),
          within24h: result.nearDeparture?.total ?? 0,
          within24hProblems: result.nearDeparture?.problems ?? 0,
          metaDeeplinkRoute: deeplink,
          verdict,
          webUrl,
        }]);
        detailsCsv.append(result.rows.map((r) => detailToCsvRow(c.id, route, r)));

        const metaSnapshotHref = `meta/${c.id}.html`;
        writeMetaSnapshotHtml(
          path.join(runDir, metaSnapshotHref),
          { id: c.id, route, dates, pax, metaStatus, requestBody: metaBody },
          metaRes.data.fareData ?? []
        );
        const metaToolHref = toolHtml ? `meta/${c.id}-metasearch.html` : "";
        if (toolHtml) {
          writeMetaToolSnapshot(path.join(runDir, metaToolHref), toolHtml, {
            apiBaseUrl: META_API_URL,
            request: metaBody,
            status: metaRes.status,
            data: metaRes.data,
            airports: [c.from, c.to].map((code) => ({ code, isDomestic: isDomesticCode(code) })),
            label: `${c.id} · ${route} · ${dates} · ${pax}`,
            savedAt: new Date().toLocaleString("vi-VN"),
          });
        }
        reports.push({
          id: c.id, description, route, dates, pax, webStatus, metaStatus, deeplink, webUrl,
          metaSnapshotHref, metaToolHref, verdict, result, searchedAt: searchedAt.toLocaleString("vi-VN"),
        });
        // Chỉ ghi lịch sử khi so được cả 2 bên — điều kiện lỗi/timeout để lần sau chạy lại.
        if (!webRes.timedOut && metaOk) {
          const tripType = c.itinerary ? "roundtrip" : "oneway";
          appendHistory({
            key: historyKey(c.from, c.to, tripType), from: c.from, to: c.to, tripType,
            departDate: c.departDate, returnDate: c.returnDate, pax, verdict, runDir, at: new Date().toISOString(),
            template: c.templateKey,
          });
        }
        // Ghi lại report sau mỗi điều kiện: lỡ dừng giữa chừng vẫn có báo cáo phần đã chạy.
        writeHtmlReport(path.join(runDir, "report.html"), reports, startedAt);

        console.log(
          `[metasearch-v2] ${c.id} ${route} ${dates} ${pax} | meta=${result.metaOffers} web=${result.webResults.items} khớp=${result.matched} ` +
            `lệch giá=${result.priceDiffs} lệch<1k=${result.smallPriceDiffs} lệch phí=${result.feeDiffs} có voucher=${result.withVoucher} chỉ meta=${result.metaOnly} chỉ web=${result.webOnly} | deeplink=${deeplink} | => ${verdict}`
        );
        console.log(`    web: ${webStatus} | meta: ${metaStatus}`);
        if (near) console.log(`    ⏱ cất cánh trong 24h kể từ lúc search: ${near}`);
        result.warnings.forEach((w) => console.log(`    ⚠ ${w}`));

        // Chỉ fail khi 1 bên không trả được dữ liệu (lỗi/timeout); chênh lệch số liệu là KẾT QUẢ, ghi vào báo cáo.
        expect.soft(webRes.timedOut, `${c.id}: ${webRes.error} — ${webUrl}`).toBe(false);
        expect.soft(metaRes.status, `${c.id}: metasearch lỗi — ${metaStatus}`).toBe(200);
      });
    }

    await testInfo.attach("report", { path: path.join(runDir, "report.html"), contentType: "text/html" });
    if (reviewBrowser) {
      // Tab cuối: báo cáo của lần chạy này. Không đóng browser — chỉ ngắt kết nối khi test kết thúc.
      const reportPage = await reviewBrowser.context.newPage();
      await reportPage.goto(`file:///${path.join(runDir, "report.html").split(path.sep).join("/")}`);
      console.log(`[metasearch-v2] Chế độ review: browser vẫn mở (${conditions.length * 2} tab META/WEB + 1 tab báo cáo).`);
    }
    console.log(`[metasearch-v2] Xong. Báo cáo: ${path.join(runDir, "report.html")}`);
  });
});
