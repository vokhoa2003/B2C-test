import { Page, Locator, expect } from "@playwright/test";

export type SearchTab = "flights" | "hotels" | "tours" | "esim" | "visa";

const TAB_LABEL: Record<SearchTab, string> = {
  flights: "Vé máy bay",
  hotels: "Khách sạn",
  tours: "Tour",
  esim: "eSIM",
  visa: "Visa",
};

export class HomePage {
  readonly page: Page;
  readonly searchTablist: Locator;
  readonly loginButton: Locator;
  readonly registerButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchTablist = page.getByRole("tablist", {
      name: "Tìm theo điểm đến, hoạt động",
    });
    this.loginButton = page.getByRole("button", { name: "Đăng nhập" }).first();
    this.registerButton = page.getByRole("button", { name: "Đăng ký" }).first();
  }

  async goto() {
    await this.page.goto("/");
  }

  tab(name: SearchTab): Locator {
    return this.searchTablist.getByRole("tab", {
      name: TAB_LABEL[name],
      exact: true,
    });
  }

  async selectTab(name: SearchTab) {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute("aria-selected", "true");
  }

  async openLoginModal() {
    await this.loginButton.click();
  }

  async openRegisterModal() {
    await this.registerButton.click();
  }
}
