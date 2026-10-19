import { Page, Locator } from "@playwright/test";
import { PassengerCountSelector } from "./PassengerCountSelector";

/** Widget tìm chuyến bay ở trang chủ (tab "Vé máy bay" mặc định được chọn sẵn). */
export class FlightSearchWidget {
  readonly page: Page;
  readonly fromInput: Locator;
  readonly toInput: Locator;
  readonly submitButton: Locator;
  readonly roundTripCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fromInput = page.getByPlaceholder("Từ...");
    this.toInput = page.getByPlaceholder("Đến...");
    this.submitButton = page.getByRole("button", { name: "Tìm chuyến bay" });
    // antd Checkbox wrap input+label trong <label> nên có accessible name thật
    // (khác Form.Item label ở trang hành khách) — CHƯA verify live, cần xác nhận.
    this.roundTripCheckbox = page.getByRole("checkbox", { name: "Khứ hồi" });
  }

  passengerCountSelector(): PassengerCountSelector {
    return new PassengerCountSelector(this.page);
  }

  private airportItem(matchText: string): Locator {
    return this.page.locator(".home__searching--placement-item", {
      hasText: matchText,
    });
  }

  async goto() {
    await this.page.goto("/");
  }

  /** @param matchText chuỗi để lọc dropdown, VD "Nội Bài" cho HAN */
  async selectFromAirport(matchText: string) {
    await this.fromInput.click();
    await this.fromInput.fill(matchText);
    const item = this.airportItem(matchText).first();
    await item.waitFor({ state: "visible" });
    await item.click();
  }

  async selectToAirport(matchText: string) {
    await this.toInput.click();
    await this.toInput.fill(matchText);
    const item = this.airportItem(matchText).first();
    await item.waitFor({ state: "visible" });
    await item.click();
  }

  /**
   * Chọn 1 ngày trong date picker theo `title="YYYY-MM-DD"` — attribute này
   * có trên MỌI cell (kể cả disabled) với giá trị ISO date CHÍNH XÁC TUYỆT
   * ĐỐI, verify thật qua error log của Playwright (`<div title="2026-10-06"
   * class="...te-date-picker__cell...">`). KHÔNG dùng regex khớp số ngày hiển
   * thị nữa — đã verify qua nhiều lần chạy live: text hiển thị là ngày + 1
   * chỉ số ẩn khác + giá dính liền nhau (VD "90198k"), ngày 2 chữ số có thể
   * TRÙNG PREFIX với text của 1 ngày khác hoàn toàn, khớp nhầm ô (có khi rơi
   * đúng ô bị disabled gây timeout) — cách dùng `title` né hẳn vấn đề này,
   * đồng thời không cần suy đoán "ngày nằm ở cột tháng nào" (`monthColumnIndex`)
   * như trước.
   */
  private dateCell(targetDate: Date): Locator {
    // Dùng local date components, KHÔNG dùng `toISOString()` — hàm đó convert
    // sang UTC, có thể lệch lùi 1 ngày với múi giờ UTC+7 (Việt Nam) nếu giờ
    // local đang ở khoảng 00:00-07:00.
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");
    const day = String(targetDate.getDate()).padStart(2, "0");
    const iso = `${year}-${month}-${day}`;
    return this.page.locator(`.te-date-picker__cell[title="${iso}"]`);
  }

  /** Chọn ngày đi trong date picker (tự mở sau khi chọn điểm đến). */
  async selectDepartureDay(targetDate: Date) {
    const cell = this.dateCell(targetDate);
    await cell.waitFor({ state: "visible", timeout: 20_000 });
    await cell.click();
  }

  /** Bật khứ hồi — PHẢI gọi trước khi chọn ngày (chuyển date picker sang range mode). */
  async enableRoundTrip() {
    await this.roundTripCheckbox.check();
  }

  /**
   * Chọn ngày về — đã verify live: sau khi bật khứ hồi + chọn ngày đi, picker
   * KHÔNG đóng, chờ chọn tiếp ngày về mới đóng (range mode).
   */
  async selectReturnDay(targetDate: Date) {
    const cell = this.dateCell(targetDate);
    await cell.waitFor({ state: "visible", timeout: 20_000 });
    await cell.click();
  }

  async submit() {
    await this.submitButton.click();
    await this.page.waitForURL(/\/flights\/result/, { timeout: 30_000 });
  }
}
