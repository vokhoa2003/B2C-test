import { Page, Locator } from "@playwright/test";

export class LoginModal {
  readonly page: Page;
  readonly dialog: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly forgotPasswordLink: Locator;
  readonly switchToSignupLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole("dialog");
    this.emailInput = this.dialog.getByPlaceholder("Email hoặc số điện thoại");
    this.passwordInput = this.dialog.getByPlaceholder("Mật khẩu");
    this.submitButton = this.dialog.getByRole("button", { name: "Tiếp tục" });
    this.forgotPasswordLink = this.dialog.getByRole("button", {
      name: "Quên mật khẩu?",
    });
    // Lưu ý: đây là <a> không có href (chỉ dùng onClick) nên không có role "link"
    // trong accessibility tree -> phải trỏ theo class thay vì getByRole.
    this.switchToSignupLink = this.dialog.locator(
      ".form-login--noaccount a"
    );
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
