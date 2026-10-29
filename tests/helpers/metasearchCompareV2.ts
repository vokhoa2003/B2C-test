/**
 * V2 — so khớp danh sách chuyến bay metasearch vs web, LẤY META LÀM CHUẨN (bản v1:
 * metasearchCompare.ts, giữ nguyên). Cách ghép hành trình giống v1 (system + số hiệu mọi segment
 * bỏ tiền tố hãng + giờ đi/đáp; ưu tiên combo, không có thì ghép 2 chặng lẻ).
 *
 * CÔNG THỨC GIÁ (theo traveleasy-cms từ 28/10 — includeMarkupFees() trong metasearch.utils.ts):
 *   - META: `totalAmount` trả về ĐÃ GỒM phí markup (cộng vào tax/total của NL, TE — em bé không tính phí)
 *     và đã trừ voucher AUTO_APPLY → giá so sánh = totalAmount + estimatedVoucherDiscount, KHÔNG cộng phí nữa.
 *     Response cũ (trước 28/10, deeplink total_amount = totalAmount + serviceFeeAmount) thì vẫn cộng serviceFeeAmount.
 *   - WEB: FE tự cộng phí → giá so sánh = giá vé hạng đó + (phí ADULT × số NL + phí CHILD × số TE) của từng chiều
 *     - giá vé hệ GALILEO (GALILEO_NDC / GALILEO, như isGalileoSystem của web): `totalAmount`;
 *     - system khác (VN, VJ, VU, 9G…): NL × totalAdt + TE × totalChd + EB × totalInf (giá 1 người);
 *     - combo khứ hồi: giá trọn gói ở chặng đầu, phí × 2; 2 chặng lẻ: mỗi chiều cộng phí của chính nó.
 *   - Em bé: không cộng phí, không trừ voucher → giá em bé meta phải bằng web (lệch thì cảnh báo).
 *   - KHỚP = giá so sánh meta bằng 1 trong các hạng vé web; giá vé (trừ phí) bằng nhau mà giá so sánh khác → LỆCH PHÍ.
 *   - Mỗi giá kèm HẠNG GHẾ của nó: cabinClass + fareType (VD "Eco · A", "ECONOMY LITE · E").
 *
 * - Vẫn cảnh báo nếu totalAmount ≠ tổng theo số khách (lỗi cũ chỉ cộng 1 người lớn) để theo dõi.
 */

export type FareInventory = {
  totalAmount?: number | null;
  cabinClass?: string | null;
  /** Hạng đặt chỗ theo số hiệu chuyến, VD { "VJ899": "A" }. */
  fareType?: Record<string, string> | null;
  adt?: number;
  chd?: number;
  inf?: number;
  totalAdt?: number | null;
  totalChd?: number | null;
  totalInf?: number | null;
};

/** Hạng ghế của 1 inventory: "Eco · A", "ECONOMY LITE · E" (nhiều segment khác hạng: "Economy · K/Y"). */
export function cabinLabel(inv: FareInventory | undefined): string {
  if (!inv) return "";
  const classes = [...new Set(Object.values(inv.fareType ?? {}).filter(Boolean))].join("/");
  return [inv.cabinClass, classes].filter(Boolean).join(" · ");
}

/** Tổng theo số khách: NL × totalAdt + TE × totalChd + EB × totalInf (giá vé v2 cho system không phải GALILEO). */
export function paxTotal(inv: FareInventory): number | null {
  if (typeof inv.totalAdt !== "number") return typeof inv.totalAmount === "number" ? inv.totalAmount : null;
  return (inv.adt ?? 1) * inv.totalAdt + (inv.chd ?? 0) * (inv.totalChd ?? 0) + (inv.inf ?? 0) * (inv.totalInf ?? 0);
}

/** "totalAmount 6.757.000 ≠ tổng theo số khách 10.197.000" nếu 2 số lệch nhau, ngược lại null. */
export function totalAmountGap(inv: FareInventory | undefined): string | null {
  if (!inv || typeof inv.totalAmount !== "number" || typeof inv.totalAdt !== "number") return null;
  const expected = paxTotal(inv)!;
  if (Math.abs(expected - inv.totalAmount) < 1) return null;
  const fmt = (v: number) => Math.round(v).toLocaleString("vi-VN");
  return `totalAmount ${fmt(inv.totalAmount)} ≠ tổng theo số khách ${fmt(expected)} (${inv.adt ?? 1} NL × ${fmt(inv.totalAdt)}${inv.chd ? ` + ${inv.chd} TE × ${fmt(inv.totalChd ?? 0)}` : ""}${inv.inf ? ` + ${inv.inf} EB × ${fmt(inv.totalInf ?? 0)}` : ""})`;
}
export type FareSegment = {
  airline: string;
  flightNumber: string;
  startPoint: string;
  endPoint: string;
  startTime: string;
  endTime?: string;
};
export type FareLeg = { leg: number; segments: FareSegment[]; inventories?: FareInventory[]; fees?: FareFee[] };
export type FareFee = { amount?: number; paxType?: string; isTemp?: boolean };
export type FareItem = {
  system?: string;
  airline?: string;
  totalAmount?: number | null;
  flights: FareLeg[];
  /** Web: phí hệ thống, FE tự cộng. */
  fees?: FareFee[];
  /** Meta: chứa `out_system`/`in_system` (system thật của từng chiều). */
  deeplinks?: string;
  /** Meta: phí hệ thống đã tính sẵn (không nằm trong totalAmount). */
  serviceFeeAmount?: number | null;
  /** Meta: `inventory.fareID` của offer, hoặc "{out}_{in}" với cặp khứ hồi ghép từ 2 chiều. */
  compositeFareId?: string | null;
  /** Meta: voucher AUTO_APPLY ước tính, đã trừ vào totalAmount. */
  estimatedVoucherCode?: string | null;
  estimatedVoucherDiscount?: number | null;
};

