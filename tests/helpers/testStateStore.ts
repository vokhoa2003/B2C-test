import fs from "fs";
import path from "path";

export type BookingAttemptLog = {
  timestamp: string;
  fromCode: string;
  toCode: string;
  departureDate: string; // YYYY-MM-DD
  orderCode: string | null;
  status: "SUCCESS" | "FAILED" | "WAITING_RECHECK";
  note?: string;
};

const STATE_DIR = path.join(process.cwd(), ".test-state");
const STATE_FILE = path.join(STATE_DIR, "flight-booking-log.json");

function readAll(): BookingAttemptLog[] {
  if (!fs.existsSync(STATE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/** Lưu lại 1 lần thử đặt vé — dùng để tránh test trùng điều kiện và note riêng case fail để rerun. */
export function logBookingAttempt(entry: Omit<BookingAttemptLog, "timestamp">) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  const all = readAll();
  all.push({ ...entry, timestamp: new Date().toISOString() });
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2), "utf-8");
}

/** Kiểm tra tổ hợp route+ngày đã test gần đây chưa (trong lần chạy hiện tại) để tránh chọn trùng. */
export function wasRecentlyAttempted(
  fromCode: string,
  toCode: string,
  departureDate: string
): boolean {
  return readAll().some(
    (e) =>
      e.fromCode === fromCode &&
      e.toCode === toCode &&
      e.departureDate === departureDate
  );
}

export function getFailedAttempts(): BookingAttemptLog[] {
  return readAll().filter((e) => e.status === "FAILED");
}
