import { SystemResponse } from "./searchCapture";
import { timeInfo } from "./airportTime";

/**
 * Từ response API → danh sách card KẾT QUẢ mà trang /flights/result PHẢI hiển thị (1 chiều).
 *
 * Quy tắc lấy theo nghiệp vụ hiển thị của web (traveleasy-web-user, đã đọc để chốt — KHÔNG chép code):
 * - Mỗi chuyến (flight) của 1 fare = 1 card. Fare GALILEO / GALILEO_NDC có chặng VJ/JQ bị ẩn
 *   (trùng kết quả search VJ/JQ riêng). Hạng vé "HF" bị bỏ, hạng trùng tên cabinClass chỉ giữ hạng rẻ hơn.
 * - Giờ đi/đến: `startTime`/`endTime` là GIỜ ĐỊA PHƯƠNG sân bay gắn chữ "Z" giả → lấy nguyên HH:mm.
 * - Thời gian bay: KHÔNG kiểm (đã thống nhất số web hiển thị là đúng). "+Nd" = số ngày lệch giữa ngày đến và ngày đi.
 * - Giá trên card = giá TRUNG BÌNH 1 khách, ĐÃ gồm thuế + phí (chế độ mặc định "full_1_adult"):
 *     (Σ giá vé + Σ thuế + Σ phí hãng + phí hệ thống − giảm giá API) ÷ (NL + TE + EB)
 *   với hạng rẻ nhất (theo totalAdt). Phí hệ thống (`fare.fees`): ADULT × số NL (isTemp: × 1), CHILD × số TE,
 *   em bé không tính. Giảm giá API = totalDiscount + vnaClassicLPromoDiscount.
 *   Voucher trừ dần (cấu hình voucher, không nằm trong response search) → card gạch giá gốc, hiện giá
 *   sau giảm và badge "Đã giảm X" — phần so sánh chấp nhận giá sau giảm = giá gốc − X ÷ số khách.
 */

export type ExpectedLeg = {
  flightCodes: string;
  airlineCode: string;
  from: string;
  to: string;
  depTime: string;
  arrTime: string;
  /** Múi giờ sân bay + giờ GMT của giờ đi/đến (cho báo cáo). */
  depTz: ReturnType<typeof timeInfo>;
  arrTz: ReturnType<typeof timeInfo>;
  nextDay: number;
  stops: number;
  stopLabel: string;
};

export type PriceParts = {
  adt: number;
  chd: number;
  inf: number;
  fare: number;
  tax: number;
  airlineFee: number;
  systemFee: number;
  discount: number;
  total: number;
  perPax: number;
  /** totalAmount API trả — để đối chiếu Σ(vé + thuế + phí hãng). */
  apiTotalAmount: number;
  /**
   * totalAmount không khớp cả 2 cách tính: × số khách (đa số system) hoặc 1 khách mỗi loại
   * (VN: totalAdt + totalChd + totalInf, đã thấy thật).
   */
  apiTotalMismatch: boolean;
};

export type ExpectedCard = {
  key: string;
  system: string;
  combo: boolean;
  legs: ExpectedLeg[];
  cabinClass: string;
  price: PriceParts;
  /** Tag "Đã bao gồm hành lý xách tay …" (card combo/Galileo không có). */
  handBaggage: string | null;
  seats: number | null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  fare: any;
  inventory: any;
};

export type SkipInfo = Record<string, number>;

const STOP_LABELS = ["Bay thẳng", "Một điểm dừng", "Hai điểm dừng trở lên"];
const isGalileo = (system: string) => system === "GALILEO_NDC" || system === "GALILEO";
const isVjOrJq = (seg: any) =>
  [seg.airline, seg.operatingAirline, seg.flightNumber].some((v) => /^(VJ|JQ)/.test(String(v ?? "").replace(/_/g, "").toUpperCase()));

const hhmm = (t: string) => String(t).slice(11, 16);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86_400_000);
export const legKey = (flightCodes: string, depTime: string, arrTime: string) => `${flightCodes}|${depTime}|${arrTime}`;

function toLeg(flight: any): ExpectedLeg {
  const segs = flight.segments;
  const first = segs[0];
  const last = segs[segs.length - 1];
  const stops = Number(flight.stopNumber) || 0;
  return {
    flightCodes: segs.map((s: any) => s.flightNumber).join(", "),
    airlineCode: String(first.airline || first.operatingAirline || "").replace("_", ""),
    from: first.startPoint,
    to: last.endPoint,
    depTime: hhmm(first.startTime),
    arrTime: hhmm(last.endTime),
    depTz: timeInfo(first.startTime, first.startPoint),
    arrTz: timeInfo(last.endTime, last.endPoint),
    nextDay: Math.max(0, dayDiff(first.startTime, last.endTime)),
    stops,
    stopLabel: STOP_LABELS[Math.min(stops, 2)],
  };
}