export type LegInfo = {
  dir: number;
  flightNumbers: string;
  route: string;
  depart: string;
  arrive: string;
  airline: string;
  key: string;
  prices: number[];
  /** Hạng ghế ứng với từng giá trong `prices` (key = giá). */
  classes: Record<string, string>;
  /** Inventory ứng với từng giá (để đối chiếu giá em bé). */
  inventories: Record<string, FareInventory>;
};

export type DetailStatus = "KHỚP" | "LỆCH GIÁ" | "Lệch giá dưới 1k" | "LỆCH PHÍ" | "CHỈ CÓ Ở META" | "CHỈ CÓ Ở WEB";

/**
 * Chênh giá nhỏ hơn mức này (VND) coi là do LÀM TRÒN (meta có giá lẻ thập phân sau khi phân bổ voucher)
 * → trạng thái cảnh báo "Lệch giá dưới 1k", không tính là lệch giá.
 */
export const SMALL_PRICE_DIFF = 1000;

export type DetailRow = {
  status: DetailStatus;
  /** Bên đang có chuyến này: META (đối chiếu sang web) hoặc WEB (meta không có). */
  side: "META" | "WEB";
  system: string;
  airline: string;
  legs: LegInfo[];
  /** totalAmount meta trả về (ĐÃ trừ voucher). */
  metaPrice: number | null;
  voucherCode: string;
  voucherDiscount: number;
  /** Giá so sánh meta = metaPrice + voucherDiscount (đã gồm phí) — đem so với giá vé + phí của web. */
  metaBasePrice: number | null;
  /** Giá từng chiều của meta (đã trừ voucher phần phân bổ vào chiều đó). */
  metaLegPrices: (number | null)[];
  /** Mọi giá so sánh web có cho hành trình này (giá vé từng hạng + phí). */
  webPrices: number[];
  webLegPrices: number[][];
  /** Giá web gần với giá meta gốc nhất (để tính chênh lệch). */
  webClosestPrice: number | null;
  /** metaBasePrice − webClosestPrice (cả 2 đều là giá so sánh: đã gồm phí, trước voucher). */
  diff: number | null;
  diffLegs: string;
  /** Phí: meta = serviceFeeAmount (đã nằm trong giá); web = phí theo công thức. */
  metaServiceFee: number | null;
  webServiceFee: number | null;
  /** Giá so sánh: meta = totalAmount + voucher (đã gồm phí); web = giá vé + phí công thức. */
  metaFinal: number | null;
  webFinal: number | null;
  webSource: "" | "combo" | "2 chặng lẻ";
  /** Số item meta trùng y hệt (cùng hành trình, system, giá) được gộp vào dòng này. */
  metaDuplicates: number;
  note: string;
  /** Hạng ghế của giá meta (mỗi chiều 1 hạng, nối " | "). */
  metaClass: string;
  /** Hạng ghế ứng với từng giá web trong `webPrices` (key = giá). */
  webClasses: Record<string, string>;
  /** Dữ liệu API 2 bên (fare/tax/fee/total từng loại khách, phí, voucher) + cách ra giá so sánh. */
  breakdown?: { meta?: SideBreakdown; web?: SideBreakdown };
  /** Item gốc API của hành trình (meta: offer; web: mọi item combo / chặng lẻ đã dùng) — để lưu JSON khi lệch. */
  raw?: { meta?: FareItem; web: FareItem[] };
  /** Đường dẫn (từ report.html) tới file JSON đã lưu của hành trình này. */
  jsonHref?: string;
  /** Số giờ từ lúc search tới giờ cất cánh chặng đi (markNearDeparture gắn); < 0 = đã qua giờ bay. */
  hoursToDepart?: number | null;
};

export type CompareResult = {
  rows: DetailRow[];
  metaOffers: number;
  /**
   * Số kết quả web nhận về: `items` = tổng fareData mọi system; `combos` = hành trình đủ chiều
   * (1 chiều: mỗi chuyến); `outLegs` / `inLegs` = chặng lẻ chiều đi / về (khứ hồi bán tách chiều).
   */
  webResults: { items: number; combos: number; outLegs: number; inLegs: number };
  matched: number;
  priceDiffs: number;
  /** Lệch giá |chênh| < SMALL_PRICE_DIFF — cảnh báo, không tính vào priceDiffs. */
  smallPriceDiffs: number;
  feeDiffs: number;
  metaOnly: number;
  webOnly: number;
  /** Số hành trình meta có voucher AUTO_APPLY trừ sẵn. */
  withVoucher: number;
  /**
   * Cảnh báo dữ liệu: inventory có `totalAmount` khác tổng theo số khách, gom theo bên + system,
   * VD "WEB VJ: 21 hạng vé — VD VJ975: totalAmount 6.757.000 ≠ tổng theo số khách 10.197.000 (…)".
   */
  warnings: string[];
  /**
   * Hành trình cất cánh trong NEAR_DEPARTURE_HOURS giờ kể từ lúc search (markNearDeparture gắn):
   * `total` dòng, `problems` dòng lệch/thiếu, `departed` dòng đã qua giờ bay mà vẫn được trả về.
   */
  nearDeparture?: { total: number; problems: number; departed: number };
};

/** Chuyến cất cánh trong chừng này giờ kể từ lúc search = "trong 24h" (đóng bán sớm, giá giờ chót…). */
export const NEAR_DEPARTURE_HOURS = 24;

