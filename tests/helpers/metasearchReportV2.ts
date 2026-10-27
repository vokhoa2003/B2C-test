import fs from "fs";
import path from "path";
import { CompareResult, DetailRow, FareItem, FareLeg } from "./metasearchCompareV2";
import { DetailViewLabels, detailView, detailViewCss, detailViewScript } from "./metasearchDetailView";

/**
 * V2 — ghi báo cáo so sánh metasearch vs web (công thức giá v2, xem metasearchCompareV2.ts) ra thư
 * mục riêng .test-state/metasearch-compare-v2/<thời gian>/ cho mỗi lần chạy:
 *   report.html  — báo cáo đọc trực tiếp bằng browser (tổng quan + chi tiết chuyến lệch/thiếu)
 *   summary.csv  — 1 dòng / điều kiện
 *   details.csv  — 1 dòng / hành trình (gồm cả dòng KHỚP để tra soát)
 *   raw/         — JSON gốc của cả 2 bên
 */

const REPORT_ROOT = path.join(process.cwd(), ".test-state", "metasearch-compare-v2");

export function createRunDir(): string {
  const dir = path.join(REPORT_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  return dir;
}

function csvEscape(value: unknown): string {
  const str = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** CSV có BOM để Excel đọc đúng tiếng Việt. */
export class CsvFile<T extends Record<string, unknown>> {
  constructor(private filePath: string, private columns: (keyof T)[]) {
    fs.writeFileSync(filePath, "﻿" + columns.join(",") + "\n", "utf-8");
  }

  append(rows: T[]) {
    if (!rows.length) return;
    const lines = rows.map((row) => this.columns.map((col) => csvEscape(row[col])).join(","));
    fs.appendFileSync(this.filePath, lines.join("\n") + "\n", "utf-8");
  }
}

/** "2026-12-08T09:40:00Z" -> "2026-12-08 09:40" (giữ nguyên giờ API trả, không đổi múi giờ). */
export const fmtTime = (iso: string) => iso.replace("T", " ").replace(/:00(\.\d+)?Z?$/, "").replace(/Z$/, "");
export const fmtPrice = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("vi-VN") : "");

export type ConditionReport = {
  id: string;
  description: string;
  route: string;
  dates: string;
  pax: string;
  webStatus: string;
  metaStatus: string;
  deeplink: string;
  webUrl: string;
  /** Đường dẫn tương đối (từ report.html) tới trang xem lại kết quả meta đã lưu. */
  metaSnapshotHref: string;
  /** Đường dẫn tương đối tới bản sao trang metaSearch hiển thị kết quả đã lưu (rỗng nếu không tạo được). */
  metaToolHref: string;
  verdict: string;
  result: CompareResult;
};

export const DETAIL_COLUMNS = [
  "id", "route", "status", "side", "system", "airline",
  "outFlight", "outRoute", "outDepart", "outArrive",
  "inFlight", "inRoute", "inDepart", "inArrive",
  "metaPrice", "voucherCode", "voucherDiscount", "metaBasePrice", "metaOutPrice", "metaInPrice",
  "webClosestPrice", "webPrices", "webOutPrices", "webInPrices",
  "diff", "diffLegs",
  "metaServiceFee", "webServiceFee", "metaFinal", "webFinal",
  "webSource", "metaDuplicates", "note",
] as const;

export function detailToCsvRow(id: string, route: string, r: DetailRow): Record<string, unknown> {
  const out = r.legs.find((l) => l.dir === 0);
  const back = r.legs.find((l) => l.dir === 1);
  const joinPrices = (list?: number[]) => (list ?? []).join(" / ");
  return {
    id, route, status: r.status, side: r.side, system: r.system, airline: r.airline,
    outFlight: out?.flightNumbers, outRoute: out?.route, outDepart: out && fmtTime(out.depart), outArrive: out && fmtTime(out.arrive),
    inFlight: back?.flightNumbers, inRoute: back?.route, inDepart: back && fmtTime(back.depart), inArrive: back && fmtTime(back.arrive),
    metaPrice: r.metaPrice ?? "", voucherCode: r.voucherCode, voucherDiscount: r.voucherDiscount || "",
    metaBasePrice: r.metaBasePrice ?? "", metaOutPrice: r.metaLegPrices[0] ?? "", metaInPrice: r.metaLegPrices[1] ?? "",
    webClosestPrice: r.webClosestPrice ?? "", webPrices: joinPrices(r.webPrices),
    webOutPrices: joinPrices(r.webLegPrices[0]), webInPrices: joinPrices(r.webLegPrices[1]),
    diff: r.diff ?? "", diffLegs: r.diffLegs,
    metaServiceFee: r.metaServiceFee ?? "", webServiceFee: r.webServiceFee ?? "", metaFinal: r.metaFinal ?? "", webFinal: r.webFinal ?? "",
    webSource: r.webSource, metaDuplicates: r.metaDuplicates || "", note: r.note,
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const DETAIL_LABELS: DetailViewLabels = { metaPrice: "Giá vé META (+ voucher)", webPrice: "Giá vé WEB", fee: "Phí (công thức)", final: "Giá so sánh" };

/** "120 hành trình · 26 chặng đi · 28 chặng về" — phân loại kết quả web (chặng lẻ chỉ có ở khứ hồi bán tách chiều). */
const webBreakdown = (w: CompareResult["webResults"]) =>
  [`${w.combos} hành trình`, w.outLegs && `${w.outLegs} chặng đi`, w.inLegs && `${w.inLegs} chặng về`].filter(Boolean).join(" · ");

/** Màu kết luận: KHỚP xanh; KHỚP kèm "lệch giá dưới 1k" vàng (do làm tròn); còn lại đỏ. */
const verdictClass = (verdict: string) => (verdict.startsWith("KHỚP") ? (verdict.includes("dưới 1k") ? "warn" : "ok") : "diff");

export function writeHtmlReport(filePath: string, conditions: ConditionReport[], startedAt: Date) {
  const summaryRows = conditions
    .map((c) => {
      const r = c.result;
      return `<tr>
        <td><a href="#${esc(c.id)}">${esc(c.id)}</a></td>
        <td>${esc(c.description)}</td>
        <td class="mono">${esc(c.route)}</td>
        <td class="mono">${esc(c.dates)}</td>
        <td>${esc(c.pax)}</td>
        <td class="num">${r.metaOffers}</td>
        <td class="num">${r.webResults.items}<div class="muted">${esc(webBreakdown(r.webResults))}</div></td>
        <td class="num">${r.matched}</td>
        <td class="num ${r.priceDiffs ? "bad" : ""}">${r.priceDiffs}</td>
        <td class="num ${r.smallPriceDiffs ? "warn-t" : ""}">${r.smallPriceDiffs}</td>
        <td class="num ${r.feeDiffs ? "bad" : ""}">${r.feeDiffs}</td>
        <td class="num">${r.withVoucher}</td>
        <td class="num ${r.metaOnly ? "bad" : ""}">${r.metaOnly}</td>
        <td class="num ${r.webOnly ? "bad" : ""}">${r.webOnly}</td>
        <td><span class="tag ${verdictClass(c.verdict)}" style="white-space: normal">${esc(c.verdict)}</span></td>
      </tr>`;
    })
    .join("");

  const sections = conditions
    .map((c) => {
      return `<section id="${esc(c.id)}">
        <h2>${esc(c.id)} · ${esc(c.route)} · ${esc(c.dates)} · ${esc(c.pax)}</h2>
        <p class="muted">${esc(c.description)} — <a href="${esc(c.webUrl)}" target="_blank">mở trang web</a>
          ${c.metaToolHref ? `· <a href="${esc(c.metaToolHref)}" target="_blank">mở trang metaSearch</a>` : ""}
          · <a href="${esc(c.metaSnapshotHref)}" target="_blank">bảng kết quả meta</a></p>
        <ul class="meta-list">
          <li>Web: ${esc(c.webStatus)}</li>
          <li>Meta: ${esc(c.metaStatus)}</li>
          <li>Deeplink meta: ${esc(c.deeplink)}</li>
          ${c.result.warnings.map((w) => `<li class="warn">⚠ ${esc(w)}</li>`).join("")}
        </ul>
        <h3>Chi tiết từng hành trình (${c.result.rows.length})</h3>
        ${detailView(c.id, c.result.rows, DETAIL_LABELS)}
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Metasearch vs Web v2</title>
<style>
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f6f7f9; color: #1f2328; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 0 0 4px; } h3 { font-size: 14px; margin: 16px 0 8px; }
  section { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 16px; margin-top: 20px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  th { background: #f0f2f5; font-weight: 600; white-space: nowrap; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: nowrap; }
  .muted { color: #6b7280; font-size: 12px; }
  .bad { color: #b42318; font-weight: 700; }
  .up { color: #b42318; } .down { color: #1a7f37; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .tag.ok { background: #dcfce7; color: #166534; } .tag.diff { background: #fee2e2; color: #991b1b; }
  .tag.meta { background: #fef3c7; color: #92400e; } .tag.web { background: #dbeafe; color: #1e40af; }
  .tag.warn { background: #fef9c3; color: #854d0e; } .warn-t { color: #a16207; font-weight: 700; }
  .meta-list { margin: 8px 0; padding-left: 18px; font-size: 13px; }
  .meta-list .warn { color: #92400e; }
  details { margin-top: 12px; } summary { cursor: pointer; color: #2563eb; }
  ${detailViewCss}
</style></head><body>
  <h1>So sánh kết quả search: Metasearch đối tác vs Web gốc — v2</h1>

  <p class="muted">Chạy lúc ${esc(startedAt.toLocaleString("vi-VN"))}. Lấy META làm chuẩn: mỗi hành trình meta được tìm ở web theo system + số hiệu từng chặng + giờ đi/đáp,
  ưu tiên combo có sẵn rồi tới ghép 2 chặng lẻ. "Chỉ có ở web" với hãng bán chặng lẻ được tính theo từng chặng.</p>
  <p class="muted"><b>Công thức v2</b> — Giá so sánh = <b>giá vé</b> + (phí ADULT × số NL + phí CHILD × số TE) × (2 nếu khứ hồi); em bé không tính phí.
  Giá vé: hệ <b>GALILEO</b> = <code>totalAmount</code>; system khác (VN, VJ, VU, 9G…) = <b>theo số khách</b>, cộng từng chiều
  (NL × totalAdt + TE × totalChd + EB × totalInf). Phí lấy từ <code>fees</code> (meta: flights[0].fees, web: fareData.fees).
  Meta đã trừ voucher AUTO_APPLY nên cộng lại voucher trước khi so. Khớp = cùng giá vé (1 trong các hạng vé web) và cùng phí.
  ⚠ cảnh báo: totalAmount ≠ tổng theo số khách, hoặc serviceFeeAmount meta ≠ phí theo công thức.</p>
  <section>
    <h2>Tổng quan</h2>
    <div class="scroll"><table>
      <thead><tr><th>#</th><th>Điều kiện</th><th>Route</th><th>Ngày</th><th>Khách</th><th>Hành trình meta</th><th>Kết quả web</th><th>Khớp</th><th>Lệch giá</th><th>Lệch giá dưới 1k</th><th>Lệch phí</th><th>Có voucher meta</th><th>Chỉ có ở meta</th><th>Chỉ có ở web</th><th>Kết luận</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table></div>
  </section>
  ${sections}
  ${detailViewScript}
</body></html>`;
  fs.writeFileSync(filePath, html, "utf-8");
}

type MetaSnapshotItem = FareItem & {
  estimatedVoucherCode?: string | null;
  estimatedVoucherDiscount?: number | null;
  serviceFeeAmount?: number | null;
  deeplinks?: string;
  dayViewDeeplinks?: string;
};

/**
 * Trang xem lại danh sách meta trả về (đúng response đã dùng để so sánh) — trang tool metasearch
 * không nhận điều kiện qua URL nên không deep-link được; trang này thay cho "mở trang meta".
 */
export function writeMetaSnapshotHtml(
  filePath: string,
  info: { id: string; route: string; dates: string; pax: string; metaStatus: string; requestBody: unknown },
  items: MetaSnapshotItem[]
) {
  const sorted = [...items].sort((a, b) => (a.totalAmount ?? 0) - (b.totalAmount ?? 0));
  const rows = sorted
    .map((item, i) => {
      const legs = [...(item.flights ?? [])].sort((a, b) => a.leg - b.leg);
      const legCell = (leg?: FareLeg) =>
        leg
          ? `<b>${esc(leg.segments.map((s) => s.flightNumber).join("-"))}</b> ${esc([leg.segments[0]?.startPoint, ...leg.segments.map((s) => s.endPoint)].join("-"))}` +
            `<div class="muted">${esc(fmtTime(leg.segments[0]?.startTime ?? ""))} → ${esc(fmtTime(leg.segments[leg.segments.length - 1]?.endTime ?? ""))}</div>` +
            `<div class="muted">${esc(leg.inventories?.[0]?.cabinClass ?? "")} · ${fmtPrice(leg.inventories?.[0]?.totalAmount)}</div>`
          : "";
      const voucher = item.estimatedVoucherDiscount
        ? `${esc(item.estimatedVoucherCode)} −${fmtPrice(item.estimatedVoucherDiscount)}`
        : "";
      const fee = item.serviceFeeAmount ?? 0;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(item.system)}</td>
        <td>${esc(item.airline)}</td>
        <td class="mono">${legCell(legs[0])}</td>
        <td class="mono">${legCell(legs[1])}</td>
        <td class="num"><b>${fmtPrice(item.totalAmount)}</b></td>
        <td class="num">${voucher}</td>
        <td class="num">${fmtPrice(fee)}</td>
        <td class="num"><b>${fmtPrice((item.totalAmount ?? 0) + fee)}</b></td>
        <td>${item.deeplinks ? `<a href="${esc(item.deeplinks)}" target="_blank">đặt vé</a>` : ""}${item.dayViewDeeplinks ? ` · <a href="${esc(item.dayViewDeeplinks)}" target="_blank">day view</a>` : ""}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meta ${esc(info.id)} ${esc(info.route)}</title>
<style>
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f6f7f9; color: #1f2328; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 12px; }
  .wrap { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; overflow-x: auto; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  th { background: #f0f2f5; font-weight: 600; white-space: nowrap; position: sticky; top: 0; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: nowrap; }
  input[type=search] { font: inherit; padding: 6px 10px; border: 1px solid #d0d4da; border-radius: 8px; min-width: 300px; margin-top: 12px; }
  details { margin-top: 8px; } pre { background: #fff; border: 1px solid #e3e5e8; padding: 8px; border-radius: 6px; overflow-x: auto; }
  a { color: #2563eb; }
</style></head><body>
  <h1>Kết quả META · ${esc(info.id)} · ${esc(info.route)} · ${esc(info.dates)} · ${esc(info.pax)}</h1>
  <p class="muted">${esc(info.metaStatus)} · ${items.length} offer · sắp xếp theo giá API trả (đã trừ voucher, chưa gồm phí hệ thống) ·
  "Giá cuối" = giá + phí hệ thống. Đây là bản lưu lúc chạy, không phải dữ liệu live.</p>
  <details><summary>Body request đã gửi</summary><pre>${esc(JSON.stringify(info.requestBody, null, 2))}</pre></details>
  <input type="search" id="q" placeholder="Lọc: số hiệu, system, hạng vé… (VD: VN1201, GALILEO, Business)">
  <span id="count" class="muted"></span>
  <div class="wrap"><table>
    <thead><tr><th>#</th><th>System</th><th>Hãng</th><th>Chiều đi (số hiệu, giờ, hạng · giá chiều)</th><th>Chiều về</th><th>Giá API</th><th>Voucher</th><th>Phí hệ thống</th><th>Giá cuối</th><th>Deeplink</th></tr></thead>
    <tbody id="rows">${rows || '<tr><td colspan="10" class="muted">Meta không trả offer nào.</td></tr>'}</tbody>
  </table></div>
<script>
  const q = document.getElementById("q"), count = document.getElementById("count");
  const rows = [...document.querySelectorAll("#rows tr")];
  function apply() {
    const terms = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown = 0;
    for (const tr of rows) {
      const visible = terms.every((t) => tr.textContent.toLowerCase().includes(t));
      tr.style.display = visible ? "" : "none";
      if (visible) shown++;
    }
    count.textContent = " " + shown + " / " + rows.length + " offer";
  }
  q.addEventListener("input", apply); apply();
</script>
</body></html>`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, "utf-8");
}

/**
 * Bản sao TRANG METASEARCH (giao diện + app.js thật của trang tool) hiển thị kết quả meta đã lưu
 * của 1 điều kiện — để từ report bấm 1 link là xem được kết quả trong trang metaSearch.
 *
 * Trang tool không nhận điều kiện qua URL nên không deep-link trang live được. Bản sao này:
 * - lấy HTML trang tool lúc chạy, `<base>` trỏ về server để app.js/CSS tải từ server thật;
 * - chặn `fetch` của trang: đăng nhập → token giả, danh sách sân bay → 2 sân bay của điều kiện,
 *   `/v1/flights/metasearch` → response ĐÃ LƯU (không gọi mạng tới API);
 * - tự điền điều kiện + bấm Search như người dùng → kết quả, bộ lọc, thống kê hiện như trang thật.
 */
export function writeMetaToolSnapshot(
  filePath: string,
  toolHtml: string,
  opts: {
    apiBaseUrl: string;
    request: unknown;
    status: number;
    data: unknown;
    airports: { code: string; isDomestic: boolean }[];
    label: string;
    savedAt: string;
  }
) {
  // JSON nhúng vào <script>: thoát "<" để chuỗi "</script>" trong dữ liệu không đóng thẻ.
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\u003c");
  const toolBase = `${opts.apiBaseUrl}/static/tools/metasearch/`;

  const mockScript = `<script>
(() => {
  const SNAP = ${json({ request: opts.request, status: opts.status, data: opts.data, airports: opts.airports })};
  // Các file bản sao (file://) dùng chung localStorage: cache sân bay/cấu hình của bản sao trước
  // sẽ ghi đè form → xoá trước khi app.js khởi động.
  try { localStorage.clear(); } catch {}
  const realFetch = window.fetch.bind(window);
  const reply = (body, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  window.fetch = (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes("/auth/login")) return reply({ accessToken: "snapshot-offline" });
    if (url.includes("/flights/airports"))
      return reply(SNAP.airports.map((a) => ({ code: a.code, cityVi: a.code, cityEn: a.code, nameVi: a.code, nameEn: a.code, country: "", isDomestic: a.isDomestic ? "1" : "0" })));
    if (url.includes("/v1/flights/metasearch")) return reply(SNAP.data, SNAP.status || 200);
    return realFetch(input, init);
  };
  window.__META_SNAPSHOT__ = SNAP;
})();
</script>`;

  const autoRunScript = `<script>
(() => {
  const SNAP = window.__META_SNAPSHOT__;
  const req = SNAP.request;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timeout"); await sleep(100); } };
  const setAirport = async (field, code) => {
    const input = $(field + "-input");
    input.value = code;
    input.dispatchEvent(new FocusEvent("blur"));
    await sleep(250);
  };
  const setPax = (type, target) => {
    const row = document.querySelector('[data-pax="' + type + '"]');
    for (let i = 0; i < 10; i++) {
      const current = Number(row.querySelector("[data-value]").textContent || 0);
      if (current === target) return;
      row.querySelector('[data-step="' + (current < target ? 1 : -1) + '"]').click();
    }
  };
  window.addEventListener("load", async () => {
    try {
      $("client-id").value = "snapshot"; $("username").value = "snapshot"; $("password").value = "snapshot";
      $("btn-login").click();
      await until(() => /[0-9]+ loaded/.test($("airport-status").textContent));
      await sleep(300);
      document.querySelector('[data-itinerary="' + req.itinerary + '"]').click();
      await setAirport("from", req.flights[0].startPoint);
      await setAirport("to", req.flights[0].endPoint);
      $("date-input")._flatpickr.setDate(req.flights.map((f) => f.departDate), true);
      setPax("adt", req.adt); setPax("chd", req.chd); setPax("inf", req.inf);
      $("currency").value = req.currency; $("language").value = req.language; $("view-mode").value = req.viewMode;
      $("btn-search").click();
    } catch (e) {
      console.error("Snapshot auto-run lỗi", e);
    }
  });
})();
</script>`;

  const banner = `<div style="position:sticky;top:0;z-index:60;background:#fef3c7;color:#92400e;border-bottom:1px solid #fcd34d;padding:6px 16px;font:600 12px system-ui,sans-serif">
  BẢN LƯU · ${esc(opts.label)} · kết quả META lúc chạy ${esc(opts.savedAt)} (không phải search live — muốn search lại thì mở
  <a href="${esc(toolBase)}" target="_blank" style="color:#1d4ed8">trang tool thật</a>)</div>`;

  let html = toolHtml.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${esc(toolBase)}">\n${mockScript}`);
  html = html.replace(/<body([^>]*)>/i, `<body$1>\n${banner}`);
  // Chạy sau app.js (app.js gắn handler khi load).
  html = html.replace(/<\/body>/i, `${autoRunScript}\n</body>`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, "utf-8");
}
