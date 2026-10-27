/**
 * V2 — xem danh sách mọi báo cáo của tool v2 (.test-state/metasearch-compare-v2/). Bản v1: metasearch-reports.js.
 * Xem danh sách mọi báo cáo so sánh metasearch vs web đã chạy (chỉ đọc file trên máy, không gọi mạng).
 *
 *   yarn compare:metasearch:v2:reports                 # in danh sách (mới nhất = #1) + tạo trang index.html
 *   yarn compare:metasearch:v2:reports --open          # mở trang index.html (lọc, bấm link từng báo cáo)
 *   yarn compare:metasearch:v2:reports 3               # mở báo cáo #3 trong trình duyệt
 *   yarn compare:metasearch:v2:reports latest          # mở báo cáo mới nhất
 *   yarn compare:metasearch:v2:reports --find SGN      # chỉ liệt kê lần chạy có route/kết luận chứa "SGN"
 *   yarn compare:metasearch:v2:reports --limit 10      # chỉ in 10 lần chạy gần nhất ra console
 *
 *   yarn compare:metasearch:v2:open latest                       # mở lại MỌI điều kiện của lần mới nhất: tab META + WEB
 *   yarn compare:metasearch:v2:open 3 --cond cond-2              # chỉ cond-2 của lần #3 (nhiều: --cond 1,3)
 *   yarn compare:metasearch:v2:open 2026-10-23T04-33-12-087Z     # dùng tên thư mục (số # đổi khi có lần chạy mới)
 *   (= yarn compare:metasearch:v2:reports <...> --live) — trang tool meta tự đăng nhập, điền điều kiện, Search
 *   live để đối chiếu thủ công với web; KHÔNG so sánh, không ghi báo cáo. Xem tests/metasearch/open-conditions.spec.ts.
 *
 * Xem tests/metasearch-v2/README.md.
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", ".test-state", "metasearch-compare-v2");
const INDEX_FILE = path.join(ROOT, "index.html");

/** Parse CSV đơn giản (có ngoặc kép, BOM) → mảng object theo header. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return (data || []).filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * Trạng thái 1 điều kiện: "fail" khi 1 bên lỗi/timeout — kể cả báo cáo cũ (trước khi có
 * kết luận "KHÔNG SO ĐƯỢC") từng ghi nhầm "KHỚP" dù web timeout —, "ok" khi khớp, còn lại "diff".
 */
function conditionState(c) {
  const verdict = c.verdict || "";
  if (verdict.startsWith("KHÔNG SO ĐƯỢC") || /^(TIMEOUT|LỖI)/.test(c.webStatus || "") || /^LỖI/.test(c.metaStatus || "")) return "fail";
  // "KHỚP · lệch giá dưới 1k: N" (chênh do làm tròn) vẫn tính là khớp.
  return verdict.startsWith("KHỚP") ? "ok" : "diff";
}

/** "2026-10-22T16-03-55-880Z" → Date */
const dirToDate = (name) => new Date(name.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z"));

function loadRuns() {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name))
    .map((d) => {
      const dir = path.join(ROOT, d.name);
      const summaryPath = path.join(dir, "summary.csv");
      const conditions = fs.existsSync(summaryPath) ? parseCsv(fs.readFileSync(summaryPath, "utf-8")) : [];
      const report = ["report.html", "summary.txt", "summary.csv"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
      const states = conditions.map(conditionState);
      return {
        name: d.name,
        dir,
        at: dirToDate(d.name),
        report,
        hasHtml: !!report && report.endsWith("report.html"),
        conditions,
        ok: states.filter((s) => s === "ok").length,
        failed: states.filter((s) => s === "fail").length,
        diff: states.filter((s) => s === "diff").length,
      };
    })
    .sort((a, b) => b.at - a.at)
    .map((run, i) => ({ ...run, index: i + 1 }));
}

const fmtTime = (d) => d.toLocaleString("vi-VN", { hour12: false });
const routesText = (run) =>
  run.conditions
    .map((c) => `${c.route} ${c.tripType === "roundtrip" ? "KH" : "1C"}${{ ok: "", diff: " ✗lệch", fail: " ✗lỗi" }[conditionState(c)]}`)
    .join(", ");
