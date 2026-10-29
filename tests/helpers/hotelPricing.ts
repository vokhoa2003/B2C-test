/**
 * Tính lại giá khách sạn ĐÚNG như 2 FE đang hiển thị, kèm từng bước để in ra báo cáo
 * (VD "1.200.000 basePrice × 2 phòng × 3 đêm = 7.200.000 → + 864.000 phí 12% → ÷ 6 = 1.344.000/đêm").
 * KHÔNG so sánh web với TMS — 2 hệ tính khác nhau có chủ đích, tool chỉ show.
 *
 * Nguồn công thức (đọc từ code, cập nhật khi FE đổi):
 *   - WEB (traveleasy-web-user):
 *       src/utils/hotel/hotelFeeMarkup.ts         — chọn policy + markup từng feeConfig
 *       src/utils/hotel/getRoomPerNightPrice.ts   — detail: markup CHỈ trên exclusive, rồi + tax + fees
 *       src/components/hotel/hotels-result/Results/Content/HotelItem.tsx — list: applyMarkupPerNight(basePrice)
 *       src/hooks/hotel/useChoosenHotelPrice.ts   — trang booking (tổng, markupAmount, base voucher)
 *   - TMS (tms_user):
 *       src/features/hotel/utils/hotel-fee-markup.ts   — markup trên INCLUSIVE; BASE_PRICE dùng exclusive
 *       src/features/hotel/utils/get-hotel-card-price.ts / get-room-price.ts
 *
 * Chung cho cả 2: policy = HOTEL + ACTIVE, có ≥1 feeConfig không phải ORIGINAL_CANCELLATION_FEE, lấy
 * priority cao nhất (bằng nhau → cái đứng trước). KHÔNG xét conditions (nội địa/quốc tế, sao…) và
 * KHÔNG đổi currency (FIXED 5 USD bị cộng như 5 VND) → tool gắn cảnh báo khi gặp.
 */

export type HotelFeeConfig = {
  unitType: "FIXED" | "PERCENT" | string;
  amount: number;
  calculationMethod: string;
  operation?: string;
  currency?: string;
  summary?: string;
};

export type HotelFeePolicy = {
  id?: string;
  name?: string;
  productType?: string;
  status?: string;
  priority: number;
  feeConfigs?: unknown;
  conditions?: { metadata?: Record<string, unknown> }[];
};

export type MarkupContext = { roomsNum: number; nights: number };

/** 1 bước tính: `op value (label)`; op "" = số khởi đầu, "=" = kết quả. */
export type PriceStep = { op: "" | "+" | "-" | "×" | "÷" | "="; value: number; label: string; note?: string };

export type PriceCalc = {
  /** Giá cuối cùng FE hiển thị/tính. */
  result: number;
  steps: PriceStep[];
  warnings: string[];
  /** Giá gạch (TMS list khi có promo). */
  originalPrice?: number;
};

const CANCELLATION_METHODS = new Set(["ORIGINAL_CANCELLATION_FEE"]);

const isFeeConfig = (v: unknown): v is HotelFeeConfig =>
  !!v && typeof v === "object" && "unitType" in v && "amount" in v && "calculationMethod" in v;

/** API trả feeConfigs dạng `[config]` hoặc `[[config]]` — bóc phẳng như 2 FE. */
export function flattenFeeConfigs(feeConfigs: unknown): HotelFeeConfig[] {
  if (!Array.isArray(feeConfigs)) return [];
  const result: HotelFeeConfig[] = [];
  const stack: unknown[] = [...feeConfigs];
  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;
    if (Array.isArray(item)) {
      stack.unshift(...item);
      continue;
    }
    if (isFeeConfig(item)) result.push(item);
  }
  return result;
}

/** Chọn policy markup — giống hệt selectHotelMarkupPolicy của cả web lẫn TMS. */
export function selectHotelMarkupPolicy(feePolicies: HotelFeePolicy[] | undefined): HotelFeePolicy | null {
  const candidates = (feePolicies ?? []).filter(
    (p) =>
      p.productType === "HOTEL" &&
      p.status === "ACTIVE" &&
      flattenFeeConfigs(p.feeConfigs).some((c) => !CANCELLATION_METHODS.has(c.calculationMethod))
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, cur) => (cur.priority > best.priority ? cur : best));
}

