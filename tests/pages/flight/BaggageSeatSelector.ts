import { Page } from "@playwright/test";

/** Nhãn ghi vào report khi chuyến không hỗ trợ addon (phân biệt rõ với lỗi
 * đọc selector — verify thật qua screenshot: chuyến không hỗ trợ hiện thẳng
 * thông báo "Hiện tại chuyến bay này không hỗ trợ..." thay vì card/bản đồ). */
export const NOT_SUPPORTED_LABEL = "Không hỗ trợ";

export type BaggageSelectionResult = {
  selected: boolean;
  /** Nhãn hành lý đã chọn (VD "+15KG hành lý ký gửi"), hoặc NOT_SUPPORTED_LABEL
   * nếu chuyến không hỗ trợ mua hành lý. */
  baggageInfo: string;
};

export type SeatSelectionResult = {
  selected: boolean;
  /** Số ghế đầy đủ (hàng+cột, VD "11B"), hoặc NOT_SUPPORTED_LABEL nếu chuyến
   * không hỗ trợ chọn trước chỗ ngồi. */
  seatNumber: string;
};

/**
 * Chọn hành lý ký gửi + chỗ ngồi trên trang điền hành khách (/booking/flight),
 * TRƯỚC khi bấm "Tiếp tục đến bước thanh toán" — cả 2 đều gọi API thật lần đầu
 * tương tác (khác giá vé cơ bản vốn lấy từ cache lúc search). Cả 2 đều KHÔNG
 * bắt buộc (không có validator nào chặn submit nếu bỏ qua) nên mọi thao tác ở
 * đây đều best-effort (catch lỗi, bỏ qua nếu addon không khả dụng cho booking
 * này — VD hệ thống 1G/Galileo hoặc bay trong 24h ẩn hẳn phần chọn chỗ).
 *
 * QUAN TRỌNG: cả hành lý lẫn chỗ ngồi đều là thao tác RIÊNG CHO TỪNG HÀNH
 * KHÁCH × TỪNG CHẶNG — VD khứ hồi 3 người = 6 lượt chọn (3 người × 2 chặng).
 *
 * Nguồn thật: OtherInformation.tsx (khối hành lý/chỗ ngồi — mỗi hành khách ×
 * mỗi chặng render 1 "purchase box" riêng, class `.passenger__form--baggage-purchase-box`),
 * ModalAddBagge + SelectBaggage.tsx (modal "xem thêm gói" khi >2-3 lựa chọn,
 * CHƯA xử lý ở đây), ModalSeatMap.tsx (sidebar chọn hành khách — class CSS
 * Module `passengerCard`; chuyển chặng qua Segmented "Chiều đi"/"Chiều về"
 * khi >1 chặng — class CSS Module, dùng text để định vị cho chắc).
 */
