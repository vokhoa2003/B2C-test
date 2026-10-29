import fs from "fs";
import path from "path";
import { CompareResult, DetailRow, FareItem, FareLeg, NEAR_DEPARTURE_HOURS, cabinLabel } from "./metasearchCompareV2";
import { CapturedSearch } from "../pages/flight/FlightSearchApiCapture";
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
  /** Lúc gửi search (giờ VN) — mốc tính "cất cánh trong 24h". */
  searchedAt?: string;
  /** Thời gian phản hồi (ms) của 2 bên; webSystemMs = từng system web, VD "VN 3.2s; VJ 1.1s". */
  webMs?: number;
  metaMs?: number;
  webSystemMs?: string;
  /** Lần search đầu có lệch giá nên đã tự search lại; kết quả trên là của lần 2. */
  firstRun?: FirstRunInfo;
  /** JSON từng hành trình lệch đã lưu (writeDiffJsons): lần cuối, và lần search đầu nếu đã search lại. */
  diffJson?: { count: number; dir: string; firstRun?: { count: number; dir: string } };
  /** Lệnh yarn chạy lại đúng điều kiện này — hiện ngay trên bảng chi tiết để copy. */
  rerunCommand?: string;
  result: CompareResult;
};

/**
 * Lệch giá ở lần search đầu (đã search lại): thường do meta và web gọi vendor (GALILEO_NDC) 2 phiên riêng cùng lúc,
 * vendor trả giá/offer khác nhau; lần 2 vendor trả từ cache nên 2 bên giống nhau.
 */
export type FirstRunInfo = {
  priceDiffs: number;
  /** "GALILEO_NDC 16, VN 2" */
  systems: string;
  /** Số dòng lệch ở lần đầu mà search lại không còn lệch. */
  cleared: number;
  webMs: number;
  metaMs: number;
};

/** Trạng thái được lưu JSON riêng từng hành trình. */
const SAVE_JSON_STATUSES = new Set(["LỆCH GIÁ", "LỆCH PHÍ"]);

/** "_9G" → "9G" (web gửi airline có "_" đầu, báo cáo bỏ). */
const sysName = (s: string) => s.replace(/^_+/, "");

/**
 * Lưu mỗi hành trình lệch giá / lệch phí thành 1 file `diffs/<folder>/<NNN>-<system>-<số hiệu>.json`: điều kiện,
 * body request, kết quả so (giá 2 bên, chênh, hạng ghế, cách tính) và NGUYÊN item API 2 bên (meta: offer; web: các
 * item combo / chặng lẻ đã dùng để so). Kèm theo, response web ĐẦY ĐỦ của từng system liên quan được lưu 1 lần mỗi
 * system (`web-response-<SYSTEM>.json`: request, status, thời gian, toàn bộ response) và file hành trình trỏ tới
 * qua `webResponseFiles`. Gắn `jsonHref` cho dòng để báo cáo có link mở file.
 * @returns số file hành trình đã lưu và thư mục (tương đối từ report.html).
 */
export function writeDiffJsons(
  runDir: string,
  folder: string,
  context: { condition: unknown; request: unknown; attempt?: string },
  result: CompareResult,
  webSearches: CapturedSearch[] = []
): { count: number; dir: string } {
  const rows = result.rows.filter((r) => SAVE_JSON_STATUSES.has(r.status));
  const dir = `diffs/${folder}`;
  if (!rows.length) return { count: 0, dir };
  fs.mkdirSync(path.join(runDir, dir), { recursive: true });

  // Response web đầy đủ theo system (chỉ system có hành trình lệch), mỗi system 1 file. Ghi gọn không thụt dòng
  // (GALILEO_NDC ~10 MB; thụt dòng lên ~30 MB) — mở bằng editor rồi Format Document để đọc.
  const responseFiles = new Map<string, string>();
  const systemOf = (s: CapturedSearch) => sysName(String((s.requestBody?.flights as { airline?: string }[] | undefined)?.[0]?.airline ?? "?"));
  const wanted = new Set(rows.flatMap((r) => r.system.split(" + ").map(sysName)));
  for (const s of webSearches) {
    const system = systemOf(s);
    if (!wanted.has(system) || responseFiles.has(system)) continue;
    const name = `web-response-${system.replace(/[^A-Za-z0-9]/g, "")}.json`;
    fs.writeFileSync(
      path.join(runDir, dir, name),
      JSON.stringify({ system, request: s.requestBody, status: s.status, ms: s.ms, bodyError: s.bodyError, response: { ...s.responseExtra, fareData: s.fareData } })
    );
    responseFiles.set(system, name);
  }

  rows.forEach((r, i) => {
    const flights = r.legs.map((l) => l.flightNumbers).join("+").replace(/[^A-Za-z0-9+-]/g, "");
    const name = `${String(i + 1).padStart(3, "0")}-${r.system.replace(/[^A-Za-z0-9]/g, "")}-${flights}.json`.slice(0, 120);
    const { raw, breakdown, jsonHref: _oldHref, ...comparison } = r;
    const data = {
      ...context,
      // Response web đầy đủ của system tương ứng (cùng thư mục) để đối chiếu.
      webResponseFiles: r.system.split(" + ").map(sysName).map((sy) => responseFiles.get(sy)).filter(Boolean),
      comparison: { ...comparison, breakdown },
      metaItem: raw?.meta ?? null,
      webItems: raw?.web ?? [],
    };
    fs.writeFileSync(path.join(runDir, dir, name), JSON.stringify(data, null, 1));
    r.jsonHref = `${dir}/${name}`;
  });
  return { count: rows.length, dir };
}

