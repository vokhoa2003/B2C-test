import { Page, Locator } from "@playwright/test";
import { FlightFareDrawer } from "./FlightFareDrawer";

export type FlightSearchTrackingData = {
  /** 0 = một chiều, 1 = khứ hồi — lấy từ query param itinerary (dữ liệu search thật) */
  isRoundTrip: boolean;
  /** Điểm đi/đến lấy từ query param f1/t1 (dữ liệu search thật, không scrape UI) */
  fromCode: string | null;
  toCode: string | null;
  /** Số hãng bay khác nhau xuất hiện trong danh sách kết quả (scrape UI) */
  airlineCount: number;
  airlineNames: string[];
  /** Tổng số chuyến bay (card) hiển thị */
  flightCount: number;
};

/** Trang kết quả tìm kiếm chuyến bay (/flights/result). */
export class FlightResultsPage {
  readonly page: Page;
  readonly progressBar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.progressBar = page.locator(".flights__list--progress");
  }

  /**
   * Đợi backend load xong TOÀN BỘ kết quả (gọi tuần tự từng hãng, có thể chậm) —
   * quan trọng để đếm đúng số hãng/số chuyến cho tracking, không chỉ lấy chuyến
   * đầu tiên render ra. Đợi progress bar THỰC SỰ xuất hiện trước rồi mới đợi nó
   * tắt hẳn; nếu nó không xuất hiện trong khoảng đệm ban đầu (kết quả trả về quá
   * nhanh, hoặc thực sự 0 kết quả) thì coi như xong, không chờ thêm.
   */
  async waitForSearchDone(timeout = 120_000) {
    const becameVisible = await this.progressBar
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (becameVisible) {
      await this.progressBar.waitFor({ state: "hidden", timeout }).catch(() => {});
    } else {
      // Không thấy progress bar trong 8s đầu — đợi thêm chút để DOM ổn định
      // trước khi đếm, phòng trường hợp kết quả vừa trả về xong đúng lúc ta check.
      await this.page.waitForTimeout(2_000);
    }
  }

  /**
   * Thu thập dữ liệu "tracking search". Điểm đi/đến + loại hành trình lấy từ URL
   * (chính là tham số search thật đã gửi lên server — đáng tin hơn scrape text UI
   * tiếng Việt dễ đổi). Hãng bay/số chuyến lấy từ DOM theo yêu cầu dùng UI thật.
   */
  async collectSearchTrackingData(): Promise<FlightSearchTrackingData> {
    const url = new URL(this.page.url());
    const fromCode = url.searchParams.get("f1");
    const toCode = url.searchParams.get("t1");
    const isRoundTrip = url.searchParams.get("itinerary") === "1";

    const airlineNameCells = this.page.locator(".flights__list--item-airline");
    const names = await airlineNameCells.allTextContents();
    const uniqueAirlines = [...new Set(names.map((n) => n.trim()).filter(Boolean))];

    const flightCount = await this.page
      .locator(".flights__list--item-choose-btn")
      .count();

    return {
      isRoundTrip,
      fromCode,
      toCode,
      airlineCount: uniqueAirlines.length,
      airlineNames: uniqueAirlines,
      flightCount,
    };
  }

  /**
   * Chọn chuyến bay theo index (0 = đầu tiên) -> mở drawer xem hạng vé -> bấm Tiếp
   * tục -> sang trang hành khách (/booking/flight). Lỗi "hết chỗ" (nếu có) chỉ xuất
   * hiện muộn hơn, lúc bấm "Đặt vé" ở PassengerFormPage — xem PassengerFormPage.submitBooking().
   */
  async chooseFlightAndContinue(index = 0) {
    const chooseBtn = this.page
      .locator(".flights__list--item-choose-btn")
      .nth(index);
    await chooseBtn.waitFor({ state: "visible", timeout: 60_000 });
    // Nút đôi lúc báo "not enabled" dù trông bình thường (nghi do loading state nội
    // bộ) — force click để không bị chặn bởi actionability check sai.
    await chooseBtn.click({ force: true, timeout: 30_000 });

    await this.page.getByRole("button", { name: "Tiếp tục" }).click();
    await this.page.waitForURL(/\/booking\/flight/, { timeout: 60_000 });
  }

  /**
   * Chọn 1 hạng vé bên trong `scope` (toàn trang cho 1 chiều, hoặc 1 khối leg
   * cụ thể trong drawer khứ hồi) — gộp hạng vé của MỌI tab hạng ghế
   * (`.flights__review-fare-tab`, VD "Phổ thông"/"Thương gia") thành 1 danh
   * sách tuần tự theo đúng thứ tự hiển thị, rồi chọn theo 1 trong 2 chế độ:
   * - MẶC ĐỊNH (không truyền `fareOrdinal`): random 1 hạng trong danh sách.
   * - CHỈ ĐỊNH THỨ TỰ (`fareOrdinal`, đếm từ 1): lấy đúng vị trí đó, vượt quá
   *   số hạng thực có thì lấy hạng CUỐI CÙNG (clamp, không lỗi).
   * Trả về `{ cabinClass, fareClass }`, null nếu không đọc được tên.
   */
  private async selectFareWithinScope(
    scope: Locator,
    fareOrdinal?: number
  ): Promise<{ cabinClass: string | null; fareClass: string | null }> {
    const fareTabs = scope.locator(".flights__review-fare-tab");
    const tabCount = await fareTabs.count();

    type FlatFareEntry = { tabIndex: number | null; cardIndexInTab: number; cabinLabel: string | null };
    const flatList: FlatFareEntry[] = [];

    if (tabCount > 1) {
      for (let t = 0; t < tabCount; t++) {
        const tab = fareTabs.nth(t);
        const cabinLabel = ((await tab.textContent().catch(() => "")) ?? "").trim() || null;
        await tab.click();
        await this.page.waitForTimeout(300);
        const cardCountInTab = await scope.locator(".flights__review-fare-card").count();
        for (let c = 0; c < cardCountInTab; c++) {
          flatList.push({ tabIndex: t, cardIndexInTab: c, cabinLabel });
        }
      }
    } else {
      const cardCount = await scope.locator(".flights__review-fare-card").count();
      for (let c = 0; c < cardCount; c++) {
        flatList.push({ tabIndex: null, cardIndexInTab: c, cabinLabel: null });
      }
    }

    if (flatList.length === 0) return { cabinClass: null, fareClass: null };

    const chosen =
      typeof fareOrdinal === "number"
        ? flatList[Math.min(Math.max(Math.trunc(fareOrdinal), 1), flatList.length) - 1]
        : flatList[Math.floor(Math.random() * flatList.length)];

    // Đưa đúng tab chứa hạng đã chọn về trạng thái active (vòng lặp gộp danh
    // sách ở trên để lại tab CUỐI CÙNG đang active, không nhất thiết là tab
    // chứa lựa chọn hiện tại).
    if (chosen.tabIndex !== null) {
      await fareTabs.nth(chosen.tabIndex).click();
      await this.page.waitForTimeout(300);
    }

    const card = scope.locator(".flights__review-fare-card").nth(chosen.cardIndexInTab);
    const fareClass =
      ((await card.locator(".flights__review-fare-name").textContent().catch(() => "")) ?? "").trim() ||
      null;
    // Click vào <label> bọc Radio — cùng cơ chế antd Radio.Group đã dùng ổn
    // định ở các chỗ khác trong source (click label = chọn radio bên trong).
    await card.click();

    return { cabinClass: chosen.cabinLabel, fareClass };
  }

  /**
   * Click nút "Chọn" đầu tiên trong danh sách — dùng click thuần qua JS (gọi
   * thẳng `el.click()`, không mô phỏng chuột theo toạ độ) vì card đầu tiên
   * thường nằm ngay dưới thanh tab ngày sticky ở đầu trang, `force:true` chỉ
   * bỏ qua check "đang visible/enabled" chứ KHÔNG bỏ qua được việc bị element
   * khác che (đã verify qua nhiều lần chạy lỗi cùng 1 kiểu, kể cả sau khi thử
   * lại nhiều lần + tăng thời gian chờ — không phải do timing).
   */
  private async clickChooseButton(index: number) {
    const chooseBtn = this.page.locator(".flights__list--item-choose-btn").nth(index);
    await chooseBtn.waitFor({ state: "visible", timeout: 60_000 });
    await chooseBtn.evaluate((el) => (el as HTMLElement).click());
  }

  /**
   * Giống `chooseFlightAndContinue()` nhưng chọn hạng vé ngẫu nhiên/theo thứ
   * tự chỉ định (xem `selectFareWithinScope()`) thay vì luôn lấy mặc định —
   * dùng cho flow tạo order 1 CHIỀU cần đa dạng hoá điều kiện test.
   */
  async chooseFlightWithRandomFareAndContinue(
    index = 0,
    fareOrdinal?: number
  ): Promise<{ cabinClass: string | null; fareClass: string | null }> {
    const drawer = new FlightFareDrawer(this.page);
    await this.clickChooseButton(index);
    await drawer.waitForOpen();

    const result = await this.selectFareWithinScope(this.page, fareOrdinal);

    await this.page.getByRole("button", { name: "Tiếp tục" }).click();
    await this.page.waitForURL(/\/booking\/flight/, { timeout: 60_000 });
    return result;
  }

  /**
   * Chọn chuyến KHỨ HỒI: click "Chọn chiều đi" (index 0 = chuyến đầu tiên
   * trong danh sách chiều đi) -> danh sách tự đổi sang hiện chuyến CHIỀU VỀ
   * (CÙNG class `.flights__list--item-choose-btn`, chỉ đổi text "Chọn chiều
   * về" — đã verify thật qua probe, KHÔNG mở drawer ở bước này) -> click
   * "Chọn chiều về" (index 0 = chuyến đầu tiên) -> drawer MỚI mở ra lúc này,
   * chứa 2 khối leg riêng (`.flights__review-drawer-body > div`, tag "Chiều
   * đi"/"Chiều về" — đã verify thật) -> random/chỉ định hạng vé RIÊNG cho
   * TỪNG leg (scope theo khối leg đó, không lẫn hạng của leg kia) -> bấm
   * **"Đặt ngay"** (KHÔNG PHẢI "Tiếp tục" — khác text so với 1 chiều, đã
   * verify qua source `confirmLabel = isOneWay ? "Tiếp tục" : "Đặt ngay"`).
   *
   * @param returnIndex Index chuyến chiều về trong danh sách MỚI hiện ra sau
   * khi chọn chiều đi — mặc định 0 (chuyến đầu tiên), độc lập với `index`
   * (chiều đi) vì đây là 2 danh sách khác nhau tại 2 thời điểm khác nhau.
   */
  async chooseRoundTripFlightsAndContinue(
    index = 0,
    returnIndex = 0,
    fareOrdinal?: number
  ): Promise<{
    outbound: { cabinClass: string | null; fareClass: string | null };
    return: { cabinClass: string | null; fareClass: string | null };
  }> {
    await this.clickChooseButton(index);
    // Đợi danh sách đổi sang hiện chuyến chiều về (không có drawer ở bước
    // này, chỉ đổi nội dung list) — chờ ngắn cho re-render ổn định.
    await this.page.waitForTimeout(1_000);

    const drawer = new FlightFareDrawer(this.page);
    await this.clickChooseButton(returnIndex);
    await drawer.waitForOpen();

    const legBlocks = this.page.locator(".flights__review-drawer-body > div");
    const legCount = await legBlocks.count();

    // legCount phải là 2 (Chiều đi + Chiều về) — nếu vì lý do gì đó chỉ có 1
    // (VD GDS combo gộp chung 1 khối fare), vẫn chọn an toàn cho leg có sẵn,
    // leg còn lại trả về null thay vì lỗi cứng.
    const outbound =
      legCount > 0 ? await this.selectFareWithinScope(legBlocks.nth(0), fareOrdinal) : { cabinClass: null, fareClass: null };
    const returnLeg =
      legCount > 1 ? await this.selectFareWithinScope(legBlocks.nth(1), fareOrdinal) : { cabinClass: null, fareClass: null };

    await this.page.getByRole("button", { name: "Đặt ngay" }).click();
    await this.page.waitForURL(/\/booking\/flight/, { timeout: 60_000 });
    return { outbound, return: returnLeg };
  }

  /**
   * Mở drawer xem chi tiết/chọn hạng vé cho chuyến tại `index` — KHÔNG bấm
   * "Tiếp tục"/"Đặt ngay" nên không điều hướng/không tạo order. Dùng để ĐỌC dữ
   * liệu (Giai đoạn 1 — chỉ thu thập thông tin). Caller tự đóng drawer qua
   * `FlightFareDrawer.closeWithoutBooking()` sau khi đọc xong.
   */
  async openFareDrawerForFlight(index: number): Promise<FlightFareDrawer> {
    const chooseBtn = this.page
      .locator(".flights__list--item-choose-btn")
      .nth(index);
    await chooseBtn.waitFor({ state: "visible", timeout: 60_000 });
    await chooseBtn.click({ force: true, timeout: 30_000 });

    const drawer = new FlightFareDrawer(this.page);
    await drawer.waitForOpen();
    return drawer;
  }
}