export class BaggageSeatSelector {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Chọn gói hành lý RẺ NHẤT hiển thị trực tiếp trên trang CHO TỪNG "purchase
   * box" (không cần mở modal "Xem thêm gói hành lý" — modal đó chỉ xuất hiện
   * khi >2-3 lựa chọn, bỏ qua case đó cho đơn giản). Mỗi hành khách × mỗi
   * chặng có 1 box riêng (`.passenger__form--baggage-purchase-box`) — xử lý
   * TẤT CẢ box tìm thấy trên trang (không giả định thứ tự/số lượng theo
   * passengerCount × legCount, vì chưa verify được box sắp xếp theo
   * passenger-major hay leg-major — cứ chọn hết mọi box có sẵn là đủ đúng ý
   * nghiệp vụ "mỗi người mỗi chặng 1 lượt chọn hành lý").
   *
   * Đã verify thật (probe DOM nhiều lần — 1 chặng, nhiều hành khách): card
   * hành lý CHỈ render sau khi khu vực "Hành lý" được cuộn vào viewport — có
   * vẻ API load data trigger lazy theo visibility (IntersectionObserver),
   * không phải useEffect chạy ngay khi mount. `isVisible({timeout})` KHÔNG
   * thực sự poll chờ phần tử xuất hiện — phải cuộn tới tiêu đề trước, rồi
   * dùng `waitFor` (poll thật).
   */
  async selectCheapestInlineBaggage(timeout = 15_000): Promise<BaggageSelectionResult[]> {
    const baggageTitle = this.page.getByText("Hành lý").first();
    await baggageTitle.scrollIntoViewIfNeeded().catch(() => {});

    const boxes = this.page.locator(".passenger__form--baggage-purchase-box");
    const appeared = await boxes
      .first()
      .waitFor({ state: "visible", timeout })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return [];

    const boxCount = await boxes.count();
    const results: BaggageSelectionResult[] = [];
    for (let b = 0; b < boxCount; b++) {
      const card = boxes.nth(b).locator(".passenger__form--baggage-purchase-card").first();
      const cardVisible = await card.isVisible().catch(() => false);
      if (!cardVisible) {
        results.push({ selected: false, baggageInfo: NOT_SUPPORTED_LABEL });
        continue;
      }
      const labelText =
        (await card
          .locator(".passenger__form--baggage-purchase-card-title")
          .textContent()
          .catch(() => "")) ?? "";
      await card.click();
      results.push({ selected: true, baggageInfo: labelText.trim() || NOT_SUPPORTED_LABEL });
    }
    return results;
  }

  /**
   * Mở modal chọn chỗ ngồi (nút "Chọn trước chỗ ngồi") 1 LẦN, rồi chọn Ô GHẾ
   * ĐẦU TIÊN còn trống CHO TỪNG CHẶNG × TỪNG HÀNH KHÁCH (chuyển chặng qua
   * Segmented "Chiều đi"/"Chiều về" NẾU `legCount > 1`, chuyển hành khách qua
   * sidebar `[class*="passengerCard"]` trước mỗi lượt), cuối cùng bấm
   * "Áp dụng" 1 LẦN DUY NHẤT (modal áp dụng tất cả lựa chọn đã tích luỹ, không
   * phải áp dụng riêng từng lượt).
   *
   * Ô ghế đã bị hành khách khác chọn tự động mất `role="button"` (disabled,
   * "takenByOtherPassenger" theo source) nên locator "ô khả dụng đầu tiên" tự
   * nhiên bỏ qua ghế đã bị chiếm — không cần logic né trùng ghế thủ công.
   *
   * Cấu trúc bản đồ ghế (verify qua probe DOM thật): mỗi hàng là 1 khối
   * `te-row te-row-center...` chứa [nhóm 3 ghế trái] + [cột số hàng
   * `[class*="rowNum"]`] + [nhóm 3 ghế phải] — SỐ HÀNG nằm ở cột SIBLING,
   * KHÔNG nằm trong chính ô ghế (ô ghế chỉ có chữ cột, VD "B"). Phải lấy
   * ancestor khối hàng rồi mới tìm `[class*="rowNum"]` trong đó để ghép
   * thành số ghế đầy đủ (VD "11B").
   *
   * @param legCount 1 (mặc định, 1 chiều) hoặc 2 (khứ hồi). Bộ chuyển chặng
   * (antd Segmented) CHƯA verify live qua class cụ thể — định vị qua text
   * "Chiều đi"/"Chiều về" cho an toàn (ổn định hơn class CSS Module hash).
   */
  async selectFirstAvailableSeat(
    passengerCount: number,
    legCount: 1 | 2 = 1,
    timeout = 10_000
  ): Promise<SeatSelectionResult[][]> {
    const notSupportedForAllLegs = (): SeatSelectionResult[][] =>
      Array.from({ length: legCount }, () =>
        Array.from({ length: passengerCount }, () => ({
          selected: false,
          seatNumber: NOT_SUPPORTED_LABEL,
        }))
      );

    const trigger = this.page.getByText("Chọn trước chỗ ngồi").first();
    const triggerVisible = await trigger.isVisible({ timeout }).catch(() => false);
    if (!triggerVisible) return notSupportedForAllLegs();

    await trigger.click();

    const modalTitle = this.page.getByText("Chọn chỗ ngồi").first();
    await modalTitle.waitFor({ state: "visible", timeout: 15_000 });

    // `.mapArea`/`passengerCard`/`rowNum` là CSS Module (hash lúc runtime, VD
    // "ModalSeatMap_mapArea__xxx") — phải dùng partial-match class.
    const seatCellLocator = this.page.locator('[class*="mapArea"] div[role="button"]');
    const passengerCards = this.page.locator('[class*="passengerCard"]');

    const legResults: SeatSelectionResult[][] = [];

    for (let leg = 0; leg < legCount; leg++) {
      if (legCount > 1) {
        // Bộ chuyển chặng: định vị qua text thật "Chiều đi"/"Chiều về" (ổn
        // định hơn class CSS Module chưa verify được tên chính xác). Verify
        // thật: click thường bị chặn bởi `ModalSeatMap_segmentWrap__xxx`/
        // skeleton loading đè lên (đổi chặng có vẻ trigger load lại bản đồ
        // ghế) — dùng click JS thuần để né, cùng pattern đã dùng ở các chỗ
        // khác trong codebase test này.
        const legLabel = leg === 0 ? "Chiều đi" : "Chiều về";
        const legTab = this.page.getByText(legLabel, { exact: false }).first();
        const legTabVisible = await legTab.isVisible().catch(() => false);
        if (legTabVisible) {
          await legTab.evaluate((el) => (el as HTMLElement).click());
          await this.page.waitForTimeout(500);
        }
      }

      const seatMapAvailable = await seatCellLocator
        .first()
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

      if (!seatMapAvailable) {
        legResults.push(
          Array.from({ length: passengerCount }, () => ({
            selected: false,
            seatNumber: NOT_SUPPORTED_LABEL,
          }))
        );
        continue;
      }

      const passengerCardCount = await passengerCards.count();
      const paxResults: SeatSelectionResult[] = [];
      for (let p = 0; p < passengerCount; p++) {
        if (passengerCardCount > 1 && p < passengerCardCount) {
          await passengerCards.nth(p).click();
          await this.page.waitForTimeout(200);
        }

        const seatCell = seatCellLocator.first();
        const seatAvailableForThisPax = await seatCell.isVisible().catch(() => false);
        if (!seatAvailableForThisPax) {
          paxResults.push({ selected: false, seatNumber: NOT_SUPPORTED_LABEL });
          continue;
        }

        const columnLetter = (await seatCell.locator("span").first().textContent().catch(() => "")) ?? "";
        const rowBlock = seatCell.locator(
          "xpath=ancestor::div[contains(@class,'te-row-center')][1]"
        );
        const rowNumText =
          (await rowBlock.locator('[class*="rowNum"]').first().textContent().catch(() => "")) ?? "";
        const row = rowNumText.trim();
        const col = columnLetter.trim();
        const seatNumber = row && col ? `${row}${col}` : NOT_SUPPORTED_LABEL;

        const availableCountBefore = await seatCellLocator.count();
        await seatCell.click();
        // Đợi SỐ LƯỢNG ô còn khả dụng THỰC SỰ GIẢM trước khi đọc "ô đầu tiên"
        // cho hành khách tiếp theo — wait cố định (đã thử 250ms) KHÔNG đủ, vẫn
        // verify thấy trùng ghế giữa 2 người liên tiếp (nghi do có gọi API giữ
        // chỗ phía sau, độ trễ không cố định). Poll tối đa 3s thay vì đoán 1
        // con số cố định.
        for (let wait = 0; wait < 20; wait++) {
          const countNow = await seatCellLocator.count();
          if (countNow < availableCountBefore) break;
          await this.page.waitForTimeout(150);
        }
        paxResults.push({ selected: !!(row && col), seatNumber });
      }
      legResults.push(paxResults);
    }

    // Luôn bấm "Áp dụng" 1 LẦN sau khi đã chọn xong cho TẤT CẢ chặng × hành
    // khách — an toàn kể cả khi không chọn được gì, tránh để modal che mất
    // form phía sau làm hỏng các bước tiếp theo.
    await this.page.getByRole("button", { name: "Áp dụng" }).click().catch(() => {});
    return legResults;
  }

  /**
   * Chọn Check-in Online — KHÁC hành lý/ghế ở chỗ đây là 1 toggle GLOBAL DUY
   * NHẤT cho cả booking (form field `isCheckin`, không phải mảng theo từng
   * hành khách/chặng) — "chỉ 1 lần chọn là đủ" đúng như plan mô tả. Nút bấm
   * đổi text "Chọn" ↔ "Bỏ chọn" (`common.select`/`common.unselect`) tuỳ trạng
   * thái hiện tại — đã verify qua source `OtherInformation.tsx`. Addon này
   * CÓ THỂ không hiện trên booking (hidden khi `!canCheckinOnline || is24H`)
   * — trả `false` nếu không tìm thấy, không coi là lỗi.
   */
  async selectCheckinOnline(timeout = 10_000): Promise<boolean> {
    const row = this.page.locator(".passenger__form--addon-list-item", {
      hasText: "Check-in Online",
    });
    const rowVisible = await row.isVisible({ timeout }).catch(() => false);
    if (!rowVisible) return false;

    const button = row.getByRole("button", { name: "Chọn", exact: true });
    const buttonVisible = await button.isVisible().catch(() => false);
    if (!buttonVisible) return false; // đã ở trạng thái "Bỏ chọn" sẵn, hoặc không có nút

    await button.click();
    return true;
  }
}
