import fs from "fs";
import path from "path";
import { CardResult, CompareSummary } from "./compareCards";
import { ExpectedCard, SkipInfo } from "./expectedCards";

export type CaseReport = {
  id: string;
  description: string;
  url: string;
  fixture?: string;
  searchedAt: string;
  ms: number;
  error: string;
  systems: { system: string; status: number; ms: number; fareCount: number; error?: string }[];
  summary?: CompareSummary;
  skipped?: SkipInfo;
  rows?: CardResult[];
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function caseState(c: CaseReport): "fail" | "diff" | "warn" | "ok" {
  if (c.error || !c.summary) return "fail";
  if (c.summary.mismatched || c.summary.notInApi) return "diff";
  if (c.summary.missingOnUi.length || !c.summary.loadedAll) return "warn";
  return "ok";
}
const STATE_LABEL = { fail: "LỖI CHẠY", diff: "LỆCH", warn: "CẢNH BÁO", ok: "KHỚP" };

type TzInfo = { offset: string | null; gmt: string | null };
type LegLike = { flightCodes: string; from: string; to: string; depTime: string; arrTime: string; nextDay: number; depTz?: TzInfo; arrTz?: TzInfo };

/**
 * Hiển thị giống card web B2C: "20:10 HAN → 06:10⁺¹ᵈ NRT" (giờ địa phương từng sân bay), dòng dưới
 * ghi múi giờ + giờ GMT để không phải đoán 06:10 là giờ HAN hay NRT. Có card API thì lấy múi giờ từ
 * giờ API (có ngày để quy đổi); không biết múi giờ → "chưa rõ GMT".
 */
function legsText(legs: LegLike[]) {
  const gmt = (code: string, tz?: TzInfo) => (tz?.gmt ? `${code} ${tz.offset} → ${tz.gmt} GMT` : `${code} chưa rõ GMT`);
  return legs
    .map((l) =>
      `${esc(l.flightCodes)}<br>` +
      `<span class="tl"><b>${esc(l.depTime)}</b> ${esc(l.from)} → <b>${esc(l.arrTime)}</b>${l.nextDay ? `<sup>+${l.nextDay}d</sup>` : ""} ${esc(l.to)}</span><br>` +
      `<span class="tm muted">${esc(gmt(l.from, l.depTz))} · ${esc(gmt(l.to, l.arrTz))}</span>`
    )
    .join("<br>");
}

function priceBreakdown(e: ExpectedCard) {
  const p = e.price;
  const pax = Math.max(p.adt + p.chd + p.inf, 1);
  return (
    `<div class="bd">${esc(e.system)} · ${esc(e.cabinClass)} · ${p.adt} NL ${p.chd} TE ${p.inf} EB<br>` +
    `vé ${fmt(p.fare)} + thuế ${fmt(p.tax)} + phí hãng ${fmt(p.airlineFee)} + phí hệ thống ${fmt(p.systemFee)}` +
    `${p.discount ? ` − giảm ${fmt(p.discount)}` : ""} = ${fmt(p.total - p.discount)} ÷ ${pax} = <b>${fmt(p.perPax)}</b>` +
    `${p.apiTotalMismatch ? `<br><span class="warn-t">totalAmount API ${fmt(p.apiTotalAmount)} ≠ vé + thuế + phí hãng (cả tính theo số khách lẫn 1 khách mỗi loại)</span>` : ""}</div>`
  );
}

function rowHtml(r: CardResult, base: string) {
  const issues = r.issues.map((i) => `<div><b>${esc(i.field)}</b>: UI <code>${esc(i.ui)}</code> · API <code>${esc(i.api)}</code></div>`).join("");
  const shot = r.screenshot ? `<a href="${esc(path.relative(base, r.screenshot).replace(/\\/g, "/"))}" target="_blank">ảnh card</a>` : "";
  return (
    `<tr class="${r.status === "KHỚP" ? "" : "bad"}"><td>${r.ui.index + 1}</td><td>${legsText(r.expected?.legs ?? r.ui.legs)}</td>` +
    `<td class="num">${fmt(r.ui.priceMain)}${r.ui.priceStrike ? `<br><del>${fmt(r.ui.priceStrike)}</del>` : ""}${r.ui.voucherBadge ? `<br><span class="muted">badge ${fmt(r.ui.voucherBadge)}</span>` : ""}</td>` +
    `<td><span class="st st-${r.status === "KHỚP" ? "ok" : "diff"}">${esc(r.status)}</span>${issues}${r.priceNote ? `<div class="muted">${esc(r.priceNote)}</div>` : ""}${shot}</td>` +
    `<td>${r.expected ? priceBreakdown(r.expected) : '<span class="muted">không tìm thấy chuyến này trong response</span>'}</td></tr>`
  );
}

function caseHtml(c: CaseReport, base: string) {
  const state = caseState(c);
  const s = c.summary;
  const systems = c.systems
    .map((x) => `${esc(x.system)} <span class="muted">${x.status || "lỗi"} · ${secs(x.ms)} · ${x.fareCount} fare</span>${x.error ? ` <span class="bad-t">${esc(x.error)}</span>` : ""}`)
    .join(" · ");
  const problems = (c.rows ?? []).filter((r) => r.status !== "KHỚP");
  const table = (rows: CardResult[]) =>
    `<table><tr><th>#</th><th>Chuyến (UI)</th><th>Giá UI</th><th>Kết quả</th><th>Giá API (tính lại)</th></tr>${rows.map((r) => rowHtml(r, base)).join("")}</table>`;
  const skipped = Object.entries(c.skipped ?? {}).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ");
  return `<section id="${esc(c.id)}">
<h2><span class="st st-${state}">${STATE_LABEL[state]}</span> ${esc(c.id)} — ${esc(c.description)}</h2>
<ul>
<li>URL: <a href="${esc(c.url)}" target="_blank">${esc(c.url)}</a>${c.fixture ? ` · <b>fixture</b> ${esc(c.fixture)}` : ""}</li>
<li>Search lúc ${esc(c.searchedAt)} · tải xong ${secs(c.ms)}${c.error ? ` · <span class="bad-t">${esc(c.error)}</span>` : ""}</li>
<li>Response: ${systems || "—"}</li>
${s ? `<li>Card UI <b>${s.uiCards}</b> · card API <b>${s.apiCards}</b> · khớp ${s.ok} · <span class="${s.mismatched ? "bad-t" : ""}">lệch ${s.mismatched}</span> · <span class="${s.notInApi ? "bad-t" : ""}">không có trong API ${s.notInApi}</span>${s.loadedAll ? ` · <span class="${s.missingOnUi.length ? "warn-t" : ""}">API có, UI không hiện ${s.missingOnUi.length}</span>` : ' · <span class="warn-t">chưa cuộn hết danh sách</span>'}</li>` : ""}
${skipped ? `<li class="muted">Bỏ qua: ${skipped}</li>` : ""}
</ul>
${problems.length ? `<h3>Card có vấn đề (${problems.length})</h3>${table(problems)}` : ""}
${s?.missingOnUi.length ? `<details><summary>API có, UI không hiện (${s.missingOnUi.length})</summary><table><tr><th>Chuyến</th><th>Giá API</th></tr>${s.missingOnUi.map((e) => `<tr><td>${legsText(e.legs)}</td><td>${priceBreakdown(e)}</td></tr>`).join("")}</table></details>` : ""}
${c.rows?.length ? `<details><summary>Tất cả card (${c.rows.length})</summary>${table(c.rows)}</details>` : ""}
</section>`;
}

export function writeReport(runDir: string, cases: CaseReport[]) {
  const file = path.join(runDir, "report.html");
  const overview = cases
    .map((c) => {
      const s = c.summary;
      const state = caseState(c);
      return `<tr><td><a href="#${esc(c.id)}">${esc(c.id)}</a></td><td>${esc(c.description)}</td><td><span class="st st-${state}">${STATE_LABEL[state]}</span></td>` +
        `<td class="num">${s?.uiCards ?? "—"}</td><td class="num">${s?.apiCards ?? "—"}</td><td class="num">${s?.ok ?? "—"}</td>` +
        `<td class="num ${s?.mismatched ? "bad-t" : ""}">${s?.mismatched ?? "—"}</td><td class="num ${s?.notInApi ? "bad-t" : ""}">${s?.notInApi ?? "—"}</td>` +
        `<td class="num ${s?.missingOnUi.length ? "warn-t" : ""}">${s ? (s.loadedAll ? s.missingOnUi.length : "?") : "—"}</td><td class="num">${secs(c.ms)}</td></tr>`;
    })
    .join("");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FE Flight Check</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--ok:#15803d;--ok-bg:#dcfce7;--warn:#a16207;--warn-bg:#fef9c3;--bad:#b91c1c;--bad-bg:#fee2e2;--row-bad:#fff7f7}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--fg:#e6e6e6;--muted:#9aa3ad;--line:#2b3138;--ok:#4ade80;--ok-bg:#14532d;--warn:#facc15;--warn-bg:#422006;--bad:#f87171;--bad-bg:#450a0a;--row-bad:#1f1416}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1400px;padding:16px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
th{background:color-mix(in srgb,var(--line) 50%,transparent)}td.num{text-align:right;white-space:nowrap}tr.bad{background:var(--row-bad)}
.st{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}
.st-ok{background:var(--ok-bg);color:var(--ok)}.st-warn{background:var(--warn-bg);color:var(--warn)}.st-diff,.st-fail{background:var(--bad-bg);color:var(--bad)}
.tl{white-space:nowrap}.tl b{font-size:15px}.tl sup{color:var(--muted);font-size:10px}.tm{font-size:12px;white-space:nowrap}.bad-t{color:var(--bad);font-weight:600}.warn-t{color:var(--warn)}.muted{color:var(--muted)}.bd{font-size:12px}
section{border-top:2px solid var(--line);margin-top:24px}h2{font-size:18px}code{font-size:12px}a{color:#2563eb}
.wrap{overflow-x:auto}
</style></head><body>
<h1>Kiểm tra FE kết quả chuyến bay</h1>
<p class="muted">So từng card trên trang /flights/result với response <code>/flights/search/</code> mà chính trang đó nhận. Thư mục: ${esc(runDir)}</p>
<div class="wrap"><table><tr><th>Case</th><th>Mô tả</th><th>Kết quả</th><th>Card UI</th><th>Card API</th><th>Khớp</th><th>Lệch</th><th>Không có trong API</th><th>UI không hiện</th><th>Tải</th></tr>${overview}</table></div>
${cases.map((c) => `<div class="wrap">${caseHtml(c, runDir)}</div>`).join("")}
</body></html>`;
  fs.writeFileSync(file, html);
  return file;
}
