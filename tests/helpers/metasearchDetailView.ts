/**
 * Bảng chi tiết từng hành trình trong report.html — dùng chung cho báo cáo v1 (metasearchReport.ts)
 * và v2 (metasearchReportV2.ts). Dữ liệu nhúng dạng JSON, render bằng JS trong trang để xử lý được
 * vài nghìn dòng: lọc theo trạng thái / system / số hiệu, sắp xếp, phân trang, bấm dòng xem chi tiết.
 */

/** Đủ field mà cả DetailRow v1 lẫn v2 đều có. */
export type DetailRowLike = {
  status: string;
  side: string;
  system: string;
  airline: string;
  legs: { dir: number; flightNumbers: string; route: string; depart: string; arrive: string }[];
  metaPrice: number | null;
  voucherCode: string;
  voucherDiscount: number;
  metaBasePrice: number | null;
  metaLegPrices: (number | null)[];
  webPrices: number[];
  webLegPrices: number[][];
  webClosestPrice: number | null;
  diff: number | null;
  diffLegs: string;
  metaServiceFee: number | null;
  webServiceFee: number | null;
  metaFinal: number | null;
  webFinal: number | null;
  webSource: string;
  metaDuplicates: number;
  note: string;
  /** Giờ từ lúc search tới giờ cất cánh chặng đi (chỉ v2 gắn) — < 24 thì đánh dấu "trong 24h". */
  hoursToDepart?: number | null;
  /** Hạng ghế của giá meta, VD "Eco · A" (chỉ v2). */
  metaClass?: string;
  /** Hạng ghế của từng giá web (key = giá, chỉ v2). */
  webClasses?: Record<string, string>;
  /** Dữ liệu API 2 bên (chỉ v2): fare/tax/fee/total từng loại khách, phí markup, cách ra giá so sánh. */
  breakdown?: { meta?: BreakdownSide; web?: BreakdownSide };
  /** File JSON đã lưu của hành trình (chỉ v2, dòng lệch). */
  jsonHref?: string;
};

type PaxPriceLike = { n: number; fare: number | null; tax: number | null; fee: number | null; total: number | null };
type BreakdownSide = {
  invs: { dir: number; flight: string; cls: string; adt: PaxPriceLike; chd: PaxPriceLike; inf: PaxPriceLike; totalAmount: number | null }[];
  fees: { dir: number | null; paxType: string; amount: number }[];
  formula: string[];
};

/**
 * Nén dữ liệu API thành mảng (bỏ tên field, bỏ loại khách 0 người) để report.html nhẹ — hàng nghìn dòng mỗi điều kiện.
 * inv: [dir, flight, cls, totalAmount, adt, chd, inf] với mỗi loại khách = [n, fare, tax, fee, total] hoặc 0.
 * Giải nén ở `unpack` trong detailViewScript.
 */
function packBreakdown(bd: DetailRowLike["breakdown"]) {
  if (!bd) return undefined;
  const pax = (p: PaxPriceLike) => (p.n > 0 ? [p.n, p.fare, p.tax, p.fee, p.total] : 0);
  const side = (s?: BreakdownSide) =>
    s && [
      s.invs.map((i) => [i.dir, i.flight, i.cls, i.totalAmount, pax(i.adt), pax(i.chd), pax(i.inf)]),
      s.fees.map((f) => [f.dir, f.paxType, f.amount]),
      s.formula,
    ];
  return [side(bd.meta) || 0, side(bd.web) || 0];
}

