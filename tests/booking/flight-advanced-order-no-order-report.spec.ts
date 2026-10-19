import { test } from "@playwright/test";
import { FlightSearchWidget } from "../pages/flight/FlightSearchWidget";
import { FlightResultsPage, FlightSearchTrackingData } from "../pages/flight/FlightResultsPage";
import { FlightFilterSidebar } from "../pages/flight/FlightFilterSidebar";
import { PassengerFormPage, PassengerInput, PassengerType } from "../pages/flight/PassengerFormPage";
import { BaggageSeatSelector, NOT_SUPPORTED_LABEL } from "../pages/flight/BaggageSeatSelector";
import { PriceDetailPanel } from "../pages/flight/PriceDetailPanel";
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
 * "Search để tạo order" (Phần II) — BẢN NHẸ, KHÔNG TẠO ORDER THẬT: đi tới hết
 * bước chọn hành lý/chỗ ngồi trên trang điền hành khách rồi DỪNG (KHÔNG bấm
 * "Tiếp tục đến bước thanh toán", KHÔNG gọi `POST /orders/create`) — chỉ đọc
 * và báo cáo lại TOÀN BỘ giá nhận được tại thời điểm đó (giá vé cache từ
 * search + giá hành lý/chỗ ngồi đã cộng vào, đọc live qua cùng panel "Chi tiết
 * giá" đã verify tồn tại và hoạt động đúng ngay trên trang này — không cần đợi
 * sang trang checkout).
 *
 * Mục đích: giảm tải số lượng ORDER THẬT phải tạo (so với
 * flight-advanced-order.spec.ts — bản ĐẦY ĐỦ, có tạo order + luân phiên cổng
 * thanh toán) khi chỉ cần khảo sát giá hành lý/chỗ ngồi trên diện rộng. Vì
 * không tạo order nên KHÔNG có rủi ro "hết chỗ lúc xác nhận" và không có dữ
 * liệu phí cổng thanh toán (cột paymentGateway/paymentGatewayFee để trống).
 *
 * Giống flight-advanced-order.spec.ts ở: random route (nội địa+quốc tế), random
 * hạng ghế/hạng vé (flatten qua mọi tab, có thể ép cố định qua `fareOrdinal`),
 * rotation hãng bay (không lặp lại hãng đã test, dùng CHUNG state file với bản
 * đầy đủ — `.test-state/airline-rotation.json`), hãng không hỗ trợ hành
 * lý/chỗ ngồi vẫn tiếp tục bình thường (ghi "Không hỗ trợ" thay vì để trống).
 *
 * TOÀN BỘ data ở DEFAULT_DATA có thể override bằng file JSON cùng tên
 * (flight-advanced-order-no-order-report.json).
 */

