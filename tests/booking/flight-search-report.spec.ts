import { test, expect } from "@playwright/test";
import { FlightSearchWidget } from "../pages/flight/FlightSearchWidget";
import { FlightResultsPage } from "../pages/flight/FlightResultsPage";
import { FlightFilterSidebar } from "../pages/flight/FlightFilterSidebar";
import {
  DEFAULT_ROUTE_AIRPORTS,
  RouteAirport,
  daysFromNowToDate,
} from "../helpers/randomPassenger";
import { loadTestData } from "../helpers/testDataLoader";
import { pickNextAirlineBatch } from "../helpers/airlineRotationStore";
import {
  SearchReportWriter,
  createReportFilePath,
  SearchReportRow,
} from "../helpers/searchReportStore";

/**
 * Phần II — "a. Spec search lấy thông tin", Giai đoạn 1: search rồi đọc/lưu
 * thông tin (hãng bay, số chuyến, giá theo hạng vé...) ra báo cáo CSV. KHÔNG
 * tạo order — chỉ mở drawer xem hạng vé để đọc giá rồi đóng lại, không bấm
 * "Tiếp tục"/"Đặt ngay".
 *
 * Data (route pool, min-days, số hãng tối đa/lần chạy...) đọc từ file JSON
 * cùng tên `flight-search-report.json` — sửa file đó để thêm/bớt case, không
 * cần sửa code (xem helpers/testDataLoader.ts).
 *
 * CHƯA VERIFY LIVE (cần theo dõi kỹ lần chạy đầu):
 * - Bộ đếm người lớn/trẻ em/em bé (PassengerCountSelector) — đã code theo HTML
 *   thật nhưng chưa chạy thử.
 * - Khứ hồi (enableRoundTrip + selectReturnDay) — suy đoán date picker chuyển
 *   range mode, chưa verify.
 * - Mở/đóng drawer xem hạng vé qua Escape mà không vô tình tạo order.
 */

type SearchCase = {
  id: string;
  description: string;
  tripType: "oneway" | "roundtrip";
  routeType: "domestic" | "international";
  adults: number;
  children: number;
  infants: number;
  airlineNames: string[];
  stopFilter: "direct" | "onestop" | "multistop" | null;
  departureTimeFilter: "morning" | "noon" | "afternoon" | "night" | null;
};

type TestData = {
  cases: SearchCase[];
  defaults: {
    domesticMinDays: number;
    internationalMinDays: number;
    maxAirlinesPerRun: number;
    maxFlightsToInspectPerAirline: number;
  };
};

const DEFAULT_DATA: TestData = {
  cases: [
    {
      id: "case-1-domestic-adult-only",
      description: "Nội địa, chỉ người lớn, 1 chiều",
      tripType: "oneway",
      routeType: "domestic",
      adults: 1,
      children: 0,
      infants: 0,
      airlineNames: [],
      stopFilter: null,
      departureTimeFilter: null,
    },
  ],
  defaults: {
    domesticMinDays: 20,
    internationalMinDays: 40,
    maxAirlinesPerRun: 5,
    maxFlightsToInspectPerAirline: 2,
  },
};

const DATA = loadTestData<TestData>(__filename, DEFAULT_DATA);

function pickRandomRoute(routeType: "domestic" | "international"): {
  from: RouteAirport;
  to: RouteAirport;
} {
  const pool = DEFAULT_ROUTE_AIRPORTS.filter((a) =>
    routeType === "domestic" ? a.isDomestic : !a.isDomestic
  );
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  if (routeType === "domestic") {
    return { from: shuffled[0], to: shuffled[1] };
  }
  // Quốc tế: 1 đầu trong nước (Việt Nam) + 1 đầu quốc tế, cho hợp lệ với chuyến
  // bay quốc tế đi/đến Việt Nam.
  const domesticPool = DEFAULT_ROUTE_AIRPORTS.filter((a) => a.isDomestic);
  const from = domesticPool[Math.floor(Math.random() * domesticPool.length)];
  const to = pool[Math.floor(Math.random() * pool.length)];
  return { from, to };
}

