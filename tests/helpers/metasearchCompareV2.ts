/**
 * V2 — so khớp danh sách chuyến bay metasearch vs web, LẤY META LÀM CHUẨN (bản v1:
 * metasearchCompare.ts, giữ nguyên). Cách ghép hành trình giống v1 (system + số hiệu mọi segment
 * bỏ tiền tố hãng + giờ đi/đáp; ưu tiên combo, không có thì ghép 2 chặng lẻ). Khác v1 ở CÔNG THỨC GIÁ:
 *
 *   Giá so sánh = giá vé + (phí ADULT × số NL + phí CHILD × số TE) × (2 nếu khứ hồi, 1 nếu 1 chiều)
 *   - giá vé hệ GALILEO (GALILEO_NDC / GALILEO, như isGalileoSystem của web): `totalAmount` API trả
 *     (combo khứ hồi: giá trọn gói ở chặng đầu);
 *   - giá vé các system khác (VN, VJ, VU, 9G…): theo số khách, cộng từng chiều —
 *     NL × totalAdt + TE × totalChd + EB × totalInf (totalAdt/totalChd/totalInf là giá 1 người).
 *   Em bé không tính phí. Phí lấy từ `fees` (paxType ADULT/CHILD): meta ở flights[0].fees, web ở fareData.fees
 *   (combo: của item; 2 chặng lẻ: của chặng đi).
 *
 * - Vẫn cảnh báo nếu totalAmount ≠ tổng theo số khách (lỗi cũ chỉ cộng 1 người lớn) để theo dõi.
 * - Meta: totalAmount đã trừ voucher AUTO_APPLY → cộng lại `estimatedVoucherDiscount` trước khi so.
 * - Web có nhiều hạng vé cho 1 hành trình nên giá meta khớp khi bằng 1 trong các giá web.
 */

export type FareInventory = {
  totalAmount?: number | null;
  cabinClass?: string | null;
  adt?: number;
  chd?: number;
  inf?: number;
  totalAdt?: number | null;
  totalChd?: number | null;
  totalInf?: number | null;
};

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
  /** Giá meta trước voucher = metaPrice + voucherDiscount — đem so với giá hãng của web. */
  metaBasePrice: number | null;
  /** Giá từng chiều của meta (đã trừ voucher phần phân bổ vào chiều đó). */
  metaLegPrices: (number | null)[];
  /** Mọi giá web có cho hành trình này (nhiều hạng vé). */
  webPrices: number[];
  webLegPrices: number[][];
  /** Giá web gần với giá meta gốc nhất (để tính chênh lệch). */
  webClosestPrice: number | null;
  /** metaBasePrice − webClosestPrice */
  diff: number | null;
  diffLegs: string;
  /** Phí theo công thức v2 (không phải serviceFeeAmount). */
  metaServiceFee: number | null;
  webServiceFee: number | null;
  /** Giá so sánh v2: meta = totalAmount + voucher + phí công thức; web = totalAmount + phí công thức. */
  metaFinal: number | null;
  webFinal: number | null;
  webSource: "" | "combo" | "2 chặng lẻ";
  /** Số item meta trùng y hệt (cùng hành trình, system, giá) được gộp vào dòng này. */
  metaDuplicates: number;
  note: string;
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
    const formula = feeByFormula(item.flights?.[0]?.fees ?? item.fees, { adt: Number(inv?.adt ?? 1), chd: Number(inv?.chd ?? 0) }, dirCount);
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
    prices: positive((leg.inventories ?? []).map((i) => ticketPrice(i, system))),
  };
}

type Pax = { adt: number; chd: number };

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

type WebCombo = { system: string; airline: string; legs: LegInfo[]; prices: Set<number>; fees: FareFee[]; used: boolean };
type WebSplitLeg = { system: string; leg: LegInfo; prices: Set<number>; fees: FareFee[]; used: boolean };

function indexWeb(items: FareItem[], dirCount: number) {
  const combos = new Map<string, WebCombo>();
  const splitLegs = new Map<string, WebSplitLeg>();
  for (const item of items) {
    const system = normSystem(item.system);
    const legs = [...(item.flights ?? [])].sort((a, b) => a.leg - b.leg).map((l) => toLegInfo(l, dirCount, item.system));
    if (!legs.length) continue;
    if (legs.length >= dirCount) {
      const key = itinKey(system, legs);
      const combo = combos.get(key) ?? {
        system, airline: item.airline || legs[0].airline, legs, prices: new Set(), fees: item.fees ?? [], used: false,
      };
      // Web combo để giá trọn gói trên inventory của chặng đầu (lặp lại ở chặng sau).
      legs[0].prices.forEach((p) => combo.prices.add(p));
      combos.set(key, combo);
      continue;
    }
    for (const leg of legs) {
      const key = legIndexKey(system, leg);
      const split = splitLegs.get(key) ?? { system, leg, prices: new Set(), fees: item.fees ?? [], used: false };
      leg.prices.forEach((p) => split.prices.add(p));
      splitLegs.set(key, split);
    }
  }
  return { combos, splitLegs };
}