/**
 * Gắn `hoursToDepart` cho từng dòng = giờ cất cánh chặng đi đầu tiên − lúc search, và đếm `nearDeparture`.
 * `startTime` API trả là giờ địa phương sân bay đi (dù có hậu tố "Z") → đọc như giờ đồng hồ, so với giờ máy
 * chạy test (VN). Chặng xuất phát ở nước ngoài lệch múi giờ so với VN → sai số bằng độ lệch múi giờ.
 */
export function markNearDeparture(result: CompareResult, searchedAt: Date): void {
  const near = { total: 0, problems: 0, departed: 0 };
  for (const row of result.rows) {
    const out = row.legs.find((l) => l.dir === 0) ?? row.legs[0];
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(out?.depart ?? "");
    if (!m) {
      row.hoursToDepart = null;
      continue;
    }
    const depart = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    row.hoursToDepart = Math.round(((depart.getTime() - searchedAt.getTime()) / 3_600_000) * 100) / 100;
    if (row.hoursToDepart >= NEAR_DEPARTURE_HOURS) continue;
    near.total++;
    if (row.hoursToDepart < 0) near.departed++;
    if (row.status !== "KHỚP" && row.status !== "Lệch giá dưới 1k") near.problems++;
  }
  result.nearDeparture = near;
}

function totalAmountWarnings(side: "WEB" | "META", items: FareItem[]): string[] {
  const bySystem = new Map<string, { count: number; example: string }>();
  for (const item of items) {
    for (const leg of item.flights ?? []) {
      for (const inv of leg.inventories ?? []) {
        const gap = totalAmountGap(inv);
        if (!gap) continue;
        const system = normSystem(item.system);
        const entry = bySystem.get(system) ?? { count: 0, example: `${leg.segments.map((sg) => sg.flightNumber).join("-")}: ${gap}` };
        entry.count++;
        bySystem.set(system, entry);
      }
    }
  }
  return [...bySystem].map(([system, e]) => `${side} ${system}: ${e.count} hạng vé có totalAmount lệch — VD ${e.example}`);
}

/** Meta trả `serviceFeeAmount` khác phí tính theo công thức v2 → cảnh báo (gom theo system). */
function serviceFeeWarnings(metaItems: FareItem[], dirCount: number): string[] {
  const bySystem = new Map<string, { count: number; example: string }>();
  for (const item of metaItems) {
    if (typeof item.serviceFeeAmount !== "number") continue;
    const inv = item.flights?.[0]?.inventories?.[0];
    const pax = { adt: Number(inv?.adt ?? 1), chd: Number(inv?.chd ?? 0) };
    // Như CMS: COMBINED = phí chiều đầu × số chiều; SEPARATE = mỗi chiều phí của chính nó.
    const legs = item.flights ?? [];
    const combined = legs.length > 1 && !String(item.compositeFareId ?? "").includes("_");
    const formula = combined || legs.length <= 1
      ? feeByFormula(legs[0]?.fees ?? item.fees, pax, dirCount)
      : round2(legs.reduce((sum, l) => sum + feeByFormula(l.fees ?? item.fees, pax, 1), 0));
    if (Math.abs(formula - item.serviceFeeAmount) < 1) continue;
    const system = normSystem(item.system);
    const entry = bySystem.get(system) ?? {
      count: 0,
      example: `${(item.flights ?? []).map((l) => l.segments.map((sg) => sg.flightNumber).join("-")).join(" + ")}: serviceFeeAmount ${item.serviceFeeAmount.toLocaleString("vi-VN")} ≠ công thức ${formula.toLocaleString("vi-VN")}`,
    };
    entry.count++;
    bySystem.set(system, entry);
  }
  return [...bySystem].map(([system, e]) => `META ${system}: ${e.count} hành trình có serviceFeeAmount khác phí theo công thức — VD ${e.example}`);
}

/** Meta có giá lẻ thập phân (VD 568257.38) — làm tròn 2 số để tránh sai số float. */
const round2 = (v: number) => Math.round(v * 100) / 100;

const positive = (values: (number | null | undefined)[]) =>
  [...new Set(values.filter((v): v is number => typeof v === "number" && v > 0).map(round2))].sort((a, b) => a - b);

/**
 * Số hiệu dùng để GHÉP chuyến: bỏ tiền tố mã hãng nếu có. Cùng 1 chuyến, web ghi "VN6002" còn
 * meta có lúc ghi "6002" (đã gặp thật) — giờ bay, giá giống hệt, chỉ khác cách ghi số hiệu.
 */
const flightNumberKey = (seg: FareSegment) => {
  const fn = String(seg.flightNumber ?? "").toUpperCase().trim();
  const airline = String(seg.airline ?? "").toUpperCase();
  return airline && fn.startsWith(airline) && /^\d/.test(fn.slice(airline.length)) ? fn.slice(airline.length) : fn;
};

/** Như isGalileoSystem của web (utils/flight/isGalileoSystem.ts). */
const isGalileo = (system?: string | null) => system === "GALILEO_NDC" || system === "GALILEO";

/** Giá vé v2 của 1 inventory: GALILEO dùng totalAmount, system khác dùng tổng theo số khách. */
const ticketPrice = (inv: FareInventory, system?: string | null) => (isGalileo(system) ? inv.totalAmount : paxTotal(inv));

