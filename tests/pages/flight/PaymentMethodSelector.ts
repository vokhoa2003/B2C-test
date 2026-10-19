import { Page, Locator } from "@playwright/test";

/**
 * Các tuỳ chọn cổng thanh toán cấp 1 hiển thị trực tiếp trên list (không cần
 * mở rộng nhóm "Ví điện tử"). Nhãn lấy THẬT từ DOM (`.payment-method-row__title`),
 * xác nhận qua probe trên 1 order thật — không phải đoán.
 *
 * Bỏ qua Apple Pay/Samsung Pay/ZaloPay (nằm lồng trong nhóm "Ví điện tử", cần
 * mở antd Collapse trước mới thấy — nhãn chính xác của 3 option này CHƯA
 * verify). Có thể bổ sung sau nếu cần so sánh phí của cả 3.
 */
export const TOP_LEVEL_PAYMENT_GATEWAYS = [
  "Chuyển khoản (VietQR)",
  "VNPay (QR)",
  "Ví MoMo",
  "ATM / Internet Banking",
  "Thẻ quốc tế",
] as const;

export type PaymentGatewayLabel = (typeof TOP_LEVEL_PAYMENT_GATEWAYS)[number];

/** Danh sách chọn phương thức thanh toán ở trang checkout (`PaymentMethodList`). */
export class PaymentMethodSelector {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private rowByLabel(label: string): Locator {
    return this.page.locator("div.payment-method-row", { hasText: label }).first();
  }

  /** Chọn 1 phương thức thanh toán theo nhãn — kích hoạt dòng "Phí tiện ích"
   * cập nhật real-time trên PriceDetailPanel (KHÔNG bấm nút "Thanh toán"). */
  async selectByLabel(label: PaymentGatewayLabel) {
    await this.rowByLabel(label).click();
  }
}
