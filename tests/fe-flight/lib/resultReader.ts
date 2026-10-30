import { Page } from "@playwright/test";

export type UiLeg = {
  airlineName: string;
  flightCodes: string;
  depTime: string;
  arrTime: string;
  nextDay: number;
  from: string;
  to: string;
  duration: string;
  stopLabel: string;
};

export type UiCard = {
  /** Thứ tự card trên trang (0 = đầu tiên). */
  index: number;
  legs: UiLeg[];
  /** Giá chính (chữ đỏ), giá gạch (nếu có), số tiền badge "Đã giảm X" (nếu có). */
  priceMain: number | null;
  priceStrike: number | null;
  voucherBadge: number | null;
  priceNote: string;
  handBaggage: string | null;
  seats: number | null;
};

export const CARD_SELECTOR = ".flights__list--item";

/**
 * Đọc toàn bộ card đang có trên trang kết quả (giao diện DESKTOP — mobile dùng DOM khác).
 * Class lấy từ FlightItem.tsx của web; đọc 1 lần bằng evaluate cho nhanh.
 */
export async function readCards(page: Page): Promise<UiCard[]> {
  return page.evaluate((selector) => {
    const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const money = (s: string) => {
      const digits = s.replace(/[^\d]/g, "");
      return digits ? Number(digits) : null;
    };
    return [...document.querySelectorAll(selector)].map((card, index) => {
      const legs = [...card.querySelectorAll(".flights__list--item-flight-row")].map((row) => {
        const times = row.querySelector(".flights__list--item-times");
        const big = [...(times?.querySelectorAll("h4") ?? [])].map(text);
        const small = [...(times?.querySelectorAll(".te-text-small") ?? [])].map(text);
        const arr = big[1] ?? "";
        return {
          airlineName: text(row.querySelector(".flights__list--item-airline")),
          flightCodes: text(row.querySelector(".flights__list--item-flightcode")),
          depTime: (big[0] ?? "").match(/\d{1,2}:\d{2}/)?.[0] ?? "",
          arrTime: arr.match(/\d{1,2}:\d{2}/)?.[0] ?? "",
          nextDay: Number(arr.match(/\+(\d+)d/)?.[1] ?? 0),
          from: small[0] ?? "",
          duration: small[1] ?? "",
          stopLabel: small[2] ?? "",
          to: small[3] ?? "",
        };
      });
      const priceBox = card.querySelector(".flights__list--item-price-info");
      // Tag "Đã bao gồm hành lý xách tay …": không dựa vào class antd (prefix có thể đổi) — lấy phần tử
      // sâu nhất chứa câu này.
      const handRe = /bao gồm hành lý xách tay/i;
      const handEl = [...card.querySelectorAll("*")].filter((el) => handRe.test(el.textContent ?? "")).pop();
      const handTag = handEl ? text(handEl) : undefined;
      return {
        index,
        legs,
        priceMain: money(text(priceBox?.querySelector("h4"))),
        priceStrike: money(text(priceBox?.querySelector("del"))),
        voucherBadge: money(text(card.querySelector(".flights__list--item-applied-voucher-amount"))),
        priceNote: text(priceBox?.querySelector(".ant-row:last-child")),
        handBaggage: handTag ? handTag.replace(/^.*xách tay\s*/i, "") : null,
        seats: Number(text(card).match(/Còn (\d+) vé/)?.[1] ?? 0) || null,
      };
    });
  }, CARD_SELECTOR);
}

/**
 * Web chỉ render ~15 card, cuộn tới cuối trang mới hiện thêm. Cuộn cho tới khi số card không tăng
 * nữa (3 lần liền) hoặc đạt `maxCards`. Trả về true nếu đã hiện hết.
 */
export async function loadAllCards(page: Page, maxCards = 400): Promise<boolean> {
  const cards = page.locator(CARD_SELECTOR);
  let last = -1;
  let stable = 0;
  while (stable < 3) {
    const count = await cards.count();
    if (count >= maxCards) return false;
    stable = count === last ? stable + 1 : 0;
    last = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return true;
}
