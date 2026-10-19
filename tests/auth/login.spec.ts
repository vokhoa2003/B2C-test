import { test, expect } from "@playwright/test";
import { HomePage } from "../pages/HomePage";
import { LoginModal } from "../pages/LoginModal";

// Tắt tạm — bộ case này chỉ dùng để verify config/selector lúc setup, chưa
// phải case thật theo yêu cầu nghiệp vụ. Giữ lại tham khảo cách viết POM.
test.describe.skip("Đăng nhập", () => {
  test("mở modal đăng nhập từ trang chủ", async ({ page }) => {
    const home = new HomePage(page);
    const loginModal = new LoginModal(page);

    await home.goto();
    await home.openLoginModal();

    await expect(loginModal.dialog).toBeVisible();
    await expect(loginModal.emailInput).toBeVisible();
    await expect(loginModal.passwordInput).toBeVisible();
  });

  test("hiển thị lỗi bắt buộc khi submit form trống", async ({ page }) => {
    const home = new HomePage(page);
    const loginModal = new LoginModal(page);

    await home.goto();
    await home.openLoginModal();
    await loginModal.submitButton.click();

    await expect(
      loginModal.dialog.getByText("Vui lòng nhập email hoặc số điện thoại")
    ).toBeVisible();
    await expect(
      loginModal.dialog.getByText("Vui lòng nhập mật khẩu")
    ).toBeVisible();
  });

  test("hiển thị lỗi đăng nhập thất bại với tài khoản không hợp lệ", async ({
    page,
  }) => {
    const home = new HomePage(page);
    const loginModal = new LoginModal(page);

    await home.goto();
    await home.openLoginModal();
    await loginModal.login("khong-ton-tai@example.com", "sai-mat-khau-123");

    await expect(
      page.getByText("Đăng nhập thất bại, vui lòng kiểm tra lại thông tin đăng nhập!")
    ).toBeVisible();
  });

  test("chuyển sang form đăng ký từ modal đăng nhập", async ({ page }) => {
    const home = new HomePage(page);
    const loginModal = new LoginModal(page);

    await home.goto();
    await home.openLoginModal();
    await loginModal.switchToSignupLink.click();

    // Form đăng ký và đăng nhập dùng chung placeholder cho email nên không thể
    // dùng nó để phân biệt 2 form. Dùng field "Xác nhận mật khẩu" vì nó chỉ
    // tồn tại ở form đăng ký.
    await expect(page.getByPlaceholder("Xác nhận mật khẩu")).toBeVisible();
  });
});
