import fs from "fs";
import path from "path";

/**
 * Ghi báo cáo kết quả search ra file CSV (import được vào Excel) — mỗi dòng là
 * 1 tổ hợp (case, hãng bay, chuyến bay, hạng vé) theo đúng cấu trúc dữ liệu
 * plan yêu cầu ("Có n chuyến hãng VNA... Máy bay VN110... Hạng eco: giá...").
 */

export type SearchReportRow = {
  caseId: string;
  conditionDescription: string;
  route: string;
  tripType: string;
  airline: string;
  flightNumber: string;
  /** Ngày bay của leg này — "ngày đi" cho chiều đi, "ngày về" cho chiều về (khứ hồi). */
  departureDate?: string;
  returnDate?: string;
  departureTime: string;
  arrivalTime: string;
  stopLabel: string;
  fareClass: string;
  adultOldPrice?: number;
  /** Giá vé thuần, chưa gồm thuế/phí. */
  ticketPrice?: number;
  /** Thuế + phí. */
  taxPrice?: number;
  /** Giá tổng (đã gồm thuế/phí, sau giảm giá nếu có) — số hiển thị trên fare-card. */
  adultPrice: number;
  childPrice?: number;
};

const REPORT_DIR = path.join(process.cwd(), ".test-state");
const CSV_COLUMNS: (keyof SearchReportRow)[] = [
  "caseId",
  "conditionDescription",
  "route",
  "tripType",
  "airline",
  "flightNumber",
  "departureDate",
  "returnDate",
  "departureTime",
  "arrivalTime",
  "stopLabel",
  "fareClass",
  "adultOldPrice",
  "ticketPrice",
  "taxPrice",
  "adultPrice",
  "childPrice",
];

function csvEscape(value: unknown): string {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Tạo tên file báo cáo mới theo timestamp (mỗi lần chạy 1 file riêng, dễ đối chiếu). */
export function createReportFilePath(prefix: string): string {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(REPORT_DIR, `${prefix}-${timestamp}.csv`);
}

export class SearchReportWriter {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    // Ghi header NGAY LÚC TẠO, không đợi có dòng dữ liệu đầu tiên — nếu không,
    // trường hợp không thu thập được dòng nào (lỗi mở drawer/filter âm thầm bị
    // catch) sẽ khiến file KHÔNG BAO GIỜ được tạo ra, nhìn như test không chạy gì.
    fs.writeFileSync(this.filePath, CSV_COLUMNS.join(",") + "\n", "utf-8");
  }

  appendRows(rows: SearchReportRow[]) {
    if (!rows.length) return;
    const lines = rows.map((row) =>
      CSV_COLUMNS.map((col) => csvEscape(row[col])).join(",")
    );
    fs.appendFileSync(this.filePath, lines.join("\n") + "\n", "utf-8");
  }

  getFilePath() {
    return this.filePath;
  }
}
