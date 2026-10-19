import { test, expect } from "@playwright/test";
import { FlightSearchWidget } from "../pages/flight/FlightSearchWidget";
import { FlightResultsPage, FlightSearchTrackingData } from "../pages/flight/FlightResultsPage";
import { FlightFilterSidebar } from "../pages/flight/FlightFilterSidebar";
import { PassengerFormPage, PassengerInput, PassengerType } from "../pages/flight/PassengerFormPage";
import { BaggageSeatSelector, NOT_SUPPORTED_LABEL } from "../pages/flight/BaggageSeatSelector";
import { PriceDetailPanel } from "../pages/flight/PriceDetailPanel";
import {
  PaymentMethodSelector,
  TOP_LEVEL_PAYMENT_GATEWAYS,
  PaymentGatewayLabel,
} from "../pages/flight/PaymentMethodSelector";
import {
  randomAdultDob,
  randomChildDob,
  randomInfantDob,
  randomCccd,
  randomPassportNumber,
  randomDocumentExpiry,
  randomForeignNationality,
  randomPassengerName,
  randomAbroadPassengerName,
  splitPassengerName,
  randomRoute,
  randomDaysFromNow,
  randomPassengerCounts,
  daysFromNowToDate,
  RouteAirport,
  PassengerCounts,
  DEFAULT_ROUTE_AIRPORTS,
  DEFAULT_PASSENGER_NAMES,
  DEFAULT_ABROAD_PASSENGER_NAMES,
  DEFAULT_FOREIGN_NATIONALITIES,
} from "../helpers/randomPassenger";
import { logBookingAttempt } from "../helpers/testStateStore";
import { pickNextAirlineBatch } from "../helpers/airlineRotationStore";
import { loadTestData } from "../helpers/testDataLoader";
import {
  OrderCostReportWriter,
  OrderCostReportRow,
  createOrderCostReportFilePath,
} from "../helpers/orderCostReportStore";

/**
 * "Search để tạo order" (Phần II): tái sử dụng logic đặt vé của
 * flight-domestic-simple.spec.ts (Phần I) nhưng DỪNG LẠI ngay sau khi tạo order
 * thành công (KHÔNG sang trang thanh toán, KHÔNG bấm "Thanh toán") — chỉ để thu
 * thập chi phí thật của order (giá vé/thuế/phí được server verify lúc tạo order,
 * chính xác hơn giá cache lúc search).
 *
 * Luân phiên qua các cổng thanh toán khác nhau NGAY TRÊN order vừa tạo (chọn
 * từng phương thức, đọc lại dòng "Phí tiện ích" + tổng cuối, KHÔNG bấm nút
 * "Thanh toán") để có dữ liệu phí theo từng loại cổng.
 *
 * Mỗi order trong 1 lần chạy nhắm vào 1 HÃNG BAY KHÁC NHAU (dùng
 * `pickNextAirlineBatch` — cùng cơ chế rotation đã xây cho
 * flight-search-report.spec.ts): ưu tiên hãng CHƯA từng test ở các lần chạy
 * trước (lưu persistent trong `.test-state/airline-rotation.json`), hết hãng
 * mới thì quay vòng random lại trong tập đã test. Hãng nào không hỗ trợ chọn
 * trước hành lý/chỗ ngồi vẫn tạo order bình thường — report chỉ ghi rõ
 * "Không hỗ trợ" ở cột tương ứng, không coi là lỗi/không bỏ qua order.
 *
 * Route + hạng ghế/hạng vé MẶC ĐỊNH random đầy đủ (cả nội địa lẫn quốc tế,
 * mọi tab hạng ghế) — có thể ép CỐ ĐỊNH 1 vị trí hạng vé cụ thể qua
 * `fareOrdinal` trong JSON override (đếm từ 1, gộp tuần tự qua mọi tab hạng
 * ghế; vượt quá số hạng thực có thì tự lấy hạng cuối cùng).
 *
 * LƯU Ý: mỗi order ở đây là ĐƠN HÀNG THẬT (gọi `POST /orders/create` thật) —
 * giống rủi ro side-effect như Phần I. Luôn chạy TUẦN TỰ (không parallel), giới
 * hạn số order/lần chạy qua `maxOrdersPerRun`.
 *
 * TOÀN BỘ data ở DEFAULT_DATA có thể override bằng file JSON cùng tên
 * (flight-advanced-order.json) — xem helpers/testDataLoader.ts.
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
  /** Vị trí hạng vé cố định (đếm từ 1, gộp tuần tự qua mọi tab hạng ghế) —
   * null/không khai báo = random (mặc định). */
  fareOrdinal: number | null;
  contact: {
    fullName: string;
    phone: string;
    emails: string[];
  };
};