export type DetailViewLabels = {
  /** Cột giá chính META, VD "Giá META (trước voucher)" / "Giá vé META (+ voucher)". */
  metaPrice: string;
  webPrice: string;
  fee: string;
  final: string;
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Chỗ đặt bảng cho 1 điều kiện + dữ liệu JSON của nó (rút gọn tên field cho nhẹ file). */
export function detailView(condId: string, rows: DetailRowLike[], labels: DetailViewLabels): string {
  const data = rows.map((r) => ({
    s: r.status, sd: r.side, sy: r.system, al: r.airline,
    lg: r.legs.map((l) => [l.dir, l.flightNumbers, l.route, l.depart, l.arrive]),
    mp: r.metaPrice, vc: r.voucherCode, vd: r.voucherDiscount, mb: r.metaBasePrice, ml: r.metaLegPrices,
    wc: r.webClosestPrice, wp: r.webPrices, wl: r.webLegPrices, d: r.diff, dl: r.diffLegs,
    mf: r.metaServiceFee, wf: r.webServiceFee, mt: r.metaFinal, wt: r.webFinal,
    src: r.webSource, dup: r.metaDuplicates, n: r.note, h: r.hoursToDepart, mc: r.metaClass, wcl: r.webClasses, bd: packBreakdown(r.breakdown), jh: r.jsonHref,
  }));
  // Thoát "<" để chuỗi "</script>" trong dữ liệu không đóng thẻ.
  const json = JSON.stringify({ labels, rows: data }).replace(/</g, "\\u003c");
  return `<div class="dv" data-cond="${esc(condId)}"></div>
<script type="application/json" id="dv-data-${esc(condId)}">${json}</script>`;
}

export const detailViewCss = `
  .dv { margin-top: 12px; }
  .dv-sys { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
  .dv-sys button { font: inherit; font-size: 12px; border: 1px solid #d0d4da; background: #fff; border-radius: 999px; padding: 2px 10px; cursor: pointer; }
  .dv-sys button.on { border-color: #2563eb; background: #eff6ff; }
  .dv-sys .bad { color: #b42318; font-weight: 600; }
  .dv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
  .dv-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .dv-chips button { font: inherit; font-size: 12px; border: 1px solid #d0d4da; background: #fff; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
  .dv-chips button.on { background: #1f2328; color: #fff; border-color: #1f2328; }
  .dv-chips button:disabled { opacity: .45; cursor: default; }
  .dv-bar input, .dv-bar select { font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid #d0d4da; border-radius: 6px; background: #fff; }
  .dv-bar input { min-width: 180px; }
  .dv table { table-layout: auto; }
  .dv tbody tr.row { cursor: pointer; }
  .dv tbody tr.row:hover { background: #f8fafc; }
  .dv tbody tr.open { background: #f1f5f9; }
  .dv td.it { font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; }
  .dv td.it .d { color: #6b7280; display: inline-block; width: 22px; }
  .dv td.it .t { color: #6b7280; }
  .dv .caret { color: #9ca3af; width: 14px; }
  .dv tr.detail td { background: #f8fafc; padding: 10px 14px 14px 36px; }
  .dv .grid { display: grid; grid-template-columns: max-content 1fr 1fr; gap: 4px 18px; font-size: 13px; max-width: 820px; }
  .dv .grid .h { font-weight: 600; color: #6b7280; font-size: 12px; }
  .dv .levels { display: flex; flex-wrap: wrap; gap: 4px; }
  .dv .cls { color: #0f766e; font-size: 11px; font-weight: 600; }
  .dv .levels span i { font-style: normal; color: #0f766e; font-size: 11px; }
  .dv .levels span { background: #fff; border: 1px solid #e3e5e8; border-radius: 4px; padding: 0 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .dv .levels span.hit { border-color: #16a34a; background: #dcfce7; }
  .dv .notes { margin-top: 8px; font-size: 12px; color: #4b5563; }
  .dv details.api { margin-top: 10px; } .dv details.api summary { font-size: 12px; font-weight: 600; color: #2563eb; cursor: pointer; }
  .dv .api-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
  .dv .api-side { background: #fff; border: 1px solid #e3e5e8; border-radius: 8px; padding: 8px 10px; min-width: 0; }
  .dv .api-title { font-weight: 700; font-size: 12px; color: #374151; margin-bottom: 4px; }
  .dv .api-inv { margin-bottom: 8px; } .dv .api-h { font-size: 12px; font-weight: 600; margin-bottom: 2px; }
  .dv table.api-t { width: auto; font-size: 12px; border-collapse: collapse; }
  .dv table.api-t th, .dv table.api-t td { padding: 2px 8px; border-bottom: 1px solid #f0f2f5; background: transparent; }
  .dv table.api-t th { font-weight: 600; color: #6b7280; } .dv table.api-t td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .dv .api-f { margin-top: 6px; font: 12px/1.6 ui-monospace, Consolas, monospace; background: #f8fafc; border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; }
  .dv .api-legend { margin-top: 6px; line-height: 1.5; }
  @media (max-width: 900px) { .dv .api-grid { grid-template-columns: 1fr; } }
  .dv-pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 8px; font-size: 12px; color: #6b7280; }
  .dv-pager button { font: inherit; font-size: 12px; padding: 2px 10px; border: 1px solid #d0d4da; background: #fff; border-radius: 6px; cursor: pointer; }
  .dv-pager button:disabled { opacity: .4; cursor: default; }
  .dv .fee-ok { color: #6b7280; } .dv .fee-bad { color: #b42318; font-weight: 600; }
  .tag.warn { background: #fef9c3; color: #854d0e; }
  .dv-sys .warn-t { color: #a16207; font-weight: 600; }
  .dv .small-diff { color: #a16207; font-weight: 600; }
  .dv .near { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #ede9fe; color: #5b21b6; font-family: system-ui, sans-serif; }
  .dv .near.past { background: #fee2e2; color: #991b1b; }
  .dv-near { font-size: 12px; display: inline-flex; gap: 4px; align-items: center; color: #5b21b6; white-space: nowrap; }
  .dv-bar .dv-near input { min-width: 0; padding: 0; }
`;

/** JS chạy trong trang: render mọi `.dv` từ JSON tương ứng. Không dùng regex/backslash để an toàn trong template. */
export const detailViewScript = `<script>
(() => {
  const SMALL = "Lệch giá dưới 1k"; // chênh do làm tròn → cảnh báo vàng, không tính là lệch
  const STATUSES = ["LỆCH GIÁ", "LỆCH PHÍ", "CHỈ CÓ Ở META", "CHỈ CÓ Ở WEB", SMALL, "KHỚP"];
  const TAG = { "KHỚP": "ok", "LỆCH GIÁ": "diff", [SMALL]: "warn", "LỆCH PHÍ": "diff", "CHỈ CÓ Ở META": "meta", "CHỈ CÓ Ở WEB": "web" };
  const isProblem = (r) => r.s !== "KHỚP" && r.s !== SMALL;
  const money = (v) => (typeof v === "number" ? v.toLocaleString("vi-VN") : "—");
  const short = (v) => {
    if (typeof v !== "number") return "—";
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + "tr";
    if (a >= 1e3) return Math.round(v / 1e3).toLocaleString("vi-VN") + "k";
    return String(v);
  };
  const esc = (s) => String(s == null ? "" : s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
  // "2026-12-16T09:40:00Z" -> "16/12 09:40"
  const hm = (iso) => {
    const s = String(iso || "");
    if (s.length < 16) return s;
    return s.slice(8, 10) + "/" + s.slice(5, 7) + " " + s.slice(11, 16);
  };
  // Giờ đến; khác ngày giờ đi thì thêm "+N" (bay qua đêm).
  const arrive = (dep, arr) => {
    const t = String(arr || "").slice(11, 16);
    const days = Math.round((Date.parse(String(arr).slice(0, 10)) - Date.parse(String(dep).slice(0, 10))) / 86400000);
    return days > 0 ? t + "+" + days : t;
  };
  // Chuyến cất cánh trong 24h kể từ lúc search (h = số giờ) → nhãn tím; đã qua giờ bay → nhãn đỏ.
  const NEAR_HOURS = 24;
  const isNear = (r) => typeof r.h === "number" && r.h < NEAR_HOURS;
  const nearTag = (r) => {
    if (!isNear(r)) return "";
    if (r.h < 0) return '<span class="near past" title="Giờ cất cánh đã qua lúc search">đã qua giờ bay</span>';
    const mins = Math.round(r.h * 60);
    return '<span class="near" title="Cất cánh trong 24h kể từ lúc search">≤24h · còn ' + Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0") + "</span>";
  };

  document.querySelectorAll(".dv").forEach((root) => {
    const id = root.dataset.cond;
    const { labels, rows } = JSON.parse(document.getElementById("dv-data-" + id).textContent);
    if (!rows.length) { root.innerHTML = '<p class="muted">Không có hành trình nào.</p>'; return; }

    const problems = rows.filter(isProblem).length;
    const nearCount = rows.filter(isNear).length;
    const st = { status: problems ? "PROBLEMS" : "ALL", system: "", q: "", near: false, sort: "default", page: 0, size: 25, open: new Set() };

    // Tóm tắt theo system
    const bySys = new Map();
    rows.forEach((r) => {
      const e = bySys.get(r.sy) || { ok: 0, bad: 0, warn: 0 };
      if (r.s === "KHỚP") e.ok++; else if (r.s === SMALL) e.warn++; else e.bad++;
      bySys.set(r.sy, e);
    });
    const counts = {};
    rows.forEach((r) => (counts[r.s] = (counts[r.s] || 0) + 1));

    root.innerHTML =
      '<div class="dv-sys"></div>' +
      '<div class="dv-bar"><div class="dv-chips"></div>' +
      '<select class="dv-sort"><option value="default">Sắp xếp: mặc định</option><option value="diff">Chênh lệch lớn nhất</option><option value="price">Giá META thấp nhất</option><option value="depart">Giờ đi sớm nhất</option></select>' +
      '<input class="dv-q" type="search" placeholder="Tìm số hiệu / chặng (VD VJ975, ICN)">' +
      (nearCount ? '<label class="dv-near"><input type="checkbox" class="dv-near-cb"> Chỉ chuyến bay trong 24h (' + nearCount + ")</label>" : "") +
      '<select class="dv-size"><option>25</option><option>50</option><option>100</option></select></div>' +
      '<div class="scroll"><table><thead><tr><th></th><th>Trạng thái</th><th>System</th><th>Hành trình</th>' +
      '<th class="num">' + esc(labels.metaPrice) + '</th><th class="num">' + esc(labels.webPrice) + '</th><th class="num">Chênh</th><th class="num">' + esc(labels.fee) + '</th></tr></thead><tbody></tbody></table></div>' +
      '<div class="dv-pager"></div>';
    const $ = (sel) => root.querySelector(sel);

    const sysBox = $(".dv-sys");
    const renderSys = () => {
      sysBox.innerHTML = [...bySys.entries()].sort((a, b) => b[1].bad - a[1].bad || b[1].ok - a[1].ok).map(([sy, e]) =>
        '<button data-sy="' + esc(sy) + '" class="' + (st.system === sy ? "on" : "") + '"><b>' + esc(sy) + '</b>: ' +
        [e.bad && '<span class="bad">' + e.bad + " lệch/thiếu</span>", e.warn && '<span class="warn-t">' + e.warn + " lệch &lt;1k</span>", e.ok && e.ok + " khớp"]
          .filter(Boolean).join(" · ") + "</button>").join("");
    };
    sysBox.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.system = st.system === b.dataset.sy ? "" : b.dataset.sy; st.page = 0; renderSys(); render();
    });

    const chips = $(".dv-chips");
    const chipDefs = [["PROBLEMS", "Lệch / thiếu", problems], ["ALL", "Tất cả", rows.length]].concat(STATUSES.map((s) => [s, s.charAt(0) + s.slice(1).toLowerCase(), counts[s] || 0]));
    const renderChips = () => {
      chips.innerHTML = chipDefs.map(([k, label, n]) =>
        '<button data-k="' + esc(k) + '" class="' + (st.status === k ? "on" : "") + '"' + (n ? "" : " disabled") + '>' + esc(label) + " (" + n + ")</button>").join("");
    };
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      st.status = b.dataset.k; st.page = 0; renderChips(); render();
    });
    $(".dv-sort").addEventListener("change", (e) => { st.sort = e.target.value; st.page = 0; render(); });
    $(".dv-size").addEventListener("change", (e) => { st.size = Number(e.target.value); st.page = 0; render(); });
    $(".dv-q").addEventListener("input", (e) => { st.q = e.target.value.trim().toLowerCase(); st.page = 0; render(); });
    if (nearCount) $(".dv-near-cb").addEventListener("change", (e) => { st.near = e.target.checked; st.page = 0; render(); });

    const legLine = (l) =>
      '<div><span class="d">' + (l[0] ? "Về" : "Đi") + "</span>" + esc(l[1]) + " " + esc(l[2]) +
      ' <span class="t">' + esc(hm(l[3])) + "→" + esc(arrive(l[3], l[4])) + "</span></div>";
    const feeCell = (r) => {
      if (r.mf == null && r.wf == null) return "";
      if (r.mf != null && r.wf != null && r.mf !== r.wf) return '<span class="fee-bad">' + short(r.mf) + " ≠ " + short(r.wf) + "</span>";
      return '<span class="fee-ok">' + short(r.mf != null ? r.mf : r.wf) + "</span>";
    };
    // Hạng ghế của 1 giá web (v2), VD "Eco · A".
    const cls = (r, p) => (r.wcl && r.wcl[String(p)]) || "";
    const levels = (list, hit, r) => '<div class="levels">' + (list || []).map((p) => '<span class="' + (p === hit ? "hit" : "") + '">' + money(p) +
      (r && cls(r, p) ? ' <i>' + esc(cls(r, p)) + "</i>" : "") + "</span>").join("") + "</div>";
    // Dữ liệu API (v2): mỗi bên 1 cột — từng chiều: fare/tax/fee/total 1 người theo loại khách, totalAmount,
    // phí markup (fees) và các bước ra giá so sánh.
    const PAX = [["adt", "Người lớn"], ["chd", "Trẻ em"], ["inf", "Em bé"]];
    // Giải nén packBreakdown().
    const unpackPax = (p) => (p ? { n: p[0], fare: p[1], tax: p[2], fee: p[3], total: p[4] } : null);
    const unpackSide = (s) => s ? {
      invs: s[0].map((i) => ({ dir: i[0], flight: i[1], cls: i[2], totalAmount: i[3], adt: unpackPax(i[4]), chd: unpackPax(i[5]), inf: unpackPax(i[6]) })),
      fees: s[1].map((f) => ({ dir: f[0], paxType: f[1], amount: f[2] })),
      formula: s[2],
    } : null;
    const API_LEGEND = '<div class="muted api-legend">META: totalAmount API đã trừ voucher và đã gồm phí markup (cộng vào tax/total của người lớn, trẻ em; em bé không tính phí, không trừ voucher) → cộng lại voucher để so với web. ' +
      "COMBINED / combo: giá cả chuyến nằm ở chiều đầu. WEB: giá vé (GALILEO = totalAmount; hãng khác = số khách × total / người) + phí markup theo công thức (combo: × số chiều; 2 chặng lẻ: mỗi chiều phí của chính nó). " +
      "fare / tax / fee / total là giá 1 người API trả.</div>";
    const unpack = (bd) => (bd ? { meta: unpackSide(bd[0]), web: unpackSide(bd[1]) } : null);
    const invTable = (inv) => {
      const rows = PAX.filter(([k]) => inv[k] && inv[k].n > 0).map(([k, label]) => {
        const p = inv[k];
        return "<tr><td>" + label + "</td><td class='n'>" + p.n + "</td><td class='n'>" + money(p.fare) + "</td><td class='n'>" + money(p.tax) +
          "</td><td class='n'>" + money(p.fee) + "</td><td class='n'><b>" + money(p.total) + "</b></td><td class='n'>" +
          (typeof p.total === "number" ? money(p.total * p.n) : "—") + "</td></tr>";
      }).join("");
      return '<div class="api-inv"><div class="api-h">' + (inv.dir ? "Về" : "Đi") + " " + esc(inv.flight) + (inv.cls ? ' <span class="cls">' + esc(inv.cls) + "</span>" : "") + "</div>" +
        '<table class="api-t"><thead><tr><th></th><th>SL</th><th>fare</th><th>tax</th><th>fee</th><th>total / người</th><th>× SL</th></tr></thead><tbody>' + rows +
        "</tbody></table><div class='muted'>totalAmount của chiều: <b>" + money(inv.totalAmount) + "</b></div></div>";
    };
    const side = (title, s) => {
      if (!s) return '<div class="api-side"><div class="api-title">' + title + '</div><div class="muted">Không có dữ liệu</div></div>';
      const fees = s.fees.length
        ? s.fees.map((f) => (f.dir === null ? "" : f.dir ? "về " : "đi ") + esc(f.paxType) + " " + money(f.amount)).join(" · ")
        : "không có";
      return '<div class="api-side"><div class="api-title">' + title + "</div>" + s.invs.map(invTable).join("") +
        '<div class="muted">Phí markup (fees): ' + fees + "</div>" +
        '<div class="api-f">' + s.formula.map(esc).join("<br>") + "</div></div>";
    };
    const apiData = (packed) => { const bd = unpack(packed); return bd ? '<details class="api" open><summary>Dữ liệu API — số từ đâu ra</summary><div class="api-grid">' + side("META", bd.meta) + side("WEB", bd.web) + "</div>" + API_LEGEND + "</details>" : ""; };

    const detail = (r) => {
      const metaLines = [];
      if (r.mb != null) metaLines.push("<b>" + money(r.mb) + "</b>" + (r.mc ? ' <span class="cls">' + esc(r.mc) + "</span>" : ""));
      if (r.vd) metaLines.push('<div class="muted">API trả ' + money(r.mp) + " + voucher " + esc(r.vc) + " " + money(r.vd) + "</div>");
      // Combo: mỗi chiều mang giá cả chuyến → không tách đi/về.
      if (r.ml && r.ml.length > 1 && r.src !== "combo") metaLines.push('<div class="muted">đi ' + money(r.ml[0]) + " · về " + money(r.ml[1]) + (r.vd ? " (đã trừ voucher)" : "") + "</div>");
      const webLines = [];
      if (r.wc != null) webLines.push("<b>" + money(r.wc) + "</b>" + (cls(r, r.wc) ? ' <span class="cls">' + esc(cls(r, r.wc)) + "</span>" : ""));
      if (r.wp && r.wp.length > 1) webLines.push('<div class="muted">các mức hạng vé:</div>' + levels(r.wp, r.mb, r));
      (r.wl || []).forEach((p, i) => p.length && webLines.push('<div class="muted">' + (i ? "về" : "đi") + ":</div>" + levels(p, r.ml ? r.ml[i] : null)));
      const jsonLink = r.jh ? '<div class="notes"><a href="' + esc(r.jh) + '" target="_blank">JSON hành trình này</a> <span class="muted">(nguyên item API meta + web, kết quả so)</span></div>' : "";
      const notes = [typeof r.h === "number" && (r.h < 0 ? "Đã qua giờ bay " + Math.abs(r.h).toFixed(1) + "h lúc search" : "Cất cánh sau " + r.h.toFixed(1) + "h kể từ lúc search"), r.dl && "Chặng lệch: " + r.dl, r.src && "Nguồn web: " + r.src, r.dup > 1 && r.dup + " offer meta trùng", r.n].filter(Boolean);
      return '<div class="grid">' +
        '<div class="h"></div><div class="h">META</div><div class="h">WEB</div>' +
        "<div>" + esc(labels.metaPrice.replace(" META", "")) + "</div><div>" + (metaLines.join("") || "—") + "</div><div>" + (webLines.join("") || "—") + "</div>" +
        "<div>" + esc(labels.fee) + "</div><div>" + money(r.mf) + "</div><div>" + money(r.wf) + "</div>" +
        "<div>" + esc(labels.final) + "</div><div><b>" + money(r.mt) + "</b></div><div><b>" + money(r.wt) + "</b></div>" +
        "</div>" + (notes.length ? '<div class="notes">' + notes.map(esc).join(" · ") + "</div>" : "") + jsonLink + apiData(r.bd);
    };

    const tbody = $("tbody"), pager = $(".dv-pager");
    const filtered = () => {
      let list = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
        (st.status === "ALL" || (st.status === "PROBLEMS" ? isProblem(r) : r.s === st.status)) &&
        (!st.system || r.sy === st.system) &&
        (!st.near || isNear(r)) &&
        (!st.q || (r.lg.map((l) => l[1] + " " + l[2]).join(" ") + " " + r.sy + " " + r.al).toLowerCase().includes(st.q)));
      const by = {
        diff: (a, b) => Math.abs(b.r.d || 0) - Math.abs(a.r.d || 0),
        price: (a, b) => (a.r.mb == null ? Infinity : a.r.mb) - (b.r.mb == null ? Infinity : b.r.mb),
        depart: (a, b) => String((a.r.lg[0] || [])[3]).localeCompare(String((b.r.lg[0] || [])[3])),
      }[st.sort];
      return by ? list.sort(by) : list;
    };
    const render = () => {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / st.size));
      st.page = Math.min(st.page, pages - 1);
      const slice = list.slice(st.page * st.size, (st.page + 1) * st.size);
      tbody.innerHTML = slice.map(({ r, i }) => {
        const open = st.open.has(i);
        const diffClass = r.s === SMALL ? "small-diff" : r.d > 0 ? "up" : "down";
        const diff = r.d ? '<b class="' + diffClass + '">' + (r.d > 0 ? "+" : "") + money(r.d) + "</b>" : "";
        return '<tr class="row' + (open ? " open" : "") + '" data-i="' + i + '">' +
          '<td class="caret">' + (open ? "▾" : "▸") + "</td>" +
          '<td><span class="tag ' + (TAG[r.s] || "") + '">' + esc(r.s) + "</span></td>" +
          "<td>" + esc(r.sy) + (r.al && r.al !== r.sy ? ' <span class="muted">' + esc(r.al) + "</span>" : "") + "</td>" +
          '<td class="it">' + r.lg.map((l, k) => (k ? legLine(l) : legLine(l).replace("</span></div>", "</span>" + nearTag(r) + "</div>"))).join("") + "</td>" +
          '<td class="num">' + (r.mb != null ? money(r.mb) : "—") + (r.mc ? '<div class="cls">' + esc(r.mc) + "</div>" : "") + (r.vd ? '<div class="muted">voucher −' + short(r.vd) + "</div>" : "") + "</td>" +
          '<td class="num">' + (r.wc != null ? money(r.wc) : "—") + (cls(r, r.wc) ? '<div class="cls">' + esc(cls(r, r.wc)) + "</div>" : "") + (r.wp && r.wp.length > 1 ? '<div class="muted">' + r.wp.length + " mức</div>" : "") + "</td>" +
          '<td class="num">' + diff + "</td>" +
          '<td class="num">' + feeCell(r) + "</td></tr>" +
          (open ? '<tr class="detail"><td colspan="8">' + detail(r) + "</td></tr>" : "");
      }).join("") || '<tr><td colspan="8" class="muted">Không có dòng nào khớp bộ lọc.</td></tr>';
      pager.innerHTML = list.length
        ? "<span>" + (st.page * st.size + 1) + "–" + Math.min((st.page + 1) * st.size, list.length) + " / " + list.length + "</span>" +
          '<button data-p="-1"' + (st.page ? "" : " disabled") + ">‹ Trước</button>" +
          '<button data-p="1"' + (st.page < pages - 1 ? "" : " disabled") + ">Sau ›</button>"
        : "";
    };
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr.row"); if (!tr || e.target.closest("a")) return;
      const i = Number(tr.dataset.i);
      st.open.has(i) ? st.open.delete(i) : st.open.add(i);
      render();
    });
    pager.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      st.page += Number(b.dataset.p); render();
    });
    renderSys(); renderChips(); render();
  });
})();
</script>`;
