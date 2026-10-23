# B2C-test — Playwright test cho traveleasy-web-user

Bộ test E2E/UI dùng Playwright để kiểm thử FE của app `traveleasy-web-user`
(repo nằm cùng cấp: `../traveleasy-web-user`).

## Cài đặt

```bash
npm install
npx playwright install   # cài browser (chromium, firefox, webkit)
```

Copy `.env.example` thành `.env` và chỉnh lại nếu cần:

```bash
cp .env.example .env
```

## Chạy app cần test

Test chạy nhắm vào `BASE_URL` khai báo trong `.env`. Có 2 lựa chọn:

**1. Dùng site dev public (khuyến nghị — nhanh & ổn định hơn nhiều):**

```env
BASE_URL=https://dev.triphubs.vn
```

Không cần start gì thêm, chạy test luôn.

**2. Dùng app chạy local:**

```bash
cd ../traveleasy-web-user
yarn dev
```

```env
BASE_URL=http://localhost:3000
```

Hoặc đặt `START_WEB_SERVER=true` trong `.env` để Playwright tự chạy `yarn dev`
giúp bạn (xem `playwright.config.ts`).

> Lưu ý: app local chạy ở Next dev mode (Turbopack) nên lần build đầu của mỗi
> route sẽ **chậm hơn đáng kể** so với site dev public (có lúc >1 phút cho 1
> route nặng như trang đặt vé). Nếu test bị timeout ở lần chạy đầu, hãy chạy
> lại, hoặc ưu tiên dùng `BASE_URL=https://dev.triphubs.vn` thay vì local.

## Chạy test

```bash
npm test                 # chạy tất cả project (chromium, firefox, webkit, mobile-chrome)
npm run test:chromium    # chỉ chạy chromium (nhanh hơn khi dev)
npm run test:headed      # chạy có hiển thị browser
npm run test:ui          # mở Playwright UI mode
npm run test:debug       # chạy debug step-by-step
npm run report           # mở report HTML sau khi chạy
```

Chạy 1 file hoặc 1 test cụ thể:

```bash
npx playwright test tests/auth/login.spec.ts
npx playwright test -g "mở modal đăng nhập"
```

## Cấu trúc thư mục

```
playwright.config.ts     # cấu hình chính: baseURL, project (browser), reporter...
tests/
  pages/                  # Page Object Model — nơi chứa locator/action của từng page/modal
    HomePage.ts
    LoginModal.ts
    flight/               # POM cho luồng đặt vé máy bay (xem mục riêng bên dưới)
      FlightSearchWidget.ts
      FlightResultsPage.ts
      FlightFilterSidebar.ts
      FlightFareDrawer.ts
      PassengerCountSelector.ts
      PassengerFormPage.ts
      BaggageSeatSelector.ts
      PriceDetailPanel.ts
      PaymentMethodSelector.ts
      CheckoutPage.ts
      OnePayGateway.ts
  helpers/                # Hàm dùng chung: sinh dữ liệu random, lưu log trạng thái test, ghi báo cáo CSV
    randomPassenger.ts
    testStateStore.ts
    airlineRotationStore.ts
    searchReportStore.ts
    orderCostReportStore.ts
    testDataLoader.ts       # Nạp data override từ file JSON cùng tên với spec
  smoke/                  # Test khói: trang chủ load được, điều hướng các trang chính (đang SKIP)
    home.spec.ts
    navigation.spec.ts
  auth/                   # Test luồng đăng nhập (đang SKIP)
    login.spec.ts
  booking/                # Test luồng đặt vé / search / tạo order (xem tests/booking/README.md)
    flight-domestic-simple.spec.ts        # Phần I: đặt vé + thanh toán OnePay đầy đủ
    flight-search-report.spec.ts          # Phần II Giai đoạn 1: chỉ đọc giá, không tạo order
    flight-advanced-order.spec.ts         # Phần II: tạo order thật + luân phiên cổng thanh toán
    flight-advanced-order-no-order-report.spec.ts  # Giống trên nhưng KHÔNG tạo order thật
    *.json                                 # Override data cho spec cùng tên — xem tests/booking/README.md
  metasearch/             # So sánh kết quả search metasearch đối tác vs web gốc (xem tests/metasearch/README.md)
    metasearch-vs-web.spec.ts             # Chạy: yarn compare:metasearch
    metasearch-vs-web.json                # Mẫu điều kiện, danh sách sân bay, timeout
```

> `smoke/` và `auth/` hiện đang `test.describe.skip` — là case cũ dùng để verify
> config lúc setup ban đầu, giữ lại tham khảo cách viết POM, không chạy mặc định.

## Luồng đặt vé máy bay + thanh toán

Test `tests/booking/flight-domestic-simple.spec.ts` tự động hoá toàn bộ hành
trình đặt vé + thanh toán thật (tạo đơn thật, gửi email thật, thanh toán sandbox
OnePay). **Đọc kỹ [`tests/booking/README.md`](tests/booking/README.md) trước
khi chạy** — có cảnh báo quan trọng, hướng dẫn chạy, cơ chế random/retry, và
danh sách giới hạn/phần chưa verify.

## Quy ước viết test

- Dùng Page Object Model (`tests/pages/*`): mọi locator của 1 page/modal gom
  vào 1 class, test chỉ gọi method/locator qua object đó — không lặp lại
  selector ở nhiều file.
- Ưu tiên locator theo role + accessible name (`getByRole`, `getByPlaceholder`,
  `getByText`) trước khi dùng class/CSS, vì app chưa có `data-testid`. Chỉ rơi
  về class CSS khi phần tử không có role phù hợp (ví dụ: `<a>` không có
  `href` thì không có role `link` trong accessibility tree).
- Khi 1 trang có nhiều phần tử trùng role (ví dụ nhiều `role="dialog"` lúc
  modal đang chuyển động), luôn `.filter({ hasText: ... })` hoặc scope vào
  container cụ thể để tránh strict-mode violation.
- Mỗi test tạo `page`/context riêng (mặc định của Playwright) — không phụ
  thuộc thứ tự chạy giữa các test.

## Mở rộng thêm

Bộ test này mới cover smoke (trang chủ, điều hướng) và luồng đăng nhập cơ
bản. Có thể mở rộng thêm theo cùng pattern POM:

- `tests/pages/SignupModal.ts`, `tests/auth/signup.spec.ts`
- `tests/pages/FlightSearchForm.ts` + test luồng tìm & đặt vé máy bay
- `tests/pages/HotelSearchForm.ts` + test luồng tìm khách sạn
- Test cho `/profile`, `/my-booking`, `/my-vouchers` (cần tài khoản test đã
  đăng nhập — có thể dùng `storageState` của Playwright để tái sử dụng session
  đăng nhập giữa các test, tránh phải login lại mỗi lần).
