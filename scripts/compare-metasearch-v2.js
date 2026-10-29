/**
 * V2 (công thức giá: totalAmount + phí × số khách × số chiều — xem tests/metasearch-v2/README.md).
 * Chạy tool so sánh metasearch vs web với cờ dòng lệnh (chạy được cả PowerShell lẫn bash):
 *
 *   yarn compare:metasearch:v2 [--trip oneway|roundtrip|all] [--route domestic|international|all]
 *                           [--count N] [--24h] [--repeat] [--review] [--headed] [--ui]
 *   yarn compare:metasearch:v2 --from SGN --to HAN [--trip rt] [--depart YYYY-MM-DD|today|tomorrow|+N] [--return …]
 *                           (chỉ định đúng 1 hành trình)
 *   ... [--adt N] [--chd N] [--inf N] [--airline VNA|VN,VJ]   (số khách / hãng — dùng kèm mọi chế độ)
 *   yarn compare:metasearch:v2:clear   (= --clear-history: xoá lịch sử điều kiện đã chạy)
 *
 * Mặc định tool bỏ qua các hành trình đã chạy ở lần trước (lịch sử trong
 * .test-state/metasearch-compare-v2/history.json); --repeat bỏ qua lịch sử cho lần chạy này.
 * --review: mỗi điều kiện mở 2 tab (trang tool metasearch + trang web), không đóng tab cũ,
 * chạy xong browser vẫn mở để xem lại.
 *
 * Playwright không nhận tham số lạ nên script này đổi cờ thành biến môi trường
 * (META_TRIP_TYPE, META_ROUTE_TYPE, META_CONDITIONS) rồi gọi `playwright test`.
 * Xem tests/metasearch-v2/README.md.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Trùng đường dẫn với HISTORY_FILE trong tests/helpers/metasearchHistoryV2.ts.
const HISTORY_FILE = path.join(__dirname, "..", ".test-state", "metasearch-compare-v2", "history.json");
const USAGE = [
  "Dùng: --trip oneway|roundtrip|all  --route domestic|international|all  --count N  --case PAX-09,ROUTE  --24h  --no-recheck  --dry-run  --repeat  --review  --clear-history  --headed  --ui",
  "Chỉ định hành trình: --from SGN --to HAN [--trip rt] [--depart YYYY-MM-DD|today|tomorrow|+N] [--return …]",
  "Số khách / hãng (dùng kèm mọi chế độ): --adt N --chd N --inf N (em bé ≤ người lớn, tổng ≤ 9)  --airline VNA (hoặc VN,VJ)",
].join("\n");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** "today" / "tomorrow" / "+N" → YYYY-MM-DD theo giờ máy; giá trị khác giữ nguyên để kiểm tra DATE. */
function relativeDate(value) {
  const v = value.toLowerCase();
  const offset = v === "today" ? 0 : v === "tomorrow" ? 1 : /^\+\d+$/.test(v) ? Number(v.slice(1)) : null;
  if (offset === null) return value;
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const FLAGS = {
  trip: { env: "META_TRIP_TYPE", values: ["oneway", "roundtrip", "all"] },
  route: { env: "META_ROUTE_TYPE", values: ["domestic", "international", "all"] },
  count: { env: "META_CONDITIONS", check: (v) => Number(v) > 0, hint: "phải là số > 0" },
  // Chỉ chạy case study theo mã/tiền tố trong metasearch-vs-web-v2.json, VD --case PAX-09,ROUTE  (nhiều: dấu phẩy)
  case: { env: "META_CASES", upper: true, check: (v) => /^[A-Z0-9-]+(,[A-Z0-9-]+)*$/.test(v), hint: "mã case, VD PAX-09 hoặc ROUTE (nhiều: dấu phẩy)" },
  // Chỉ định 1 hành trình cụ thể (bỏ qua templates/lịch sử, chạy đúng 1 điều kiện).
  from: { env: "META_FROM", upper: true, check: (v) => /^[A-Z]{3}$/.test(v), hint: "mã sân bay 3 chữ, VD SGN" },
  to: { env: "META_TO", upper: true, check: (v) => /^[A-Z]{3}$/.test(v), hint: "mã sân bay 3 chữ, VD HAN" },
  // Ngày: YYYY-MM-DD, hoặc today / tomorrow / +N (N ngày nữa) — VD case 24h: --depart today
  depart: { env: "META_DEPART", map: relativeDate, check: (v) => DATE.test(v), hint: "dạng YYYY-MM-DD, today, tomorrow hoặc +N" },
  return: { env: "META_RETURN", map: relativeDate, check: (v) => DATE.test(v), hint: "dạng YYYY-MM-DD, today, tomorrow hoặc +N" },
  // Số khách — dùng được cả khi chạy ngẫu nhiên (ghi đè số khách của mọi template).
  adt: { env: "META_ADT", check: (v) => /^\d$/.test(v) && Number(v) >= 1, hint: "số người lớn 1–9" },
  chd: { env: "META_CHD", check: (v) => /^\d$/.test(v), hint: "số trẻ em 0–8" },
  inf: { env: "META_INF", check: (v) => /^\d$/.test(v), hint: "số em bé 0–4" },
  // Chỉ so hành trình của hãng này (mọi segment do hãng bán). Nhiều hãng: --airline VN,VJ
  airline: {
    env: "META_AIRLINES",
    upper: true,
    map: (v) => v.split(",").map((c) => AIRLINE_ICAO[c.trim()] ?? c.trim()).filter(Boolean).join(","),
    check: (v) => !!v && v.split(",").every((c) => /^[A-Z0-9]{2}$/.test(c)),
    hint: "mã hãng 2 ký tự (VD VN, VJ, QH, VU, 9G, SQ) hoặc mã 3 chữ (VNA, VJC, BAV, VAG…); nhiều hãng cách nhau dấu phẩy",
  },
};
// Mã ICAO 3 chữ thường dùng → mã IATA 2 ký tự mà API trả trong segments[].airline.
const AIRLINE_ICAO = { VNA: "VN", VJC: "VJ", BAV: "QH", VAG: "VU", PIC: "BL", SIA: "SQ", THA: "TG", CPA: "CX", KAL: "KE", AAR: "OZ", JAL: "JL", ANA: "NH", EVA: "BR", CAL: "CI", MAS: "MH", QTR: "QR", UAE: "EK" };
// Viết tắt cho tiện gõ: --trip ow / rt, --route dom / intl
const ALIASES = { ow: "oneway", rt: "roundtrip", dom: "domestic", intl: "international" };

const env = { ...process.env };
const playwrightArgs = ["playwright", "test", "tests/metasearch-v2/metasearch-vs-web-v2.spec.ts", "--project=chromium"];
const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--headed" || arg === "--ui" || arg === "--debug") {
    playwrightArgs.push(arg);
    continue;
  }
  if (arg === "--clear-history") {
    if (fs.existsSync(HISTORY_FILE)) {
      const count = (JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")).entries || []).length;
      fs.rmSync(HISTORY_FILE);
      console.log(`Đã xoá lịch sử ${count} điều kiện (${HISTORY_FILE}). Lần chạy sau bắt đầu lại từ đầu.`);
    } else {
      console.log("Chưa có lịch sử nào để xoá.");
    }
    process.exit(0);
  }
  if (arg === "--repeat") {
    env.META_IGNORE_HISTORY = "1";
    continue;
  }
  if (arg === "--review") {
    env.META_REVIEW = "1";
    continue;
  }
  // Case 24h ngẫu nhiên: mọi case (khách, chặng, hành trình ngẫu nhiên như thường) bay hôm nay / ngày mai.
  if (arg === "--24h") {
    env.META_NEAR_24H = "1";
    continue;
  }
  // Mặc định: lần search đầu có lệch giá thì tự search lại 1 lần (vendor hay trả khác nhau giữa 2 phiên). Tắt bằng cờ này.
  if (arg === "--no-recheck") {
    env.META_RECHECK = "0";
    continue;
  }
  if (arg === "--dry-run") {
    env.META_DRY_RUN = "1";
    continue;
  }
  const match = arg.match(/^--(\w+)(?:=(.*))?$/);
  const flag = match && FLAGS[match[1]];
  if (!flag) {
    console.error(`Cờ không hợp lệ: ${arg}\n${USAGE}`);
    process.exit(1);
  }
  let value = match[2] ?? args[++i] ?? "";
  value = ALIASES[value] ?? value;
  if (flag.upper) value = value.toUpperCase();
  if (flag.map) value = flag.map(value);
  if (flag.values ? !flag.values.includes(value) : !flag.check(value)) {
    console.error(`--${match[1]}=${value} không hợp lệ — ${flag.values ? `chỉ nhận: ${flag.values.join(", ")}` : flag.hint}`);
    process.exit(1);
  }
  env[flag.env] = value;
}

