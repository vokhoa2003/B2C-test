/**
 * Xem các lần chạy tool giá khách sạn (.test-state/hotel-price/) — chỉ đọc file trên máy, không gọi mạng.
 *
 *   yarn hotel:price:reports                  # in danh sách (mới nhất = #1) + tạo trang tổng quan index.html
 *   yarn hotel:price:reports --open           # mở trang tổng quan (lọc, bấm link từng báo cáo)
 *   yarn hotel:price:reports latest           # mở báo cáo mới nhất
 *   yarn hotel:price:reports 3                # mở báo cáo #3
 *   yarn hotel:price:reports --find "Da Nang" # chỉ lần chạy có địa điểm / case chứa từ khoá
 *   yarn hotel:price:reports --limit 10       # chỉ in 10 lần gần nhất ra console
 *
 * Xem tests/hotel-price/README.md.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", ".test-state", "hotel-price");
const INDEX_FILE = path.join(ROOT, "index.html");

/** "2026-10-29T05-23-12" (giờ UTC, xem spec) → Date */
const dirToDate = (name) => new Date(name.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3Z"));

function loadRuns() {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name))
    .map((d) => {
      const dir = path.join(ROOT, d.name);
      const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) : null);
      // Lần chạy cũ chưa có overview.json → lấy điều kiện từ raw.json (không có số cảnh báo).
      const overview = read("overview.json");
      const conditions = overview?.conditions ?? (read("raw.json")?.conditions ?? []).map((c) => ({
        id: c.id,
        description: c.description,
        location: c.location?.name ?? c.location?.term,
        checkIn: c.checkIn,
        nights: c.nights,
        rooms: c.rooms,
        adults: c.adults,
        children: c.children,
        error: c.error ?? c.web?.error ?? null,
        webCount: c.web?.count ?? 0,
      }));
      const report = path.join(dir, "report.html");
      return { name: d.name, dir, at: dirToDate(d.name), report: fs.existsSync(report) ? report : null, conditions };
    })
    .sort((a, b) => b.at - a.at)
    .map((run, i) => ({ ...run, index: i + 1 }));
}

