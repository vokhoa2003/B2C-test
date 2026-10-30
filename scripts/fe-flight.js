/**
 * Kiểm tra FE trang kết quả chuyến bay so với response API (tests/fe-flight — xem README trong đó).
 * Điều kiện sinh theo pattern metasearch v2: dùng chung case study PAX / TRIP / ROUTE trong
 * tests/metasearch-v2/metasearch-vs-web-v2.json (chỉ mẫu 1 chiều), ngẫu nhiên + không lặp chặng đã kiểm.
 *
 *   yarn fe:flight                                  (mặc định: N điều kiện đa dạng, N = conditionsPerRun)
 *   yarn fe:flight --count 10 --route domestic      (--route domestic|international|all)
 *   yarn fe:flight --case PAX-09,ROUTE              (chỉ case study này — mã hoặc tiền tố)
 *   yarn fe:flight --24h                            (mọi điều kiện bay hôm nay / ngày mai)
 *   yarn fe:flight --adt 2 --chd 1 --inf 1          (ghi đè số khách cho mọi điều kiện)
 *   yarn fe:flight --from SGN --to HAN [--depart YYYY-MM-DD|today|tomorrow|+N]   (đúng 1 hành trình)
 *   yarn fe:flight --fixture <thư mục response>     (không gọi API thật: trả lại response đã lưu)
 *   yarn fe:flight --dry-run                        (chỉ in điều kiện sẽ chạy)
 *   yarn fe:flight --repeat                         (bỏ qua lịch sử lần này)
 *   yarn fe:flight:clear                            (= --clear-history: xoá lịch sử chặng đã kiểm)
 *   ... [--headed] [--debug] [--max-cards N]
 *
 * Playwright không nhận tham số lạ nên script đổi cờ thành biến môi trường FE_FLIGHT_* rồi gọi
 * `playwright test` (chromium, 1 worker, không retry — mỗi lần retry là 1 lần search thật).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Trùng đường dẫn với HISTORY_FILE trong tests/fe-flight/lib/conditions.ts.
const HISTORY_FILE = path.join(__dirname, "..", ".test-state", "fe-flight", "history.json");
const USAGE = [
  "Dùng: --count N  --route domestic|international|all  --case PAX-09,ROUTE  --24h  --repeat  --dry-run  --clear-history",
  "      --from SGN --to HAN [--depart YYYY-MM-DD|today|tomorrow|+N]   --adt N --chd N --inf N",
  "      --fixture <thư mục chứa <SYSTEM>.json>  --max-cards N  --headed  --debug",
].join("\n");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function relativeDate(value) {
  const v = value.toLowerCase();
  const offset = v === "today" ? 0 : v === "tomorrow" ? 1 : /^\+\d+$/.test(v) ? Number(v.slice(1)) : null;
  if (offset === null) return value;
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FLAGS = {
  case: { env: "FE_FLIGHT_CASES", check: (v) => !!v },
  from: { env: "FE_FLIGHT_FROM", check: (v) => /^[A-Z]{3}$/i.test(v) },
  to: { env: "FE_FLIGHT_TO", check: (v) => /^[A-Z]{3}$/i.test(v) },
  depart: { env: "FE_FLIGHT_DEPART", map: relativeDate, check: (v) => DATE.test(v) },
  adt: { env: "FE_FLIGHT_ADT", check: (v) => /^[1-9]$/.test(v) },
  chd: { env: "FE_FLIGHT_CHD", check: (v) => /^[0-8]$/.test(v) },
  inf: { env: "FE_FLIGHT_INF", check: (v) => /^[0-9]$/.test(v) },
  fixture: { env: "FE_FLIGHT_FIXTURE", map: (v) => path.resolve(v), check: (v) => fs.existsSync(v) && fs.statSync(v).isDirectory() },
  "max-cards": { env: "FE_FLIGHT_MAX_CARDS", check: (v) => /^\d+$/.test(v) },
  count: { env: "FE_FLIGHT_COUNT", check: (v) => /^[1-9]\d*$/.test(v) },
  route: { env: "FE_FLIGHT_ROUTE", map: (v) => ({ dom: "domestic", intl: "international" })[v] ?? v, check: (v) => ["domestic", "international", "all"].includes(v) },
  // FE mới kiểm 1 chiều — nhận cờ cho giống meta, khứ hồi báo chưa hỗ trợ.
  trip: { env: "FE_FLIGHT_TRIP", map: (v) => ({ ow: "oneway", rt: "roundtrip" })[v] ?? v, check: (v) => v === "oneway" || v === "all" },
};
const SWITCHES = { "--24h": "FE_FLIGHT_24H", "--repeat": "FE_FLIGHT_REPEAT", "--dry-run": "FE_FLIGHT_DRY_RUN" };

const env = { ...process.env };
const playwrightArgs = ["playwright", "test", "tests/fe-flight/fe-flight-result.spec.ts", "--project=chromium", "--workers=1", "--retries=0"];
const args = process.argv.slice(2);
const fail = (message) => {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--headed" || arg === "--debug") {
    playwrightArgs.push(arg);
    continue;
  }
  if (SWITCHES[arg]) {
    env[SWITCHES[arg]] = "1";
    continue;
  }
  if (arg === "--clear-history") {
    if (fs.existsSync(HISTORY_FILE)) {
      const count = (JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")).entries || []).length;
      fs.rmSync(HISTORY_FILE);
      console.log(`Đã xoá lịch sử ${count} chặng đã kiểm (${HISTORY_FILE}).`);
    } else {
      console.log("Chưa có lịch sử nào để xoá.");
    }
    process.exit(0);
  }
  if (/^--trip(=|$)/.test(arg) && /r(ound)?t(rip)?$/i.test(arg.split("=")[1] ?? args[i + 1] ?? "")) {
    fail("FE flight hiện chỉ kiểm 1 chiều — khứ hồi sẽ có ở Mốc 3.");
  }
  const match = arg.match(/^--([\w-]+)(?:=(.*))?$/);
  const flag = match && FLAGS[match[1]];
  if (!flag) fail(`Cờ không hợp lệ: ${arg}`);
  let value = match[2] ?? args[++i] ?? "";
  if (flag.map) value = flag.map(value);
  if (!flag.check(value)) fail(`--${match[1]}=${value} không hợp lệ`);
  env[flag.env] = value;
}

if (!!env.FE_FLIGHT_FROM !== !!env.FE_FLIGHT_TO) fail("Chỉ định hành trình cần cả --from và --to.");
if (env.FE_FLIGHT_FROM && env.FE_FLIGHT_FROM.toUpperCase() === env.FE_FLIGHT_TO.toUpperCase()) fail("--from và --to phải khác nhau.");
const adt = Number(env.FE_FLIGHT_ADT || 1), chd = Number(env.FE_FLIGHT_CHD || 0), inf = Number(env.FE_FLIGHT_INF || 0);
if (inf > adt) fail(`Số em bé (${inf}) không được nhiều hơn số người lớn (${adt}).`);
if (adt + chd + inf > 9) fail(`Tổng người lớn + trẻ em + em bé tối đa 9 (đang ${adt + chd + inf}).`);

// Mọi case của 1 lần chạy ghi chung 1 thư mục → 1 báo cáo.
env.FE_FLIGHT_RUN_DIR = path.join(__dirname, "..", ".test-state", "fe-flight", new Date().toISOString().replace(/[:.]/g, "-"));

if (env.FE_FLIGHT_DRY_RUN) playwrightArgs.push("--reporter=line");
const result = spawnSync("yarn", playwrightArgs, { stdio: "inherit", env, shell: true });
const report = path.join(env.FE_FLIGHT_RUN_DIR, "report.html");
if (env.FE_FLIGHT_DRY_RUN) fs.rmSync(env.FE_FLIGHT_RUN_DIR, { recursive: true, force: true });
else if (fs.existsSync(report)) console.log(`\nMở báo cáo: ${report}  (hoặc yarn fe:flight:reports latest)`);
process.exit(result.status ?? 1);
