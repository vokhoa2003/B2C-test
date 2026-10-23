import { Page, Response } from "@playwright/test";
import { FareItem } from "../../helpers/metasearchCompare";

export type CapturedSearch = {
  requestBody: Record<string, unknown> | null;
  status: number;
  fareData: FareItem[];
};

export type WebSearchCaptureResult = {
  url: string;
  ms: number;
  timedOut: boolean;
  /** Lý do không lấy được dữ liệu (timeout / web không gọi search) — rỗng nếu OK. */
  error: string;
  /** Số lần phải tải lại trang vì web không bắn request search. */
  reloads: number;
  searches: CapturedSearch[];
  /** Số liệu đọc từ sidebar bộ lọc của chính trang web (để đối chiếu UI với data). */
  uiStops: string[];
  uiAirlines: string[];
  uiCardCount: number;
};

/**
 * Mở trang kết quả /flights/result của web với điều kiện search cho trước và
 * bắt TẤT CẢ response `/flights/search/` (web gọi 1 request riêng cho từng
 * hãng/system: VN, VJ, VU, _9G, GALILEO_NDC...). Không đếm card trên DOM làm số
 * liệu chính vì danh sách chỉ render 1 trang (~15 card) — đã verify thật.
 *
 * Đi thẳng URL kết quả (giống URL mà form ở trang chủ submit ra, đã verify:
 * f1 = điểm đi, t1 = điểm đến, df1 = ngày đi, dt1 = ngày về) để tránh phụ thuộc
 * date picker/autocomplete.
 */
export class FlightSearchApiCapture {
  constructor(private page: Page) {}

  /**
   * @param noSearchReloadMs Sau bao lâu kể từ lúc tải trang mà web vẫn CHƯA bắn request
   * `/flights/search/` nào thì tải lại trang (đã gặp thật: trang kẹt lúc khởi tạo, không
   * search, lần mở sau lại bình thường). Hết `maxReloads` lần vẫn không search thì dừng
   * luôn thay vì chờ tới `timeout`.
   */
  async searchAndCapture(
    resultUrl: string,
    timeout: number,
    { noSearchReloadMs = 60_000, maxReloads = 1 } = {}
  ): Promise<WebSearchCaptureResult> {
    const searches: CapturedSearch[] = [];
    const pending = new Set<Promise<void>>();
    let inFlight = 0;
    let requestsStarted = 0;
    let lastActivity = Date.now();

    const isSearch = (url: string) => /\/flights\/search\/?(\?|$)/.test(url);
    this.page.on("request", (req) => {
      if (req.method() === "POST" && isSearch(req.url())) {
        inFlight++;
        requestsStarted++;
        lastActivity = Date.now();
      }
    });
    const onDone = () => {
      inFlight = Math.max(0, inFlight - 1);
      lastActivity = Date.now();
    };
    this.page.on("requestfailed", (req) => {
      if (req.method() === "POST" && isSearch(req.url())) onDone();
    });
    this.page.on("response", (res: Response) => {
      if (res.request().method() !== "POST" || !isSearch(res.url())) return;
      const task = (async () => {
        let requestBody: Record<string, unknown> | null = null;
        try {
          requestBody = JSON.parse(res.request().postData() ?? "null");
        } catch {
          // Body không phải JSON: vẫn giữ response.
        }
        const json = await res.json().catch(() => ({}));
        searches.push({ requestBody, status: res.status(), fareData: Array.isArray(json?.fareData) ? json.fareData : [] });
        onDone();
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    });

    const t0 = Date.now();
    await this.page.goto(resultUrl, { timeout: 120_000 });
    let loadedAt = Date.now();
    let reloads = 0;
    let error = "";

    // Xong khi: đã có ít nhất 1 request search, không còn request nào đang chạy,
    // progress bar đã tắt, và yên lặng thêm 8s (phòng web bắn thêm request trễ).
    const progressBar = this.page.locator(".flights__list--progress");
    let timedOut = true;
    while (Date.now() - t0 < timeout) {
      await this.page.waitForTimeout(1_000);
      if (requestsStarted === 0 && Date.now() - loadedAt > noSearchReloadMs) {
        if (reloads >= maxReloads) {
          error = `web không gọi /flights/search/ sau ${reloads + 1} lần tải trang (${Math.round(noSearchReloadMs / 1000)}s/lần)`;
          break;
        }
        reloads++;
        await this.page.reload({ timeout: 120_000 });
        loadedAt = Date.now();
        continue;
      }
      const progressVisible = await progressBar.isVisible().catch(() => false);
      if (searches.length > 0 && inFlight === 0 && !progressVisible && Date.now() - lastActivity > 8_000) {
        timedOut = false;
        break;
      }
    }
    if (timedOut && !error) error = `web chưa load xong sau ${Math.round((Date.now() - t0) / 1000)}s`;
    await Promise.all([...pending]);

    const readTexts = async (selector: string) =>
      (await this.page.locator(selector).allInnerTexts().catch(() => [] as string[])).map((t) => t.replace(/\s+/g, " ").trim());

    return {
      url: resultUrl,
      ms: Date.now() - t0,
      timedOut,
      error,
      reloads,
      searches,
      uiStops: await readTexts(".flights__list--filter-input--stops"),
      uiAirlines: await readTexts(".flights__list--filter-input--airline"),
      uiCardCount: await this.page.locator(".flights__list--item-choose-btn").count(),
    };
  }
}
