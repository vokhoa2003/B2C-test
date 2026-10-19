import { test, expect } from "@playwright/test";
import { HomePage } from "../pages/HomePage";

// Tắt tạm — bộ case này chỉ dùng để verify config/selector lúc setup, chưa
// phải case thật theo yêu cầu nghiệp vụ. Giữ lại tham khảo cách viết POM.
test.describe.skip("Trang chủ", () => {
  test("hiển thị đầy đủ các thành phần chính", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    await expect(page).toHaveURL(/\/vi\/?$/);
    await expect(page).toHaveTitle(/Đặt Tour Du Lịch, Vé Máy Bay/);

    await expect(home.searchTablist).toBeVisible();
    await expect(home.loginButton).toBeVisible();
    await expect(home.registerButton).toBeVisible();
  });

  test("mặc định chọn tab Vé máy bay", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    await expect(home.tab("flights")).toHaveAttribute("aria-selected", "true");
  });

  test.describe("Chuyển tab tìm kiếm", () => {
    const tabs = [
      { key: "flights", label: "Vé máy bay" },
      { key: "hotels", label: "Khách sạn" },
      { key: "tours", label: "Tour" },
      { key: "esim", label: "eSIM" },
      { key: "visa", label: "Visa" },
    ] as const;

    for (const { key, label } of tabs) {
      test(`chọn tab ${label} thì panel tương ứng được active`, async ({
        page,
      }) => {
        const home = new HomePage(page);
        await home.goto();

        await home.selectTab(key);
        await expect(home.tab(key)).toHaveAttribute("aria-selected", "true");
      });
    }
  });
});
