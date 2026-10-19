import { Page, Locator } from "@playwright/test";

export type StopFilter = "direct" | "onestop" | "multistop";
export type DepartureTimeFilter = "morning" | "noon" | "afternoon" | "night";

/**
 * Sidebar bộ lọc trên trang kết quả tìm kiếm (/flights/result). Class thật đã
 * verify qua source (FilterFlights.tsx) — KHÔNG đoán:
 * - Điểm dừng: `.flights__list--filter-input--stops` (3 checkbox, thứ tự DOM:
 *   0=bay thẳng, 1=1 điểm dừng, 2=2+ điểm dừng)
 * - Hãng bay: `.flights__list--filter-input--airline` — LƯU Ý: checkbox chỉ hiện
 *   TÊN hãng + số lượng (VD "Vietnam Airlines (12)"), KHÔNG có mã code (VNA/VJ)
 *   trong text — code chỉ tồn tại trong props React, không scrape được từ DOM.
 *   Vì vậy mọi thao tác filter/rotation ở đây dùng TÊN hãng, không dùng code.
 * - Giờ bay: `.flights__list--filter-input--departuretime` (thứ tự DOM: 0=sáng
 *   sớm 00-06h, 1=sáng 06-12h, 2=chiều 12-18h, 3=tối 18-24h)
 */
export class FlightFilterSidebar {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async filterByStop(stop: StopFilter) {
    const index = { direct: 0, onestop: 1, multistop: 2 }[stop];
    await this.page
      .locator(".flights__list--filter-input--stops")
      .nth(index)
      .getByRole("checkbox")
      .click();
  }

  async filterByDepartureTime(time: DepartureTimeFilter) {
    const index = { morning: 0, noon: 1, afternoon: 2, night: 3 }[time];
    await this.page
      .locator(".flights__list--filter-input--departuretime")
      .nth(index)
      .getByRole("checkbox")
      .click();
  }

  /** Tick checkbox hãng bay theo TÊN hiển thị (VD "Vietnam Airlines") — khớp
   * substring trên text của row (bao gồm cả số lượng, không ảnh hưởng match). */
  async filterByAirlineName(name: string) {
    await this.page
      .locator(".flights__list--filter-input--airline", { hasText: name })
      .first()
      .getByRole("checkbox")
      .click();
  }

  /** Danh sách TÊN hãng bay đang có trong filter sidebar (đã bỏ phần "(N)" số
   * lượng) — dùng để biết hãng nào CHƯA test (phục vụ rotation tối đa N hãng/lần). */
  async listAvailableAirlines(): Promise<string[]> {
    const rows = this.page.locator(".flights__list--filter-input--airline");
    const count = await rows.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).textContent()) || "";
      // "Vietnam Airlines (12)" -> "Vietnam Airlines"
      const name = text.replace(/\(\d+\)\s*$/, "").trim();
      if (name) names.push(name);
    }
    return names;
  }
}
