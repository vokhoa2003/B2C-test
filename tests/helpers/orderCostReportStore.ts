import fs from "fs";
import path from "path";

/**
 * Ghi báo cáo CHI PHÍ ORDER THẬT (sau khi tạo order, dừng trước bước thanh
 * toán) ra CSV — mỗi dòng là 1 tổ hợp (order, cổng thanh toán), vì cùng 1 order
 * được luân phiên chọn qua nhiều cổng thanh toán khác nhau để so sánh "Phí tiện
 * ích" (chỉ dòng phí cổng + tổng cuối thay đổi, phần giá vé/thuế/dịch vụ khác
 * giữ nguyên giữa các dòng cùng order).
 */

export type OrderCostReportRow = {
  orderIndex: number;
  orderCode: string;
  route: string;
  tripType: string;
  departureDate: string;
  /** Hãng bay nhắm tới cho order này (rotation — mỗi order trong 1 lần chạy
   * nhắm 1 hãng khác nhau khi route cho phép). */
  airline?: string;
  /** Hạng ghế (tab Phổ thông/Thương gia) đã random chọn khi tạo order — rỗng
   * nếu chuyến chỉ có 1 hạng ghế (không có tab để chọn). */
  cabinClass?: string;
  /** Hạng vé cụ thể bên trong hạng ghế (VD "Phổ thông tiết kiệm") đã random chọn. */
  fareClass?: string;
  adults: number;
  children: number;
  infants: number;
  adultTicket?: number;
  childTicket?: number;
  infantTicket?: number;
  taxAndFee?: number;
  baggageFee?: number;
  /** Nhãn hành lý đã chọn (VD "+15KG hành lý ký gửi"), rỗng nếu không chọn được. */
  baggageInfo?: string;
  seatFee?: number;
  /** Số ghế đã chọn (VD "11B"), rỗng nếu không chọn được. */
  seatNumber?: string;
  checkinFee?: number;
  discount?: number;
  paymentGateway: string;
  paymentGatewayFee?: number;
  totalWithGateway?: number;
};

const REPORT_DIR = path.join(process.cwd(), ".test-state");
const CSV_COLUMNS: (keyof OrderCostReportRow)[] = [
  "orderIndex",
  "orderCode",
  "route",
  "tripType",
  "departureDate",
  "airline",
  "cabinClass",
  "fareClass",
  "adults",
  "children",
  "infants",
  "adultTicket",
  "childTicket",
  "infantTicket",
  "taxAndFee",
  "baggageFee",
  "baggageInfo",
  "seatFee",
  "seatNumber",
  "checkinFee",
  "discount",
  "paymentGateway",
  "paymentGatewayFee",
  "totalWithGateway",
];

function csvEscape(value: unknown): string {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Tạo tên file báo cáo mới theo timestamp (mỗi lần chạy 1 file riêng, dễ đối chiếu). */
export function createOrderCostReportFilePath(prefix: string): string {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(REPORT_DIR, `${prefix}-${timestamp}.csv`);
}

export class OrderCostReportWriter {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    // Ghi header NGAY LÚC TẠO (không đợi dòng dữ liệu đầu tiên) — theo đúng bài
    // học từ searchReportStore.ts: nếu lỗi xảy ra trước khi có dòng nào, file vẫn
    // phải tồn tại để biết test đã thực sự chạy, không phải không chạy gì.
    fs.writeFileSync(this.filePath, CSV_COLUMNS.join(",") + "\n", "utf-8");
  }

  appendRows(rows: OrderCostReportRow[]) {
    if (!rows.length) return;
    const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
    fs.appendFileSync(this.filePath, lines.join("\n") + "\n", "utf-8");
  }

  getFilePath() {
    return this.filePath;
  }
}