/** Cảnh báo về policy đã chọn: bị bỏ qua điều kiện, trùng priority, FIXED khác VND. */
export function policyWarnings(feePolicies: HotelFeePolicy[] | undefined, policy: HotelFeePolicy | null): string[] {
  if (!policy) return [];
  const warnings: string[] = [];
  const hotelPolicies = (feePolicies ?? []).filter((p) => p.productType === "HOTEL" && p.status === "ACTIVE");
  const samePriority = hotelPolicies.filter((p) => p !== policy && p.priority === policy.priority);
  if (samePriority.length) {
    warnings.push(`${samePriority.length + 1} policy cùng priority ${policy.priority} — FE lấy cái đứng trước trong danh sách API trả`);
  }
  const metadata = (policy.conditions ?? []).map((c) => c.metadata).filter((m) => m && Object.keys(m).length);
  if (metadata.length) {
    warnings.push(`policy có điều kiện (${[...new Set(metadata.flatMap((m) => Object.keys(m!)))].join(", ")}) nhưng FE KHÔNG xét điều kiện`);
  }
  for (const c of flattenFeeConfigs(policy.feeConfigs)) {
    if (c.unitType === "FIXED" && c.currency && c.currency !== "VND") {
      warnings.push(`phí FIXED ${c.amount} ${c.currency} — FE cộng thẳng ${c.amount} như VND, không quy đổi`);
    }
  }
  return warnings;
}

export const fmt = (v: number) => Math.round(v).toLocaleString("vi-VN");

/** "PERCENT 12% PER_ROOM_NIGHT" / "FIXED 50.000 PER_BOOKING". */
export function describeConfig(c: HotelFeeConfig): string {
  const value = c.unitType === "PERCENT" ? `${c.amount}%` : `${fmt(c.amount)}${c.currency && c.currency !== "VND" ? ` ${c.currency}` : ""}`;
  const op = c.operation && c.operation !== "ADD" ? ` ${c.operation}` : "";
  return `${c.unitType} ${value} ${c.calculationMethod}${op}`;
}

function applyOperation(base: number, feeValue: number, operation?: string): number {
  switch (operation) {
    case "SUBTRACT":
      return base - feeValue;
    case "MULTIPLY":
      return base * feeValue;
    case "DIVIDE":
      return feeValue === 0 ? base : base / feeValue;
    default:
      return base + feeValue;
  }
}

/** Sau khi có feeValue: ADD trả thẳng, phép khác quy về chênh lệch so với base (giống 2 FE). */
function finishMarkup(safeBase: number, feeValue: number, operation?: string): number {
  feeValue = Math.round(feeValue);
  if (!operation || operation === "ADD") return feeValue;
  return Math.round(applyOperation(safeBase, feeValue, operation) - safeBase);
}

type ConfigMarkup = { amount: number; how: string };

// ─────────────────────────────── WEB ───────────────────────────────

/** web calculateConfigMarkupAmount: units PER_ROOM = R, PER_ROOM_NIGHT = R×N, còn lại (kể cả BASE_PRICE) = 1. */
function webConfigMarkup(baseAmount: number, c: HotelFeeConfig, ctx: MarkupContext): ConfigMarkup {
  if (CANCELLATION_METHODS.has(c.calculationMethod)) return { amount: 0, how: "phí huỷ — bỏ qua" };
  const R = Math.max(1, ctx.roomsNum);
  const N = Math.max(1, ctx.nights);
  const units = c.calculationMethod === "PER_ROOM" ? R : c.calculationMethod === "PER_ROOM_NIGHT" ? R * N : 1;
  const safeBase = Math.max(0, baseAmount);
  let feeValue: number;
  let how: string;
  if (c.unitType === "PERCENT") {
    const percentBase = c.calculationMethod === "PER_ROOM_NIGHT" ? safeBase / Math.max(1, R * N) : c.calculationMethod === "PER_ROOM" ? safeBase / R : safeBase;
    feeValue = ((percentBase * c.amount) / 100) * units;
    how = units > 1 ? `${c.amount}% × ${fmt(percentBase)} × ${units}` : `${c.amount}% × ${fmt(safeBase)}`;
  } else {
    feeValue = c.amount * units;
    how = units > 1 ? `${fmt(c.amount)} × ${units}` : `${fmt(c.amount)}`;
  }
  return { amount: finishMarkup(safeBase, feeValue, c.operation), how };
}

