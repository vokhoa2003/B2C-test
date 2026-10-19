import { test, expect } from "@playwright/test";

const pages = [
  { path: "/flights", titleRegex: /Vé Máy Bay/ },
  { path: "/hotels", titleRegex: /Khách Sạn/ },
  { path: "/tours", titleRegex: /Tour Du Lịch/ },
  { path: "/esim-du-lich", titleRegex: /eSIM/ },
  { path: "/dich-vu-visa", titleRegex: /Visa/ },
];

// Tắt tạm — bộ case này chỉ dùng để verify config/selector lúc setup, chưa
// phải case thật theo yêu cầu nghiệp vụ. Giữ lại tham khảo cách viết POM.
test.describe.skip("Điều hướng các trang chính", () => {
  for (const { path, titleRegex } of pages) {
    test(`trang ${path} tải thành công`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `GET ${path}`).toBeLessThan(400);
      await expect(page).toHaveTitle(titleRegex);
    });
  }

  test("trang /login hiển thị form đăng nhập", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBeLessThan(400);
    await expect(
      page.getByPlaceholder("Email hoặc số điện thoại")
    ).toBeVisible();
    await expect(page.getByPlaceholder("Mật khẩu")).toBeVisible();
  });
});
