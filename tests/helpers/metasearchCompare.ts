/**
 * So khớp danh sách chuyến bay giữa 2 nguồn cho CÙNG 1 điều kiện search, LẤY META LÀM CHUẨN:
 * - meta: response `/v1/flights/metasearch` (API trả cho đối tác) — mỗi item luôn là
 *   hành trình đầy đủ (1 chiều, hoặc đã ghép sẵn đi + về).
 * - web: các response `/flights/search/` mà trang dev.triphubs.vn gọi (1 request/system).
 *   Có 2 kiểu item:
 *   + "combo": 1 item chứa đủ mọi chiều (VD GALILEO_NDC khứ hồi; mọi item 1 chiều).
 *   + "chặng lẻ": khứ hồi nhưng mỗi item chỉ 1 chiều (VD VJ/VU/9G) — khách chọn đi rồi chọn về.
 *
 * Với mỗi item meta: tìm ở web theo đúng SYSTEM + từng chặng khớp (số hiệu mọi segment,
 * giờ khởi hành, giờ đáp) — ưu tiên combo có sẵn, không có thì ghép 2 chặng lẻ — rồi so giá.
 * Cùng 1 chuyến có thể bán ở nhiều system với giá/giờ đáp khác nhau (VD VZ qua VJ và
 * GALILEO_NDC) nên KHÔNG được gộp khác system.
 *
 * Web và meta tính giá khác chỗ (đã đối chiếu source traveleasy-web-user / traveleasy-cms):
 * - Web: API trả giá hãng `inventory.totalAmount` + phí hệ thống `fareData.fees`; FE tự cộng
 *   phí (ADULT × số NL, CHILD × số TE, em bé không tính — useChoosenFlightsDetailPrice.ts).
 *   Voucher chỉ trừ khi khách nhập mã lúc thanh toán.
 * - Meta: server ước tính sẵn voucher AUTO_APPLY (`estimatedVoucherCode/Discount`) và TRỪ LUÔN
 *   vào `totalAmount` (phân bổ vào fee → tax, em bé → trẻ em → người lớn, chiều đi trước);
 *   phí hệ thống trả riêng ở `serviceFeeAmount` (metasearch/README.md §2.2).
 * Vì vậy so: (totalAmount meta + voucher) với giá hãng web, và serviceFeeAmount với phí web.
 * Web có nhiều hạng vé cho 1 hành trình nên giá meta khớp khi bằng 1 trong các giá web.
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

/**
 * Giá 1 inventory theo cách FE web tính (useChoosenFlightsDetailPrice.ts nhân giá TỪNG khách với số
 * khách): NL × totalAdt + TE × totalChd + EB × totalInf. KHÔNG dùng `totalAmount` của API web: với
 * VJ/VN/VU nhiều người lớn trường này chỉ cộng 1 người lớn (đã gặp thật: 2 NL + 1 TE, totalAmount
 * 6.757.000 thay vì 10.197.000) — FE không dùng nó nên khách vẫn thấy đúng giá.
 * Thiếu giá từng khách thì quay về totalAmount.
 */
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
export type FareLeg = { leg: number; segments: FareSegment[]; inventories?: FareInventory[] };
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

export type DetailStatus = "KHỚP" | "LỆCH GIÁ" | "LỆCH PHÍ" | "CHỈ CÓ Ở META" | "CHỈ CÓ Ở WEB";

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
  metaServiceFee: number | null;
  webServiceFee: number | null;
  /** Giá khách thấy cuối cùng: meta = totalAmount + serviceFee; web = giá hãng + phí hệ thống (chưa nhập voucher). */
  metaFinal: number | null;
  webFinal: number | null;
  webSource: "" | "combo" | "2 chặng lẻ";
  /** Số item meta trùng y hệt (cùng hành trình, system, giá) được gộp vào dòng này. */
  metaDuplicates: number;
  note: string;
};

export type CompareResult = {
  rows: DetailRow[];
  metaOffers: number;
  matched: number;
  priceDiffs: number;
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
};

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

/**
 * @param priceMode "fe" (web): giá theo từng khách như FE tính; "api" (meta): `totalAmount` meta trả
 * (meta là chuẩn — đúng/sai thế nào thì lộ ra khi so với web).
 */
function toLegInfo(leg: FareLeg, dirCount: number, priceMode: "fe" | "api"): LegInfo {
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
    prices: positive((leg.inventories ?? []).map((i) => (priceMode === "fe" ? paxTotal(i) : i.totalAmount))),
  };
}

type Pax = { adt: number; chd: number };

/** Phí hệ thống web như FE cộng (getSystemFeeByPaxType): ADULT × NL (isTemp = 1 lần), CHILD × TE, INFANT không tính. */
function webSystemFee(fees: FareFee[] | undefined, pax: Pax): number {
  return (fees ?? []).reduce((sum, f) => {
    const amount = Number(f?.amount || 0);
    if (f?.paxType === "ADULT") return sum + amount * (f.isTemp ? 1 : pax.adt);
    if (f?.paxType === "CHILD") return sum + amount * pax.chd;
    return sum;
  }, 0);
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
    const legs = [...(item.flights ?? [])].sort((a, b) => a.leg - b.leg).map((l) => toLegInfo(l, dirCount, "fe"));
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
    const legs = [...(item.flights ?? [])].sort((a, b) => a.leg - b.leg).map((l) => toLegInfo(l, dirCount, "api"));
    if (!legs.length) continue;
    const legSystems = metaLegSystems(item, legs.length);
    const mixedSystems = new Set(legSystems).size > 1;
    // Hiển thị: "9G" hoặc "9G + VU" khi meta ghép 2 chiều khác system.
    const system = mixedSystems ? legSystems.join(" + ") : legSystems[0];

    const firstInv = item.flights?.[0]?.inventories?.[0];
    const pax: Pax = { adt: Number(firstInv?.adt ?? 1), chd: Number(firstInv?.chd ?? 0) };
    const metaPrice = positive([item.totalAmount ?? legs[0].prices[0]])[0] ?? null;
    const voucherDiscount = round2(Number(item.estimatedVoucherDiscount || 0));
    const metaBasePrice = metaPrice !== null ? round2(metaPrice + voucherDiscount) : null;
    const metaLegPrices = legs.map((l) => l.prices[0] ?? null);
    const metaServiceFee = typeof item.serviceFeeAmount === "number" ? round2(item.serviceFeeAmount) : null;

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
    const comboFee = combo ? webSystemFee(combo.fees, pax) : null;
    const splitFee = allSplitsFound ? splits.reduce((sum, s) => sum + webSystemFee(s!.fees, pax), 0) : null;

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
      metaFinal: add(metaPrice, metaServiceFee),
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
        diffLegs: feeOk ? "" : `phí hệ thống: meta ${metaServiceFee} ≠ web ${webServiceFee}`,
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
    matched: count("KHỚP"),
    priceDiffs: count("LỆCH GIÁ"),
    feeDiffs: count("LỆCH PHÍ"),
    metaOnly: count("CHỈ CÓ Ở META"),
    webOnly: webOnlyRows.length,
    withVoucher: metaRows.filter((r) => r.voucherDiscount > 0).length,
    warnings: [...totalAmountWarnings("META", metaItems), ...totalAmountWarnings("WEB", webItems)],
  };
}
