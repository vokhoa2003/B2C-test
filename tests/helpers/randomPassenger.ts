/** Sinh dữ liệu test ngẫu nhiên (ngày, chặng bay, hành khách...). Các "pool" giá
 * trị mặc định nằm ở đây — có thể override qua file JSON cùng tên với spec
 * (xem testDataLoader.ts), spec sẽ truyền pool đã load vào các hàm random bên
 * dưới thay vì dùng thẳng hằng số module-level. */

export type RandomDob = { day: string; month: string; year: string };

/**
 * Tách tên mẫu dạng "SYSTEM AUTO TESTER VIETNAMESE" thành Họ (từ đầu tiên) +
 * Tên đệm và tên (phần còn lại) — dùng cho form hành khách quốc tế (2 field
 * riêng) lẫn nội địa (ghép lại thành 1 field "Họ và tên").
 */
export function splitPassengerName(fullName: string): {
  lastName: string;
  firstName: string;
} {
  const [lastName, ...rest] = fullName.trim().split(/\s+/);
  return { lastName, firstName: rest.join(" ") || lastName };
}

/** Ngày sinh random cho người lớn 25-45 tuổi, tính theo ngày hiện tại. */
export function randomAdultDob(today: Date = new Date()): RandomDob {
  const age = 25 + Math.floor(Math.random() * 21); // 25..45
  const year = today.getFullYear() - age;
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28); // tránh edge-case tháng 2/30-31
  return {
    day: String(day).padStart(2, "0"),
    month: String(month).padStart(2, "0"),
    year: String(year),
  };
}

/** Ngày sinh random cho trẻ em 2-11 tuổi (khớp hint "(2-11 tuổi)" trên form thật). */
export function randomChildDob(today: Date = new Date()): RandomDob {
  const age = 2 + Math.floor(Math.random() * 10); // 2..11
  const year = today.getFullYear() - age;
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return {
    day: String(day).padStart(2, "0"),
    month: String(month).padStart(2, "0"),
    year: String(year),
  };
}

/** Ngày sinh random cho em bé <2 tuổi (khớp hint "(<2 tuổi)" trên form thật). */
export function randomInfantDob(today: Date = new Date()): RandomDob {
  const ageMonths = Math.floor(Math.random() * 23); // 0..22 tháng tuổi, luôn <2 tuổi
  const d = new Date(today);
  d.setMonth(d.getMonth() - ageMonths);
  d.setDate(1 + Math.floor(Math.random() * 28));
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    year: String(d.getFullYear()),
  };
}

export type PassengerCounts = { adults: number; children: number; infants: number };

/**
 * Random số lượng hành khách theo đúng khoảng plan yêu cầu: người lớn 1-4,
 * trẻ em 0-3, em bé 0-2 (ràng buộc em bé <= người lớn — đúng nghiệp vụ hàng
 * không chuẩn, component FE cũng tự giới hạn qua `max`). Tổng cả 3 loại
 * KHÔNG được vượt quá 8 — nếu random ra vượt (tối đa lý thuyết 4+3+2=9), giảm
 * bớt trẻ em trước (ít ảnh hưởng field-set hơn giảm người lớn/em bé), rồi mới
 * tới em bé nếu vẫn còn vượt.
 */
export function randomPassengerCounts(): PassengerCounts {
  const adults = 1 + Math.floor(Math.random() * 4); // 1..4
  let children = Math.floor(Math.random() * 4); // 0..3
  const maxInfants = Math.min(2, adults);
  let infants = Math.floor(Math.random() * (maxInfants + 1)); // 0..min(2,adults)

  let total = adults + children + infants;
  while (total > 8 && children > 0) {
    children--;
    total--;
  }
  while (total > 8 && infants > 0) {
    infants--;
    total--;
  }

  return { adults, children, infants };
}

/** Số CCCD 12 chữ số ngẫu nhiên (không trùng giữa các lần chạy). */
export function randomCccd(): string {
  return String(Math.floor(100000000000 + Math.random() * 900000000000));
}

/** Số hộ chiếu ngẫu nhiên dạng 1 chữ cái + 8 số, theo định dạng phổ biến. */
export function randomPassportNumber(): string {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = String(Math.floor(10000000 + Math.random() * 90000000));
  return `${letter}${digits}`;
}

/** Ngày hết hạn giấy tờ random, cách hiện tại 3-10 năm (luôn hợp lệ, không hết hạn). */
export function randomDocumentExpiry(
  today: Date = new Date()
): { day: string; month: string; year: string } {
  const yearsAhead = 3 + Math.floor(Math.random() * 8); // +3..+10 năm
  const year = today.getFullYear() + yearsAhead;
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return {
    day: String(day).padStart(2, "0"),
    month: String(month).padStart(2, "0"),
    year: String(year),
  };
}

/** Pool mặc định quốc tịch nước ngoài — override qua JSON field `foreignNationalities`. */
export const DEFAULT_FOREIGN_NATIONALITIES = [
  "United States",
  "Japan",
  "South Korea",
  "Australia",
];