test.describe("Search lấy thông tin chuyến bay (Phần II - Giai đoạn 1, không tạo order)", () => {
  for (const searchCase of DATA.cases) {
    test(`${searchCase.id}: ${searchCase.description}`, async ({ page }) => {
      test.setTimeout(10 * 60_000);

      const report = new SearchReportWriter(
        createReportFilePath(`search-report-${searchCase.id}`)
      );

      const minDays =
        searchCase.routeType === "domestic"
          ? DATA.defaults.domesticMinDays
          : DATA.defaults.internationalMinDays;
      const dayOffset = minDays + Math.floor(Math.random() * 10);
      const route = pickRandomRoute(searchCase.routeType);

      const search = new FlightSearchWidget(page);
      await search.goto();
      await search.selectFromAirport(route.from.searchText);
      await search.selectToAirport(route.to.searchText);

      if (searchCase.tripType === "roundtrip") {
        await search.enableRoundTrip();
      }

      await search.selectDepartureDay(daysFromNowToDate(dayOffset));

      if (searchCase.tripType === "roundtrip") {
        await search.selectReturnDay(daysFromNowToDate(dayOffset + 3));
      }

      if (searchCase.adults > 1 || searchCase.children > 0 || searchCase.infants > 0) {
        const paxSelector = search.passengerCountSelector();
        await paxSelector.open();
        await paxSelector.setCounts({
          adults: searchCase.adults,
          children: searchCase.children,
          infants: searchCase.infants,
        });
        await paxSelector.close();
      }

      await search.submit();

      const results = new FlightResultsPage(page);
      await results.waitForSearchDone();

      const tracking = await results.collectSearchTrackingData();
      console.log(
        `[search-report] case=${searchCase.id} route=${tracking.fromCode}->${tracking.toCode} ` +
          `airlines=${tracking.airlineCount}(${tracking.airlineNames.join(",")}) flights=${tracking.flightCount}`
      );

      if (tracking.flightCount === 0) {
        console.log(`[search-report] case=${searchCase.id} -> 0 kết quả, bỏ qua (WAITING_RECHECK)`);
        return;
      }

      const filterSidebar = new FlightFilterSidebar(page);

      if (searchCase.stopFilter) {
        await filterSidebar.filterByStop(searchCase.stopFilter);
      }
      if (searchCase.departureTimeFilter) {
        await filterSidebar.filterByDepartureTime(searchCase.departureTimeFilter);
      }

      const availableAirlineNames = await filterSidebar.listAvailableAirlines();
      console.log(`[search-report] case=${searchCase.id} available airlines: ${availableAirlineNames.join(", ")}`);

      // searchCase.airlineNames phải khai báo đúng TÊN hiển thị trên filter sidebar
      // (VD "Vietnam Airlines"), không phải mã hãng — filter UI không có mã trong DOM.
      const targetAirlineNames = searchCase.airlineNames.length
        ? searchCase.airlineNames
        : pickNextAirlineBatch(availableAirlineNames, DATA.defaults.maxAirlinesPerRun);

      console.log(`[search-report] case=${searchCase.id} target airlines: ${targetAirlineNames.join(", ")}`);

      for (const airlineName of targetAirlineNames) {
        await filterSidebar.filterByAirlineName(airlineName).catch((err) => {
          console.log(`[search-report] filterByAirlineName(${airlineName}) lỗi: ${err.message}`);
        });
        await page.waitForTimeout(500);

        const flightCount = Math.min(
          DATA.defaults.maxFlightsToInspectPerAirline,
          await page.locator(".flights__list--item-choose-btn").count()
        );
        console.log(`[search-report] airline=${airlineName} flightCount sau filter=${flightCount}`);

        for (let i = 0; i < flightCount; i++) {
          const drawer = await results.openFareDrawerForFlight(i).catch((err) => {
            console.log(`[search-report] openFareDrawerForFlight(${i}) lỗi: ${err.message}`);
            return null;
          });
          if (!drawer) continue;

          const legs = await drawer.readLegs();
          console.log(
            `[search-report] flight#${i} legs=${legs.length} fares=${legs.map((l) => l.fares.length).join(",")}`
          );
          const rows: SearchReportRow[] = [];
          for (const [legIndex, leg] of legs.entries()) {
            // leg 0 luôn là chiều đi; leg 1 (nếu có, khứ hồi) là chiều về —
            // khớp thứ tự render cố định trong DrawerReviewFlights.tsx.
            const isReturnLeg = legIndex > 0;
            for (const fare of leg.fares) {
              rows.push({
                caseId: searchCase.id,
                conditionDescription: searchCase.description,
                route: `${route.from.code}->${route.to.code}`,
                tripType: searchCase.tripType,
                airline: leg.airline || airlineName,
                flightNumber: leg.flightNumber,
                departureDate: isReturnLeg ? undefined : leg.legDate,
                returnDate: isReturnLeg ? leg.legDate : undefined,
                departureTime: leg.departureTime,
                arrivalTime: leg.arrivalTime,
                stopLabel: leg.stopLabel,
                fareClass: fare.className,
                adultOldPrice: fare.oldPrice ?? undefined,
                ticketPrice: fare.ticketPrice ?? undefined,
                taxPrice: fare.taxFee ?? undefined,
                adultPrice: fare.price ?? 0,
              });
            }
          }
          report.appendRows(rows);

          await drawer.closeWithoutBooking();
        }

        // Bỏ tick hãng vừa xong trước khi sang hãng tiếp theo (toggle off).
        await filterSidebar.filterByAirlineName(airlineName).catch(() => {});
      }

      console.log(`[search-report] case=${searchCase.id} -> báo cáo: ${report.getFilePath()}`);
    });
  }
});
