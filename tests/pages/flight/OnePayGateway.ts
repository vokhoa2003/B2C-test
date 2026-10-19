import { Page, Locator } from "@playwright/test";

export type TestCard = {
  number: string;
  issueDateDigits: string; // VD "0113" cho 01/13 (MM/YY)
  cardHolderName: string;
};

/** Thẻ test chuẩn OnePay sandbox (Vietcombank domestic ATM). */
export const ONEPAY_TEST_CARD: TestCard = {
  number: "9704360000000000002",
  issueDateDigits: "0113",
  cardHolderName: "NGUYEN VAN A",
};

export const ONEPAY_TEST_OTP = "123456";

/**
 * Trang cổng OnePay (domain khác — mtf.onepay.vn). Lưu ý: logo ngân hàng là
 * <img src=".../N_logo_full.svg"> không có text/alt nào trong DOM (đã verify qua
 * HTML thật), nên không thể chọn theo tên — phải chọn theo VỊ TRÍ. Vietcombank
 * luôn là ô đầu tiên (a.bank-list-item đầu tiên) trong mọi lần quan sát.
 */
export class OnePayGateway {
  readonly page: Page;
  readonly firstBankTile: Locator;
  readonly cardNumberInput: Locator;
  readonly issueDateInput: Locator;
  readonly cardNameInput: Locator;
  readonly termsCheckbox: Locator;
  readonly confirmPaymentButton: Locator;
  readonly otpInput: Locator;
  readonly verifyButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstBankTile = page.locator("a.bank-list-item").first();
    this.cardNumberInput = page.getByPlaceholder(/9704/);
    this.issueDateInput = page.getByPlaceholder(/12\/18/);
    this.cardNameInput = page.getByPlaceholder(/Nhập tên chủ thẻ/);
    this.termsCheckbox = page.getByRole("checkbox");
    this.confirmPaymentButton = page.getByRole("button", {
      name: "Xác nhận thanh toán",
    });
    // Trang OTP không gắn tên cho input -> đây là input duy nhất trên trang đó.
    this.otpInput = page.locator("input").first();
    this.verifyButton = page.getByRole("button", { name: "Xác thực giao dịch" });
  }

  /** Bấm ngân hàng đầu tiên trong lưới (Vietcombank) nếu màn chọn ngân hàng xuất hiện. */
  async selectFirstBankIfShown() {
    const appeared = await this.firstBankTile
      .waitFor({ state: "visible", timeout: 40_000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await this.firstBankTile.click();
      await this.page.waitForTimeout(1000);
    }
    return appeared;
  }

  async fillCard(card: TestCard = ONEPAY_TEST_CARD) {
    await this.cardNumberInput.waitFor({ state: "visible", timeout: 30_000 });
    await this.cardNumberInput.click();
    await this.cardNumberInput.pressSequentially(card.number, { delay: 20 });

    await this.issueDateInput.click();
    await this.issueDateInput.pressSequentially(card.issueDateDigits, {
      delay: 40,
    });

    await this.cardNameInput.click();
    await this.cardNameInput.pressSequentially(card.cardHolderName, {
      delay: 20,
    });
  }

  async confirmPayment() {
    // Input checkbox thật bị 1 <span class="checkmark"> (custom CSS) che mất.
    await this.termsCheckbox.click({ force: true });
    await this.confirmPaymentButton.click();
    await this.page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
  }

  /**
   * Nhập OTP, bấm "Xác thực giao dịch", rồi đợi THẬT SỰ tới khi OnePay xử lý
   * xong và redirect về trang kết quả bên mình (URL chứa vpc_TxnResponseCode).
   * Không dùng waitForLoadState("load") ở đây vì OnePay có thể qua 1 bước xử lý
   * trung gian trước khi JS-redirect về site mình — "load" sẽ resolve sớm ở
   * bước trung gian đó, không phải đích cuối, khiến page.url() đọc được sau đó
   * chưa phải URL kết quả thật.
   */
  async enterOtpAndVerify(otp: string = ONEPAY_TEST_OTP, timeout = 60_000) {
    await this.otpInput.waitFor({ state: "visible", timeout: 15_000 });
    await this.otpInput.click();
    await this.otpInput.pressSequentially(otp, { delay: 40 });
    await this.verifyButton.click();

    await this.page.waitForURL(
      (url) => url.searchParams.has("vpc_TxnResponseCode"),
      { timeout }
    );
  }
}
