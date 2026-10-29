/**
 * Hiển thị giá khách sạn theo công thức web + TMS (xem tests/hotel-price/README.md):
 *
 *   yarn hotel:price [--count N] [--hotels 10..30] [--case H-03,H-09] [--region dom|intl] [--no-detail]
 *   yarn hotel:price --loc "Đà Nẵng" [--in YYYY-MM-DD|today|tomorrow|+N] [--nights N]
 *                    [--rooms N] [--adt N] [--chd N --ages 5,8]
 *
 * Playwright không nhận tham số lạ nên script đổi cờ thành biến môi trường HOTEL_* rồi gọi `playwright test`.
 */
const { spawnSync } = require("child_process");

const USAGE = [
  "Dùng: --count N  --hotels 10..30  --case H-03,H-09  --region dom|intl  --no-detail  --headed",
  "Chỉ định: --loc \"Đà Nẵng\"  --in YYYY-MM-DD|today|tomorrow|+N  --nights N  --rooms N  --adt N  --chd N  --ages 5,8",
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
  count: { env: "HOTEL_CONDITIONS", check: (v) => Number(v) > 0, hint: "số điều kiện > 0" },
  hotels: { env: "HOTEL_COUNT", check: (v) => Number(v) >= 10 && Number(v) <= 30, hint: "số khách sạn mỗi điều kiện, 10–30" },
  case: { env: "HOTEL_CASES", upper: true, check: (v) => /^[A-Z0-9-]+(,[A-Z0-9-]+)*$/.test(v), hint: "mã case, VD H-03 hoặc H-03,H-09" },
  region: { env: "HOTEL_REGION", values: ["domestic", "international"] },
  loc: { env: "HOTEL_LOC", check: (v) => v.trim().length >= 2, hint: "tên địa điểm, VD \"Đà Nẵng\"" },
  in: { env: "HOTEL_IN", map: relativeDate, check: (v) => DATE.test(v), hint: "dạng YYYY-MM-DD, today, tomorrow hoặc +N" },
  nights: { env: "HOTEL_NIGHTS", check: (v) => Number(v) >= 1 && Number(v) <= 30, hint: "số đêm 1–30" },
  rooms: { env: "HOTEL_ROOMS", check: (v) => Number(v) >= 1 && Number(v) <= 9, hint: "số phòng 1–9" },
  adt: { env: "HOTEL_ADT", check: (v) => Number(v) >= 1 && Number(v) <= 36, hint: "số người lớn ≥ 1" },
  chd: { env: "HOTEL_CHD", check: (v) => /^\d+$/.test(v) && Number(v) <= 9, hint: "số trẻ em 0–9" },
  ages: { env: "HOTEL_AGES", check: (v) => /^\d{1,2}(,\d{1,2})*$/.test(v), hint: "tuổi trẻ em, VD 5,8" },
};
const ALIASES = { dom: "domestic", intl: "international" };

const env = { ...process.env };
const playwrightArgs = ["playwright", "test", "tests/hotel-price/hotel-price.spec.ts", "--project=chromium"];
const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--headed" || arg === "--ui" || arg === "--debug") {
    playwrightArgs.push(arg);
    continue;
  }
  if (arg === "--no-detail") {
    env.HOTEL_NO_DETAIL = "1";
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

if (env.HOTEL_AGES && env.HOTEL_CHD && env.HOTEL_AGES.split(",").length !== Number(env.HOTEL_CHD)) {
  console.error(`--ages cần đủ ${env.HOTEL_CHD} tuổi (đang ${env.HOTEL_AGES}).`);
  process.exit(1);
}
if (env.HOTEL_ROOMS && env.HOTEL_ADT && Number(env.HOTEL_ADT) < Number(env.HOTEL_ROOMS)) {
  console.error(`Mỗi phòng cần ít nhất 1 người lớn (--rooms ${env.HOTEL_ROOMS}, --adt ${env.HOTEL_ADT}).`);
  process.exit(1);
}

const result = spawnSync("yarn", playwrightArgs, { stdio: "inherit", env, shell: true });
process.exit(result.status ?? 1);