function toLegInfo(leg: FareLeg, dirCount: number, system?: string | null): LegInfo {
  const segs = leg.segments ?? [];
  const flightNumbers = segs.map((s) => s.flightNumber).join("-");
  const depart = segs[0]?.startTime ?? "?";
  const arrive = segs[segs.length - 1]?.endTime ?? "?";
  return {
    dir: Math.min(Math.max(leg.leg ?? 0, 0), dirCount - 1),
    flightNumbers,
    route: [segs[0]?.startPoint, ...segs.map((s) => s.endPoint)].join("-"),
    depart,
    arrive,
    airline: segs[0]?.airline ?? "?",
    key: `${segs.map(flightNumberKey).join("-")}|${depart}|${arrive}`,
    ...priceLevels(leg.inventories ?? [], (i) => ticketPrice(i, system)),
  };
}

/** Giá (đã cộng `extra`, VD phí) từng hạng + hạng ghế / inventory của giá đó. Cùng giá nhiều hạng: ghi hạng đầu tiên. */
function priceLevels(inventories: FareInventory[], price: (inv: FareInventory) => number | null | undefined, extra = 0) {
  const classes: Record<string, string> = {};
  const invByPrice: Record<string, FareInventory> = {};
  for (const inv of inventories) {
    const p = price(inv);
    if (typeof p !== "number" || p <= 0) continue;
    const key = String(round2(p + extra));
    classes[key] ??= cabinLabel(inv);
    invByPrice[key] ??= inv;
  }
  return { prices: Object.keys(classes).map(Number).sort((a, b) => a - b), classes, inventories: invByPrice };
}

type Pax = { adt: number; chd: number };

/** Giá 1 loại khách API trả: số khách + fare/tax/fee/total của 1 người. */
export type PaxPrice = { n: number; fare: number | null; tax: number | null; fee: number | null; total: number | null };
/** 1 inventory (1 chiều, hạng đã chọn) đúng như API trả. */
export type InvBreakdown = { dir: number; flight: string; cls: string; adt: PaxPrice; chd: PaxPrice; inf: PaxPrice; totalAmount: number | null };
/** Dữ liệu API 1 bên của 1 hành trình + các bước tính ra giá so sánh. */
export type SideBreakdown = {
  invs: InvBreakdown[];
  /** Phí markup (`fees`): meta theo từng chiều, web của item. */
  fees: { dir: number | null; paxType: string; amount: number }[];
  /** Các dòng giải thích cách ra giá so sánh. */
  formula: string[];
};

const fmt = (v: number | null | undefined) => (typeof v === "number" ? round2(v).toLocaleString("vi-VN") : "—");
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

function invBreakdown(inv: FareInventory | undefined, leg: LegInfo | undefined, dir: number): InvBreakdown {
  const raw = (inv ?? {}) as Record<string, unknown>;
  const pax = (suffix: "Adt" | "Chd" | "Inf", count: string): PaxPrice => ({
    n: Number(raw[count] ?? 0),
    fare: numOrNull(raw[`fare${suffix}`]),
    tax: numOrNull(raw[`tax${suffix}`]),
    fee: numOrNull(raw[`fee${suffix}`]),
    total: numOrNull(raw[`total${suffix}`]),
  });
  return {
    dir,
    flight: leg?.flightNumbers ?? "",
    cls: cabinLabel(inv),
    adt: pax("Adt", "adt"),
    chd: pax("Chd", "chd"),
    inf: pax("Inf", "inf"),
    totalAmount: numOrNull(raw.totalAmount),
  };
}

/** "3 × 2.146.181 + 2 × 2.087.591 + 1 × 186.000 = 10.799.725" (system thường) hoặc "totalAmount 8.028.000" (GALILEO). */
function ticketText(inv: FareInventory | undefined, system?: string | null): string {
  if (!inv) return "—";
  if (isGalileo(system)) return `totalAmount ${fmt(inv.totalAmount)}`;
  const parts = [
    [inv.adt ?? 1, inv.totalAdt],
    [inv.chd ?? 0, inv.totalChd],
    [inv.inf ?? 0, inv.totalInf],
  ].filter(([n]) => Number(n) > 0).map(([n, p]) => `${n} × ${fmt(p as number)}`);
  return `${parts.join(" + ")} = ${fmt(ticketPrice(inv, system))}`;
}

/** "(ADULT 50.000 × 2 + CHILD 50.000 × 1) × 2 = 300.000" — em bé không tính. */
function feeText(fees: FareFee[] | undefined, pax: Pax, dirCount: number): string {
  const parts = (fees ?? [])
    .filter((f) => (f.paxType === "ADULT" && pax.adt) || (f.paxType === "CHILD" && pax.chd))
    .map((f) => `${f.paxType} ${fmt(Number(f.amount || 0))} × ${f.paxType === "ADULT" ? pax.adt : pax.chd}`);
  if (!parts.length) return "0";
  const body = parts.length > 1 || dirCount > 1 ? `(${parts.join(" + ")})` : parts[0];
  return `${body}${dirCount > 1 ? ` × ${dirCount}` : ""} = ${fmt(feeByFormula(fees, pax, dirCount))}`;
}

/** Hành trình chỉ web có: dữ liệu API của hạng rẻ nhất (giá chưa cộng phí). */
function webOnlyBreakdown(inv: FareInventory | undefined, leg: LegInfo, dir: number, system: string, fees: FareFee[]): DetailRow["breakdown"] {
  return {
    web: {
      invs: [invBreakdown(inv, leg, dir)],
      fees: feeList(fees, null),
      formula: [`hạng rẻ nhất, vé: ${ticketText(inv, system)}`, "(chưa cộng phí)"],
    },
  };
}

const feeList = (fees: FareFee[] | undefined, dir: number | null) =>
  (fees ?? []).map((f) => ({ dir, paxType: String(f.paxType ?? "?"), amount: Number(f.amount || 0) }));