export function randomForeignNationality(pool: string[] = DEFAULT_FOREIGN_NATIONALITIES): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pool mặc định tên hành khách nội địa — override qua JSON field `passengerNames`. */
export const DEFAULT_PASSENGER_NAMES = [
  "SYSTEM AUTO TESTER VIETNAMESE",
  "SYSTEM AUTO TESTER MOBILE",
  "SYSTEM AUTO TESTER DESKTOP",
  "SYSTEM AUTO TESTER REGRESSION",
  "SYSTEM AUTO TESTER SMOKE",
];

export function randomPassengerName(pool: string[] = DEFAULT_PASSENGER_NAMES): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pool mặc định tên hành khách nước ngoài — override qua JSON field `abroadPassengerNames`. */
export const DEFAULT_ABROAD_PASSENGER_NAMES = [
  "SYSTEM AUTO TESTER ABROAD",
  "SYSTEM AUTO TESTER OVERSEAS",
  "SYSTEM AUTO TESTER FOREIGN",
  "SYSTEM AUTO TESTER INTERNATIONAL",
  "SYSTEM AUTO TESTER GLOBAL",
];

export function randomAbroadPassengerName(
  pool: string[] = DEFAULT_ABROAD_PASSENGER_NAMES
): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

export type RouteAirport = {
  code: string;
  /** Chuỗi để gõ vào ô tìm kiếm sân bay (khớp theo tên sân bay/thành phố hiển thị trong dropdown). */
  searchText: string;
  isDomestic: boolean;
};

/**
 * Pool mặc định sân bay theo plan: SGN, HAN, TPE, DAD, SYD, NRT — override qua
 * JSON field `routes`. Toàn bộ searchText đã verify thật qua dropdown live
 * (probe trực tiếp input "Đến..." trên trang chủ).
 */
export const DEFAULT_ROUTE_AIRPORTS: RouteAirport[] = [
  { code: "SGN", searchText: "Tân Sơn Nhất", isDomestic: true },
  { code: "HAN", searchText: "Nội Bài", isDomestic: true },
  { code: "DAD", searchText: "Đà Nẵng", isDomestic: true },
  { code: "TPE", searchText: "Đài Bắc", isDomestic: false },
  { code: "SYD", searchText: "Sydney", isDomestic: false },
  // "Tokyo" KHÔNG dùng được: dropdown trả kết quả đúng nhưng text hiển thị của
  // item lại KHÔNG chứa chuỗi "Tokyo" (chỉ "Sân bay quốc tế Narita NRT", thiếu
  // phần tên thành phố) — verify thật qua probe, "NRT" khớp ổn định và duy nhất.
  { code: "NRT", searchText: "NRT", isDomestic: false },
];

export type RandomRoute = {
  from: RouteAirport;
  to: RouteAirport;
  /** true nếu có ít nhất 1 đầu quốc tế -> áp dụng mốc search tối thiểu 40 ngày thay vì 20. */
  isInternational: boolean;
};

/** Chọn ngẫu nhiên 2 sân bay khác nhau trong pool làm điểm đi/điểm đến. */
export function randomRoute(pool: RouteAirport[] = DEFAULT_ROUTE_AIRPORTS): RandomRoute {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const [from, to] = shuffled;
  return {
    from,
    to,
    isInternational: !from.isDomestic || !to.isDomestic,
  };
}

/**
 * Random số ngày tới (kể từ hôm nay) cho ngày khởi hành, theo đúng mốc tối thiểu:
 * nội địa >=20 ngày, có chặng quốc tế >=40 ngày. Giới hạn trên +15 ngày so với mốc
 * tối thiểu để tránh vượt quá phạm vi 2 cột tháng mà date picker đang hiển thị.
 */
export function randomDaysFromNow(
  isInternational: boolean,
  domesticMinDays = 20,
  internationalMinDays = 40
): number {
  const minDays = isInternational ? internationalMinDays : domesticMinDays;
  return minDays + Math.floor(Math.random() * 15); // minDays..minDays+14
}

/**
 * +N ngày kể từ hôm nay, trả về Date object thuần — dùng với
 * `FlightSearchWidget.selectDepartureDay()`/`selectReturnDay()` (khớp ô theo
 * `title="YYYY-MM-DD"` thật trên mỗi cell date-picker, KHÔNG còn cần suy đoán
 * "ngày nằm ở cột tháng nào" nữa).
 *
 * ĐÃ THAY THẾ `addDaysForDatePicker()` cũ (trả {day, monthColumnIndex} +
 * khớp theo regex số ngày) — cách cũ có BUG THẬT đã verify qua chạy live
 * nhiều lần: text hiển thị trên mỗi cell là ngày+1 chỉ số ẩn khác+giá dính
 * liền nhau (VD "90198k"), nên ngày 2 chữ số (VD "12") có thể TRÙNG PREFIX
 * với text của 1 ngày khác hoàn toàn (VD ngày 1 có chỉ số ẩn bắt đầu bằng
 * "2" ra text "12998k" cũng khớp regex `/^12/`) — khớp nhầm ô, có khi rơi
 * đúng ô bị disabled (ngày trong quá khứ) gây timeout. `title` attribute là
 * ISO date chính xác tuyệt đối, không có rủi ro này.
 */
export function daysFromNowToDate(daysFromNow: number, today: Date = new Date()): Date {
  const target = new Date(today);
  target.setDate(target.getDate() + daysFromNow);
  return target;
}
