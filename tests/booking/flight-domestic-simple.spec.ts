import { test, expect } from "@playwright/test";
import { FlightSearchWidget } from "../pages/flight/FlightSearchWidget";
import {
  FlightResultsPage,
  FlightSearchTrackingData,
} from "../pages/flight/FlightResultsPage";
import { PassengerFormPage } from "../pages/flight/PassengerFormPage";
import { CheckoutPage } from "../pages/flight/CheckoutPage";
import { OnePayGateway, TestCard } from "../pages/flight/OnePayGateway";
import {
  randomAdultDob,
  randomCccd,
  randomPassportNumber,
  randomDocumentExpiry,
  randomForeignNationality,
  randomPassengerName,
  randomAbroadPassengerName,
  splitPassengerName,
  randomRoute,
  randomDaysFromNow,
  daysFromNowToDate,
  RouteAirport,
  DEFAULT_ROUTE_AIRPORTS,
  DEFAULT_PASSENGER_NAMES,
  DEFAULT_ABROAD_PASSENGER_NAMES,
  DEFAULT_FOREIGN_NATIONALITIES,
} from "../helpers/randomPassenger";
import { logBookingAttempt } from "../helpers/testStateStore";
import { loadTestData } from "../helpers/testDataLoader";

/**
 * Luồng test theo "Ví dụ 1" trong plan: search 1 chiều cho 1 người lớn, chọn
 * chuyến, đặt vé, thanh toán OnePay (thẻ test Vietcombank). Yêu cầu nghiệp vụ:
 * - Tối đa 3 order/lần chạy, chạy TUẦN TỰ (không song song).
 * - Chặng bay: random 2 trong pool `routes` mỗi order.
 * - Ngày search: random, tối thiểu `domesticMinDays`/`internationalMinDays` ngày.
 * - Tên hành khách: random trong pool `passengerNames`/`abroadPassengerNames`.
 * - Ngày sinh: random người lớn 25-45 tuổi. CCCD/hộ chiếu: random (chỉ điền nếu
 *   field xuất hiện — tuỳ hãng bay).
 * - Thông tin liên hệ: tên/SĐT cố định, random 1 trong các email ở `contact.emails`.
 * - Nếu gặp "hết chỗ": đổi điều kiện (chặng + ngày khác) rồi search lại từ đầu.
 *
 * TOÀN BỘ data ở DEFAULT_DATA bên dưới có thể override bằng file JSON CÙNG TÊN
 * đặt cạnh file này (flight-domestic-simple.json) — xem helpers/testDataLoader.ts.
 * Field nào JSON không khai báo thì vẫn dùng giá trị mặc định hard-code ở đây.
 *
 * LƯU Ý CHƯA VERIFY LIVE: nhánh hành khách quốc tế (chọn Quốc tịch, điền hộ
 * chiếu) mới được viết theo suy đoán cấu trúc UI, chưa chạy thật lần nào.
 */

type TestData = {
  maxOrdersPerRun: number;
  maxSoldOutRetries: number;
  domesticMinDays: number;
  internationalMinDays: number;
  routes: RouteAirport[];
  passengerNames: string[];
  abroadPassengerNames: string[];
  foreignNationalities: string[];
  contact: {
    fullName: string;
    phone: string;
    emails: string[];
  };
  onePayTestCard: TestCard;
  onePayTestOtp: string;
};

const DEFAULT_DATA: TestData = {
  maxOrdersPerRun: 3,
  maxSoldOutRetries: 3,
  domesticMinDays: 20,
  internationalMinDays: 40,
  routes: DEFAULT_ROUTE_AIRPORTS,
  passengerNames: DEFAULT_PASSENGER_NAMES,
  abroadPassengerNames: DEFAULT_ABROAD_PASSENGER_NAMES,
  foreignNationalities: DEFAULT_FOREIGN_NATIONALITIES,
  contact: {
    fullName: "VO PHAM DANG KHOA",
    phone: "935912495",
    emails: ["vophamdangkhoa.010103@gmail.com", "akiyoshimeo@gmail.com"],
  },
  onePayTestCard: {
    number: "9704360000000000002",
    issueDateDigits: "0113",
    cardHolderName: "NGUYEN VAN A",
  },
  onePayTestOtp: "123456",
};

const DATA = loadTestData<TestData>(__filename, DEFAULT_DATA);

function pickRandomEmail(): string {
  return DATA.contact.emails[Math.floor(Math.random() * DATA.contact.emails.length)];
}

function toIsoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