export const DETAIL_COLUMNS = [
  "id", "route", "status", "side", "system", "airline",
  "outFlight", "outRoute", "outDepart", "outArrive",
  "inFlight", "inRoute", "inDepart", "inArrive",
  "metaPrice", "voucherCode", "voucherDiscount", "metaBasePrice", "metaOutPrice", "metaInPrice",
  "webClosestPrice", "webPrices", "webOutPrices", "webInPrices",
  "diff", "diffLegs",
  "metaServiceFee", "webServiceFee", "metaFinal", "webFinal",
  "webSource", "metaDuplicates", "note", "hoursToDepart", "within24h", "metaClass", "webClass", "jsonFile",
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
    hoursToDepart: r.hoursToDepart ?? "",
    metaClass: r.metaClass,
    jsonFile: r.jsonHref ?? "",
    webClass: r.webClosestPrice !== null ? r.webClasses[String(r.webClosestPrice)] ?? "" : "",
    within24h: r.hoursToDepart == null ? "" : r.hoursToDepart < 0 ? "đã qua giờ bay" : r.hoursToDepart < NEAR_DEPARTURE_HOURS ? "trong 24h" : "",
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const DETAIL_LABELS: DetailViewLabels = { metaPrice: "Giá META (gồm phí, + voucher)", webPrice: "Giá WEB (vé + phí)", fee: "Phí (META: đã gồm trong giá)", final: "Giá so sánh" };

/** "120 hành trình · 26 chặng đi · 28 chặng về" — phân loại kết quả web (chặng lẻ chỉ có ở khứ hồi bán tách chiều). */
const webBreakdown = (w: CompareResult["webResults"]) =>
  [`${w.combos} hành trình`, w.outLegs && `${w.outLegs} chặng đi`, w.inLegs && `${w.inLegs} chặng về`].filter(Boolean).join(" · ");

/** Màu kết luận: KHỚP xanh; KHỚP kèm "lệch giá dưới 1k" vàng (do làm tròn); còn lại đỏ. */
/** "12 chuyến (3 lệch/thiếu, 1 đã qua giờ bay)" — hành trình cất cánh trong 24h kể từ lúc search. */
export function nearDepartureText(n: CompareResult["nearDeparture"]): string {
  if (!n?.total) return "";
  const extra = [n.problems && `${n.problems} lệch/thiếu`, n.departed && `${n.departed} đã qua giờ bay`].filter(Boolean).join(", ");
  return `${n.total} chuyến${extra ? ` (${extra})` : ""}`;
}

/**
 * Màu kết luận: chỉ LỆCH GIÁ lớn / LỆCH PHÍ (hoặc không so được) là lỗi đỏ; lệch < 1k (làm tròn) và
 * chuyến chỉ 1 bên có là cảnh báo vàng; còn lại xanh.
 */
function verdictClass(c: ConditionReport): "ok" | "warn" | "diff" {
  const r = c.result;
  if (c.verdict.startsWith("KHÔNG SO ĐƯỢC") || r.priceDiffs + r.feeDiffs) return "diff";
  return r.smallPriceDiffs + r.metaOnly + r.webOnly + (c.firstRun?.priceDiffs ?? 0) ? "warn" : "ok";
}

const secs = (ms?: number) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}s`);

export function writeHtmlReport(filePath: string, conditions: ConditionReport[], startedAt: Date) {
  const summaryRows = conditions
    .map((c) => {
      const r = c.result;
      return `<tr>
        <td><a href="#${esc(c.id)}">${esc(c.id)}</a></td>
        <td class="desc">${esc(c.description)}</td>
        <td class="mono">${esc(c.route)}</td>
        <td class="mono">${esc(c.dates)}</td>
        <td>${esc(c.pax)}</td>
        <td class="num">${r.metaOffers}</td>
        <td class="num">${r.webResults.items}<div class="muted">${esc(webBreakdown(r.webResults))}</div></td>
        <td class="num">${r.matched}</td>
        <td class="num ${r.priceDiffs ? "bad" : ""}">${r.priceDiffs}${c.firstRun ? `<div class="warn-t" style="font-size:11px" title="Lần search đầu lệch, đã tự search lại">lần đầu ${c.firstRun.priceDiffs}</div>` : ""}</td>
        <td class="num ${r.smallPriceDiffs ? "warn-t" : ""}">${r.smallPriceDiffs}</td>
        <td class="num ${r.feeDiffs ? "bad" : ""}">${r.feeDiffs}</td>
        <td class="num">${r.withVoucher}</td>
        <td class="num ${r.metaOnly ? "warn-t" : ""}">${r.metaOnly}</td>
        <td class="num ${r.webOnly ? "warn-t" : ""}">${r.webOnly}</td>
        <td class="nowrap">META ${secs(c.metaMs)}<br>WEB ${secs(c.webMs)}${c.webSystemMs ? `<div class="muted">${esc(c.webSystemMs)}</div>` : ""}</td>
        <td class="num ${r.nearDeparture?.problems ? "warn-t" : ""}">${r.nearDeparture?.total || ""}${r.nearDeparture?.problems ? `<div class="muted">${r.nearDeparture.problems} lệch/thiếu</div>` : ""}</td>
        <td><span class="tag ${verdictClass(c)}" style="white-space: normal">${esc(c.verdict)}</span></td>
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
          ${c.diffJson?.count || c.diffJson?.firstRun?.count ? `<li>JSON từng hành trình lệch (nguyên dữ liệu API 2 bên): ${c.diffJson.count ? `<a href="${esc(c.diffJson.dir)}/" target="_blank">${esc(c.diffJson.dir)}/</a> (${c.diffJson.count} file)` : ""}${c.diffJson.firstRun?.count ? `${c.diffJson.count ? " · " : ""}lần search đầu: <a href="${esc(c.diffJson.firstRun.dir)}/" target="_blank">${esc(c.diffJson.firstRun.dir)}/</a> (${c.diffJson.firstRun.count} file)` : ""} — kèm response web đầy đủ theo system (<code>web-response-&lt;SYSTEM&gt;.json</code>); hoặc mở 1 dòng lệch, bấm "JSON"</li>` : ""}
          ${c.firstRun ? `<li class="warn">⚠ Lần search đầu lệch giá ${c.firstRun.priceDiffs} hành trình (${esc(c.firstRun.systems)}; meta ${secs(c.firstRun.metaMs)}, web ${secs(c.firstRun.webMs)}) → đã tự search lại: hết lệch ${c.firstRun.cleared}, còn ${c.result.priceDiffs}. Thường do meta và web gọi vendor 2 phiên riêng cùng lúc nên vendor trả giá khác nhau; bảng dưới là kết quả lần search lại (dữ liệu lần đầu: <code>raw/${esc(c.id)}-*-1.json</code>).</li>` : ""}
          ${c.result.nearDeparture?.total ? `<li class="near-li">Cất cánh trong 24h kể từ lúc search${c.searchedAt ? ` (${esc(c.searchedAt)})` : ""}: ${esc(nearDepartureText(c.result.nearDeparture))} — nhãn tím <b>≤24h</b> trong bảng, lọc bằng ô "Chỉ chuyến bay trong 24h"</li>` : ""}
          ${c.result.warnings.map((w) => `<li class="warn">⚠ ${esc(w)}</li>`).join("")}
        </ul>
        ${c.rerunCommand ? `<pre class="rerun">${esc(c.rerunCommand)}</pre>` : ""}
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
  .nowrap { white-space: nowrap; }
  td.desc { min-width: 280px; }
  .bad { color: #b42318; font-weight: 700; }
  .up { color: #b42318; } .down { color: #1a7f37; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .tag.ok { background: #dcfce7; color: #166534; } .tag.diff { background: #fee2e2; color: #991b1b; }
  .tag.meta { background: #fef3c7; color: #92400e; } .tag.web { background: #dbeafe; color: #1e40af; }
  .tag.warn { background: #fef9c3; color: #854d0e; } .warn-t { color: #a16207; font-weight: 700; }
  .meta-list { margin: 8px 0; padding-left: 18px; font-size: 13px; }
  .meta-list .warn { color: #92400e; }
  pre.rerun { margin: 12px 0 0; padding: 6px 10px; background: #f6f8fa; border: 1px solid #eceef1; border-radius: 6px; font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-all; } .meta-list .near-li { color: #5b21b6; }
  details { margin-top: 12px; } summary { cursor: pointer; color: #2563eb; }
  ${detailViewCss}
</style></head><body>
  <h1>So sánh kết quả search: Metasearch đối tác vs Web gốc — v2</h1>

  <p class="muted">Chạy lúc ${esc(startedAt.toLocaleString("vi-VN"))}. Lấy META làm chuẩn: mỗi hành trình meta được tìm ở web theo system + số hiệu từng chặng + giờ đi/đáp,
  ưu tiên combo có sẵn rồi tới ghép 2 chặng lẻ. "Chỉ có ở web" với hãng bán chặng lẻ được tính theo từng chặng.</p>
  <p class="muted"><b>Công thức v2</b> (theo traveleasy-cms từ 28/10) — <b>META</b>: <code>totalAmount</code> đã gồm phí markup và đã trừ voucher AUTO_APPLY
  → giá so sánh = totalAmount + voucher, <b>không cộng phí nữa</b>. <b>WEB</b>: giá vé từng hạng + (phí ADULT × số NL + phí CHILD × số TE) của từng chiều
  (combo khứ hồi: phí × 2). Giá vé web: hệ <b>GALILEO</b> = <code>totalAmount</code>; system khác = NL × totalAdt + TE × totalChd + EB × totalInf.
  <b>Em bé</b>: không cộng phí, không trừ voucher → giá em bé 2 bên phải bằng nhau. Mỗi giá kèm <b>hạng ghế</b> (cabinClass · fareType).
  Khớp = giá so sánh meta bằng 1 trong các hạng vé web; giá vé bằng nhau mà giá so sánh khác → lệch phí.</p>
  <section>
    <h2>Tổng quan</h2>
    <div class="scroll"><table>
      <thead><tr><th>#</th><th>Điều kiện</th><th>Route</th><th>Ngày</th><th>Khách</th><th>Hành trình meta</th><th>Kết quả web</th><th>Khớp</th><th>Lệch giá</th><th>Lệch giá dưới 1k</th><th>Lệch phí</th><th>Có voucher meta</th><th>Chỉ có ở meta</th><th>Chỉ có ở web</th><th title="Thời gian phản hồi của 2 bên (web: từng system gọi song song)">Phản hồi</th><th title="Hành trình cất cánh trong 24h kể từ lúc search">Bay trong 24h</th><th>Kết luận</th></tr></thead>
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
            `<div class="muted">${esc(cabinLabel(leg.inventories?.[0]))} · ${fmtPrice(leg.inventories?.[0]?.totalAmount)}</div>`
          : "";
      const voucher = item.estimatedVoucherDiscount
        ? `${esc(item.estimatedVoucherCode)} −${fmtPrice(item.estimatedVoucherDiscount)}`
        : "";
      const fee = item.serviceFeeAmount ?? 0;
      // Giá cuối khách trả = total_amount của deeplink (từ 28/10 = totalAmount, đã gồm phí; response cũ = totalAmount + phí).
      let final = (item.totalAmount ?? 0) + fee;
      try {
        const t = item.deeplinks ? new URL(item.deeplinks).searchParams.get("total_amount") : null;
        if (t && !isNaN(Number(t))) final = Number(t);
      } catch {
        // deeplink hỏng: giữ cách tính cũ
      }
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(item.system)}</td>
        <td>${esc(item.airline)}</td>
        <td class="mono">${legCell(legs[0])}</td>
        <td class="mono">${legCell(legs[1])}</td>
        <td class="num"><b>${fmtPrice(item.totalAmount)}</b></td>
        <td class="num">${voucher}</td>
        <td class="num">${fmtPrice(fee)}</td>
        <td class="num"><b>${fmtPrice(final)}</b></td>
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
  <p class="muted">${esc(info.metaStatus)} · ${items.length} offer · sắp xếp theo giá API trả (đã trừ voucher; từ 28/10 đã gồm phí hệ thống — cột phí chỉ để tham khảo) ·
  "Giá cuối" = <code>total_amount</code> của deeplink (giá khách trả). Đây là bản lưu lúc chạy, không phải dữ liệu live.</p>
  <details><summary>Body request đã gửi</summary><pre>${esc(JSON.stringify(info.requestBody, null, 2))}</pre></details>
  <input type="search" id="q" placeholder="Lọc: số hiệu, system, hạng vé… (VD: VN1201, GALILEO, Business)">
  <span id="count" class="muted"></span>
  <div class="wrap"><table>
    <thead><tr><th>#</th><th>System</th><th>Hãng</th><th>Chiều đi (số hiệu, giờ, hạng · giá chiều)</th><th>Chiều về</th><th>Giá API</th><th>Voucher</th><th>Phí hệ thống (tham khảo)</th><th>Giá cuối</th><th>Deeplink</th></tr></thead>
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