const fmtTime = (d) => d.toLocaleString("vi-VN", { hour12: false });
const secs = (ms) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}s`);
const sum = (list, key) => list.reduce((a, c) => a + (Number(c[key]) || 0), 0);
const guests = (c) => `${c.rooms}P · ${c.adults}NL${c.children ? ` ${c.children}TE` : ""}`;
const searchable = (run) => [run.name, ...run.conditions.flatMap((c) => [c.id, c.location, c.description])].join(" ").toLowerCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Tình trạng 1 điều kiện: lỗi / 0 khách sạn / có cảnh báo / ổn. */
function condState(c) {
  if (c.error) return { cls: "fail", text: `Lỗi: ${c.error}` };
  if (!c.webCount) return { cls: "fail", text: "0 khách sạn" };
  const warns = [
    c.listDetailGaps && `${c.listDetailGaps} KS giá list ≠ detail`,
    c.detailErrors && `${c.detailErrors} KS lỗi detail`,
    ...(c.policyWarnings ?? []),
  ].filter(Boolean);
  return warns.length ? { cls: "warn", text: warns.join(" · ") } : { cls: "ok", text: "" };
}

function writeIndex(runs) {
  const rows = runs
    .map((run) => {
      const conds = run.conditions
        .map((c) => {
          const s = condState(c);
          return `<tr class="${s.cls}"><td>${esc(c.id)}</td><td>${esc(c.location)}${c.isDomestic === false ? ' <span class="tag">QT</span>' : ""}</td><td>${esc(c.checkIn)} · ${c.nights} đêm</td><td>${esc(guests(c))}</td><td class="n">${c.webCount ?? "—"}</td><td class="n">${secs(c.webMs)}</td><td>${esc(c.webPolicy ?? "—")}</td><td>${c.tmsUsesWebData ? '<span class="muted">chung token WEB</span>' : `${c.tmsCount ?? "—"} KS · ${esc(c.tmsPolicy ?? "—")}`}</td><td>${esc(s.text)}</td></tr>`;
        })
        .join("");
      const link = run.report ? `<a href="${esc(path.relative(ROOT, run.report).replace(/\\/g, "/"))}">Mở báo cáo</a>` : '<span class="muted">không có report.html</span>';
      return `<section class="run" data-search="${esc(searchable(run))}"><h2>#${run.index} · ${esc(fmtTime(run.at))} <small>${run.conditions.length} điều kiện · ${sum(run.conditions, "hotels") || sum(run.conditions, "webCount")} khách sạn</small> ${link}</h2><table><thead><tr><th>Case</th><th>Địa điểm</th><th>Ngày</th><th>Phòng/khách</th><th class="n">KS</th><th class="n">Search</th><th>Policy WEB</th><th>TMS</th><th>Ghi chú</th></tr></thead><tbody>${conds}</tbody></table></section>`;
    })
    .join("");
  const totalHotels = runs.reduce((a, r) => a + (sum(r.conditions, "hotels") || sum(r.conditions, "webCount")), 0);
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Giá khách sạn — tổng quan</title><style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2430;--muted:#6b7380;--line:#e3e6eb;--accent:#1f6feb;--warn:#fff4e5;--fail:#fdecec}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1f26;--fg:#e6e9ee;--muted:#9aa3ae;--line:#2c333d;--accent:#58a6ff;--warn:#2b2112;--fail:#2d1517}}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px}h2 small,.muted{color:var(--muted);font-weight:normal}a{color:var(--accent)}
input{width:100%;max-width:420px;padding:6px 10px;margin:10px 0;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
.run{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:12px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}
tr.warn{background:var(--warn)}tr.fail{background:var(--fail)}.tag{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px}
</style></head><body><h1>Giá khách sạn — tổng quan các lần chạy</h1><div class="muted">${runs.length} lần chạy · ${totalHotels} khách sạn · hàng vàng = có cảnh báo, hàng đỏ = lỗi / 0 khách sạn</div>
<input id="q" placeholder="Lọc theo địa điểm, case, ngày…"><div id="runs">${rows || '<p class="muted">Chưa có lần chạy nào — chạy yarn hotel:price</p>'}</div>
<script>document.getElementById("q").addEventListener("input",function(e){var v=e.target.value.toLowerCase();document.querySelectorAll(".run").forEach(function(s){s.style.display=s.dataset.search.indexOf(v)>=0?"":"none"})})</script></body></html>`;
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(INDEX_FILE, html, "utf-8");
}

function openFile(file) {
  const cmd = process.platform === "win32" ? `start "" "${file}"` : process.platform === "darwin" ? `open "${file}"` : `xdg-open "${file}"`;
  spawn(cmd, { shell: true, stdio: "ignore", detached: true }).unref();
}

const args = process.argv.slice(2);
let find = "";
let limit = Infinity;
let target = null;
let openIndex = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--open") openIndex = true;
  else if (a === "--find") find = (args[++i] ?? "").toLowerCase();
  else if (a === "--limit") limit = Number(args[++i]) || Infinity;
  else if (a === "latest" || /^\d+$/.test(a)) target = a;
  else {
    console.error(`Tham số không hợp lệ: ${a}\nDùng: [--open] [latest | số] [--find từ-khoá] [--limit N]`);
    process.exit(1);
  }
}

const allRuns = loadRuns();
writeIndex(allRuns);

if (target) {
  const run = target === "latest" ? allRuns[0] : allRuns.find((r) => r.index === Number(target));
  if (!run?.report) {
    console.error(run ? `Lần chạy #${run.index} không có report.html (${run.dir})` : `Không có lần chạy #${target} (đang có ${allRuns.length})`);
    process.exit(1);
  }
  console.log(`Mở #${run.index} (${fmtTime(run.at)}): ${run.report}`);
  openFile(run.report);
  process.exit(0);
}

const runs = allRuns.filter((r) => !find || searchable(r).includes(find));
if (!runs.length) console.log(allRuns.length ? `Không có lần chạy nào khớp "${find}".` : "Chưa có lần chạy nào — chạy: yarn hotel:price");
for (const run of runs.slice(0, limit)) {
  console.log(`#${run.index}  ${fmtTime(run.at)}  ${run.conditions.length} điều kiện  ${run.report ?? "(không có report.html)"}`);
  for (const c of run.conditions) {
    const s = condState(c);
    console.log(`     ${c.id.padEnd(12)} ${String(c.location).padEnd(18)} ${c.checkIn} ${c.nights}đ ${guests(c).padEnd(10)} ${String(c.webCount ?? "—").padStart(3)} KS${s.text ? `  ${s.cls === "fail" ? "✗" : "⚠"} ${s.text}` : ""}`);
  }
}
console.log(`\nTrang tổng quan: ${INDEX_FILE}${openIndex ? "" : "  (mở: yarn hotel:price:reports --open)"}`);
if (openIndex) openFile(INDEX_FILE);