// Kiểm tra tổ hợp cờ chỉ định hành trình trước khi mở browser.
const fail = (message) => {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
};
const route = ["META_FROM", "META_TO", "META_DEPART", "META_RETURN"].filter((k) => env[k] && !process.env[k]);
if (route.length) {
  if (!env.META_FROM || !env.META_TO) fail("Chỉ định hành trình cần cả --from và --to.");
  if (env.META_FROM === env.META_TO) fail("--from và --to phải khác nhau.");
  if (env.META_TRIP_TYPE === "oneway" && env.META_RETURN) fail("--trip oneway thì không dùng --return.");
  if (env.META_DEPART && env.META_RETURN && env.META_RETURN < env.META_DEPART) fail("--return phải sau hoặc bằng --depart.");
  // Mã sân bay không có trong danh mục (public/PLAN/airports.json) → chỉ cảnh báo, vẫn chạy.
  const catalogFile = path.resolve(process.env.META_AIRPORTS_FILE || path.join(__dirname, "..", "public", "PLAN", "airports.json"));
  if (fs.existsSync(catalogFile)) {
    const codes = new Set(JSON.parse(fs.readFileSync(catalogFile, "utf-8")).map((a) => String(a.code).toUpperCase()));
    for (const code of [env.META_FROM, env.META_TO]) {
      if (!codes.has(code)) console.warn(`⚠ ${code} không có trong danh mục sân bay ${path.relative(process.cwd(), catalogFile)} — vẫn chạy thử.`);
    }
  }
}
// Số khách: cùng quy tắc ô chọn khách khi đặt vé trên web (InputInfant.tsx): em bé ≤ người lớn,
// tổng người lớn + trẻ em + em bé ≤ 9. Thiếu cờ nào thì lấy mặc định 1 NL / 0 TE / 0 EB.
if (["META_ADT", "META_CHD", "META_INF"].some((k) => env[k] && !process.env[k])) {
  const adt = Number(env.META_ADT || 1), chd = Number(env.META_CHD || 0), inf = Number(env.META_INF || 0);
  if (inf > adt) fail(`Số em bé (${inf}) không được nhiều hơn số người lớn (${adt}).`);
  if (adt + chd + inf > 9) fail(`Tổng người lớn + trẻ em + em bé tối đa 9 (đang ${adt + chd + inf}).`);
}

const result = spawnSync("yarn", playwrightArgs, { stdio: "inherit", env, shell: true });
process.exit(result.status ?? 1);
