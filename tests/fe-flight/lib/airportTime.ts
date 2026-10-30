import fs from "fs";
import path from "path";

/**
 * Thời gian bay THỰC = giờ đến − giờ đi, quy về UTC theo múi giờ sân bay.
 *
 * Vì sao cần: API trả `startTime`/`endTime` là giờ địa phương (chữ "Z" giả), còn `flight.duration` mỗi
 * system hiểu một kiểu (đã đo HAN→NRT: VN = thời gian thực; GALILEO_NDC = chỉ giờ bay, thiếu thời gian
 * nối chuyến; VJ = lệch đúng chênh múi giờ) → không field nào làm chuẩn được.
 *
 * Múi giờ: theo quốc gia (danh mục public/PLAN/airports.json có countryCode); nước nhiều múi giờ thì
 * tra theo sân bay. Không biết → null (bỏ qua kiểm thời gian bay, không đoán).
 */

const COUNTRY_TZ: Record<string, string> = {
  VN: "Asia/Ho_Chi_Minh", TH: "Asia/Bangkok", KH: "Asia/Phnom_Penh", LA: "Asia/Vientiane", MM: "Asia/Yangon",
  MY: "Asia/Kuala_Lumpur", SG: "Asia/Singapore", PH: "Asia/Manila", BN: "Asia/Brunei", TL: "Asia/Dili",
  JP: "Asia/Tokyo", KR: "Asia/Seoul", CN: "Asia/Shanghai", HK: "Asia/Hong_Kong", MO: "Asia/Macau", TW: "Asia/Taipei",
  IN: "Asia/Kolkata", LK: "Asia/Colombo", NP: "Asia/Kathmandu", BD: "Asia/Dhaka", BT: "Asia/Thimphu", MV: "Indian/Maldives",
  PK: "Asia/Karachi", AE: "Asia/Dubai", QA: "Asia/Qatar", SA: "Asia/Riyadh", KW: "Asia/Kuwait", BH: "Asia/Bahrain",
  OM: "Asia/Muscat", IL: "Asia/Jerusalem", JO: "Asia/Amman", TR: "Europe/Istanbul", IR: "Asia/Tehran", UZ: "Asia/Tashkent",
  GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", CH: "Europe/Zurich", AT: "Europe/Vienna", IT: "Europe/Rome", ES: "Europe/Madrid",
  PT: "Europe/Lisbon", DK: "Europe/Copenhagen", SE: "Europe/Stockholm", NO: "Europe/Oslo", FI: "Europe/Helsinki",
  PL: "Europe/Warsaw", CZ: "Europe/Prague", HU: "Europe/Budapest", GR: "Europe/Athens", RO: "Europe/Bucharest",
  BG: "Europe/Sofia", HR: "Europe/Zagreb", RS: "Europe/Belgrade", UA: "Europe/Kyiv", IS: "Atlantic/Reykjavik",
  LU: "Europe/Luxembourg", EG: "Africa/Cairo", ZA: "Africa/Johannesburg", KE: "Africa/Nairobi", ET: "Africa/Addis_Ababa",
  MA: "Africa/Casablanca", NG: "Africa/Lagos", NZ: "Pacific/Auckland", GU: "Pacific/Guam", FJ: "Pacific/Fiji",
};

/** Nước nhiều múi giờ: tra theo sân bay. */
const AIRPORT_TZ: Record<string, string> = {
  LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles", SAN: "America/Los_Angeles",
  LAS: "America/Los_Angeles", PDX: "America/Los_Angeles", SJC: "America/Los_Angeles", OAK: "America/Los_Angeles",
  JFK: "America/New_York", EWR: "America/New_York", LGA: "America/New_York", BOS: "America/New_York",
  IAD: "America/New_York", DCA: "America/New_York", ATL: "America/New_York", MIA: "America/New_York",
  PHL: "America/New_York", MCO: "America/New_York", DTW: "America/New_York", CLT: "America/New_York",
  ORD: "America/Chicago", MDW: "America/Chicago", DFW: "America/Chicago", IAH: "America/Chicago", MSP: "America/Chicago",
  DEN: "America/Denver", SLC: "America/Denver", PHX: "America/Phoenix", HNL: "Pacific/Honolulu", ANC: "America/Anchorage",
  YVR: "America/Vancouver", YYZ: "America/Toronto", YUL: "America/Toronto", YOW: "America/Toronto",
  YYC: "America/Edmonton", YEG: "America/Edmonton",
  SYD: "Australia/Sydney", CBR: "Australia/Sydney", MEL: "Australia/Melbourne", BNE: "Australia/Brisbane",
  OOL: "Australia/Brisbane", CNS: "Australia/Brisbane", PER: "Australia/Perth", ADL: "Australia/Adelaide", DRW: "Australia/Darwin",
  CGK: "Asia/Jakarta", SUB: "Asia/Jakarta", YIA: "Asia/Jakarta", DPS: "Asia/Makassar", UPG: "Asia/Makassar",
  SVO: "Europe/Moscow", DME: "Europe/Moscow", VKO: "Europe/Moscow", LED: "Europe/Moscow", VVO: "Asia/Vladivostok",
  ALA: "Asia/Almaty", NQZ: "Asia/Almaty", ULN: "Asia/Ulaanbaatar",
};
const MULTI_TZ = new Set(["US", "CA", "AU", "ID", "RU", "BR", "MX", "KZ", "MN", "CL"]);

