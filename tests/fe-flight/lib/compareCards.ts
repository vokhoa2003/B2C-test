import { ExpectedCard, legKey } from "./expectedCards";
import { UiCard } from "./resultReader";

export type CardStatus = "KHỚP" | "LỆCH" | "KHÔNG CÓ TRONG API";

export type FieldIssue = { field: string; ui: string; api: string };

export type CardResult = {
  status: CardStatus;
  ui: UiCard;
  /** Card API khớp nhất (cùng chuyến). */
  expected?: ExpectedCard;
  issues: FieldIssue[];
  /** Giá UI được giải thích thế nào (VD "đã trừ voucher 50.000 / khách"). */
  priceNote?: string;
  screenshot?: string;
};

export type CompareSummary = {
  uiCards: number;
  apiCards: number;
  ok: number;
  mismatched: number;
  notInApi: number;
  /** Card API không thấy trên UI (chỉ tính khi đã cuộn hết danh sách). */
  missingOnUi: ExpectedCard[];
  loadedAll: boolean;
};

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) <= 1;

/** Giá UI có giải thích được bằng giá API không. Trả về ghi chú nếu khớp, null nếu lệch. */
function explainPrice(ui: UiCard, exp: ExpectedCard): string | null {
  const gross = Math.round(exp.price.perPax);
  const pax = Math.max(exp.price.adt + exp.price.chd + exp.price.inf, 1);
  if (near(ui.priceMain, gross)) return "";
  if (ui.voucherBadge && near(ui.priceMain, Math.max(0, exp.price.perPax - ui.voucherBadge / pax))) {
    if (ui.priceStrike != null && !near(ui.priceStrike, gross)) return null;
    return `đã trừ voucher ${fmt(ui.voucherBadge)} ÷ ${pax} khách`;
  }
  return null;
}

function issuesOf(ui: UiCard, exp: ExpectedCard): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const check = (field: string, uiVal: unknown, apiVal: unknown) => {
    if (String(uiVal ?? "") !== String(apiVal ?? "")) issues.push({ field, ui: String(uiVal ?? "—"), api: String(apiVal ?? "—") });
  };
  if (ui.legs.length !== exp.legs.length) check("số chặng", ui.legs.length, exp.legs.length);
  exp.legs.forEach((leg, i) => {
    const u = ui.legs[i];
    if (!u) return;
    const p = exp.legs.length > 1 ? `chặng ${i + 1}: ` : "";
    check(`${p}điểm đi`, u.from, leg.from);
    check(`${p}điểm đến`, u.to, leg.to);
    check(`${p}điểm dừng`, u.stopLabel, leg.stopLabel);
    check(`${p}+ngày`, u.nextDay, leg.nextDay);
  });
  if (explainPrice(ui, exp) === null) {
    issues.push({ field: "giá / khách", ui: `${fmt(ui.priceMain)}${ui.priceStrike ? ` (gạch ${fmt(ui.priceStrike)})` : ""}`, api: fmt(exp.price.perPax) });
  }
  if (exp.handBaggage) check("hành lý xách tay", (ui.handBaggage ?? "").toLowerCase(), exp.handBaggage);
  if (exp.seats && ui.seats) check("số vé còn", ui.seats, exp.seats);
  return issues;
}

export function compareCards(uiCards: UiCard[], expected: ExpectedCard[], loadedAll: boolean) {
  const byKey = new Map<string, ExpectedCard[]>();
  for (const e of expected) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  const used = new Set<ExpectedCard>();

  const rows: CardResult[] = uiCards.map((ui) => {
    const key = ui.legs.map((l) => legKey(l.flightCodes, l.depTime, l.arrTime)).join(" + ");
    const candidates = byKey.get(key) ?? [];
    if (!candidates.length) return { status: "KHÔNG CÓ TRONG API", ui, issues: [] };
    // Cùng chuyến có thể có nhiều fare (VD VN và GALILEO_NDC) → chọn fare ít lỗi nhất, ưu tiên fare chưa dùng.
    const ranked = candidates
      .map((e) => ({ e, issues: issuesOf(ui, e) }))
      .sort((a, b) => a.issues.length - b.issues.length || Number(used.has(a.e)) - Number(used.has(b.e)));
    const best = ranked[0];
    used.add(best.e);
    return {
      status: best.issues.length ? "LỆCH" : "KHỚP",
      ui,
      expected: best.e,
      issues: best.issues,
      priceNote: explainPrice(ui, best.e) || undefined,
    };
  });

  const summary: CompareSummary = {
    uiCards: uiCards.length,
    apiCards: expected.length,
    ok: rows.filter((r) => r.status === "KHỚP").length,
    mismatched: rows.filter((r) => r.status === "LỆCH").length,
    notInApi: rows.filter((r) => r.status === "KHÔNG CÓ TRONG API").length,
    missingOnUi: loadedAll ? expected.filter((e) => !used.has(e)) : [],
    loadedAll,
  };
  return { rows, summary };
}
