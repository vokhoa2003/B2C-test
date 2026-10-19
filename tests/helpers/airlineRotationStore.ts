import fs from "fs";
import path from "path";

/**
 * Lưu danh sách hãng bay ĐÃ test qua các LẦN CHẠY TRƯỚC (không reset mỗi lần
 * chạy, khác testStateStore.ts) — phục vụ yêu cầu "mặc định test không trùng,
 * tối đa N lần search/order, lần sau tiếp tục N hãng mới tiếp theo".
 */

const STATE_DIR = path.join(process.cwd(), ".test-state");
const STATE_FILE = path.join(STATE_DIR, "airline-rotation.json");

type RotationState = {
  /** Mã hãng đã test, theo thứ tự lần đầu gặp. */
  testedAirlineCodes: string[];
};

function readState(): RotationState {
  if (!fs.existsSync(STATE_FILE)) return { testedAirlineCodes: [] };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { testedAirlineCodes: [] };
  }
}

function writeState(state: RotationState) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Chọn tối đa `maxCount` hãng từ `availableCodes` ưu tiên hãng CHƯA từng test
 * (theo lịch sử tích luỹ qua các lần chạy). Nếu không đủ hãng mới, lặp lại hãng
 * cũ ngẫu nhiên để đủ số lượng. Ghi lại các hãng vừa chọn vào lịch sử ngay
 * (coi như đã test) để lần chạy sau tiếp tục đúng phần còn lại.
 */
export function pickNextAirlineBatch(
  availableCodes: string[],
  maxCount: number
): string[] {
  const state = readState();
  const testedSet = new Set(state.testedAirlineCodes);

  const untested = availableCodes.filter((c) => !testedSet.has(c));
  const picked: string[] = untested.slice(0, maxCount);

  if (picked.length < maxCount) {
    const alreadyTestedAvailable = availableCodes.filter((c) => testedSet.has(c));
    const shuffled = [...alreadyTestedAvailable].sort(() => Math.random() - 0.5);
    for (const code of shuffled) {
      if (picked.length >= maxCount) break;
      if (!picked.includes(code)) picked.push(code);
    }
  }

  const newlyTested = picked.filter((c) => !testedSet.has(c));
  if (newlyTested.length) {
    writeState({
      testedAirlineCodes: [...state.testedAirlineCodes, ...newlyTested],
    });
  }

  return picked;
}

/** Xoá lịch sử rotation — dùng khi muốn test lại từ đầu toàn bộ hãng bay. */
export function resetAirlineRotation() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}