const DEFAULT_DATA: TestData = {
  // 1 lần chạy = 3 order, mỗi order 1 hãng bay khác nhau.
  maxOrdersPerRun: 3,
  maxSoldOutRetries: 3,
  domesticMinDays: 20,
  internationalMinDays: 40,
  routes: DEFAULT_ROUTE_AIRPORTS,
  passengerNames: DEFAULT_PASSENGER_NAMES,
  abroadPassengerNames: DEFAULT_ABROAD_PASSENGER_NAMES,
  foreignNationalities: DEFAULT_FOREIGN_NATIONALITIES,
  fareOrdinal: null,
  contact: {
    fullName: "VO PHAM DANG KHOA",
    phone: "935912495",
    emails: ["vophamdangkhoa.010103@gmail.com", "akiyoshimeo@gmail.com"],
  },
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

/**
 * Sinh danh sách hành khách theo đúng thứ tự form thật render: người lớn
 * trước, rồi trẻ em, rồi em bé (PassengerInformation.tsx — 3 vòng `.map()`
 * liên tiếp, index toàn cục không reset theo loại). Quốc tế: mọi loại đều cần
 * hộ chiếu (đã verify source). Nội địa: chỉ người lớn có thể có CCCD (field
 * tự ẩn nếu hãng không hỗ trợ — không cần biết trước, cứ truyền vào an toàn).
 */
function buildPassengerList(
  counts: PassengerCounts,
  isDomestic: boolean,
  passengerNames: string[],
  abroadPassengerNames: string[],
  foreignNationalities: string[]
): { type: PassengerType; input: PassengerInput }[] {
  const list: { type: PassengerType; input: PassengerInput }[] = [];

  const pushOne = (type: PassengerType, dob: ReturnType<typeof randomAdultDob>) => {
    const { lastName, firstName } = splitPassengerName(
      isDomestic ? randomPassengerName(passengerNames) : randomAbroadPassengerName(abroadPassengerNames)
    );
    const input: PassengerInput = isDomestic
      ? { lastName, firstName, dob, documentNumber: randomCccd(), documentExpiry: randomDocumentExpiry() }
      : {
          lastName,
          firstName,
          dob,
          nationality: randomForeignNationality(foreignNationalities),
          documentNumber: randomPassportNumber(),
          documentExpiry: randomDocumentExpiry(),
        };
    list.push({ type, input });
  };

  for (let i = 0; i < counts.adults; i++) pushOne("ADULT", randomAdultDob());
  for (let i = 0; i < counts.children; i++) pushOne("CHILD", randomChildDob());
  for (let i = 0; i < counts.infants; i++) pushOne("INFANT", randomInfantDob());

  return list;
}

test.describe("Search để tạo order (Phần II — dừng trước bước thanh toán)", () => {
  test("search → chọn vé → điền hành khách → tạo order → luân phiên cổng thanh toán đọc phí (không thanh toán)", async ({
    page,
  }) => {
    // Mỗi order: search + điền form + tạo order + 5 lần đổi cổng thanh toán.
    test.setTimeout(15 * 60_000);

    const report = new OrderCostReportWriter(
      createOrderCostReportFilePath("order-cost-report")
    );

    for (let orderIndex = 0; orderIndex < DATA.maxOrdersPerRun; orderIndex++) {
      let orderCreated = false;

      for (
        let soldOutRetry = 0;
        soldOutRetry < DATA.maxSoldOutRetries && !orderCreated;
        soldOutRetry++
      ) {
        // Đổi điều kiện (chặng + ngày) mỗi lần thử để tránh trùng tồn kho giữa
        // các order/lần retry trong cùng 1 lần chạy.
        const route = randomRoute(DATA.routes);
        const dayOffset = randomDaysFromNow(
          route.isInternational,
          DATA.domesticMinDays,
          DATA.internationalMinDays
        );
        const departureIso = toIsoDate(dayOffset);
        const counts = randomPassengerCounts();

        await test.step(
          `Order ${orderIndex + 1}/${DATA.maxOrdersPerRun} — ${route.from.code}->${route.to.code} ` +
            `ngày +${dayOffset} (thử ${soldOutRetry + 1}/${DATA.maxSoldOutRetries}) — ` +
            `${counts.adults} người lớn, ${counts.children} trẻ em, ${counts.infants} em bé`,
          async () => {
            const search = new FlightSearchWidget(page);
            await search.goto();
            await search.selectFromAirport(route.from.searchText);
            await search.selectToAirport(route.to.searchText);

            await search.selectDepartureDay(daysFromNowToDate(dayOffset));

            if (counts.adults > 1 || counts.children > 0 || counts.infants > 0) {
              const paxSelector = search.passengerCountSelector();
              await paxSelector.open();
              await paxSelector.setCounts(counts);
              await paxSelector.close();
            }

            await search.submit();

            const results = new FlightResultsPage(page);
            await results.waitForSearchDone();

            const tracking: FlightSearchTrackingData =
              await results.collectSearchTrackingData();
            console.log(
              `[order-cost] order=${orderIndex + 1} route=${tracking.fromCode}->${tracking.toCode} ` +
                `flights=${tracking.flightCount}`
            );

            if (tracking.flightCount === 0) {
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

            // Lọc theo 1 hãng bay CHƯA test (ưu tiên qua pickNextAirlineBatch) —
            // đảm bảo 3 order trong 1 lần chạy nhắm 3 hãng khác nhau khi route
            // cho phép, và không lặp lại hãng đã test ở các lần chạy trước.
            const filterSidebar = new FlightFilterSidebar(page);
            const availableAirlineNames = await filterSidebar.listAvailableAirlines();
            const [targetAirline] = pickNextAirlineBatch(availableAirlineNames, 1);
            console.log(`[order-cost] order=${orderIndex + 1} targetAirline=${targetAirline}`);
            await filterSidebar.filterByAirlineName(targetAirline);
            await page.waitForTimeout(1200);

            const { cabinClass, fareClass } = await results.chooseFlightWithRandomFareAndContinue(
              0,
              DATA.fareOrdinal ?? undefined
            );
            console.log(
              `[order-cost] order=${orderIndex + 1} cabinClass=${cabinClass} fareClass=${fareClass}`
            );

            const passengerForm = new PassengerFormPage(page);
            await passengerForm.waitForLoaded();

            const passengerList = buildPassengerList(
              counts,
              !route.isInternational,
              DATA.passengerNames,
              DATA.abroadPassengerNames,
              DATA.foreignNationalities
            );
            for (let p = 0; p < passengerList.length; p++) {
              const { type, input } = passengerList[p];
              await passengerForm.fillPassenger(input, !route.isInternational, p, type);
            }

            await passengerForm.fillContact({
              fullName: DATA.contact.fullName,
              phone: DATA.contact.phone,
              email: pickRandomEmail(),
            });

            // Chọn hành lý + chỗ ngồi TRƯỚC khi tạo order — cả 2 đều gọi API
            // thật lần đầu tương tác (khác giá vé cơ bản lấy từ cache lúc
            // search). Best-effort: addon có thể không khả dụng tuỳ booking
            // (hệ thống 1G/Galileo, bay trong 24h...), không coi là lỗi nếu
            // không chọn được — chỉ ảnh hưởng cột baggageFee/seatFee = rỗng.
            const baggageSeat = new BaggageSeatSelector(page);
            const baggageResults = await baggageSeat.selectCheapestInlineBaggage();
            // TODO (khứ hồi): legCount hiện cố định 1 — spec này mới hỗ trợ 1
            // chiều, cần truyền legCount=2 khi tích hợp chooseRoundTripFlightsAndContinue.
            const seatResultsByLeg = await baggageSeat.selectFirstAvailableSeat(passengerList.length, 1);
            const seatResults = seatResultsByLeg[0] ?? [];
            // Gộp kết quả từng hành khách thành 1 chuỗi tóm tắt cho report (tách
            // riêng từng người là việc #5 trong plan, chưa làm) — VD "11B, 12A".
            const baggageInfoSummary =
              baggageResults.length > 0
                ? baggageResults.map((r) => r.baggageInfo).join(", ")
                : NOT_SUPPORTED_LABEL;
            const seatNumberSummary = seatResults.map((r) => r.seatNumber).join(", ");
            console.log(
              `[order-cost] order=${orderIndex + 1} baggage=[${baggageInfoSummary}] seat=[${seatNumberSummary}]`
            );

            // Check-in Online — toggle GLOBAL duy nhất cho cả booking (khác
            // hành lý/ghế), 1 lần chọn là đủ. Có thể không hiện tuỳ booking.
            const checkinSelected = await baggageSeat.selectCheckinOnline();
            console.log(`[order-cost] order=${orderIndex + 1} checkinOnline=${checkinSelected}`);

            // submitBooking() đã tự xử lý modal "giá thay đổi" (verify lúc tạo
            // order) — chấp nhận giá mới và tạo order tiếp, không coi là lỗi.
            const bookingOutcome = await passengerForm.submitBooking();

            if (bookingOutcome === "sold_out") {
              logBookingAttempt({
                fromCode: route.from.code,
                toCode: route.to.code,
                departureDate: departureIso,
                orderCode: null,
                status: "FAILED",
                note: "Hết chỗ lúc tạo order — sẽ đổi điều kiện thử lại",
              });
              return;
            }

            const orderCode = passengerForm.getOrderCodeFromUrl();
            expect(orderCode).toBeTruthy();
            console.log(`[order-cost] order=${orderIndex + 1} orderCode=${orderCode} -> tạo thành công`);

            const pricePanel = new PriceDetailPanel(page);
            await pricePanel.waitForLoaded();
            const gatewaySelector = new PaymentMethodSelector(page);

            const rows: OrderCostReportRow[] = [];
            for (const gateway of TOP_LEVEL_PAYMENT_GATEWAYS as readonly PaymentGatewayLabel[]) {
              await gatewaySelector.selectByLabel(gateway).catch((err) => {
                console.log(`[order-cost] chọn cổng "${gateway}" lỗi: ${err.message}`);
              });
              // Phí cổng chỉ tính lại ở FE (tra bảng rate cục bộ, không gọi API)
              // nên chỉ cần đợi ngắn cho re-render, không cần chờ network.
              await page.waitForTimeout(400);
              const breakdown = await pricePanel.read();
              console.log(
                `[order-cost] orderCode=${orderCode} gateway=${gateway} fee=${breakdown.paymentGatewayFee} total=${breakdown.total}`
              );
              rows.push({
                orderIndex: orderIndex + 1,
                orderCode: orderCode ?? "",
                route: `${route.from.code}->${route.to.code}`,
                tripType: "oneway",
                departureDate: departureIso,
                airline: targetAirline,
                cabinClass: cabinClass ?? undefined,
                fareClass: fareClass ?? undefined,
                adults: counts.adults,
                children: counts.children,
                infants: counts.infants,
                adultTicket: breakdown.adultTicket ?? undefined,
                childTicket: breakdown.childTicket ?? undefined,
                infantTicket: breakdown.infantTicket ?? undefined,
                taxAndFee: breakdown.taxAndFee ?? undefined,
                baggageFee: breakdown.baggageFee ?? undefined,
                baggageInfo: baggageInfoSummary,
                seatFee: breakdown.seatFee ?? undefined,
                seatNumber: seatNumberSummary,
                checkinFee: breakdown.checkinFee ?? undefined,
                discount: breakdown.discount ?? undefined,
                paymentGateway: gateway,
                paymentGatewayFee: breakdown.paymentGatewayFee ?? undefined,
                totalWithGateway: breakdown.total ?? undefined,
              });
            }
            report.appendRows(rows);

            logBookingAttempt({
              fromCode: route.from.code,
              toCode: route.to.code,
              departureDate: departureIso,
              orderCode,
              status: "SUCCESS",
              note: `Hãng ${targetAirline} — baggage=[${baggageInfoSummary}] seat=[${seatNumberSummary}] — dừng sau khi tạo order`,
            });

            orderCreated = true;
          }
        );
      }

      expect(
        orderCreated,
        `Order ${orderIndex + 1} không tạo được sau ${DATA.maxSoldOutRetries} lần thử (hết chỗ/không có chuyến liên tục)`
      ).toBe(true);
    }

    console.log(`[order-cost] báo cáo: ${report.getFilePath()}`);
  });
});