const searchable = (run) =>
  [run.name, ...run.conditions.flatMap((c) => [c.route, c.description, c.verdict, c.flightType, c.tripType])].join(" ").toLowerCase();

function openFile(file) {
  const cmd = process.platform === "win32" ? `start "" "${file}"` : process.platform === "darwin" ? `open "${file}"` : `xdg-open "${file}"`;
  spawn(cmd, { shell: true, stdio: "ignore", detached: true }).unref();
  console.log(`Đã mở: ${file}`);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function writeIndex(runs) {
  const rows = runs
    .map((run) => {
      const href = run.report ? path.relative(ROOT, run.report).split(path.sep).join("/") : "";
      const conds = run.conditions
        .map((c) => {
          const cls = conditionState(c);
          const label = cls === "fail" && !(c.verdict || "").startsWith("KHÔNG SO ĐƯỢC") ? `KHÔNG SO ĐƯỢC (${c.webStatus})` : c.verdict || "?";
          return `<li><span class="tag ${cls}">${esc(label)}</span> <b>${esc(c.route)}</b> · ${esc(c.tripType === "roundtrip" ? "khứ hồi" : "1 chiều")} · ${esc(c.departDate)}${c.returnDate ? " / " + esc(c.returnDate) : ""} · ${esc(c.pax)}</li>`;
        })
        .join("");
      return `<tr data-search="${esc(searchable(run))}">
        <td class="num">#${run.index}</td>
        <td class="nowrap">${esc(fmtTime(run.at))}</td>
        <td class="num">${run.conditions.length}</td>
        <td class="num ok-t">${run.ok}</td>
        <td class="num ${run.diff ? "bad" : ""}">${run.diff}</td>
        <td class="num ${run.failed ? "bad" : ""}">${run.failed}</td>
        <td><ul>${conds || '<li class="muted">Không có summary.csv (lần chạy bị dừng giữa chừng?)</li>'}</ul></td>
        <td class="nowrap">${href ? `<a href="${esc(href)}" target="_blank">${run.hasHtml ? "Mở báo cáo" : "Xem tóm tắt (định dạng cũ)"}</a>` : '<span class="muted">—</span>'}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Metasearch Reports v2</title>
<style>
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f6f7f9; color: #1f2328; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 12px; }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 16px 0; }
  input[type=search] { font: inherit; padding: 6px 10px; border: 1px solid #d0d4da; border-radius: 8px; min-width: 280px; }
  label { font-size: 13px; }
  .wrap { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  th { background: #f0f2f5; font-weight: 600; white-space: nowrap; }
  ul { margin: 0; padding-left: 16px; } li { margin: 2px 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; } .nowrap { white-space: nowrap; }
  .bad { color: #b42318; font-weight: 700; } .ok-t { color: #166534; }
  .tag { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .tag.ok { background: #dcfce7; color: #166534; } .tag.diff { background: #fee2e2; color: #991b1b; } .tag.fail { background: #fef3c7; color: #92400e; }
  a { color: #2563eb; }
</style></head><body>
  <h1>Báo cáo so sánh Metasearch vs Web — v2</h1>
  <p class="muted">${runs.length} lần chạy · tạo lúc ${esc(fmtTime(new Date()))} · chạy lại <code>yarn compare:metasearch:v2:reports</code> để cập nhật danh sách</p>
  <div class="bar">
    <input type="search" id="q" placeholder="Lọc theo route, ngày, kết luận… (VD: SGN, khứ hồi, lệch)">
    <label><input type="checkbox" id="onlyProblem"> Chỉ lần chạy có lệch / không so được</label>
    <span id="count" class="muted"></span>
  </div>
  <div class="wrap"><table>
    <thead><tr><th>#</th><th>Thời gian</th><th>Điều kiện</th><th>Khớp</th><th>Lệch</th><th>Không so được</th><th>Chi tiết</th><th>Báo cáo</th></tr></thead>
    <tbody id="rows">${rows}</tbody>
  </table></div>
<script>
  const q = document.getElementById("q"), only = document.getElementById("onlyProblem"), count = document.getElementById("count");
  const rows = [...document.querySelectorAll("#rows tr")];
  function apply() {
    const terms = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown = 0;
    for (const tr of rows) {
      const text = tr.dataset.search + " " + tr.textContent.toLowerCase();
      const problem = tr.querySelector(".bad");
      const visible = terms.every((t) => text.includes(t)) && (!only.checked || problem);
      tr.style.display = visible ? "" : "none";
      if (visible) shown++;
    }
    count.textContent = shown + " / " + rows.length + " lần chạy";
  }
  q.addEventListener("input", apply); only.addEventListener("change", apply); apply();
</script>
</body></html>`;
  fs.writeFileSync(INDEX_FILE, html, "utf-8");
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let find = "", limit = Infinity, openIndex = false, target = null, live = false, conds = "";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--open") openIndex = true;
  else if (a === "--find") find = (args[++i] || "").toLowerCase();
  else if (a.startsWith("--find=")) find = a.slice(7).toLowerCase();
  else if (a === "--limit") limit = Number(args[++i]) || Infinity;
  else if (a.startsWith("--limit=")) limit = Number(a.slice(8)) || Infinity;
  else if (a === "--live") live = true;
  else if (a === "--cond") conds = args[++i] || "";
  else if (a.startsWith("--cond=")) conds = a.slice(7);
  else if (a === "latest" || /^\d+$/.test(a)) target = a === "latest" ? 1 : Number(a);
  else if (/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(a)) target = a;
  else {
    console.error(`Tham số không hợp lệ: ${a}\nDùng: [số | latest | tên thư mục] [--open] [--find TEXT] [--limit N] [--live [--cond cond-N]]`);
    process.exit(1);
  }
}

const runs = loadRuns();
if (!runs.length) {
  console.log(`Chưa có báo cáo nào trong ${ROOT}. Chạy: yarn compare:metasearch:v2`);
  process.exit(0);
}
writeIndex(runs);

if (live && target === null) target = 1;
if (target !== null) {
  const run = runs.find((r) => r.index === target || r.name === target);
  if (!run) {
    console.error(`Không có báo cáo ${typeof target === "number" ? "#" + target : target} (có ${runs.length} báo cáo).`);
    process.exit(1);
  }
  if (live) {
    if (!fs.existsSync(path.join(run.dir, "raw"))) {
      console.error(`Báo cáo #${run.index} (${run.name}) không có dữ liệu raw để mở lại.`);
      process.exit(1);
    }
    // Spec này đọc raw/cond-N-*.json của lần chạy, mở Chrome riêng với tab META + WEB (live).
    const normalized = conds.split(",").map((c) => c.trim()).filter(Boolean).map((c) => (/^\d+$/.test(c) ? `cond-${c}` : c));
    console.log(`Mở lại ${normalized.join(", ") || "mọi điều kiện"} của #${run.index} (${run.name})…`);
    const result = spawnSync("yarn", ["playwright", "test", "tests/metasearch/open-conditions.spec.ts", "--project=chromium", "--reporter=line"], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, META_OPEN_RUN_DIR: run.dir, META_OPEN_CONDS: normalized.join(",") },
    });
    process.exit(result.status ?? 1);
  }
  if (!run.report) {
    console.error(`Báo cáo #${target} (${run.name}) không có file báo cáo.`);
    process.exit(1);
  }
  openFile(run.report);
  process.exit(0);
}

const filtered = runs.filter((r) => !find || searchable(r).includes(find));
console.log(`${filtered.length}/${runs.length} lần chạy${find ? ` khớp "${find}"` : ""} (mới nhất = #1):\n`);
for (const run of filtered.slice(0, limit)) {
  const status = run.conditions.length
    ? `${run.conditions.length} đk: ${run.ok} khớp, ${run.diff} lệch, ${run.failed} không so được`
    : "không có summary.csv";
  console.log(`#${String(run.index).padEnd(3)} ${fmtTime(run.at).padEnd(20)} ${status}${run.hasHtml ? "" : "  [định dạng cũ]"}`);
  if (run.conditions.length) console.log(`     ${routesText(run)}`);
}
if (filtered.length > limit) console.log(`\n… còn ${filtered.length - limit} lần chạy (bỏ --limit để xem hết)`);
console.log(`\nMở 1 báo cáo:  yarn compare:metasearch:v2:reports <số>   ·   Trang tổng hợp: yarn compare:metasearch:v2:reports --open`);
console.log(`Trang tổng hợp: ${INDEX_FILE}`);

if (openIndex) openFile(INDEX_FILE);
