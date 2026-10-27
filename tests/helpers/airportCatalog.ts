import fs from "fs";
import path from "path";

/**
 * Danh mục sân bay của web (public/PLAN/airports.json — bản export danh sách điểm đi/đến của web) để
 * tool metasearch chọn ngẫu nhiên điểm đi/đến đa dạng hơn và hiện tên thành phố/quốc gia trong báo cáo.
 *
 * File gồm ~2.400 điểm, lẫn cả ga tàu, heliport, bãi thủy phi cơ, căn cứ quân sự, mã "TẤT CẢ CÁC SÂN BAY"
 * của thành phố → chỉ những điểm `kind = "airport"` mới được đưa vào pool chọn ngẫu nhiên.
 * - `featured`: điểm web đã xếp nhóm (có `subject`/`continent`, ~70 điểm: Việt Nam, Đông Nam Á, Đông Bắc Á,
 *   Tây Á, Hoa Kỳ - Canada, châu Âu, châu Úc, châu Phi) — đường bay phổ biến, gần như luôn có kết quả.
 * - còn lại: toàn bộ sân bay thế giới — dùng cho case "khám phá" (dễ ra 0 kết quả, có chủ đích).
 */

export type Airport = {
  code: string;
  name: string;
  city: string;
  country: string;
  continent: string;
  /** Nhóm web hiển thị: "Việt nam", "Đông Nam Á", "Đông Bắc Á", "Đông dương", "Tây Á", "Hoa kỳ - Canada". */
  subject: string;
  isDomestic: boolean;
  isPopular: boolean;
  /** Web đã xếp nhóm điểm này (có subject hoặc continent). */
  featured: boolean;
  kind: "airport" | "city" | "station" | "heliport" | "seaplane" | "military";
};

type RawAirport = Record<string, string | undefined>;

export const AIRPORTS_FILE = path.resolve(
  process.env.META_AIRPORTS_FILE || path.join(__dirname, "..", "..", "public", "PLAN", "airports.json")
);

function kindOf(a: RawAirport): Airport["kind"] {
  const text = `${a.nameVi ?? ""} ${a.nameEn ?? ""}`.toLowerCase();
  // Mã thành phố (NYC, LON, JKT…) — riêng LAX trong file cũng ghi "TẤT CẢ" nhưng nameEn là sân bay thật.
  if (text.includes("tất cả các sân bay") && !/international airport/.test(text)) return "city";
  if (/station|bahnhof|railway|rail |trạm xe lửa/.test(text)) return "station";
  if (/heliport/.test(text)) return "heliport";
  if (/seaplane|seaplace/.test(text)) return "seaplane";
  if (/air base|\bnas\b/.test(text)) return "military";
  return "airport";
}

function load(): Map<string, Airport> {
  const map = new Map<string, Airport>();
  if (!fs.existsSync(AIRPORTS_FILE)) return map;
  const raw = JSON.parse(fs.readFileSync(AIRPORTS_FILE, "utf-8")) as RawAirport[];
  for (const a of raw) {
    const code = String(a.code ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || map.has(code)) continue;
    map.set(code, {
      code,
      name: (a.nameVi || a.nameEn || "").trim(),
      city: (a.city ?? "").trim(),
      country: (a.country ?? "").trim(),
      continent: (a.continent ?? "").trim(),
      subject: (a.subject ?? "").trim(),
      isDomestic: a.isDomestic === "1",
      isPopular: a.isPopular === "1",
      featured: !!(a.subject || a.continent),
      kind: kindOf(a),
    });
  }
  return map;
}

/** Rỗng nếu không có file — khi đó tool dùng danh sách sân bay trong JSON cấu hình như cũ. */
export const AIRPORT_CATALOG = load();

export const findAirport = (code: string) => AIRPORT_CATALOG.get(code.toUpperCase());

/** "ICN (Seoul, Hàn quốc)" — mã không có trong danh mục thì trả nguyên mã. */
export function airportLabel(code: string): string {
  const a = findAirport(code);
  if (!a) return code;
  const place = [a.city || a.name, a.country].filter(Boolean).join(", ");
  return place ? `${code} (${place})` : code;
}

const isForeignAirport = (a: Airport) => !a.isDomestic && a.kind === "airport" && a.country !== "Việt Nam";

/** Sân bay Việt Nam (isDomestic = 1). */
export const domesticAirports = () => [...AIRPORT_CATALOG.values()].filter((a) => a.isDomestic).map((a) => a.code);

/** Sân bay nước ngoài web đã xếp nhóm (đường bay phổ biến). */
export const featuredInternational = () =>
  [...AIRPORT_CATALOG.values()].filter((a) => isForeignAirport(a) && a.featured).map((a) => a.code);

/** Mọi sân bay nước ngoài thật trong file (bỏ ga tàu, heliport, mã thành phố…). */
export const allInternational = () => [...AIRPORT_CATALOG.values()].filter(isForeignAirport).map((a) => a.code);

/** Mọi nhóm vùng có trong file (subject + continent), để báo lỗi khi template ghi sai tên vùng. */
export const knownRegions = () =>
  [...new Set([...AIRPORT_CATALOG.values()].flatMap((a) => [a.subject, a.continent]).filter(Boolean))];

/**
 * Sân bay nước ngoài thuộc 1 trong các vùng (khớp `subject` hoặc `continent`, không phân biệt hoa thường),
 * VD ["Đông Nam Á", "Đông dương"], ["Châu Âu"]. Vùng chỉ gồm điểm web đã xếp nhóm.
 */
export function airportsInRegions(regions: string[]): string[] {
  const wanted = regions.map((r) => r.trim().toLowerCase());
  return [...AIRPORT_CATALOG.values()]
    .filter((a) => isForeignAirport(a) && wanted.some((r) => a.subject.toLowerCase() === r || a.continent.toLowerCase() === r))
    .map((a) => a.code);
}
