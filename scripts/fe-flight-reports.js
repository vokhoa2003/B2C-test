/**
 * Danh sách các lần chạy FE flight (tests/fe-flight) + mở báo cáo.
 *
 *   yarn fe:flight:reports                 # liệt kê các lần chạy (mới nhất trước) + ghi index.html
 *   yarn fe:flight:reports --open          # mở trang index.html (bấm vào từng báo cáo)
 *   yarn fe:flight:reports latest          # mở report.html của lần mới nhất
 *   yarn fe:flight:reports 3               # mở báo cáo lần #3 trong danh sách
 *   yarn fe:flight:reports 2026-10-30T02-38-31-006Z
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", ".test-state", "fe-flight");
const USAGE = "Dùng: yarn fe:flight:reports [latest | số | tên thư mục] [--open]";

function openFile(file) {
  const cmd = process.platform === "win32" ? `start "" "${file}"` : process.platform === "darwin" ? `open "${file}"` : `xdg-open "${file}"`;
  spawn(cmd, { shell: true, stdio: "ignore", detached: true }).unref();
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Tóm tắt 1 lần chạy từ <run>/<CASE>/result.json. */
function readRun(name) {
  const dir = path.join(ROOT, name);
  const cases = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "result.json")))
    .map((d) => {
      const r = JSON.parse(fs.readFileSync(path.join(dir, d.name, "result.json"), "utf8"));
      const s = r.summary || {};
      const c = r.case || {};
      const state = s.mismatched || s.notInApi ? "diff" : (s.missingOnUi || []).length || !s.loadedAll ? "warn" : "ok";
      return { id: d.name, route: `${c.from}→${c.to} ${c.departDate}`, fixture: !!c.fixture, state, s };
    });
  const hasReport = fs.existsSync(path.join(dir, "report.html"));
  const state = !cases.length ? "fail" : cases.some((c) => c.state === "diff") ? "diff" : cases.some((c) => c.state === "warn") ? "warn" : "ok";
  return { name, dir, cases, hasReport, state };
}

const LABEL = { ok: "KHỚP", warn: "CẢNH BÁO", diff: "LỆCH", fail: "LỖI / CHƯA XONG" };

function writeIndex(runs) {
  const rows = runs
    .map((r, i) => {
      const cases = r.cases
        .map((c) => `<div>${esc(c.id)} ${esc(c.route)}${c.fixture ? " <i>(fixture)</i>" : ""} — <span class="st st-${c.state}">${LABEL[c.state]}</span> ` +
          `card ${c.s.uiCards ?? "?"} · khớp ${c.s.ok ?? "?"} · lệch ${c.s.mismatched ?? "?"} · không có trong API ${c.s.notInApi ?? "?"}</div>`)
        .join("");
      const link = r.hasReport ? `<a href="${esc(r.name)}/report.html">${esc(r.name)}</a>` : esc(r.name);
      return `<tr><td>#${i + 1}</td><td>${link}</td><td><span class="st st-${r.state}">${LABEL[r.state]}</span></td><td>${cases || "—"}</td></tr>`;
    })
    .join("");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FE Flight Runs</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--line:#e5e7eb;--ok:#15803d;--ok-bg:#dcfce7;--warn:#a16207;--warn-bg:#fef9c3;--bad:#b91c1c;--bad-bg:#fee2e2}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--fg:#e6e6e6;--line:#2b3138;--ok:#4ade80;--ok-bg:#14532d;--warn:#facc15;--warn-bg:#422006;--bad:#f87171;--bad-bg:#450a0a}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:16px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.st{padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}
.st-ok{background:var(--ok-bg);color:var(--ok)}.st-warn{background:var(--warn-bg);color:var(--warn)}.st-diff,.st-fail{background:var(--bad-bg);color:var(--bad)}
a{color:#2563eb}.wrap{overflow-x:auto}
</style></head><body><h1>Các lần chạy FE flight</h1>
<div class="wrap"><table><tr><th>#</th><th>Lần chạy</th><th>Kết quả</th><th>Case</th></tr>${rows}</table></div></body></html>`;
  const file = path.join(ROOT, "index.html");
  fs.writeFileSync(file, html);
  return file;
}

if (!fs.existsSync(ROOT)) {
  console.log("Chưa có lần chạy nào — chạy yarn fe:flight trước.");
  process.exit(0);
}
const runs = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}-/.test(d.name))
  .map((d) => d.name)
  .sort()
  .reverse()
  .map(readRun)
  // Thư mục chưa có case nào (VD tạo bởi `playwright test --list`, hoặc dừng trước case đầu) → bỏ qua.
  .filter((r) => r.cases.length || r.hasReport);

let openIndex = false;
let target = null;
for (const a of process.argv.slice(2)) {
  if (a === "--open") openIndex = true;
  else if (!a.startsWith("--") && !target) target = a;
  else {
    console.error(`Tham số không hợp lệ: ${a}\n${USAGE}`);
    process.exit(1);
  }
}

const index = writeIndex(runs);
if (target) {
  const run = target === "latest" ? runs[0] : /^\d+$/.test(target) ? runs[Number(target) - 1] : runs.find((r) => r.name === target);
  if (!run) {
    console.error(`Không tìm thấy lần chạy "${target}" (có ${runs.length} lần).\n${USAGE}`);
    process.exit(1);
  }
  if (!run.hasReport) {
    console.error(`Lần chạy ${run.name} chưa có report.html (bị dừng giữa chừng?).`);
    process.exit(1);
  }
  const file = path.join(run.dir, "report.html");
  console.log(`Mở ${file}`);
  openFile(file);
  process.exit(0);
}

runs.forEach((r, i) => {
  const cases = r.cases.map((c) => `${c.id} ${LABEL[c.state]}`).join(", ");
  console.log(`#${i + 1}  ${r.name}  ${LABEL[r.state]}${cases ? `  (${cases})` : ""}`);
});
console.log(`\nTrang tổng hợp: ${index}`);
if (openIndex) openFile(index);
else console.log("Mở báo cáo: yarn fe:flight:reports latest | <số> | --open");
