import { Page } from "@playwright/test";

export type FareOption = {
  className: string;
  /** Giá tổng hiển thị trên fare-card (đã gồm thuế/phí, sau giảm giá nếu có). */
  price: number | null;
  oldPrice: number | null;
  isRecommended: boolean;
  /** Giá vé thuần (chưa gồm thuế/phí) — đọc từ popover "Giá" khi hover giá trên card. */
  ticketPrice: number | null;
  /** Thuế + phí — đọc từ popover "Thuế và phí". */
  taxFee: number | null;
};

export type LegDetail = {
  tag: string; // "Chiều đi" | "Chiều về" | ""
  airline: string;
  flightNumber: string;
  cabinLabel: string;
  stopLabel: string;
  /** Ngày bay của leg này (VD "T6, 6 Thg 11 2026") — đọc từ chip đầu tiên. */
  legDate: string;
  departureTime: string;
  arrivalTime: string;
  fares: FareOption[];
};

/**
 * Drawer xem chi tiết + chọn hạng vé (`DrawerReviewFlights.tsx`) — mở ra khi
 * bấm "Chọn" trên 1 chuyến bay ở list kết quả. Dùng để ĐỌC dữ liệu (giá theo
 * hạng, giờ bay, hãng...) rồi ĐÓNG LẠI KHÔNG đặt — không bấm "Tiếp tục"/"Đặt
 * ngay" thì chưa điều hướng sang trang hành khách, an toàn cho việc chỉ thu
 * thập thông tin (Giai đoạn 1, không tạo order).
 *
 * Toàn bộ class CSS dùng ở đây lấy trực tiếp từ source thật
 * (DrawerReviewFlights.tsx), không phải đoán.
 */
export class FlightFareDrawer {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForOpen(timeout = 30_000) {
    await this.page
      .locator(".flights__review-leg, .flights__review-oneway")
      .first()
      .waitFor({ state: "visible", timeout });
  }

  /**
   * Đọc toàn bộ chặng (1 cho 1 chiều, 2 cho khứ hồi) kèm giá từng hạng vé đang
   * hiện. Dùng direct-child selector (`.flights__review-drawer-body > div`)
   * thay vì gộp 2 class bằng dấu phẩy — vì case 1 chiều có 1 div lồng BÊN
   * TRONG mang class `flights__review-leg flights__review-leg--timeline`
   * (khác leg thật), selector OR trước đây khớp luôn div lồng đó -> đếm dư
   * legs ảo (fares=0) dù không làm sai dữ liệu cuối (vòng lặp rỗng).
   */
  async readLegs(): Promise<LegDetail[]> {
    const legBlocks = this.page.locator(".flights__review-drawer-body > div");
    const count = await legBlocks.count();
    const legs: LegDetail[] = [];

    for (let i = 0; i < count; i++) {
      const block = legBlocks.nth(i);
      const tag = (await block.locator(".flights__review-leg-tag").textContent().catch(() => "")) ?? "";
      const airline = (await block.locator(".flights__review-leg-airline-name").first().textContent().catch(() => "")) ?? "";
      const flightNumber = (await block.locator(".flights__review-leg-flightno").first().textContent().catch(() => "")) ?? "";
      const cabinLabel = (await block.locator(".flights__review-leg-cabin").first().textContent().catch(() => "")) ?? "";
      // 2 chip cố định theo thứ tự render (DrawerReviewFlights.tsx metaChips):
      // chip đầu = ngày bay (CalendarOutlined), chip sau = số điểm dừng.
      const legDate = (await block.locator(".flights__review-chip").first().textContent().catch(() => "")) ?? "";
      const stopLabel = (await block.locator(".flights__review-chip").last().textContent().catch(() => "")) ?? "";
      const clocks = await block.locator(".flights__review-leg-clock").allTextContents();

      const fareCards = block.locator(".flights__review-fare-card");
      const fareCount = await fareCards.count();
      const fares: FareOption[] = [];
      for (let f = 0; f < fareCount; f++) {
        const card = fareCards.nth(f);
        const className = (await card.locator(".flights__review-fare-name").textContent().catch(() => "")) ?? "";
        const priceText = (await card.locator(".flights__review-fare-price").last().textContent().catch(() => "")) ?? "";
        const oldPriceText = await card.locator(".flights__review-fare-price-old").textContent().catch(() => null);
        const isRecommended = (await card.locator(".flights__review-fare-cheapest").count()) > 0;
        const { ticketPrice, taxFee } = await this.readPriceBreakdown(card);
        fares.push({
          className: className.trim(),
          price: parsePriceVnd(priceText),
          oldPrice: oldPriceText ? parsePriceVnd(oldPriceText) : null,
          isRecommended,
          ticketPrice,
          taxFee,
        });
      }

      legs.push({
        tag: tag.trim(),
        airline: airline.trim(),
        flightNumber: flightNumber.trim(),
        cabinLabel: cabinLabel.trim(),
        legDate: legDate.trim(),
        stopLabel: stopLabel.trim(),
        departureTime: clocks[0]?.trim() ?? "",
        arrivalTime: clocks[clocks.length - 1]?.trim() ?? "",
        fares,
      });
    }

    return legs;
  }