const AIRPORTS_FILE = path.resolve(process.env.META_AIRPORTS_FILE || path.join(__dirname, "..", "..", "..", "public", "PLAN", "airports.json"));
/** Mã sân bay → countryCode (đọc thẳng danh mục, không đụng helper của tool metasearch). */
const COUNTRY_OF = new Map<string, string>(
  fs.existsSync(AIRPORTS_FILE)
    ? (JSON.parse(fs.readFileSync(AIRPORTS_FILE, "utf8")) as { code?: string; countryCode?: string }[])
        .filter((a) => a.code && a.countryCode)
        .map((a) => [String(a.code).toUpperCase(), String(a.countryCode).toUpperCase()] as [string, string])
    : []
);

export function airportTimeZone(code: string): string | null {
  if (AIRPORT_TZ[code]) return AIRPORT_TZ[code];
  const country = COUNTRY_OF.get(code.toUpperCase()) ?? "";
  if (!country || MULTI_TZ.has(country)) return null;
  return COUNTRY_TZ[country] ?? null;
}

/** Độ lệch (phút) của múi giờ `tz` tại thời điểm UTC `ms`. */
function offsetMin(tz: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - Math.floor(ms / 60_000) * 60_000) / 60_000;
}

/** Giờ địa phương "YYYY-MM-DDTHH:mm…" (bỏ qua "Z") tại `tz` → mốc UTC (ms). */
function wallToUtc(wall: string, tz: string): number {
  const asUtc = Date.parse(`${wall.slice(0, 16)}:00Z`);
  let utc = asUtc - offsetMin(tz, asUtc) * 60_000;
  utc = asUtc - offsetMin(tz, utc) * 60_000;
  return utc;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 1 mốc giờ API (giờ địa phương sân bay, "Z" giả) cho báo cáo: giờ địa phương như web hiển thị, múi giờ
 * sân bay ("GMT+7") và giờ GMT ("17:25 19/12"); không biết múi giờ → offset/gmt null.
 */
export function timeInfo(wall: string, code: string): { local: string; offset: string | null; gmt: string | null } {
  const local = String(wall).slice(11, 16);
  const tz = airportTimeZone(code);
  if (!tz || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(wall)) return { local, offset: null, gmt: null };
  const utc = wallToUtc(wall, tz);
  const off = Math.round((Date.parse(`${wall.slice(0, 16)}:00Z`) - utc) / 60_000);
  const d = new Date(utc);
  return {
    local,
    offset: `GMT${off < 0 ? "−" : "+"}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${pad(Math.abs(off) % 60)}` : ""}`,
    gmt: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`,
  };
}

/** Phút bay thực từ (giờ đi, sân bay đi) → (giờ đến, sân bay đến); null nếu thiếu múi giờ. */
export function elapsedMinutes(startTime: string, from: string, endTime: string, to: string): { minutes: number | null; missing: string[] } {
  const tzFrom = airportTimeZone(from);
  const tzTo = airportTimeZone(to);
  const missing = [!tzFrom && from, !tzTo && to].filter(Boolean) as string[];
  if (!tzFrom || !tzTo) return { minutes: null, missing };
  return { minutes: Math.round((wallToUtc(endTime, tzTo) - wallToUtc(startTime, tzFrom)) / 60_000), missing };
}