/** Các bước "+ markup" của 1 policy trên baseTotal (cả đơn). */
function webMarkupSteps(baseTotal: number, policy: HotelFeePolicy, ctx: MarkupContext): { markup: number; steps: PriceStep[] } {
  const steps: PriceStep[] = [];
  let markup = 0;
  for (const c of flattenFeeConfigs(policy.feeConfigs)) {
    if (CANCELLATION_METHODS.has(c.calculationMethod)) continue;
    const m = webConfigMarkup(baseTotal, c, ctx);
    markup += m.amount;
    steps.push({ op: m.amount < 0 ? "-" : "+", value: Math.abs(m.amount), label: `markup ${describeConfig(c)}`, note: m.how });
  }
  return { markup, steps };
}

/**
 * web getHotelDisplayPrice(basePerNight): nhân ra cả đơn (R×N), cộng markup, làm tròn, chia lại R×N.
 * `baseLabel` là tên field nguồn để in ("basePrice", "exclusive").
 */
function webDisplayPerNight(basePerNight: number, baseLabel: string, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const R = Math.max(1, ctx.roomsNum);
  const N = Math.max(1, ctx.nights);
  const steps: PriceStep[] = [{ op: "", value: basePerNight, label: `${baseLabel}/phòng/đêm` }];
  if (!policy || basePerNight <= 0) {
    steps.push({ op: "=", value: basePerNight, label: policy ? "base ≤ 0 — không cộng markup" : "không có policy markup" });
    return { result: basePerNight, steps, warnings: [] };
  }
  const baseTotal = basePerNight * R * N;
  if (R * N > 1) steps.push({ op: "×", value: R * N, label: `${R} phòng × ${N} đêm`, note: `= ${fmt(baseTotal)}` });
  const { markup, steps: markupSteps } = webMarkupSteps(baseTotal, policy, ctx);
  steps.push(...markupSteps);
  const markedTotal = Math.round(baseTotal + markup);
  const result = Math.round(markedTotal / (R * N));
  if (R * N > 1) steps.push({ op: "÷", value: R * N, label: "chia lại về 1 phòng/1 đêm", note: `${fmt(markedTotal)} ÷ ${R * N}` });
  steps.push({ op: "=", value: result, label: "/phòng/đêm" });
  return { result, steps, warnings: [] };
}

/**
 * API list trả `basePrice` = exclusive của phòng rẻ nhất, `taxAndServiceFree` = tax + fees,
 * `setTotalPrice` = inclusive (đã đối chiếu với detail). FE list lấy basePrice làm base → không có thuế phí.
 */
function listTaxNote(hotel: HotelRecord): string | null {
  const taxFees = Number(hotel.taxAndServiceFree ?? 0);
  if (hotel.basePrice == null || taxFees <= 0) return null;
  return `basePrice chưa gồm thuế + phí: taxAndServiceFree ${fmt(taxFees)}/phòng/đêm (setTotalPrice ${fmt(Number(hotel.setTotalPrice ?? 0))}) không được cộng vào giá list`;
}

/** Web — giá trên thẻ khách sạn ở trang LIST: applyMarkupPerNight(hotel.basePrice). Không có giá gạch. */
export function webListPrice(hotel: HotelRecord, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const calc = webDisplayPerNight(Number(hotel.basePrice ?? 0), "basePrice", policy, ctx);
  if (hotel.basePrice == null) calc.warnings.push("record không có basePrice → web hiển thị 0");
  const note = listTaxNote(hotel);
  if (note) calc.warnings.push(`${note} — dù web ghi "giá đã gồm thuế phí"`);
  return calc;
}