/** Phí theo công thức v2: (phí ADULT × NL + phí CHILD × TE) × số chiều. INFANT không tính. */
function feeByFormula(fees: FareFee[] | undefined, pax: Pax, dirCount: number): number {
  const perTrip = (fees ?? []).reduce((sum, f) => {
    const amount = Number(f?.amount || 0);
    if (f?.paxType === "ADULT") return sum + amount * pax.adt;
    if (f?.paxType === "CHILD") return sum + amount * pax.chd;
    return sum;
  }, 0);
  return round2(perTrip * dirCount);
}

/** Web ghi "_9G", deeplink meta ghi "9G" — bỏ "_" đầu để so được. */
const normSystem = (system?: string | null) => (system || "UNKNOWN").replace(/^_+/, "");

/**
 * System thật của từng chiều trong 1 item meta. Meta có thể ghép 2 chiều khác hãng
 * (VD đi 9G + về VU) nhưng `system` của item chỉ ghi 1 giá trị — system từng chiều
 * nằm trong deeplink (`out_system`, `in_system`).
 */
function metaLegSystems(item: FareItem, legCount: number): string[] {
  const fallback = normSystem(item.system);
  let params: URLSearchParams | null = null;
  try {
    params = item.deeplinks ? new URL(item.deeplinks).searchParams : null;
  } catch {
    // Deeplink hỏng: dùng system của item.
  }
  return Array.from({ length: legCount }, (_, i) =>
    normSystem(params?.get(i === 0 ? "out_system" : "in_system") || fallback)
  );
}

const itinKey = (system: string, legs: LegInfo[]) => `${system}#${legs.map((l) => l.key).join("#")}`;
const legIndexKey = (system: string, leg: LegInfo) => `${system}#${leg.dir}#${leg.key}`;

/** 1 mức giá web: giá so sánh (vé + phí), giá vé, hạng ghế, inventory. */
type WebLevel = { final: number; ticket: number; cls: string; inv: FareInventory };
type WebTickets = Map<number, { cls: string; inv: FareInventory }>;
type WebCombo = { system: string; airline: string; legs: LegInfo[]; fees: FareFee[]; tickets: WebTickets; used: boolean; items: FareItem[] };
type WebSplitLeg = { system: string; leg: LegInfo; fees: FareFee[]; tickets: WebTickets; used: boolean; items: FareItem[] };

function indexWeb(items: FareItem[], dirCount: number) {
  const combos = new Map<string, WebCombo>();
  const splitLegs = new Map<string, WebSplitLeg>();
  const addTickets = (target: WebTickets, leg: LegInfo) => {
    for (const p of leg.prices) if (!target.has(p)) target.set(p, { cls: leg.classes[String(p)], inv: leg.inventories[String(p)] });
  };
  for (const item of items) {
    const system = normSystem(item.system);
    const legs = [...(item.flights ?? [])].sort((a, b) => a.leg - b.leg).map((l) => toLegInfo(l, dirCount, item.system));
    if (!legs.length) continue;
    if (legs.length >= dirCount) {
      const key = itinKey(system, legs);
      const combo = combos.get(key) ?? { system, airline: item.airline || legs[0].airline, legs, fees: item.fees ?? [], tickets: new Map(), used: false, items: [] };
      combo.items.push(item);
      // Web combo để giá trọn gói trên inventory của chặng đầu (lặp lại ở chặng sau).
      addTickets(combo.tickets, legs[0]);
      combos.set(key, combo);
      continue;
    }
    for (const leg of legs) {
      const key = legIndexKey(system, leg);
      const split = splitLegs.get(key) ?? { system, leg, fees: item.fees ?? [], tickets: new Map(), used: false, items: [] };
      if (!split.items.includes(item)) split.items.push(item);
      addTickets(split.tickets, leg);
      splitLegs.set(key, split);
    }
  }
  return { combos, splitLegs };
}

/** Các mức giá so sánh web = giá vé từng hạng + phí, sắp tăng dần. */
const webLevels = (tickets: WebTickets, fee: number): WebLevel[] =>
  [...tickets].map(([ticket, t]) => ({ final: round2(ticket + fee), ticket, cls: t.cls, inv: t.inv })).sort((a, b) => a.final - b.final);

const closest = (target: number | null, candidates: number[]) =>
  target === null || !candidates.length
    ? candidates[0] ?? null
    : candidates.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));

const sub = (a: number | null, b: number | null) => (a !== null && b !== null ? round2(a - b) : null);

const DIR_LABEL = ["chiều đi", "chiều về"];

