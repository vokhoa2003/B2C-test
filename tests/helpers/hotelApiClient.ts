import { APIRequestContext } from "@playwright/test";
import type { HotelFeePolicy, HotelRecord, HotelRoom } from "./hotelPricing";

/**
 * Gọi thẳng API khách sạn mà web và TMS dùng: `{API}/hotel/...` (CMS chuyển tiếp sang hotel service).
 * Body search giống TMS buildHotelSearchBody (hotel service từ chối field lạ như TYPE).
 * Token quyết định clientId → quyết định `feePolicies` trả về, nên web và TMS cần token riêng.
 */

export type HotelSearchBody = {
  locationId: number;
  searchType: string;
  checkInDate: string;
  checkOutDate: string;
  roomsNum: number;
  adults: number;
  children: number;
  childrenAges: number[];
  page: number;
  pageSize: number;
  locale: "vn" | "en";
  searchMode: string;
  filter: unknown[];
};

export type HotelLocation = {
  id: number;
  searchType?: string;
  text?: string;
  textTranslate?: string;
  displayName?: string;
  cityName?: string;
  countryName?: string;
  isDomestic?: boolean;
  activeHotel?: number;
};

export type HotelSearchResult = {
  status: number;
  ms: number;
  records: HotelRecord[];
  feePolicies: HotelFeePolicy[];
  error?: string;
};

export type HotelDetailResult = {
  status: number;
  ms: number;
  rooms: HotelRoom[];
  feePolicies: HotelFeePolicy[];
  error?: string;
};

/** Bỏ dấu tiếng Việt — location search của hotel service lọc theo searchTerm không dấu. */
export const removeVietnameseChars = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");

export const locationName = (l: HotelLocation) => String(l.text ?? l.textTranslate ?? l.displayName ?? l.cityName ?? "");

const nameRank = (l: HotelLocation, term: string) => {
  const key = removeVietnameseChars(term).toLowerCase().trim();
  const name = removeVietnameseChars(locationName(l)).toLowerCase();
  return name === key ? 0 : name.startsWith(key) ? 1 : 2;
};

export class HotelApiClient {
  constructor(
    private request: APIRequestContext,
    /** VD https://api-dev.triphubs.vn (không có /hotel). */
    private baseUrl: string,
    private token: string,
    private timeout: number
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, accept: "application/json", "accept-language": "vi-VN" };
  }

  /** Mọi địa điểm khớp từ khoá (GET /hotel/location/search). */
  async searchLocations(term: string): Promise<HotelLocation[]> {
    const searchTerm = removeVietnameseChars(term).trim();
    const url = `${this.baseUrl}/hotel/location/search?${new URLSearchParams({ searchTerm, offset: "0", limit: "20", locale: "vn" })}`;
    const res = await this.request.get(url, { headers: this.headers(), timeout: this.timeout });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json) ? json : json?.records ?? json?.data ?? [];
  }

  /**
   * Địa điểm để search theo vùng: bỏ kết quả loại HOTEL (1 khách sạn lẻ), ưu tiên CITY → AREA → COUNTRY,
   * trong cùng loại ưu tiên tên trùng khớp từ khoá. Không có thì null.
   */
  async findLocation(term: string): Promise<HotelLocation | null> {
    const list = await this.searchLocations(term);
    const rank = (l: HotelLocation) => {
      const typeRank = { CITY: 0, AREA: 1, COUNTRY: 2 }[l.searchType ?? ""] ?? 3;
      return typeRank * 10 + nameRank(l, term);
    };
    return list.filter((l) => l.searchType !== "HOTEL").sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }

  /**
   * Khách sạn lẻ có đủ mọi từ trong tên, tên ngắn nhất (sát nhất) đứng đầu. API tìm mờ nên kết quả đầu không chắc đúng.
   * So sánh bỏ dấu cách vì "Hà Nội" và "Hanoi" cùng tồn tại. Search bằng locationId = id khách sạn, searchType HOTEL như web.
   */
  async findHotels(term: string): Promise<HotelLocation[]> {
    const normalize = (s: string) => removeVietnameseChars(s).toLowerCase();
    const words = normalize(term).replace(/^(khach san|ks|hotel)\s+/, "").split(/\s+/).filter(Boolean);
    const matches = (l: HotelLocation) => {
      const names = normalize([l.text, l.textTranslate, l.displayName].filter(Boolean).join(" ")).replace(/\s+/g, "");
      return words.every((w) => names.includes(w));
    };
    const list = await this.searchLocations(term);
    return list.filter((l) => l.searchType === "HOTEL" && matches(l)).sort((a, b) => locationName(a).length - locationName(b).length);
  }

  async search(body: HotelSearchBody): Promise<HotelSearchResult> {
    const started = Date.now();
    try {
      const res = await this.request.post(`${this.baseUrl}/hotel/searchHotels?locale=${body.locale}`, {
        data: body,
        headers: this.headers(),
        timeout: this.timeout,
      });
      const json = await res.json().catch(() => ({}));
      const pageSearchId = json?.searchId;
      const records: HotelRecord[] = (Array.isArray(json?.records) ? json.records : []).map((r: HotelRecord) => ({
        ...r,
        searchId: r.searchId ?? pageSearchId,
      }));
      const error = res.status() >= 400 || json?.errorCode ? `HTTP ${res.status()} ${json?.errorCode ?? ""} ${json?.message ?? ""}`.trim() : undefined;
      return { status: res.status(), ms: Date.now() - started, records, feePolicies: Array.isArray(json?.feePolicies) ? json.feePolicies : [], error };
    } catch (err) {
      return { status: 0, ms: Date.now() - started, records: [], feePolicies: [], error: (err as Error).message.split("\n")[0] };
    }
  }

  async detail(hotelId: number | string, searchId: number | string): Promise<HotelDetailResult> {
    const started = Date.now();
    try {
      const res = await this.request.get(`${this.baseUrl}/hotel/search/detail/${hotelId}/${searchId}?locale=vn`, {
        headers: this.headers(),
        timeout: this.timeout,
      });
      const json = await res.json().catch(() => ({}));
      const raw = json?.searchResponse?.rooms;
      const rooms: HotelRoom[] = Array.isArray(raw) ? raw : Object.values(raw ?? {}).flat() as HotelRoom[];
      const error = res.status() >= 400 || json?.errorCode ? `HTTP ${res.status()} ${json?.errorCode ?? ""} ${json?.message ?? ""}`.trim() : undefined;
      return { status: res.status(), ms: Date.now() - started, rooms, feePolicies: Array.isArray(json?.feePolicies) ? json.feePolicies : [], error };
    } catch (err) {
      return { status: 0, ms: Date.now() - started, rooms: [], feePolicies: [], error: (err as Error).message.split("\n")[0] };
    }
  }
}

/** Chạy `fn` cho từng phần tử, tối đa `limit` việc cùng lúc, giữ thứ tự kết quả. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}
