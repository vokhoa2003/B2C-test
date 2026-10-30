import fs from "fs";
import { BookingRow, BookingStatus, BookingSummary } from "./metasearchBookingCheck";

/** Trang báo cáo riêng của bước đặt chỗ: mỗi item 1 thẻ kèm ảnh màn hình deeplink trỏ tới. */

export type BookingReportCondition = {
  id: string;
  description: string;
  route: string;
  dates: string;
  pax: string;
  booking?: BookingSummary;
};

const STATUS_ORDER: BookingStatus[] = ["LỖI", "GIÁ ĐỔI", "HẾT CHUYẾN", "HẾT PHIÊN", "KHÔNG CÒN TRONG SEARCH", "OK"];
const STATUS_CLASS: Record<BookingStatus, string> = {
  OK: "ok", "GIÁ ĐỔI": "bad", LỖI: "bad", "HẾT CHUYẾN": "warn", "HẾT PHIÊN": "warn", "KHÔNG CÒN TRONG SEARCH": "warn",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const price = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("vi-VN"));

function card(id: string, r: BookingRow): string {
  const image = r.screenshot ? `booking/${esc(id)}/${esc(r.screenshot)}` : "";
  return `<article class="card" data-status="${esc(r.status)}">
    ${image ? `<a href="${image}" target="_blank"><img src="${image}" loading="lazy" alt="Màn hình ${esc(r.flights)}"></a>` : `<div class="noimg">Không có ảnh</div>`}
    <div class="body">
      <div class="top"><span class="tag ${STATUS_CLASS[r.status]}">${esc(r.status)}</span><span class="mono">${esc(r.system)}</span></div>
      <div class="flight mono">${esc(r.flights)}</div>
      <div class="muted">Giá meta ${price(r.metaTotal)}${r.newTotal != null ? ` · <b>Giá mới ${price(r.newTotal)}</b>` : ""}</div>
      <div class="muted">Mở sau search ${r.sinceSearchS}s${r.apiMs != null ? ` · API ${(r.apiMs / 1000).toFixed(1)}s` : ""}</div>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
      ${r.url ? `<a class="muted" href="${esc(r.url)}" target="_blank">Mở deeplink</a>` : ""}
    </div>
  </article>`;
}

export function writeBookingReport(filePath: string, conditions: BookingReportCondition[], startedAt: Date) {
  const done = conditions.filter((c) => c.booking);
  const counts = new Map<BookingStatus, number>();
  for (const c of done) for (const r of c.booking!.rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const filters = STATUS_ORDER.filter((s) => counts.get(s))
    .map((s) => `<button type="button" data-filter="${esc(s)}">${esc(s)} (${counts.get(s)})</button>`)
    .join("");

  const sections = done
    .map((c) => {
      const b = c.booking!;
      const rows = [...b.rows].sort((x, y) => STATUS_ORDER.indexOf(x.status) - STATUS_ORDER.indexOf(y.status));
      return `<section>
        <h2>${esc(c.id)} · ${esc(c.route)} · ${esc(c.dates)} · ${esc(c.pax)}</h2>
        <p class="muted">${esc(c.description)} — thành công ${b.ok}/${b.planned}, đã mở ${b.planned}/${b.items} item meta, ${b.searches} lần search, ${(b.ms / 1000).toFixed(1)}s</p>
        <div class="grid">${rows.map((r) => card(c.id, r)).join("")}</div>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Metasearch đặt chỗ</title>
<style>
  :root { --bg: #f6f7f9; --panel: #fff; --line: #e3e5e8; --text: #1f2328; --muted: #6b7280; --accent: #2563eb;
    --ok-bg: #dcfce7; --ok: #166534; --bad-bg: #fee2e2; --bad: #991b1b; --warn-bg: #fef9c3; --warn: #854d0e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15171a; --panel: #1e2125; --line: #33373d; --text: #e6e8eb; --muted: #9aa1ab; --accent: #6ea0ff;
    --ok-bg: #143d26; --ok: #86efac; --bad-bg: #4a1d1d; --bad: #fca5a5; --warn-bg: #443a12; --warn: #fde047; } }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: var(--bg); color: var(--text); }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 0 0 4px; }
  a { color: var(--accent); }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-top: 20px; }
  .muted { color: var(--muted); font-size: 12px; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .filters button { font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
  .filters button.on { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
  .card { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .card[hidden] { display: none; }
  .card img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border-bottom: 1px solid var(--line); }
  .noimg { display: grid; place-items: center; aspect-ratio: 16 / 10; color: var(--muted); border-bottom: 1px solid var(--line); }
  .body { padding: 10px; display: grid; gap: 3px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .flight { font-size: 13px; font-weight: 600; }
  .note { font-size: 12px; overflow-wrap: anywhere; }
  .tag { padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .tag.ok { background: var(--ok-bg); color: var(--ok); } .tag.bad { background: var(--bad-bg); color: var(--bad); } .tag.warn { background: var(--warn-bg); color: var(--warn); }
  @media (max-width: 640px) { body { padding: 16px; } .grid { grid-template-columns: 1fr; } }
</style></head><body>
  <h1>Metasearch: mở deeplink tới trang đặt chỗ</h1>
  <p class="muted">Chạy lúc ${esc(startedAt.toLocaleString("vi-VN"))} · ${done.length} điều kiện · ${total} item · <a href="report.html">Báo cáo so sánh meta/web</a></p>
  <div class="filters"><button type="button" class="on" data-filter="">Tất cả (${total})</button>${filters}</div>
  ${sections || `<section><p class="muted">Chưa có item nào được mở.</p></section>`}
  <script>
    const buttons = document.querySelectorAll(".filters button");
    buttons.forEach((b) => b.addEventListener("click", () => {
      buttons.forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll(".card").forEach((c) => { c.hidden = !!b.dataset.filter && c.dataset.status !== b.dataset.filter; });
    }));
  </script>
</body></html>`;
  fs.writeFileSync(filePath, html, "utf-8");
}