const closest = (target: number | null, candidates: number[]) =>
  target === null || !candidates.length
    ? candidates[0] ?? null
    : candidates.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));

const sub = (a: number | null, b: number | null) => (a !== null && b !== null ? round2(a - b) : null);
const add = (a: number | null, b: number | null) => (a !== null && b !== null ? round2(a + b) : null);

const DIR_LABEL = ["chiều đi", "chiều về"];

export function compareMetaAgainstWeb(metaItems: FareItem[], webItems: FareItem[], dirCount: number): CompareResult {
  const web = indexWeb(webItems, dirCount);
  const rowsByKey = new Map<string, DetailRow>();

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
    // Giá vé v2: GALILEO = totalAmount của item; system khác = theo số khách, cộng từng chiều.
    // Vé COMBINED (VD VN quốc tế khứ hồi; compositeFareId không có "_" như cặp ghép "0_6"): mỗi chiều
    // đã mang giá CẢ CHUYẾN → chỉ lấy chiều đầu (như FE web: isVnComboEntry, giá ở leg 0).
    const combined = sortedLegs.length > 1 && !String(item.compositeFareId ?? "").includes("_");
    const metaPrice = isGalileo(item.system)
      ? positive([item.totalAmount ?? legs[0].prices[0]])[0] ?? null
      : positive([
          (combined ? sortedLegs.slice(0, 1) : sortedLegs).reduce((sum, l) => sum + (paxTotal(l.inventories?.[0] ?? {}) ?? 0), 0),
        ])[0] ?? null;
    const voucherDiscount = round2(Number(item.estimatedVoucherDiscount || 0));
    const metaBasePrice = metaPrice !== null ? round2(metaPrice + voucherDiscount) : null;
    const metaLegPrices = legs.map((l) => l.prices[0] ?? null);
    const metaServiceFee = feeByFormula(item.flights?.[0]?.fees ?? item.fees, pax, dirCount);

    const dedupeKey = `${itinKey(system, legs)}#${metaPrice}#${voucherDiscount}#${metaLegPrices.join(",")}`;
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

    const comboPrices = combo ? [...combo.prices].sort((a, b) => a - b) : [];
    const splitLegPrices = splits.map((s) => (s ? [...s.prices].sort((a, b) => a - b) : []));
    const allSplitsFound = splits.length > 0 && splits.every(Boolean);
    // Tổng giá có thể của 2 chặng lẻ = mọi tổ hợp giá chiều đi + giá chiều về.
    const splitTotals = allSplitsFound
      ? positive(splitLegPrices.reduce<number[]>((acc, prices) => acc.flatMap((a) => prices.map((p) => a + p)), [0]))
      : [];
    const comboFee = combo ? feeByFormula(combo.fees, pax, dirCount) : null;
    const splitFee = allSplitsFound ? feeByFormula(splits[0]!.fees, pax, dirCount) : null;

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
      metaFinal: add(metaBasePrice, metaServiceFee),
      metaDuplicates: 1,
    };
    const voucherNote = voucherDiscount
      ? `meta đã trừ sẵn voucher ${item.estimatedVoucherCode || "?"} ${voucherDiscount.toLocaleString("vi-VN")} (phân bổ fee → tax, em bé → trẻ em → người lớn, chiều đi trước)`
      : "";

    // Khớp giá gốc (trước voucher) → còn so phí hệ thống.
    const priced = (webSource: "combo" | "2 chặng lẻ", webPrices: number[], webLegPrices: number[][], webServiceFee: number | null): DetailRow => {
      const feeOk = metaServiceFee === null || webServiceFee === null || round2(webServiceFee) === metaServiceFee;
      return {
        ...base,
        status: feeOk ? "KHỚP" : "LỆCH PHÍ",
        webPrices, webLegPrices, webClosestPrice: metaBasePrice,
        diff: 0,
        diffLegs: feeOk ? "" : `phí (công thức): meta ${metaServiceFee} ≠ web ${webServiceFee}`,
        webServiceFee, webFinal: add(metaBasePrice, webServiceFee),
        webSource, note: voucherNote,
      };
    };

    let row: DetailRow;
    if (combo && metaBasePrice !== null && combo.prices.has(metaBasePrice)) {
      row = priced("combo", comboPrices, [], comboFee);
    } else if (allSplitsFound && metaBasePrice !== null && splitTotals.includes(metaBasePrice)) {
      row = priced("2 chặng lẻ", splitTotals, splitLegPrices, splitFee);
    } else if (combo) {
      const webClosestPrice = closest(metaBasePrice, comboPrices);
      row = {
        ...base,
        status: "LỆCH GIÁ",
        webPrices: comboPrices,
        webLegPrices: [],
        webClosestPrice,
        diff: sub(metaBasePrice, webClosestPrice),
        diffLegs: dirCount > 1 ? "cả hành trình (web bán giá trọn gói đi + về)" : "chiều đi",
        webServiceFee: comboFee,
        webFinal: add(webClosestPrice, comboFee),
        webSource: "combo",
        note: voucherNote,
      };
    } else if (allSplitsFound) {
      // Chiều lệch: giá meta chiều đó (cộng lại voucher nếu có) không nằm trong các giá web của chiều đó.
      const wrongLegs = legs
        .filter((_, i) => {
          const p = metaLegPrices[i];
          return p === null || (!splitLegPrices[i].includes(p) && !splitLegPrices[i].includes(round2(p + voucherDiscount)));
        })
        .map((l) => DIR_LABEL[l.dir]);
      const webClosestPrice = closest(metaBasePrice, splitTotals);
      row = {
        ...base,
        status: "LỆCH GIÁ",
        webPrices: splitTotals,
        webLegPrices: splitLegPrices,
        webClosestPrice,
        diff: sub(metaBasePrice, webClosestPrice),
        diffLegs: wrongLegs.length ? wrongLegs.join(" + ") : "tổng 2 chiều",
        webServiceFee: splitFee,
        webFinal: add(webClosestPrice, splitFee),
        webSource: "2 chặng lẻ",
        note: voucherNote,
      };
    } else {
      const missing =
        splits.length && splits.some(Boolean)
          ? `web có chặng lẻ nhưng thiếu: ${legs.filter((_, i) => !splits[i]).map((l) => `${DIR_LABEL[l.dir]} ${l.flightNumbers}`).join(", ")}`
          : `web không có hành trình này ở system ${system}`;
      row = {
        ...base, status: "CHỈ CÓ Ở META", webPrices: [], webLegPrices: splitLegPrices, webClosestPrice: null, diff: null,
        diffLegs: "", webServiceFee: null, webFinal: null, webSource: "", note: [missing, voucherNote].filter(Boolean).join(" · "),
      };
    }
    if (row.status === "LỆCH GIÁ" && row.diff !== null && Math.abs(row.diff) < SMALL_PRICE_DIFF) row.status = "Lệch giá dưới 1k";
    rowsByKey.set(dedupeKey, row);
  }

  const metaRows = [...rowsByKey.values()];
  const webOnlyBase = {
    status: "CHỈ CÓ Ở WEB" as const, side: "WEB" as const, metaPrice: null, voucherCode: "", voucherDiscount: 0,
    metaBasePrice: null, metaLegPrices: [], diff: null, diffLegs: "", metaServiceFee: null, metaFinal: null, metaDuplicates: 0,
  };
  const webOnlyRows: DetailRow[] = [];
  for (const combo of web.combos.values()) {
    if (combo.used) continue;
    const prices = [...combo.prices].sort((a, b) => a - b);
    webOnlyRows.push({
      ...webOnlyBase, system: combo.system, airline: combo.airline, legs: combo.legs,
      webPrices: prices, webLegPrices: [], webClosestPrice: prices[0] ?? null,
      webServiceFee: null, webFinal: null, webSource: "combo", note: "meta không trả hành trình này",
    });
  }
  for (const split of web.splitLegs.values()) {
    if (split.used) continue;
    const prices = [...split.prices].sort((a, b) => a - b);
    webOnlyRows.push({
      ...webOnlyBase, system: split.system, airline: split.leg.airline, legs: [split.leg],
      webPrices: prices, webLegPrices: [prices], webClosestPrice: prices[0] ?? null,
      webServiceFee: null, webFinal: null, webSource: "2 chặng lẻ",
      note: `chặng lẻ ${DIR_LABEL[split.leg.dir]} — không có hành trình meta nào dùng chặng này`,
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
    ],
  };
}