/** Web — giá/đêm 1 phòng ở trang DETAIL: markup(exclusive) + tax + fees. */
export function webDetailPerNight(room: HotelRoom, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const r = room.perRoomPerNightRate;
  if (!r) return { result: 0, steps: [], warnings: ["phòng không có perRoomPerNightRate"] };
  const marked = webDisplayPerNight(r.exclusive, "exclusive", policy, ctx);
  const steps = marked.steps.slice(0, -1);
  steps.push({ op: "=", value: marked.result, label: "exclusive sau markup/phòng/đêm" });
  steps.push({ op: "+", value: r.tax, label: "tax/phòng/đêm (không markup)" });
  steps.push({ op: "+", value: r.fees, label: "fees/phòng/đêm (không markup)" });
  const result = marked.result + r.tax + r.fees;
  steps.push({ op: "=", value: result, label: "/phòng/đêm hiển thị" });
  return { result, steps, warnings: [] };
}

/** Web — trang BOOKING (useChoosenHotelPrice + HotelPriceDetail + payload checkout). */
export function webBooking(room: HotelRoom, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc & { lines: { label: string; value: number }[] } {
  const r = room.perRoomPerNightRate;
  if (!r) return { result: 0, steps: [], warnings: ["phòng không có perRoomPerNightRate"], lines: [] };
  const R = Math.max(1, ctx.roomsNum);
  const N = Math.max(1, ctx.nights);
  const perNight = webDetailPerNight(room, policy, ctx).result;
  const total = perNight * N * R;
  const baseTotal = (r.exclusive + r.tax + r.fees) * N * R;
  const markupAmount = total - baseTotal;
  const steps: PriceStep[] = [
    { op: "", value: perNight, label: "giá/phòng/đêm (detail)" },
    { op: "×", value: N * R, label: `${N} đêm × ${R} phòng` },
    { op: "=", value: total, label: "totalAmount (chưa voucher, chưa phí cổng TT)" },
  ];
  return {
    result: total,
    steps,
    warnings: [],
    lines: [
      { label: `"${R} phòng × ${N} đêm" = exclusive × N × R`, value: r.exclusive * N * R },
      { label: `"Thuế và phí" = tax + fees + markup (+ phí cổng TT)`, value: (r.tax + r.fees) * N * R + markupAmount },
      { label: "serviceAmount gửi BE = markupAmount (total − (excl+tax+fees)×N×R)", value: markupAmount },
      { label: "feeAmount gửi BE = fees × N × R (không gồm tax)", value: r.fees * N * R },
      { label: "Base validate voucher = exclusive × N × R", value: r.exclusive * N * R },
    ],
  };
}

// ─────────────────────────────── TMS ───────────────────────────────

/** TMS strategy: BASE_PRICE & PER_ROOM_NIGHT → units R×N, % trên (base ÷ R×N); PER_ROOM → R; khác → 1. */
function tmsConfigMarkup(baseAmount: number, c: HotelFeeConfig, ctx: MarkupContext, exclusiveBase: number | undefined, baseLabel: string): ConfigMarkup {
  if (CANCELLATION_METHODS.has(c.calculationMethod)) return { amount: 0, how: "phí huỷ — bỏ qua" };
  const R = Math.max(1, ctx.roomsNum);
  const N = Math.max(1, ctx.nights);
  const method = c.calculationMethod;
  const units = method === "BASE_PRICE" || method === "PER_ROOM_NIGHT" ? R * N : method === "PER_ROOM" ? R : 1;
  const source = method === "BASE_PRICE" ? exclusiveBase ?? baseAmount : baseAmount;
  const safeBase = Math.max(0, source);
  const percentBase = method === "BASE_PRICE" || method === "PER_ROOM_NIGHT" ? safeBase / Math.max(1, R * N) : method === "PER_ROOM" ? safeBase / R : safeBase;
  const baseName = method === "BASE_PRICE" ? "exclusive" : baseLabel;
  let feeValue: number;
  let how: string;
  if (c.unitType === "PERCENT") {
    feeValue = ((percentBase * c.amount) / 100) * units;
    how = units > 1 ? `${c.amount}% × ${fmt(percentBase)} (${baseName}) × ${units}` : `${c.amount}% × ${fmt(safeBase)} (${baseName})`;
  } else {
    feeValue = c.amount * units;
    how = units > 1 ? `${fmt(c.amount)} × ${units}` : `${fmt(c.amount)}`;
  }
  return { amount: finishMarkup(safeBase, feeValue, c.operation), how };
}

function tmsMarkupSteps(baseTotal: number, policy: HotelFeePolicy, ctx: MarkupContext, exclusiveTotal: number | undefined, baseLabel: string) {
  const steps: PriceStep[] = [];
  let markup = 0;
  if (baseTotal <= 0) return { markup, steps };
  for (const c of flattenFeeConfigs(policy.feeConfigs)) {
    if (CANCELLATION_METHODS.has(c.calculationMethod)) continue;
    const m = tmsConfigMarkup(baseTotal, c, ctx, exclusiveTotal, baseLabel);
    markup += m.amount;
    steps.push({ op: m.amount < 0 ? "-" : "+", value: Math.abs(m.amount), label: `markup ${describeConfig(c)}`, note: m.how });
  }
  return { markup, steps };
}

/** TMS getHotelDisplayPrice(base inclusive, exclusive riêng cho BASE_PRICE). */
function tmsDisplayPerNight(base: number, baseLabel: string, exclusive: number | undefined, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const R = Math.max(1, ctx.roomsNum);
  const N = Math.max(1, ctx.nights);
  const steps: PriceStep[] = [{ op: "", value: base, label: `${baseLabel}/phòng/đêm` }];
  if (!policy || base <= 0) {
    steps.push({ op: "=", value: base, label: policy ? "base ≤ 0 — không cộng markup" : "không có policy markup" });
    return { result: base, steps, warnings: [] };
  }
  const baseTotal = base * R * N;
  if (R * N > 1) steps.push({ op: "×", value: R * N, label: `${R} phòng × ${N} đêm`, note: `= ${fmt(baseTotal)}` });
  const { markup, steps: markupSteps } = tmsMarkupSteps(baseTotal, policy, ctx, exclusive != null ? exclusive * R * N : undefined, baseLabel);
  steps.push(...markupSteps);
  const markedTotal = Math.round(baseTotal + markup);
  const result = Math.round(markedTotal / (R * N));
  if (R * N > 1) steps.push({ op: "÷", value: R * N, label: "chia lại về 1 phòng/1 đêm", note: `${fmt(markedTotal)} ÷ ${R * N}` });
  steps.push({ op: "=", value: result, label: "/phòng/đêm hiển thị" });
  return { result, steps, warnings: [] };
}

/** TMS — thẻ khách sạn trang LIST: base = basePrice ?? costPerNight.inclusive; giá gạch = giá + savingAmount. */
export function tmsListPrice(hotel: HotelRecord, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const cpn = hotel.costPerNight;
  const base = Number(hotel.basePrice ?? cpn?.inclusive ?? cpn?.exclusive ?? 0);
  const baseLabel = hotel.basePrice != null ? "basePrice" : cpn?.inclusive != null ? "costPerNight.inclusive" : "costPerNight.exclusive";
  const exclusive = Number(cpn?.exclusive ?? hotel.basePrice ?? cpn?.inclusive ?? 0);
  const calc = tmsDisplayPerNight(base, baseLabel, exclusive, policy, ctx);
  const saving = Number(hotel.promotionDetails?.savingAmount ?? 0);
  if (saving > 0 && calc.result > 0) calc.originalPrice = calc.result + saving;
  const note = baseLabel === "basePrice" ? listTaxNote(hotel) : null;
  if (note) calc.warnings.push(note);
  return calc;
}

/** TMS — giá/đêm 1 phòng ở DETAIL: base = perRoomPerNightRate.inclusive (đã gồm tax + fees). */
export function tmsDetailPerNight(room: HotelRoom, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const N = Math.max(1, ctx.nights);
  const p = room.perRoomPerNightRate;
  const base = p?.inclusive != null ? p.inclusive : room.totalPayment?.inclusive != null ? room.totalPayment.inclusive / N : Number(room.rate?.inclusive ?? 0);
  const exclusive = p?.exclusive != null ? p.exclusive : room.totalPayment?.exclusive != null ? room.totalPayment.exclusive / N : Number(room.rate?.exclusive ?? 0);
  const label = p?.inclusive != null ? "inclusive" : room.totalPayment?.inclusive != null ? "totalPayment.inclusive ÷ đêm" : "rate.inclusive";
  return tmsDisplayPerNight(base, label, exclusive, policy, ctx);
}

/** TMS — tổng cả kỳ ở (getRoomStayTotal): markup trên inclusive × R × N, KHÔNG nhân từ giá/đêm đã làm tròn. */
export function tmsStayTotal(room: HotelRoom, policy: HotelFeePolicy | null, ctx: MarkupContext): PriceCalc {
  const R = Math.max(1, ctx.roomsNum);
  const N = Math.max(1, ctx.nights);
  const p = room.perRoomPerNightRate;
  const base = p?.inclusive != null ? p.inclusive : room.totalPayment?.inclusive != null ? room.totalPayment.inclusive / N : Number(room.rate?.inclusive ?? 0);
  const exclusive = p?.exclusive != null ? p.exclusive : room.totalPayment?.exclusive != null ? room.totalPayment.exclusive / N : Number(room.rate?.exclusive ?? 0);
  const baseTotal = base * R * N;
  const steps: PriceStep[] = [
    { op: "", value: base, label: "inclusive/phòng/đêm" },
    { op: "×", value: R * N, label: `${R} phòng × ${N} đêm`, note: `= ${fmt(baseTotal)}` },
  ];
  let total = baseTotal;
  if (policy && baseTotal > 0) {
    const { markup, steps: markupSteps } = tmsMarkupSteps(baseTotal, policy, ctx, exclusive * R * N, "inclusive");
    steps.push(...markupSteps);
    total = Math.round(baseTotal + markup);
  }
  steps.push({ op: "=", value: total, label: "totalAmount đơn TMS (chưa có voucher)" });
  return { result: total, steps, warnings: [] };
}

// ─────────────────────────────── Dữ liệu API ───────────────────────────────

export type Rate = { exclusive: number; inclusive: number; tax: number; fees: number; currency?: string };

export type HotelRoom = {
  roomId: number | string;
  roomName?: string;
  translatedRoomName?: string;
  blockId?: string;
  perRoomPerNightRate?: Rate;
  totalPayment?: Rate;
  rate?: Rate;
  promotionDetail?: { savingAmount?: number; description?: string };
  freeBreakfast?: boolean;
  freeCancellation?: boolean;
  remainingRooms?: number;
};

export type HotelRecord = {
  id?: number | string;
  hotelId: number;
  hotelName?: string;
  translatedName?: string;
  starRating?: number | string;
  accommodationType?: string;
  searchId?: number | string;
  basePrice?: number | null;
  basePriceBeforePromo?: number | null;
  taxAndServiceFree?: number | null;
  setTotalPrice?: number | null;
  setCurrency?: string;
  supplier?: string;
  costPerNight?: Rate;
  promotionDetails?: { savingAmount?: number; description?: string };
};

/** Phòng rẻ nhất theo perRoomPerNightRate.inclusive — cùng cách web xếp phòng ở detail. */
export function cheapestRoom(rooms: HotelRoom[]): HotelRoom | undefined {
  return rooms
    .filter((r) => r.perRoomPerNightRate)
    .sort((a, b) => a.perRoomPerNightRate!.inclusive - b.perRoomPerNightRate!.inclusive)[0];
}

/** "1.200.000 (basePrice/phòng/đêm) × 6 (2 phòng × 3 đêm) + 864.000 (markup …) = 1.344.000 (/phòng/đêm)". */
export function stepsToText(steps: PriceStep[]): string {
  return steps
    .map((s) => {
      const body = `${fmt(s.value)} (${s.label}${s.note ? `: ${s.note}` : ""})`;
      return s.op ? `${s.op} ${body}` : body;
    })
    .join(" ");
}
