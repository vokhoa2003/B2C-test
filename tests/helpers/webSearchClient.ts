import { APIRequestContext } from "@playwright/test";
import { CapturedSearch, WebSearchCaptureResult } from "../pages/flight/FlightSearchApiCapture";

/**
 * Lấy kết quả search của web bằng cách GỌI THẲNG API mà trang dev.triphubs.vn dùng
 * (`POST {WEB_API_URL}/flights/search/`, header `Authorization: Bearer {WEB_API_TOKEN}`), mỗi system
 * 1 request, song song — giống hệt web (getAirlinesCanBeExcuted.ts + callbackSearchFlights.ts).
 *
 * Vì sao không bắt qua browser: response lớn (VD GALILEO_NDC SGN⇄ICN 2 NL + 1 TE: 10,2 MB, 965 kết
 * quả) Chrome không cho đọc body → trước đây tool nhận rỗng, báo nhầm "chỉ có ở meta".
 *
 * Token: token ứng dụng web (JWT clientId "TE"). Đặt sẵn ở .env WEB_API_TOKEN (DevTools → Network →
 * `flights/search` → Request Headers → `authorization`, bỏ chữ "Bearer "), hoặc để tool tự đăng nhập
 * bằng WEB_API_CLIENT_ID / WEB_API_USERNAME / WEB_API_PASSWORD — giống web (sitemap.ts: `POST /auth/login`
 * với NEXT_PUBLIC_AUTHEN_API_CLIENT_ID / USER / PASS).
 */

/** Đăng nhập `POST {baseUrl}/auth/login` như web để lấy accessToken vendor. Lỗi thì throw kèm lý do. */
export async function loginWebApi(
  request: APIRequestContext,
  baseUrl: string,
  credentials: { clientId: string; username: string; password: string }
): Promise<string> {
  const res = await request.post(`${baseUrl}/auth/login`, { data: credentials, headers: { accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!data?.accessToken) {
    throw new Error(`Đăng nhập API web thất bại (HTTP ${res.status()}): ${data?.message ?? JSON.stringify(data)} — kiểm tra WEB_API_CLIENT_ID / WEB_API_USERNAME / WEB_API_PASSWORD`);
  }
  return String(data.accessToken);
}

export type WebSearchBody = {
  adt: number;
  chd: number;
  inf: number;
  itinerary: 0 | 1;
  currency: string;
  language: string;
  flightType: "DOMESTIC" | "INTERNATIONAL";
  viewMode: string;
  flights: { startPoint: string; endPoint: string; departDate: string }[];
};

export type WebSystems = { domestic: string[]; international: string[] };

export class WebSearchClient {
  constructor(
    private request: APIRequestContext,
    private baseUrl: string,
    private token: string,
    private systems: WebSystems
  ) {}

  /** Trả cùng dạng với FlightSearchApiCapture để phần so sánh/báo cáo dùng chung. */
  async search(body: WebSearchBody, resultUrl: string, timeout: number): Promise<WebSearchCaptureResult> {
    const t0 = Date.now();
    const systems = body.flightType === "DOMESTIC" ? this.systems.domestic : this.systems.international;
    const searches: CapturedSearch[] = await Promise.all(
      systems.map(async (airline) => {
        // Body đúng như web gửi: thêm `airline` vào từng chiều.
        const requestBody = { ...body, flights: body.flights.map((f) => ({ ...f, airline })) };
        try {
          const res = await this.request.post(`${this.baseUrl}/flights/search/`, {
            data: requestBody,
            headers: { Authorization: `Bearer ${this.token}`, "accept-language": "vi-VN" },
            timeout,
          });
          const json = await res.json().catch(() => ({}));
          return { requestBody, status: res.status(), fareData: Array.isArray(json?.fareData) ? json.fareData : [] };
        } catch (err) {
          return { requestBody, status: 0, fareData: [], bodyError: (err as Error).message.split("\n")[0] };
        }
      })
    );

    // Token sai/hết hạn: mọi request 400/401/403 → không so được (khác "web không có chuyến").
    const authFailed = searches.length > 0 && searches.every((s) => [400, 401, 403].includes(s.status));
    const failed = searches.filter((s) => s.status === 0);
    const error = authFailed
      ? `API web từ chối token (HTTP ${searches[0].status}) — kiểm tra WEB_API_TOKEN`
      : failed.length === searches.length && searches.length
        ? `không gọi được API web: ${failed[0].bodyError}`
        : "";

    return {
      url: resultUrl,
      ms: Date.now() - t0,
      timedOut: !!error,
      error,
      reloads: 0,
      searches,
      // Gọi API trực tiếp thì không có số liệu sidebar trên giao diện.
      uiStops: [],
      uiAirlines: [],
      uiCardCount: 0,
    };
  }
}
