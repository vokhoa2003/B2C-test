import { Page, Locator } from "@playwright/test";
import { RandomDob } from "../../helpers/randomPassenger";

export type PassengerType = "ADULT" | "CHILD" | "INFANT";

export type PassengerInput = {
  /** Họ (family name) — field riêng "Họ" khi quốc tế, ghép vào 1 ô "Họ và tên" khi nội địa. */
  lastName: string;
  /** Tên đệm và tên — field riêng khi quốc tế, ghép vào 1 ô "Họ và tên" khi nội địa. */
  firstName: string;
  dob: RandomDob;
  /** Bỏ trống nếu để mặc định "Việt Nam" */
  nationality?: string;
  /** Chỉ điền nếu field CCCD/Hộ chiếu thực sự xuất hiện trên form (tuỳ hãng bay) */
  documentNumber?: string;
  documentExpiry?: { day: string; month: string; year: string };
};

export type ContactInput = {
  fullName: string;
  phone: string;
  email: string;
};

export type SubmitBookingResult = "ok" | "sold_out";

/** Trang điền thông tin hành khách + liên hệ (/booking/flight). */
export class PassengerFormPage {
  readonly page: Page;
  readonly continueToPaymentButton: Locator;
  readonly confirmBookButton: Locator;
  readonly seatUnavailableDialog: Locator;
  readonly backToResultsButton: Locator;
  /** Modal `ModalUpdatePriceFlight` — hiện khi backend verify giá lúc tạo order
   * phát hiện giá đã đổi (không phải lỗi, chỉ cần chấp nhận giá mới). */
  readonly priceChangedModal: Locator;
  /** Nút chấp nhận giá mới trong priceChangedModal — exact match để KHÔNG khớp
   * nhầm `continueToPaymentButton` (chứa cùng chữ "Tiếp tục" làm substring). */
  readonly acceptNewPriceButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.continueToPaymentButton = page.getByRole("button", {
      name: "Tiếp tục đến bước thanh toán",
    });
    this.confirmBookButton = page.getByRole("button", { name: "Đặt vé" });
    this.seatUnavailableDialog = page.getByText(
      "Hiện chỗ ngồi đang chọn không còn khả dụng"
    );
    this.backToResultsButton = page.getByRole("button", {
      name: "Quay lại danh sách chuyến bay",
    });
    this.priceChangedModal = page.getByText("Chuyến bay đã thay đổi giá");
    this.acceptNewPriceButton = page.getByRole("button", {
      name: "Tiếp tục",
      exact: true,
    });
  }

  async waitForLoaded() {
    await this.page
      .getByText("Họ và tên")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  /**
   * Label của antd Form.Item ở trang này KHÔNG gắn for/aria-label với input
   * (đã verify qua accessibility snapshot thật) -> getByLabel vô dụng. Phải scope
   * theo Row chứa text label rồi lấy input bên trong. CHỈ dùng được khi có ĐÚNG 1
   * hành khách (nhiều hành khách thì label lặp lại ở mọi khối, hasText sẽ khớp
   * nhầm khối đầu tiên luôn) — xem `fillPassenger()` dùng `name` attribute thay
   * thế để hỗ trợ nhiều hành khách.
   */
  private formRow(labelText: string): Locator {
    return this.page
      .locator(".passenger__form--row", { hasText: labelText })
      .first();
  }

  /**
   * Điền 1 hành khách tại vị trí `index` (0-based, TRÙNG thứ tự mảng
   * `passengers` thật của form — người lớn trước, rồi trẻ em, rồi em bé, theo
   * đúng thứ tự `PassengerInformation.tsx` render 3 vòng `.map()` liên tiếp).
   *
   * Dùng `name` attribute (`passengers.${index}.xxx`, react-hook-form forward
   * thẳng ra DOM) để scope CHÍNH XÁC theo từng hành khách — đã verify qua probe
   * DOM thật với 2 người lớn + 1 trẻ em, KHÔNG dùng text-scope như trước nữa vì
   * mỗi khối hành khách không có container class riêng (label lặp lại y hệt ở
   * mọi khối, chỉ `name` attribute phân biệt được).
   *
   * @param isDomestic Chuyến nội địa dùng 1 field "Họ và tên" gộp; chuyến có
   * chặng quốc tế tách riêng "Họ" + "Tên đệm và tên" (đã verify qua source thật).
   * @param type Chỉ ảnh hưởng option "Danh xưng" hiển thị (Ông/Bà cho người lớn,
   * Bé trai/Bé Gái cho trẻ em/em bé) — KHÔNG ảnh hưởng field nào khác field-set
   * bên dưới (đã verify: tên/ngày sinh/quốc tịch giống hệt nhau mọi loại hành
   * khách; CCCD/hộ chiếu nội địa CHỈ có cho người lớn, quốc tế có cho mọi loại).
   */
  async fillPassenger(
    passenger: PassengerInput,
    isDomestic: boolean = true,
    index: number = 0,
    type: PassengerType = "ADULT"
  ) {
    // Danh xưng — chọn đại option ĐẦU TIÊN hiện ra (Ông/Bé trai) cho đơn giản,
    // không random giới tính (không có yêu cầu). antd Select hỗ trợ gõ tên để
    // nhảy tới option khớp (type-ahead mặc định) — cùng cơ chế đã dùng cho
    // Quốc tịch bên dưới, giờ verify thêm qua field này.
    const genderValue = type === "ADULT" ? "Ông" : "Bé trai";
    await this.page.locator(`[name="passengers.${index}.gender"]`).click();
    await this.page.keyboard.type(genderValue, { delay: 40 });
    await this.page.keyboard.press("Enter");

    if (isDomestic) {
      const fullName = `${passenger.lastName} ${passenger.firstName}`.trim();
      await this.page.locator(`input[name="passengers.${index}.fullName"]`).fill(fullName);
    } else {
      await this.page.locator(`input[name="passengers.${index}.lastName"]`).fill(passenger.lastName);
      await this.page.locator(`input[name="passengers.${index}.firstName"]`).fill(passenger.firstName);
    }

    // DatePicker antd (day/month/year riêng, CÙNG 1 name attribute, phân biệt
    // qua placeholder) — .fill() không commit giá trị, phải gõ tuần tự rồi
    // Enter để xác nhận (Escape sẽ huỷ thao tác thay vì xác nhận).
    const dobName = `passengers.${index}.birthday`;
    await this.typeIntoDatePart(
      this.page.locator(`input[name="${dobName}"][placeholder="Ngày"]`),
      passenger.dob.day
    );
    await this.typeIntoDatePart(
      this.page.locator(`input[name="${dobName}"][placeholder="Tháng"]`),
      passenger.dob.month
    );
    await this.typeIntoDatePart(
      this.page.locator(`input[name="${dobName}"][placeholder="Năm"]`),
      passenger.dob.year
    );

    if (passenger.nationality) {
      await this.page.locator(`[name="passengers.${index}.nationality"]`).click();
      await this.page.keyboard.type(passenger.nationality, { delay: 40 });
      await this.page.keyboard.press("Enter");
    }

    // CCCD/Hộ chiếu — chỉ xuất hiện tuỳ loại hành khách + hãng bay, không fill
    // cứng. Đã verify qua source + probe DOM: nội địa CHỈ render cho NGƯỜI LỚN
    // (và chỉ khi hãng là VJ/VN — trẻ em/em bé nội địa KHÔNG có field này dù
    // hãng nào), quốc tế render cho MỌI loại hành khách. Check tồn tại trước khi
    // fill (an toàn cho cả 2 trường hợp không cần biết trước hãng gì).
    const docCodeInput = this.page.locator(
      `input[name="passengers.${index}.documentInfo.0.documentCode"]`
    );
    if ((await docCodeInput.count()) && passenger.documentNumber) {
      await docCodeInput.fill(passenger.documentNumber);
      if (passenger.documentExpiry) {
        const expiryInput = this.page.locator(
          `input[name="passengers.${index}.documentInfo.0.documentExpiry"]`
        );
        await this.typeIntoDatePart(
          expiryInput,
          `${passenger.documentExpiry.day}${passenger.documentExpiry.month}${passenger.documentExpiry.year}`
        );
      }
    }
  }

  async fillContact(contact: ContactInput) {
    await this.formRow("Le Van An")
      .locator("input")
      .first()
      .fill(contact.fullName);

    // Phone + Email nằm CHUNG 1 Row (2 Col). Input DOM order: [0]=select mã vùng
    // (readonly combobox), [1]=input phone, [2]=input email.
    const phoneEmailRow = this.formRow("Số điện thoại");
    await phoneEmailRow.locator("input").nth(1).fill(contact.phone);
    await phoneEmailRow.locator("input").nth(2).fill(contact.email);
  }

  /** Gõ tuần tự từng ký tự rồi Enter — bắt buộc với input picker/mask của antd. */
  private async typeIntoDatePart(locator: Locator, value: string) {
    await locator.click();
    await locator.pressSequentially(value, { delay: 40 });
    await locator.press("Enter");
  }

  /**
   * Bấm "Tiếp tục đến bước thanh toán" -> modal xác nhận lại thông tin -> bấm "Đặt
   * vé" -> tạo order thật. Trả về "sold_out" nếu backend báo hết chỗ (cần quay lại
   * search chọn chuyến khác — xem flow cấp cao hơn xử lý retry).
   *
   * Backend verify giá ngay lúc gọi API tạo order — đôi khi (không phải luôn)
   * phát hiện giá đã đổi và hiện `priceChangedModal` THAY VÌ tạo order thành
   * công hay báo hết chỗ. Đây KHÔNG phải lỗi — chỉ cần bấm chấp nhận giá mới
   * (`acceptNewPriceButton`), modal xác nhận thông tin sẽ MỞ LẠI (reset về bước
   * trước), cần bấm "Đặt vé" lần nữa để tạo order với giá đã verify.
   */
  async submitBooking(): Promise<SubmitBookingResult> {
    await this.continueToPaymentButton.click();
    await this.confirmBookButton.click();
    return this.waitForOrderOutcome();
  }

  private async waitForOrderOutcome(): Promise<SubmitBookingResult> {
    const outcome = await Promise.race([
      this.page
        .waitForURL(/\/checkout\?orderCode=/, { timeout: 60_000 })
        .then(() => "ok" as const),
      this.seatUnavailableDialog
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(() => "sold_out" as const),
      this.priceChangedModal
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(() => "price_changed" as const),
    ]).catch(() => "sold_out" as const);

    if (outcome === "price_changed") {
      await this.acceptNewPriceButton.click();
      await this.confirmBookButton.click();
      return this.waitForOrderOutcome();
    }

    return outcome;
  }

  /** Mã đơn hàng lấy từ URL sau khi submitBooking() trả về "ok". */
  getOrderCodeFromUrl(): string | null {
    const url = new URL(this.page.url());
    return url.searchParams.get("orderCode");
  }
}
