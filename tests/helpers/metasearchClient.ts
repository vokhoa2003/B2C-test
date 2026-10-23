import { APIRequestContext } from "@playwright/test";
import { FareItem } from "./metasearchCompare";

/**
 * Gọi thẳng API mà trang tool https://api-dev.triphubs.vn/static/tools/metasearch/
 * dùng (xem app.js của trang đó): `POST /auth/login` lấy accessToken, rồi
 * `POST /v1/flights/metasearch`. Trang tool chỉ render y nguyên `fareData` của
 * response nên số liệu ở đây chính là "list trả ra" của trang đó.
 */

export type MetasearchBody = {
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

export type MetasearchResponse = {
  metasearchId?: string;
  flightType?: string;
  fareData?: (FareItem & { dayViewDeeplinks?: string; deeplinks?: string })[];
  errorCode?: string;
  message?: string;
};

export class MetasearchClient {
  private token: string | null = null;

  constructor(
    private request: APIRequestContext,
    private baseUrl: string,
    private credentials: { clientId: string; username: string; password: string }
  ) {}

  async login() {
    const res = await this.request.post(`${this.baseUrl}/auth/login`, {
      data: this.credentials,
      headers: { accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!data.accessToken) {
      throw new Error(`Metasearch login thất bại (HTTP ${res.status()}): ${data.message ?? JSON.stringify(data)}`);
    }
    this.token = data.accessToken;
  }

  async search(body: MetasearchBody, timeout: number): Promise<{ status: number; ms: number; data: MetasearchResponse }> {
    if (!this.token) await this.login();
    const t0 = Date.now();
    const res = await this.request.post(`${this.baseUrl}/v1/flights/metasearch`, {
      data: body,
      headers: { Authorization: `Bearer ${this.token}` },
      timeout,
    });
    const data = (await res.json().catch(() => ({}))) as MetasearchResponse;
    return { status: res.status(), ms: Date.now() - t0, data };
  }
}