  /**
   * Hover vào giá trên fare-card để mở popover `PriceFlightDetail` (chỉ hiện
   * khi hover trên desktop — xem DrawerReviewFlights.tsx
   * `trigger={isDesktop ? "hover" : "click"}`). Popover liệt kê từng loại hành
   * khách có mặt (người lớn/trẻ em/em bé) với 2 dòng "Giá" (giá vé thuần) và
   * "Thuế và phí" riêng — cộng dồn qua tất cả loại hành khách vì card chỉ hiện
   * 1 con số tổng gộp. Không cần tách Row theo cấu trúc DOM: mỗi dòng nhãn "Giá"/
   * "Thuế và phí" không chứa chữ số, nên parsePriceVnd trên text GỘP của cả dòng
   * (nhãn + giá trị) vẫn ra đúng số.
   */
  private async readPriceBreakdownOnce(
    fareCard: import("@playwright/test").Locator
  ): Promise<{ ticketPrice: number | null; taxFee: number | null }> {
    const trigger = fareCard.locator(".flights__review-fare-price-trigger");
    if ((await trigger.count()) === 0) return { ticketPrice: null, taxFee: null };

    try {
      await trigger.hover();
      const popover = this.page.locator(".flights__review-price-popover");
      await popover.waitFor({ state: "visible", timeout: 5_000 });

      const sumRowsByLabel = async (label: string): Promise<number | null> => {
        const labelNodes = await popover.getByText(label, { exact: true }).all();
        let sum = 0;
        let found = false;
        for (const node of labelNodes) {
          // antd dùng prefixCls="te" trong app này (xem ThemeProvider.tsx) — class
          // thật là "te-row", KHÔNG phải "ant-row" mặc định.
          const row = node.locator("xpath=ancestor::div[contains(@class,'te-row')][1]");
          const rowText = (await row.textContent().catch(() => "")) ?? "";
          const value = parsePriceVnd(rowText);
          if (value !== null) {
            sum += value;
            found = true;
          }
        }
        return found ? sum : null;
      };

      const ticketPrice = await sumRowsByLabel("Giá");
      const taxFee = await sumRowsByLabel("Thuế và phí");
      return { ticketPrice, taxFee };
    } catch {
      return { ticketPrice: null, taxFee: null };
    } finally {
      await this.page.mouse.move(0, 0).catch(() => {});
    }
  }

  /**
   * Hover liên tiếp nhiều fare-card trong 1 vòng lặp nhanh đôi khi khiến popover
   * của card TRƯỚC chưa kịp đóng hẳn (CSS transition) trước khi card SAU bắt
   * đầu hover — verify thực tế: đa số card đọc đúng nhưng vài card rải rác bị
   * rỗng dù cấu trúc/selector đã đúng. Đợi ngắn trước khi hover + thử lại 1 lần
   * nếu lần đầu không đọc được gì.
   */
  private async readPriceBreakdown(
    fareCard: import("@playwright/test").Locator
  ): Promise<{ ticketPrice: number | null; taxFee: number | null }> {
    await this.page.waitForTimeout(200);
    const first = await this.readPriceBreakdownOnce(fareCard);
    if (first.ticketPrice !== null || first.taxFee !== null) return first;
    await this.page.waitForTimeout(300);
    return this.readPriceBreakdownOnce(fareCard);
  }

  /** Đóng drawer KHÔNG đặt chuyến (không bấm Tiếp tục/Đặt ngay) — dùng Escape để
   * tránh phải tìm nút X cụ thể. */
  async closeWithoutBooking() {
    await this.page.keyboard.press("Escape");
    await this.page
      .locator(".flights__review-leg, .flights__review-oneway")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  }
}

/** "1.027.181 đ" hoặc "1.027.181 đ/khách" -> 1027181. */
function parsePriceVnd(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}