/** Hạng vé hợp lệ của 1 chuyến: sắp theo totalAmount, bỏ "HF", bỏ hạng trùng tên. */
function validInventories(flight: any): any[] {
  const seen = new Set<string>();
  return [...(flight.inventories ?? [])]
    .sort((a, b) => a.totalAmount - b.totalAmount)
    .filter((inv) => {
      if (inv.cabinClass === "HF" || seen.has(inv.cabinClass)) return false;
      seen.add(inv.cabinClass);
      return true;
    });
}

const cheapest = (invs: any[]) =>
  [...invs].sort((a, b) => (a.totalAdt || a.totalAmount || Infinity) - (b.totalAdt || b.totalAmount || Infinity))[0];

export function priceOf(inv: any, fees: any[] = []): PriceParts {
  const adt = Number(inv.adt) || 0;
  const chd = Number(inv.chd) || 0;
  const inf = Number(inv.inf) || 0;
  const fare = inv.fareAdt * adt + inv.fareChd * chd + inv.fareInf * inf;
  const tax = inv.taxAdt * adt + inv.taxChd * chd + inv.taxInf * inf;
  const airlineFee = inv.feeAdt * adt + inv.feeChd * chd + inv.feeInf * inf;
  const systemFee = fees.reduce((t, f) => {
    const amount = Number(f?.amount) || 0;
    if (f?.paxType === "ADULT") return t + amount * (f.isTemp ? 1 : adt);
    if (f?.paxType === "CHILD") return t + amount * chd;
    return t;
  }, 0);
  const discount = (Number(inv.totalDiscount) || 0) + (Number(inv.vnaClassicLPromoDiscount) || 0);
  const total = fare + tax + airlineFee + systemFee;
  const apiTotalAmount = Number(inv.totalAmount) || 0;
  const onePerType = [adt, chd, inf].reduce((t, n, i) => t + (n ? Number([inv.totalAdt, inv.totalChd, inv.totalInf][i]) || 0 : 0), 0);
  return {
    adt, chd, inf, fare, tax, airlineFee, systemFee, discount, total,
    perPax: Math.max(0, (total - discount) / Math.max(adt + chd + inf, 1)),
    apiTotalAmount,
    apiTotalMismatch: Math.abs(fare + tax + airlineFee - apiTotalAmount) > 1 && Math.abs(onePerType - apiTotalAmount) > 1,
  };
}

export function buildExpectedCards(responses: SystemResponse[], route: { from: string; to: string }) {
  const cards: ExpectedCard[] = [];
  const skipped: SkipInfo = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);

  for (const res of responses) {
    for (const fare of res.response?.fareData ?? []) {
      const system = String(fare.system ?? res.system);
      const flights = (fare.flights ?? []).filter((f: any) => f.segments?.length);
      if (isGalileo(system) && flights.some((f: any) => f.segments.some(isVjOrJq))) {
        skip("Galileo có chặng VJ/JQ (web ẩn)");
        continue;
      }
      const combo = isGalileo(system) || (system === "VN" && flights.length > 1);
      // 1 chiều: mỗi chuyến 1 card (combo chỉ có 1 chuyến/fare).
      for (const flight of flights) {
        const leg = toLeg(flight);
        if (leg.from !== route.from || leg.to !== route.to) {
          skip("khác điểm đi/đến search");
          continue;
        }
        const invs = validInventories(flight);
        if (!invs.length) {
          skip("không có hạng vé");
          continue;
        }
        const inv = cheapest(invs);
        const firstHand = Object.values(invs[0].handBaggage ?? {})[0] as string | undefined;
        cards.push({
          key: legKey(leg.flightCodes, leg.depTime, leg.arrTime),
          system,
          combo,
          legs: [leg],
          cabinClass: inv.cabinClass,
          price: priceOf(inv, fare.fees),
          handBaggage: !combo && firstHand ? firstHand.toLowerCase().replace("piece", "kiện") : null,
          seats: Number(flight.segments[0].seat) || null,
          fare: { ...fare, flights: undefined },
          inventory: inv,
        });
      }
    }
  }
  return { cards, skipped };
}
