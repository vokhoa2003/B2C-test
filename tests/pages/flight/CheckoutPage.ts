import { Page, Locator } from "@playwright/test";

/** Trang chọn phương thức thanh toán (/booking/flight/checkout?orderCode=...). */
export class CheckoutPage {
  readonly page: Page;
  readonly atmInternetBankingOption: Locator;
  readonly payButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.atmInternetBankingOption = page.getByText("ATM / Internet Banking");
    // "Thanh toán" cũng trùng text với 1 payment-method-row khác (VD "Ví MoMo"
    // chứa chữ "Thanh toán" lồng bên trong) -> phải exact match nút submit thật.
    this.payButton = page.getByRole("button", {
      name: "Thanh toán",
      exact: true,
    });
  }

  async goto(orderCode: string) {
    await this.page.goto(`/booking/flight/checkout?orderCode=${orderCode}`);
  }

  async waitForLoaded() {
    await this.atmInternetBankingOption.waitFor({
      state: "visible",
      timeout: 40_000,
    });
  }

  /** Chọn ATM/Internet Banking (map gateway ONEPAY-2 — thẻ nội địa) rồi bấm Thanh toán. */
  async payWithAtmInternetBanking() {
    await this.atmInternetBankingOption.scrollIntoViewIfNeeded();
    await this.atmInternetBankingOption.click();
    await this.payButton.click();
    await this.page.waitForURL(/onepay\.vn/, { timeout: 30_000 });
    await this.page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
  }
}