/** `total_amount` của deeplink meta (giá cuối khách trả). */
function deeplinkTotal(item: FareItem): number | null {
  try {
    const v = item.deeplinks ? new URL(item.deeplinks).searchParams.get("total_amount") : null;
    return v !== null && v !== "" && !isNaN(Number(v)) ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * Meta đã cộng phí vào `totalAmount` chưa: từ 28/10 deeplink total_amount = totalAmount (đã gồm phí);
 * response cũ total_amount = totalAmount + serviceFeeAmount. Không xác định được → coi như đã gồm (hành vi hiện tại).
 */
function metaFeeIncluded(item: FareItem): boolean {
  const fee = Number(item.serviceFeeAmount || 0);
  const total = deeplinkTotal(item);
  if (!fee || total === null || typeof item.totalAmount !== "number") return true;
  return !(Math.abs(total - (item.totalAmount + fee)) < 1 && Math.abs(total - item.totalAmount) >= 1);
}

/** Giá 1 em bé — meta không cộng phí / không trừ voucher cho em bé nên phải bằng web. Lệch → mô tả, khớp → null. */
function infantGap(metaInv: FareInventory | undefined, webInv: FareInventory | undefined, dir: string): string | null {
  if (!metaInv || !webInv || !Number(metaInv.inf) || typeof metaInv.totalInf !== "number" || typeof webInv.totalInf !== "number") return null;
  if (Math.abs(metaInv.totalInf - webInv.totalInf) < 1) return null;
  return `${dir}: giá 1 em bé meta ${metaInv.totalInf.toLocaleString("vi-VN")} ≠ web ${webInv.totalInf.toLocaleString("vi-VN")}`;
}

type SplitLevel = { final: number; ticket: number; cls: string; invs: FareInventory[] };

export function compareMetaAgainstWeb(metaItems: FareItem[], webItems: FareItem[], dirCount: number): CompareResult {
  const web = indexWeb(webItems, dirCount);
  const rowsByKey = new Map<string, DetailRow>();
  const infantWarnings = new Map<string, { count: number; example: string }>();
  let oldFormat = 0;

  for (const item of metaItems) {
    const sortedLegs = [...(item.flights ?? [])].sort((a, b) => a.leg - b.leg);
    if (!sortedLegs.length) continue;
    const legSystems = metaLegSystems(item, sortedLegs.length);
    // GALILEO: system gốc của item; chiều ghép khác hãng (VD 9G + VU) không phải GALILEO.
    const legs = sortedLegs.map((l, i) => toLegInfo(l, dirCount, isGalileo(item.system) ? item.system : legSystems[i]));
    const mixedSystems = new Set(legSystems).size > 1;
    // Hiển thị: "9G" hoặc "9G + VU" khi meta ghép 2 chiều khác system.
    const system = mixedSystems ? legSystems.join(" + ") : legSystems[0];

    const firstInv = item.flights?.[0]?.inventories?.[0];
    const pax: Pax = { adt: Number(firstInv?.adt ?? 1), chd: Number(firstInv?.chd ?? 0) };
    // Vé COMBINED (GALILEO_NDC, VN quốc tế khứ hồi; compositeFareId không có "_" như cặp ghép "0_6"): mỗi chiều
    // đã mang giá CẢ CHUYẾN → giá theo chiều đầu.
    const combined = sortedLegs.length > 1 && !String(item.compositeFareId ?? "").includes("_");
    // Giá API: root totalAmount (CMS tính lại theo số khách: SEPARATE cộng các chiều, COMBINED lấy chiều đầu).
    const computed = (combined ? sortedLegs.slice(0, 1) : sortedLegs).reduce((sum, l) => sum + (paxTotal(l.inventories?.[0] ?? {}) ?? 0), 0);
    const metaPrice = positive([typeof item.totalAmount === "number" ? item.totalAmount : computed])[0] ?? null;
    const voucherDiscount = round2(Number(item.estimatedVoucherDiscount || 0));
    const metaServiceFee =
      typeof item.serviceFeeAmount === "number" ? round2(item.serviceFeeAmount) : feeByFormula(item.flights?.[0]?.fees ?? item.fees, pax, dirCount);
    const feeIncluded = metaFeeIncluded(item);
    if (!feeIncluded) oldFormat++;
    // Giá so sánh meta: + voucher (web chưa trừ voucher); response cũ chưa gồm phí thì cộng thêm.
    const metaBasePrice = metaPrice !== null ? round2(metaPrice + voucherDiscount + (feeIncluded ? 0 : metaServiceFee)) : null;
    const metaTicket = sub(metaBasePrice, metaServiceFee);
    const metaLegPrices = legs.map((l) => l.prices[0] ?? null);
    const metaLegInvs = sortedLegs.map((l) => l.inventories?.[0]);
    const metaClass = (combined ? metaLegInvs.slice(0, 1) : metaLegInvs).map(cabinLabel).join(" | ");

    const dedupeKey = `${itinKey(system, legs)}#${metaPrice}#${voucherDiscount}#${metaLegPrices.join(",")}#${metaClass}`;
    const existing = rowsByKey.get(dedupeKey);
    if (existing) {
      existing.metaDuplicates++;
      continue;
    }

    // Combo web chỉ có trong 1 system; hành trình ghép khác system chỉ có thể là 2 chặng lẻ.
    const combo = legs.length >= dirCount && !mixedSystems ? web.combos.get(itinKey(system, legs)) : undefined;
    const splits = dirCount > 1 ? legs.map((l, i) => web.splitLegs.get(legIndexKey(legSystems[i], l))) : [];
    if (combo) combo.used = true;
    splits.forEach((s) => s && (s.used = true));
    const allSplitsFound = splits.length > 0 && splits.every(Boolean);

    // Mức giá web: combo = vé trọn gói + phí × số chiều; 2 chặng lẻ = mỗi chiều vé + phí của chính nó, rồi ghép.
    const comboFee = combo ? feeByFormula(combo.fees, pax, dirCount) : null;
    const splitLegLevels = allSplitsFound ? splits.map((sp) => webLevels(sp!.tickets, feeByFormula(sp!.fees, pax, 1))) : [];
    const splitFee = allSplitsFound ? round2(splits.reduce((sum, sp) => sum + feeByFormula(sp!.fees, pax, 1), 0)) : null;
    const source: "" | "combo" | "2 chặng lẻ" = combo && combo.tickets.size ? "combo" : allSplitsFound ? "2 chặng lẻ" : "";
    const levels: SplitLevel[] =
      source === "combo"
        ? webLevels(combo!.tickets, comboFee!).map((l) => ({ final: l.final, ticket: l.ticket, cls: l.cls, invs: [l.inv] }))
        : source
          ? splitLegLevels.reduce<SplitLevel[]>(
              (acc, legLevels) =>
                acc.flatMap((a) =>
                  legLevels.map((l) => ({
                    final: round2(a.final + l.final),
                    ticket: round2(a.ticket + l.ticket),
                    cls: a.cls ? `${a.cls} | ${l.cls}` : l.cls,
                    invs: [...a.invs, l.inv],
                  }))
                ),
              [{ final: 0, ticket: 0, cls: "", invs: [] }]
            )
          : [];

    const base = {
      side: "META" as const,
      system,
      airline: item.airline || legs[0].airline,
      legs,
      metaPrice,
      voucherCode: item.estimatedVoucherCode || "",
      voucherDiscount,
      metaBasePrice,
      metaLegPrices,
      metaServiceFee,
      metaFinal: metaBasePrice,
      metaClass,
      metaDuplicates: 1,
    };
    const voucherNote = voucherDiscount
      ? `meta đã trừ sẵn voucher ${item.estimatedVoucherCode || "?"} ${voucherDiscount.toLocaleString("vi-VN")} (phân bổ fee → tax, trẻ em → người lớn, em bé không giảm)`
      : "";
    const feeNote = feeIncluded ? "" : "response meta cũ: totalAmount chưa gồm phí → đã cộng serviceFeeAmount";

    let row: DetailRow;
    let webInvs: FareInventory[] = [];
    if (source) {
      const classes: Record<string, string> = {};
      for (const l of levels) classes[String(l.final)] ??= l.cls;
      const prices = Object.keys(classes).map(Number).sort((a, b) => a - b);
      const webFee = source === "combo" ? comboFee : splitFee;
      const hit = metaBasePrice !== null ? levels.find((l) => l.final === metaBasePrice) : undefined;
      // Giá vé bằng nhau (trừ phí 2 bên) mà giá so sánh khác → do phí.
      const ticketHit = !hit && metaTicket !== null ? levels.find((l) => l.ticket === metaTicket) : undefined;
      const webClosestPrice = hit ? hit.final : ticketHit ? ticketHit.final : closest(metaBasePrice, prices);
      webInvs = (hit ?? ticketHit ?? levels.find((l) => l.final === webClosestPrice))?.invs ?? [];
      const webLegPrices = source === "2 chặng lẻ" ? splitLegLevels.map((ls) => ls.map((l) => l.final)) : [];
      let diffLegs = "";
      if (!hit && ticketHit) diffLegs = `phí: meta ${metaServiceFee.toLocaleString("vi-VN")} ≠ web ${(webFee ?? 0).toLocaleString("vi-VN")}`;
      else if (!hit && source === "combo") diffLegs = dirCount > 1 ? "cả hành trình (web bán giá trọn gói đi + về)" : "chiều đi";
      else if (!hit) {
        // Chiều lệch: giá meta chiều đó (cộng lại voucher nếu có) không nằm trong các giá web của chiều đó.
        const wrong = legs
          .filter((_, i) => {
            const p = metaLegPrices[i];
            return p === null || (!webLegPrices[i].includes(p) && !webLegPrices[i].includes(round2(p + voucherDiscount)));
          })
          .map((l) => DIR_LABEL[l.dir]);
        diffLegs = wrong.length ? wrong.join(" + ") : "tổng 2 chiều";
      }
      row = {
        ...base,
        status: hit ? "KHỚP" : ticketHit ? "LỆCH PHÍ" : "LỆCH GIÁ",
        webPrices: prices,
        webClasses: classes,
        webLegPrices,
        webClosestPrice,
        diff: hit ? 0 : sub(metaBasePrice, webClosestPrice),
        diffLegs,
        webServiceFee: webFee,
        webFinal: webClosestPrice,
        webSource: source,
        note: "",
      };
    } else {
      const missing =
        splits.length && splits.some(Boolean)
          ? `web có chặng lẻ nhưng thiếu: ${legs.filter((_, i) => !splits[i]).map((l) => `${DIR_LABEL[l.dir]} ${l.flightNumbers}`).join(", ")}`
          : `web không có hành trình này ở system ${system}`;
      row = {
        ...base, status: "CHỈ CÓ Ở META", webPrices: [], webClasses: {}, webLegPrices: [], webClosestPrice: null, diff: null,
        diffLegs: "", webServiceFee: null, webFinal: null, webSource: "", note: missing,
      };
    }
    if (row.status === "LỆCH GIÁ" && row.diff !== null && Math.abs(row.diff) < SMALL_PRICE_DIFF) row.status = "Lệch giá dưới 1k";

    // Em bé: meta không cộng phí / không trừ voucher → giá 1 em bé phải bằng web (cùng hạng đã chọn).
    const infantNotes = (combined || source === "combo" ? [0] : legs.map((_, i) => i))
      .map((i) => infantGap(metaLegInvs[i], webInvs[i], DIR_LABEL[legs[i]?.dir ?? i]))
      .filter((g): g is string => !!g);
    if (infantNotes.length) {
      const entry = infantWarnings.get(system) ?? { count: 0, example: `${legs.map((l) => l.flightNumbers).join(" + ")} — ${infantNotes[0]}` };
      entry.count++;
      infantWarnings.set(system, entry);
    }
    row.note = [row.note, ...infantNotes.map((n) => `⚠ ${n}`), voucherNote, feeNote].filter(Boolean).join(" · ");

    // Dữ liệu API để xem số từ đâu ra (mở 1 dòng trong báo cáo).
    // Ngắn gọn (lặp ở mọi dòng của report); phần giải thích chung nằm ở chú thích trong detailViewScript.
    const metaFormula = [
      `totalAmount ${fmt(metaPrice)}` + (combined ? " (COMBINED)" : sortedLegs.length > 1 ? " (2 chiều)" : ""),
      voucherDiscount ? `+ voucher ${item.estimatedVoucherCode || "?"} ${fmt(voucherDiscount)}` : "",
      feeIncluded ? `(đã gồm phí ${fmt(metaServiceFee)})` : `+ phí ${fmt(metaServiceFee)} (response cũ)`,
      `= ${fmt(metaBasePrice)}`,
    ].filter(Boolean);
    const breakdown: NonNullable<DetailRow["breakdown"]> = {
      meta: {
        invs: metaLegInvs.map((inv, i) => invBreakdown(inv, legs[i], legs[i]?.dir ?? i)),
        fees: sortedLegs.flatMap((l, i) => feeList(l.fees, legs[i]?.dir ?? i)),
        formula: metaFormula,
      },
    };
    if (source && webInvs.length) {
      const webFormula =
        source === "combo"
          ? [`vé: ${ticketText(webInvs[0], combo!.system)}`, `+ phí ${feeText(combo!.fees, pax, dirCount)}`]
          : splits.flatMap((sp, i) => [
              `${legs[i]?.dir ? "về" : "đi"} vé: ${ticketText(webInvs[i], sp!.system)}`,
              `  + phí ${feeText(sp!.fees, pax, 1)}`,
            ]);
      breakdown.web = {
        invs: webInvs.map((inv, i) => invBreakdown(inv, source === "combo" ? legs[0] : legs[i], source === "combo" ? 0 : legs[i]?.dir ?? i)),
        fees: source === "combo" ? feeList(combo!.fees, null) : splits.flatMap((sp, i) => feeList(sp!.fees, legs[i]?.dir ?? i)),
        formula: [...webFormula, `= ${fmt(row.webClosestPrice)}`],
      };
    }
    row.breakdown = breakdown;
    row.raw = { meta: item, web: source === "combo" ? combo!.items : allSplitsFound ? splits.flatMap((sp) => sp!.items) : [] };
    rowsByKey.set(dedupeKey, row);
  }

  const metaRows = [...rowsByKey.values()];
  const webOnlyBase = {
    status: "CHỈ CÓ Ở WEB" as const, side: "WEB" as const, metaPrice: null, voucherCode: "", voucherDiscount: 0,
    metaBasePrice: null, metaLegPrices: [], diff: null, diffLegs: "", metaServiceFee: null, metaFinal: null, metaDuplicates: 0, metaClass: "",
  };
  const webOnlyRows: DetailRow[] = [];
  for (const combo of web.combos.values()) {
    if (combo.used) continue;
    // Chưa biết số khách của meta → hiện giá vé (chưa cộng phí) kèm hạng ghế.
    const levels = webLevels(combo.tickets, 0);
    webOnlyRows.push({
      ...webOnlyBase, system: combo.system, airline: combo.airline, legs: combo.legs,
      webPrices: levels.map((l) => l.final), webClasses: Object.fromEntries(levels.map((l) => [String(l.final), l.cls])),
      webLegPrices: [], webClosestPrice: levels[0]?.final ?? null,
      webServiceFee: null, webFinal: null, webSource: "combo", note: "meta không trả hành trình này · giá web chưa cộng phí",
      breakdown: webOnlyBreakdown(levels[0]?.inv, combo.legs[0], 0, combo.system, combo.fees),
    });
  }
  for (const split of web.splitLegs.values()) {
    if (split.used) continue;
    const levels = webLevels(split.tickets, 0);
    const prices = levels.map((l) => l.final);
    webOnlyRows.push({
      ...webOnlyBase, system: split.system, airline: split.leg.airline, legs: [split.leg],
      webPrices: prices, webClasses: Object.fromEntries(levels.map((l) => [String(l.final), l.cls])),
      webLegPrices: [prices], webClosestPrice: prices[0] ?? null,
      webServiceFee: null, webFinal: null, webSource: "2 chặng lẻ",
      note: `chặng lẻ ${DIR_LABEL[split.leg.dir]} — không có hành trình meta nào dùng chặng này · giá web chưa cộng phí`,
      breakdown: webOnlyBreakdown(levels[0]?.inv, split.leg, split.leg.dir, split.system, split.fees),
    });
  }

  const count = (s: DetailStatus) => metaRows.filter((r) => r.status === s).length;
  return {
    rows: [...metaRows, ...webOnlyRows],
    metaOffers: metaRows.length,
    webResults: {
      items: webItems.length,
      combos: web.combos.size,
      outLegs: [...web.splitLegs.values()].filter((s) => s.leg.dir === 0).length,
      inLegs: [...web.splitLegs.values()].filter((s) => s.leg.dir === 1).length,
    },
    matched: count("KHỚP"),
    priceDiffs: count("LỆCH GIÁ"),
    smallPriceDiffs: count("Lệch giá dưới 1k"),
    feeDiffs: count("LỆCH PHÍ"),
    metaOnly: count("CHỈ CÓ Ở META"),
    webOnly: webOnlyRows.length,
    withVoucher: metaRows.filter((r) => r.voucherDiscount > 0).length,
    warnings: [
      ...totalAmountWarnings("META", metaItems),
      ...totalAmountWarnings("WEB", webItems),
      ...serviceFeeWarnings(metaItems, dirCount),
      ...[...infantWarnings].map(
        ([system, e]) => `META ${system}: ${e.count} hành trình có giá em bé khác web (em bé không cộng phí, không trừ voucher) — VD ${e.example}`
      ),
      ...(oldFormat ? [`META: ${oldFormat} offer theo định dạng cũ (totalAmount chưa gồm phí) — đã tự cộng serviceFeeAmount`] : []),
    ],
  };
}
