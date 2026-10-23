import fs from "fs";
import path from "path";

/**
 * Lịch sử các điều kiện đã so sánh (metasearch vs web) — để các lần chạy sau KHÔNG lặp lại
 * hành trình đã kiểm tra. Lưu ở `.test-state/metasearch-compare/history.json` (không commit).
 * Xoá bằng `yarn compare:metasearch:clear` (scripts/compare-metasearch.js --clear-history).
 *
 * "Trùng" = cùng điểm đi → điểm đến (có chiều) + cùng loại 1 chiều/khứ hồi. Không tính ngày bay
 * (ngày random mỗi lần) và số khách.
 */

export const HISTORY_FILE = path.join(process.cwd(), ".test-state", "metasearch-compare", "history.json");

export type HistoryEntry = {
  key: string;
  from: string;
  to: string;
  tripType: "oneway" | "roundtrip";
  departDate: string;
  returnDate?: string;
  pax: string;
  verdict: string;
  runDir: string;
  at: string;
};

export const historyKey = (from: string, to: string, tripType: string) => `${from}-${to}|${tripType}`;

export function loadHistory(): HistoryEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    // Chưa có file hoặc file hỏng: coi như chưa chạy gì.
    return [];
  }
}

export function appendHistory(entry: HistoryEntry) {
  const entries = loadHistory();
  entries.push(entry);
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ entries }, null, 1), "utf-8");
}
