import { Page } from "@playwright/test";
import { MetasearchBody, MetasearchResponse } from "../../helpers/metasearchClient";

/**
 * Trang tool metasearch cho đối tác: {META_API_URL}/static/tools/metasearch/
 * (source: traveleasy-cms public/tools/metasearch/index.html + app.js — ID phần tử lấy từ đó).
 *
 * Dùng ở chế độ review: thao tác y như người dùng (đăng nhập ở panel "Server & Auth", điền
 * điều kiện, bấm Search) để người review nhìn thấy đúng danh sách meta trả ra, đồng thời bắt
 * response `/v1/flights/metasearch` của chính lượt search đó làm dữ liệu so sánh.
 */
export class MetasearchToolPage {
  constructor(private page: Page, private apiBaseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.apiBaseUrl}/static/tools/metasearch/`, { timeout: 120_000 });
  }

  /** Token chỉ giữ trong bộ nhớ của trang → mỗi tab mới phải đăng nhập lại (danh sách sân bay có cache localStorage). */
  async login(credentials: { clientId: string; username: string; password: string }) {
    const p = this.page;
    // Panel cấu hình mở sẵn khi chưa đăng nhập; trên màn hẹp sidebar là drawer.
    if (!(await p.locator("#api-base-url").isVisible())) await p.locator("#btn-open-sidebar").click();
    await p.locator("#api-base-url").fill(this.apiBaseUrl);
    await p.locator("#client-id").fill(credentials.clientId);
    await p.locator("#username").fill(credentials.username);
    await p.locator("#password").fill(credentials.password);
    await p.locator("#btn-login").click();
    await p.locator("#auth-status").filter({ hasNotText: "Not authenticated" }).waitFor({ timeout: 60_000 });
    // Cần danh sách sân bay để trang tự suy DOMESTIC/INTERNATIONAL. Đăng nhập xong trang tự thu gọn
    // panel cấu hình → dòng trạng thái bị ẩn, nên chỉ chờ "attached" (không chờ visible).
    // "not loaded"/"loading..." là trạng thái chưa xong; xong là "N loaded" hoặc "N cached".
    await p
      .locator("#airport-status")
      .filter({ hasText: /\d+ (loaded|cached)/ })
      .waitFor({ state: "attached", timeout: 120_000 });
  }

  private async setAirport(field: "from" | "to", code: string) {
    const input = this.page.locator(`#${field}-input`);
    await input.click();
    await input.fill(code);
    // Blur với đúng 3 chữ cái → trang tự chọn mã đó (handler blur trong app.js).
    await input.evaluate((el) => (el as HTMLInputElement).blur());
    await this.page.waitForTimeout(300);
  }

  private async setPax(type: "adt" | "chd" | "inf", target: number) {
    const row = this.page.locator(`[data-pax="${type}"]`);
    for (let guard = 0; guard < 10; guard++) {
      const current = Number((await row.locator("[data-value]").textContent()) || 0);
      if (current === target) return;
      await row.locator(`[data-step="${current < target ? 1 : -1}"]`).click();
    }
  }

  /** Điền đúng body sẽ gửi đi, bấm Search và trả về response metasearch của chính lượt đó. */
  async searchAndCapture(body: MetasearchBody, timeout: number): Promise<{ status: number; ms: number; data: MetasearchResponse }> {
    const p = this.page;
    const [outbound, inbound] = body.flights;

    await p.locator(`[data-itinerary="${body.itinerary}"]`).click();
    await this.setAirport("from", outbound.startPoint);
    await this.setAirport("to", outbound.endPoint);
    // flatpickr gắn instance vào input gốc; khứ hồi là range mode [đi, về].
    await p.evaluate(
      (dates) => (document.getElementById("date-input") as any)._flatpickr.setDate(dates, true),
      inbound ? [outbound.departDate, inbound.departDate] : [outbound.departDate]
    );
    // Người lớn trước (em bé <= người lớn, tổng NL + TE <= 9).
    await this.setPax("adt", body.adt);
    await this.setPax("chd", body.chd);
    await this.setPax("inf", body.inf);
    await p.locator("#currency").selectOption(body.currency);
    await p.locator("#language").selectOption(body.language);
    await p.locator("#view-mode").selectOption(body.viewMode);

    const t0 = Date.now();
    const responsePromise = p.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/v1/flights/metasearch"),
      { timeout }
    );
    await p.locator("#btn-search").click();
    const res = await responsePromise;

    // Điền form tự động mà sai (sân bay/ngày/số khách) thì 2 bên không còn cùng điều kiện → báo lỗi.
    const sent = res.request().postDataJSON() as Partial<MetasearchBody>;
    const pick = (b: Partial<MetasearchBody>) =>
      JSON.stringify([b.adt, b.chd, b.inf, b.itinerary, b.flightType, b.flights?.map((f) => [f.startPoint, f.endPoint, f.departDate])]);
    if (pick(sent) !== pick(body)) {
      throw new Error(`Trang tool gửi sai điều kiện: ${pick(sent)} ≠ mong đợi ${pick(body)}`);
    }

    const data = (await res.json().catch(() => ({}))) as MetasearchResponse;
    return { status: res.status(), ms: Date.now() - t0, data };
  }
}
