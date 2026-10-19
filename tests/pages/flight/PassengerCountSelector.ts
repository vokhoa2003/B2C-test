import { Page, Locator } from "@playwright/test";

/**
 * Popover chọn số lượng hành khách ở form search chuyến bay (Người lớn/Trẻ
 * em/Em bé, stepper +/-). Đã verify qua HTML thật: nút +/- là button KHÔNG có
 * tên accessible, nhưng icon bên trong có role="img" aria-label="plus"/"minus".
 * Ô hiển thị số là role="spinbutton" với aria-valuenow (đáng tin hơn đọc text).
 */
export class PassengerCountSelector {
  readonly page: Page;
  /** Trigger hiện tại dạng text "N Người lớn, N Trẻ em, N Em bé" trên form search. */
  readonly trigger: Locator;

  constructor(page: Page) {
    this.page = page;
    // Trước dùng getByText(regex) bị strict-mode violation: text nối chuỗi của
    // CẢ popover đã mở (Số hành khách + Người lớn + Trẻ em + Em bé...) cũng
    // khớp cùng pattern -> khớp trùng 2 phần tử. Scope theo class thật của
    // trigger (xác nhận qua source SelectPeople.tsx) để tránh nhầm.
    this.trigger = page.locator(".home__searching--select-people").first();
  }

  /**
   * `.isVisible()` đọc tức thời có thể trả về false NHẦM trong lúc popover
   * đang chạy CSS transition (fade/zoom) của antd dù nó vẫn đang mở — đã verify
   * bug này lặp lại 2 lần với cách kiểm tra tức thời: cứ hễ "thấy đóng" là click
   * trigger để mở lại, nhưng nếu thực ra nó vẫn đang mở (chỉ đang transition)
   * thì click đó sẽ TOGGLE nó đóng thật. Nên chờ một khoảng ngắn xem popover có
   * tự hiện lại không trước khi kết luận là đã đóng thật sự.
   */
  private async isReallyClosed(timeout = 1500): Promise<boolean> {
    const panel = this.page.locator(".flights__formsearch--passengers");
    try {
      await panel.waitFor({ state: "visible", timeout });
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Popover này có thể ĐÃ TỰ MỞ SẴN do UX auto-advance (đóng date picker xong
   * tự mở popover số khách — xem SelectDateFromTo.tsx `onClose={() =>
   * refSelectPeople.current?.open()}`). Nếu gọi .click() vào trigger trong khi
   * popover đã mở, antd sẽ TOGGLE ĐÓNG LẠI thay vì mở — luôn kiểm tra trạng
   * thái hiện tại trước, chỉ click khi thực sự đang đóng.
   */
  async open() {
    if (await this.isReallyClosed()) {
      await this.trigger.click();
      await this.page
        .locator(".flights__formsearch--passengers")
        .waitFor({ state: "visible", timeout: 10_000 });
    }
  }

  private row(labelText: "Người lớn" | "Trẻ em" | "Em bé"): Locator {
    return this.page.locator(".flights__formsearch--passengers .te-row", {
      hasText: labelText,
    }).first();
  }

  private async getCount(labelText: "Người lớn" | "Trẻ em" | "Em bé"): Promise<number> {
    const value = await this.row(labelText)
      .getByRole("spinbutton")
      .getAttribute("aria-valuenow");
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Popover đôi khi tự đóng GIỮA CHỪNG một cách không nhất quán — đã verify
   * qua nhiều lần chạy thật: lần đóng sau khi set xong cả 3 dòng, lần khác đóng
   * ngay khi đang set dòng thứ 2 (chưa kịp click gì ở dòng đó). Không gắn với
   * 1 hành động cụ thể nào (không phải do scroll hay do click sai chỗ) nên
   * thay vì cố loại trừ nguyên nhân, tự phục hồi: mỗi vòng lặp kiểm tra popover
   * còn mở không (dùng isReallyClosed để tránh nhầm với transition), nếu đã
   * đóng thật thì mở lại trước khi đọc/set tiếp.
   */
  private async ensureOpen() {
    if (await this.isReallyClosed()) {
      await this.trigger.click();
      await this.page
        .locator(".flights__formsearch--passengers")
        .waitFor({ state: "visible", timeout: 10_000 });
    }
  }

  private async setCount(
    labelText: "Người lớn" | "Trẻ em" | "Em bé",
    target: number
  ) {
    const row = this.row(labelText);
    // Click vào <button> CHA chứ không phải <span role="img"> icon bên trong —
    // click thẳng vào icon từng bị lệch toạ độ, trúng nhầm nội dung nền phía
    // sau popover, vô tình kích hoạt "click ra ngoài" khiến popover tự đóng.
    const plusBtn = row.getByRole("img", { name: "plus" }).locator("xpath=ancestor::button[1]");
    const minusBtn = row.getByRole("img", { name: "minus" }).locator("xpath=ancestor::button[1]");

    // An toàn nếu plus/minus bị disabled do chạm max/min (0) — chờ ngắn rồi dừng.
    for (let i = 0; i < 20; i++) {
      await this.ensureOpen();
      const current = await this.getCount(labelText);
      if (current === target) return;
      const btn = current < target ? plusBtn : minusBtn;
      const isDisabled = await btn.isDisabled().catch(() => false);
      if (isDisabled) return; // đã chạm giới hạn (VD max 9 - adt - inf)
      // KHÔNG dùng locator.click() (kể cả force:true) — Playwright tự
      // scrollIntoViewIfNeeded trước khi click, và việc SCROLL TRANG khiến antd
      // Popover tự đóng (đã verify: lỗi luôn xảy ra ngay sau click đầu tiên dù
      // button hợp lệ). Click thuần qua JS (không mô phỏng chuột, không scroll).
      await btn.evaluate((el) => (el as HTMLElement).click());
      await this.page.waitForTimeout(100);
    }
  }

  /**
   * Set số lượng hành khách. Thứ tự set QUAN TRỌNG: set adults trước (vì
   * max của children/infants phụ thuộc adults: `max = 9 - adt - inf`), rồi
   * infants, rồi children — và số infants không được vượt số adults (ràng buộc
   * nghiệp vụ hàng không chuẩn, component tự giới hạn qua `max`).
   */
  async setCounts({
    adults,
    children = 0,
    infants = 0,
  }: {
    adults: number;
    children?: number;
    infants?: number;
  }) {
    await this.setCount("Người lớn", adults);
    await this.setCount("Em bé", Math.min(infants, adults));
    await this.setCount("Trẻ em", children);
  }

  /**
   * Trong vài trường hợp popover tự đóng ngay sau khi set xong số lượng
   * (verify qua screenshot thực tế: giá trị đã đúng nhưng panel biến mất) —
   * khả năng do click JS thuần (.evaluate) không tạo focus/mousedown thật
   * như click chuột thật, khiến antd coi đây như một tương tác "ra ngoài".
   * Giá trị đã set đúng nên chỉ cần bấm "Xong" nếu popover còn mở.
   */
  async close() {
    if (await this.isReallyClosed()) return;
    await this.page.getByRole("button", { name: "Xong" }).click();
  }
}