type TestData = {
  // Không tạo order thật -> rẻ hơn nhiều so với bản đầy đủ -> mặc định chạy
  // nhiều lượt hơn để khảo sát rộng hơn.
  maxIterationsPerRun: number;
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
  maxIterationsPerRun: 5,
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

test.describe("Search để tạo order — bản nhẹ (dừng ở bước chọn hành lý/chỗ ngồi, không tạo order thật)", () => {
  test("search → chọn vé → điền hành khách → chọn hành lý/chỗ ngồi → đọc giá → dừng (không thanh toán, không tạo order)", async ({
    page,
  }) => {
    test.setTimeout(15 * 60_000);

    const report = new OrderCostReportWriter(
      createOrderCostReportFilePath("pre-order-price-report")
    );

    for (let iterationIndex = 0; iterationIndex < DATA.maxIterationsPerRun; iterationIndex++) {
      const route = randomRoute(DATA.routes);
      const dayOffset = randomDaysFromNow(
        route.isInternational,
        DATA.domesticMinDays,
        DATA.internationalMinDays
      );
      const departureIso = toIsoDate(dayOffset);
      const counts = randomPassengerCounts();
      // Random 50/50 khứ hồi — không ép mọi lượt đều khứ hồi để vẫn giữ diện
      // khảo sát 1 chiều rộng như trước.
      const isRoundTrip = Math.random() < 0.5;
      // Ngày về cách ngày đi RANDOM tối đa 5 ngày (1-5 ngày sau ngày đi) — theo
      // yêu cầu, tạm thời set up đơn giản vậy đã.
      const returnGapDays = 1 + Math.floor(Math.random() * 5); // 1..5
      const returnDayOffset = dayOffset + returnGapDays;
      const returnDateIso = toIsoDate(returnDayOffset);

      await test.step(
        `Lượt ${iterationIndex + 1}/${DATA.maxIterationsPerRun} — ${route.from.code}->${route.to.code} ` +
          `${isRoundTrip ? `khứ hồi +${dayOffset}/+${returnDayOffset}` : `1 chiều +${dayOffset}`} ` +
          `(${counts.adults} người lớn, ${counts.children} trẻ em, ${counts.infants} em bé)`,
        async () => {
          const search = new FlightSearchWidget(page);
          await search.goto();
          await search.selectFromAirport(route.from.searchText);
          await search.selectToAirport(route.to.searchText);

          if (isRoundTrip) {
            await search.enableRoundTrip();
          }

          await search.selectDepartureDay(daysFromNowToDate(dayOffset));

          if (isRoundTrip) {
            await search.selectReturnDay(daysFromNowToDate(returnDayOffset));
          }

          if (counts.adults > 1 || counts.children > 0 || counts.infants > 0) {
            const paxSelector = search.passengerCountSelector();
            await paxSelector.open();
            await paxSelector.setCounts(counts);
            await paxSelector.close();
          }

          await search.submit();

          const results = new FlightResultsPage(page);
          await results.waitForSearchDone();

          const tracking: FlightSearchTrackingData = await results.collectSearchTrackingData();
          console.log(
            `[pre-order-price] lượt=${iterationIndex + 1} route=${tracking.fromCode}->${tracking.toCode} ` +
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

          const filterSidebar = new FlightFilterSidebar(page);
          const availableAirlineNames = await filterSidebar.listAvailableAirlines();
          const [targetAirline] = pickNextAirlineBatch(availableAirlineNames, 1);
          console.log(`[pre-order-price] lượt=${iterationIndex + 1} targetAirline=${targetAirline}`);
          await filterSidebar.filterByAirlineName(targetAirline);
          await page.waitForTimeout(1200);

          let cabinClassSummary: string | null;
          let fareClassSummary: string | null;
          if (isRoundTrip) {
            const { outbound, return: ret } = await results.chooseRoundTripFlightsAndContinue(
              0,
              0,
              DATA.fareOrdinal ?? undefined
            );
            cabinClassSummary = `đi:${outbound.cabinClass ?? "-"} / về:${ret.cabinClass ?? "-"}`;
            fareClassSummary = `đi:${outbound.fareClass ?? "-"} / về:${ret.fareClass ?? "-"}`;
          } else {
            const { cabinClass, fareClass } = await results.chooseFlightWithRandomFareAndContinue(
              0,
              DATA.fareOrdinal ?? undefined
            );
            cabinClassSummary = cabinClass;
            fareClassSummary = fareClass;
          }
          console.log(
            `[pre-order-price] lượt=${iterationIndex + 1} cabinClass=${cabinClassSummary} fareClass=${fareClassSummary}`
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

          const baggageSeat = new BaggageSeatSelector(page);
          // Hành lý: tự xử lý hết mọi "purchase box" tìm thấy trên trang (đã
          // gồm cả 2 chặng nếu khứ hồi — mỗi người × mỗi chặng 1 box riêng).
          const baggageResults = await baggageSeat.selectCheapestInlineBaggage();
          // Ghế: khứ hồi cần legCount=2 (chuyển qua "Chiều đi"/"Chiều về" trong
          // modal, mỗi chặng chọn riêng cho từng người — VD 3 người khứ hồi =
          // 6 lượt chọn).
          const seatResultsByLeg = await baggageSeat.selectFirstAvailableSeat(
            passengerList.length,
            isRoundTrip ? 2 : 1
          );
          // Gộp kết quả thành 1 chuỗi tóm tắt cho report (tách riêng từng
          // người/chặng là việc #5 trong plan, chưa làm) — VD "11B, 12A".
          const baggageInfoSummary =
            baggageResults.length > 0
              ? baggageResults.map((r) => r.baggageInfo).join(", ")
              : NOT_SUPPORTED_LABEL;
          const seatNumberSummary = isRoundTrip
            ? `đi:[${(seatResultsByLeg[0] ?? []).map((r) => r.seatNumber).join(", ")}] ` +
              `về:[${(seatResultsByLeg[1] ?? []).map((r) => r.seatNumber).join(", ")}]`
            : (seatResultsByLeg[0] ?? []).map((r) => r.seatNumber).join(", ");
          console.log(
            `[pre-order-price] lượt=${iterationIndex + 1} baggage=[${baggageInfoSummary}] seat=[${seatNumberSummary}]`
          );

          // Check-in Online — toggle GLOBAL duy nhất cho cả booking (khác
          // hành lý/ghế), 1 lần chọn là đủ. Có thể không hiện tuỳ booking.
          const checkinSelected = await baggageSeat.selectCheckinOnline();
          console.log(`[pre-order-price] lượt=${iterationIndex + 1} checkinOnline=${checkinSelected}`);

          // Panel "Chi tiết giá" đã verify tồn tại + hoạt động đúng NGAY trên
          // trang điền hành khách (trước khi submit) — đọc trực tiếp ở đây,
          // KHÔNG cần bấm "Tiếp tục đến bước thanh toán"/tạo order thật.
          const pricePanel = new PriceDetailPanel(page);
          await pricePanel.waitForLoaded();
          const breakdown = await pricePanel.read();
          console.log(
            `[pre-order-price] lượt=${iterationIndex + 1} giá=${JSON.stringify(breakdown)}`
          );

          const row: OrderCostReportRow = {
            orderIndex: iterationIndex + 1,
            orderCode: "",
            route: `${route.from.code}->${route.to.code}`,
            tripType: isRoundTrip ? "roundtrip" : "oneway",
            departureDate: isRoundTrip ? `${departureIso} / ${returnDateIso}` : departureIso,
            airline: targetAirline,
            cabinClass: cabinClassSummary ?? undefined,
            fareClass: fareClassSummary ?? undefined,
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
            // Không tạo order -> không có cổng thanh toán để chọn.
            paymentGateway: "",
            paymentGatewayFee: undefined,
            totalWithGateway: breakdown.total ?? undefined,
          };
          report.appendRows([row]);

          logBookingAttempt({
            fromCode: route.from.code,
            toCode: route.to.code,
            departureDate: departureIso,
            orderCode: null,
            status: "SUCCESS",
            note: `[bản nhẹ, không tạo order] Hãng ${targetAirline} — baggage=[${baggageInfoSummary}] seat=[${seatNumberSummary}]`,
          });
        }
      );
    }

    console.log(`[pre-order-price] báo cáo: ${report.getFilePath()}`);
  });
});