test.describe("Đặt vé máy bay - luồng đơn giản (1 người lớn, 1 chiều, chặng/ngày random)", () => {
  test("search → chọn vé → điền hành khách → thanh toán OnePay (tối đa 3 order, tuần tự)", async ({
    page,
  }) => {
    // Mỗi order có thể mất 1-2 phút (search tuần tự từng hãng + OnePay), x3 order.
    test.setTimeout(15 * 60_000);

    for (let orderIndex = 0; orderIndex < DATA.maxOrdersPerRun; orderIndex++) {
      let bookingDone = false;

      for (
        let soldOutRetry = 0;
        soldOutRetry < DATA.maxSoldOutRetries && !bookingDone;
        soldOutRetry++
      ) {
        // Đổi điều kiện (chặng + ngày) mỗi lần thử, kể cả lần đầu của mỗi order,
        // để tránh trùng tồn kho giữa các order/lần retry trong cùng 1 lần chạy.
        const route = randomRoute(DATA.routes);
        const dayOffset = randomDaysFromNow(
          route.isInternational,
          DATA.domesticMinDays,
          DATA.internationalMinDays
        );
        const departureIso = toIsoDate(dayOffset);

        await test.step(
          `Order ${orderIndex + 1}/${DATA.maxOrdersPerRun} — ${route.from.code}->${route.to.code} ` +
            `ngày +${dayOffset} (thử ${soldOutRetry + 1}/${DATA.maxSoldOutRetries})`,
          async () => {
            const search = new FlightSearchWidget(page);
            await search.goto();
            await search.selectFromAirport(route.from.searchText);
            await search.selectToAirport(route.to.searchText);

            await search.selectDepartureDay(daysFromNowToDate(dayOffset));
            await search.submit();

            const results = new FlightResultsPage(page);
            await results.waitForSearchDone();

            const tracking: FlightSearchTrackingData =
              await results.collectSearchTrackingData();
            console.log(
              `[tracking:search] order=${orderIndex + 1} date=${departureIso} ` +
                `route=${tracking.fromCode}->${tracking.toCode} roundTrip=${tracking.isRoundTrip} ` +
                `airlines=${tracking.airlineCount}(${tracking.airlineNames.join(",")}) flights=${tracking.flightCount}`
            );

            expect(tracking.fromCode).toBe(route.from.code);
            expect(tracking.toCode).toBe(route.to.code);

            if (tracking.flightCount === 0) {
              // Không có chuyến nào trả ra -> không tính là lỗi, note lại rồi đổi
              // điều kiện thử lại (vòng lặp ngoài sẽ random route+ngày mới).
              logBookingAttempt({
                fromCode: route.from.code,
                toCode: route.to.code,
                departureDate: departureIso,
                orderCode: null,
                status: "WAITING_RECHECK",
                note: "Search không trả ra chuyến nào",
              });
              return;
            }

            await results.chooseFlightAndContinue(0);

            const passengerForm = new PassengerFormPage(page);
            await passengerForm.waitForLoaded();

            if (route.isInternational) {
              const { lastName, firstName } = splitPassengerName(
                randomAbroadPassengerName(DATA.abroadPassengerNames)
              );
              await passengerForm.fillPassenger(
                {
                  lastName,
                  firstName,
                  dob: randomAdultDob(),
                  nationality: randomForeignNationality(DATA.foreignNationalities),
                  documentNumber: randomPassportNumber(),
                  documentExpiry: randomDocumentExpiry(),
                },
                /* isDomestic */ false
              );
            } else {
              const { lastName, firstName } = splitPassengerName(
                randomPassengerName(DATA.passengerNames)
              );
              await passengerForm.fillPassenger(
                {
                  lastName,
                  firstName,
                  dob: randomAdultDob(),
                  documentNumber: randomCccd(),
                  documentExpiry: randomDocumentExpiry(),
                },
                /* isDomestic */ true
              );
            }

            await passengerForm.fillContact({
              fullName: DATA.contact.fullName,
              phone: DATA.contact.phone,
              email: pickRandomEmail(),
            });

            const bookingOutcome = await passengerForm.submitBooking();

            if (bookingOutcome === "sold_out") {
              logBookingAttempt({
                fromCode: route.from.code,
                toCode: route.to.code,
                departureDate: departureIso,
                orderCode: null,
                status: "FAILED",
                note: "Hết chỗ lúc xác nhận đặt vé — sẽ đổi điều kiện thử lại",
              });
              return;
            }

            const orderCode = passengerForm.getOrderCodeFromUrl();
            expect(orderCode).toBeTruthy();

            const checkout = new CheckoutPage(page);
            await checkout.waitForLoaded();
            await checkout.payWithAtmInternetBanking();

            const onepay = new OnePayGateway(page);
            await onepay.selectFirstBankIfShown();
            await onepay.fillCard(DATA.onePayTestCard);
            await onepay.confirmPayment();
            await onepay.enterOtpAndVerify(DATA.onePayTestOtp);

            const finalUrl = new URL(page.url());
            const responseCode = finalUrl.searchParams.get("vpc_TxnResponseCode");
            const isPaid = responseCode === "0";

            console.log(
              `[tracking:order] order=${orderIndex + 1} orderCode=${orderCode} ` +
                `paid=${isPaid} responseCode=${responseCode}`
            );

            logBookingAttempt({
              fromCode: route.from.code,
              toCode: route.to.code,
              departureDate: departureIso,
              orderCode,
              status: isPaid ? "SUCCESS" : "FAILED",
              note: isPaid ? undefined : `vpc_TxnResponseCode=${responseCode}`,
            });

            expect(isPaid, `Thanh toán order ${orderCode} phải Approved (code 0)`).toBe(
              true
            );
            bookingDone = true;
          }
        );
      }

      expect(
        bookingDone,
        `Order ${orderIndex + 1} không đặt được vé sau ${DATA.maxSoldOutRetries} lần thử (hết chỗ/không có chuyến liên tục)`
      ).toBe(true);
    }
  });
});
