import { Page, Locator } from "@playwright/test";

export type PriceBreakdown = {
  adultTicket: number | null;
  childTicket: number | null;
  infantTicket: number | null;
  taxAndFee: number | null;
  baggageFee: number | null;
  seatFee: number | null;
  checkinFee: number | null;
  /** "Phí tiện ích" — phí cổng thanh toán, chỉ có giá trị SAU khi đã chọn 1
   * phương thức thanh toán trên trang checkout (ẩn/0 nếu chưa chọn gì). */
  paymentGatewayFee: number | null;
  discount: number | null;
  total: number | null;
};

/**
 * Panel "Chi tiết giá" ở sidebar trang điền hành khách/checkout
 * (`.passenger__order--price`, component thật: `PriceDetail.tsx`). Giá vé cơ
 * bản là dữ liệu cache từ lúc search/chọn chuyến (không gọi API lại); chỉ dòng
 * "Phí tiện ích" đổi real-time theo phương thức thanh toán đang chọn.
 *
 * Cấu trúc DOM đã verify thật (probe DOM trên order thật): mỗi dòng giá là
 * `.te-row.te-row-space-between` với đúng 2 `.te-col` con (label, value).
 * QUAN TRỌNG: label có thể chứa chữ số (VD "Người lớn x1") nên KHÔNG được gộp
 * strip-digit trên toàn bộ text của row (sẽ lẫn số đếm vào giá) — phải đọc
 * RIÊNG cột value (`.te-col` cuối) chứ không phải cả row.
 */
export class PriceDetailPanel {
  readonly page: Page;
  readonly panel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator(".passenger__order--price");
  }

  async waitForLoaded(timeout = 30_000) {
    await this.panel.waitFor({ state: "visible", timeout });
    // Tổng tiền (h4 cuối panel) chỉ có text thật sau khi qua hết skeleton loading.
    await this.panel.locator(".te-list-footer h4").first().waitFor({ state: "visible", timeout });
  }

  /**
   * Cộng dồn giá trị mọi dòng có label khớp regex — khứ hồi có 2 khối "Chuyến
   * 1"/"Chuyến 2", mỗi label (VD "Thuế và phí") có thể lặp lại 1 lần/chặng nên
   * cần gộp thành 1 số tổng thay vì chỉ lấy dòng đầu tiên.
   */
  private async sumRowsByLabel(labelPattern: RegExp): Promise<number | null> {
    const rows = this.panel.locator(".te-row.te-row-space-between");
    const count = await rows.count();
    let sum = 0;
    let found = false;
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const cols = row.locator(".te-col");
      const colCount = await cols.count();
      if (colCount < 2) continue;
      const labelText = (await cols.first().textContent().catch(() => "")) ?? "";
      if (!labelPattern.test(labelText.trim())) continue;
      const valueText = (await cols.last().textContent().catch(() => "")) ?? "";
      const value = parsePriceVnd(valueText);
      if (value !== null) {
        sum += value;
        found = true;
      }
    }
    return found ? sum : null;
  }

  async read(): Promise<PriceBreakdown> {
    const [
      adultTicket,
      childTicket,
      infantTicket,
      taxAndFee,
      baggageFee,
      seatFee,
      checkinFee,
      paymentGatewayFee,
      discount,
    ] = await Promise.all([
      this.sumRowsByLabel(/^Người lớn x\d+/),
      this.sumRowsByLabel(/^Trẻ em x\d+/),
      this.sumRowsByLabel(/^Em bé x\d+/),
      this.sumRowsByLabel(/^Thuế và phí/),
      this.sumRowsByLabel(/^Hành lý ký gửi/),
      this.sumRowsByLabel(/^Chỗ ngồi/),
      this.sumRowsByLabel(/^Check-in Online/),
      this.sumRowsByLabel(/^Phí tiện ích/),
      this.sumRowsByLabel(/^Giảm giá/),
    ]);

    const totalText =
      (await this.panel.locator(".te-list-footer h4").first().textContent().catch(() => "")) ?? "";
    const total = parsePriceVnd(totalText);

    return {
      adultTicket,
      childTicket,
      infantTicket,
      taxAndFee,
      baggageFee,
      seatFee,
      checkinFee,
      paymentGatewayFee,
      discount,
      total,
    };
  }
}

/** "3.791.181 ₫" -> 3791181. */
function parsePriceVnd(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}
