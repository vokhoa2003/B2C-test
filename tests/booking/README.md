# Test đặt vé máy bay + thanh toán

Thư mục này gồm **2 phần**:

- **Phần I** (`flight-domestic-simple.spec.ts`): luồng đơn giản, tự động hoá
  **toàn bộ** hành trình đặt vé thật: tìm chuyến → chọn vé → điền hành khách →
  tạo đơn → thanh toán qua OnePay (thẻ test Vietcombank) → nhập OTP → xác nhận
  thành công.
- **Phần II**: điều kiện đa dạng hơn (random hạng ghế/hạng vé, luân phiên hãng
  bay, hành lý/chỗ ngồi, luân phiên cổng thanh toán), tách thành nhiều spec
  theo từng mục đích khác nhau — xem bảng bên dưới.

Đã verify chạy thật thành công end-to-end trên `https://dev.triphubs.vn`.

## Danh sách spec

| File | Mục đích | Tạo order thật? |
|---|---|---|
| `flight-domestic-simple.spec.ts` | Phần I: search → đặt vé → thanh toán OnePay đầy đủ. Tối đa 3 order/lần chạy. | Có (+ thanh toán) |
| `flight-search-report.spec.ts` | Phần II Giai đoạn 1: chỉ **đọc giá** theo hãng/chuyến/hạng vé, dừng ở drawer chọn vé. 3 case cố định: case-1 (nội địa, chỉ người lớn), case-2 (nội địa, người lớn+trẻ em), case-3 (quốc tế, người lớn+em bé). | Không |
| `flight-advanced-order.spec.ts` | Phần II Giai đoạn 2 (bản đầy đủ): search → chọn vé (random hạng ghế/hạng vé) → điền hành khách → chọn hành lý/chỗ ngồi → **tạo order thật** → luân phiên 5 cổng thanh toán đọc phí → dừng (không bấm "Thanh toán"). 3 order/lần chạy, mỗi order 1 hãng bay khác nhau. | Có (không thanh toán) |
| `flight-advanced-order-no-order-report.spec.ts` | Giống hệt trên nhưng **KHÔNG tạo order thật** — dừng ngay sau khi chọn hành lý/chỗ ngồi, đọc giá tại chỗ (panel giá cũng hiện sẵn trên trang điền hành khách, không cần tạo order mới đọc được). Dùng khi chỉ cần khảo sát giá hành lý/ghế trên diện rộng mà không muốn tốn quá nhiều order thật. Mặc định 5 lượt/lần chạy. | Không |

## Tuỳ chỉnh data test (không cần sửa code)

Mỗi spec có file JSON cùng tên, cùng thư mục — chỉnh file này để override data
mặc định (route, số người lớn/trẻ em/em bé, hạng vé cố định...) mà không cần
đụng code. Field nào không khai báo trong JSON thì rơi về giá trị hard-code
mặc định trong chính spec (object `DEFAULT_DATA`). Xoá cả file JSON thì dùng
100% giá trị mặc định.

Cơ chế dùng chung `tests/helpers/testDataLoader.ts` — quy ước:
`ten-file.spec.ts` ↔ `ten-file.json`. Đây là **quy ước bắt buộc cho mọi spec
mới** trong repo, không riêng thư mục này.

> **Quy tắc riêng**: mỗi case/kịch bản test phải nằm ở **1 spec file riêng**,
> không gộp nhiều case vào chung 1 file (kể cả khi logic giống nhau >90% —
> chấp nhận trùng lặp code để giữ mỗi case độc lập, dễ chạy/debug riêng).

## ⚠️ Lưu ý quan trọng trước khi chạy

- `flight-domestic-simple.spec.ts` và `flight-advanced-order.spec.ts` **tạo
  đơn hàng thật** trên môi trường dev (sandbox OnePay, không phải tiền thật,
  nhưng order/vé là dữ liệu thật trong hệ thống). `flight-advanced-order.spec.ts`
  dừng trước khi thanh toán nên không gửi email; `flight-domestic-simple.spec.ts`
  thanh toán thật nên **gửi email xác nhận thật** tới 1 trong 2 địa chỉ cấu
  hình sẵn (`vophamdangkhoa.010103@gmail.com` hoặc `akiyoshimeo@gmail.com`).
- `flight-search-report.spec.ts` và `flight-advanced-order-no-order-report.spec.ts`
  **không tạo order** — an toàn chạy nhiều lần không giới hạn.
- Mỗi lần chạy các spec có tạo order đều giới hạn số lượng (3 order), chạy
  **tuần tự** (không song song) — không đổi `workers` cho các file này.
- Nên chạy nhắm vào `BASE_URL=https://dev.triphubs.vn` (đặt trong `.env` ở gốc
  repo) — chạy trên app local (Next dev mode) từng gặp `page.goto` timeout do
  route nặng/compile chậm.

## Chạy

```bash
# Từ thư mục gốc B2C-test
npx playwright test tests/booking/flight-domestic-simple.spec.ts --project=chromium --headed --retries=0 --reporter=list
npx playwright test tests/booking/flight-search-report.spec.ts --project=chromium --headed --retries=0 --reporter=list
npx playwright test tests/booking/flight-advanced-order.spec.ts --project=chromium --headed --retries=0 --reporter=list
npx playwright test tests/booking/flight-advanced-order-no-order-report.spec.ts --project=chromium --headed --retries=0 --reporter=list
```

- `--headed`: mở browser thật để xem trực tiếp quá trình chạy.
- `--retries=0`: không tự retry khi fail — fail là thấy lỗi ngay, đỡ chờ lâu.
- `flight-search-report.spec.ts` có 3 `test()` riêng (case-1/2/3) nên **có thể**
  lọc bằng `-g "case-2"`. Các file còn lại chỉ có **1 `test()` duy nhất** (nhiều
  order chạy bên trong qua `test.step()`), nên `-g` không lọc được theo từng
  order — dùng `--debug` hoặc `--ui` để xem riêng từng step.

```bash
npx playwright test tests/booking --debug      # debug step-by-step
npx playwright test tests/booking --ui         # xem UI mode, tua lại từng bước
```

## Cơ chế bên trong

- **Random mỗi lần chạy**: chặng bay (6 điểm: SGN/HAN/DAD/TPE/SYD/NRT — đã
  verify searchText khớp đúng dropdown thật), ngày khởi hành (≥20 ngày nếu nội
  địa, ≥40 ngày nếu có chặng quốc tế), tên hành khách, ngày sinh, số CCCD/hộ
  chiếu. Phần II thêm: hạng ghế/hạng vé (random hoặc ép `fareOrdinal` cố định
  qua JSON), hãng bay (rotation, xem dưới).
- **Rotation hãng bay** (`tests/helpers/airlineRotationStore.ts`, dùng chung
  cho mọi spec Phần II): ưu tiên hãng CHƯA test ở các lần chạy trước (lưu
  persistent `.test-state/airline-rotation.json`), hết hãng mới thì random lại
  trong tập đã test (tương đương vòng lại từ đầu). `flight-advanced-order*`
  dùng cơ chế này để đảm bảo nhiều order trong 1 lần chạy nhắm vào các hãng
  khác nhau khi route cho phép.
- **Hãng không hỗ trợ hành lý/chỗ ngồi**: vẫn tiếp tục luồng bình thường (không
  coi là lỗi, không bỏ qua order) — report ghi rõ chữ **"Không hỗ trợ"** ở cột
  `baggageInfo`/`seatNumber` thay vì để trống.
- **Tự retry khi hết chỗ**: nếu backend báo "hết chỗ ngồi" lúc xác nhận đặt vé,
  hoặc search ra 0 chuyến, test tự đổi chặng/ngày khác rồi thử lại — không coi
  là lỗi test, chỉ ghi log `WAITING_RECHECK`/`FAILED`.
- **Giá thay đổi lúc tạo order**: backend verify giá ngay lúc gọi API tạo order
  — nếu phát hiện giá đổi sẽ hiện modal "Chuyến bay đã thay đổi giá". Đây
  KHÔNG phải lỗi — `PassengerFormPage.submitBooking()` tự động chấp nhận giá
  mới và tạo order tiếp.
- **Log ra file**: mọi lần thử (thành công hay thất bại) ghi vào
  `.test-state/flight-booking-log.json` — dùng để tránh test trùng điều kiện.
  Báo cáo CSV (giá theo hãng/chuyến/hạng vé, hoặc chi phí order) ghi vào
  `.test-state/search-report-*.csv` / `.test-state/order-cost-report*.csv` /
  `.test-state/pre-order-price-report-*.csv` — import thẳng vào Excel được.

## Page Object Model dùng trong luồng này

Nằm ở `tests/pages/flight/`:

| File | Nhiệm vụ |
|---|---|
| `FlightSearchWidget.ts` | Chọn điểm đi/đến, ngày, số hành khách, bấm tìm chuyến (ở trang chủ) |
| `FlightResultsPage.ts` | Đợi search xong, thu thập dữ liệu tracking, chọn chuyến (mặc định / random hạng vé / mở drawer đọc giá) |
| `FlightFilterSidebar.ts` | Lọc theo điểm dừng / giờ bay / hãng bay trên trang kết quả |
| `FlightFareDrawer.ts` | Đọc chi tiết giá theo hạng vé trong drawer "Chọn giá vé" (Giai đoạn 1, không đặt) |
| `PassengerCountSelector.ts` | Popover chọn số người lớn/trẻ em/em bé ở form search |
| `PassengerFormPage.ts` | Điền thông tin hành khách + liên hệ, xác nhận đặt vé (bắt lỗi hết chỗ + giá đổi) |
| `BaggageSeatSelector.ts` | Chọn hành lý ký gửi + chỗ ngồi trên trang điền hành khách (best-effort, có thể không hỗ trợ tuỳ hãng) |
| `PriceDetailPanel.ts` | Đọc panel "Chi tiết giá" (vé/thuế/hành lý/ghế/phí cổng/giảm giá/tổng) — dùng được cả TRƯỚC và SAU khi tạo order |
| `PaymentMethodSelector.ts` | Chọn 1 trong 5 cổng thanh toán cấp 1 trên trang checkout (để đọc phí, không bấm "Thanh toán") |
| `CheckoutPage.ts` | Chọn phương thức thanh toán (ATM/Internet Banking) — Phần I |
| `OnePayGateway.ts` | Chọn ngân hàng, điền thẻ test, xác nhận, nhập OTP — Phần I |

Helper dùng chung ở `tests/helpers/`:

| File | Nhiệm vụ |
|---|---|
| `randomPassenger.ts` | Sinh dữ liệu random: route, ngày, tên, ngày sinh, CCCD/hộ chiếu |
| `testStateStore.ts` | Ghi/đọc log kết quả từng lần thử vào `.test-state/` |
| `airlineRotationStore.ts` | Lưu lịch sử hãng bay đã test (persistent qua các lần chạy) |
| `searchReportStore.ts` | Ghi báo cáo CSV cho `flight-search-report.spec.ts` |
| `orderCostReportStore.ts` | Ghi báo cáo CSV cho 2 spec `flight-advanced-order*` |

## Những điểm cần biết khi debug selector (đã verify thật, tránh đoán lại)

- Label của form hành khách **không** gắn `for`/`aria-label` với input → không
  dùng `getByLabel` được, phải scope theo `.passenger__form--row` chứa text
  label rồi lấy `input` bên trong theo index.
- DatePicker (ngày sinh, ngày hết hạn giấy tờ, ngày khởi hành) là input dạng
  mask/picker của antd — `.fill()` không commit giá trị, phải
  `pressSequentially()` rồi `press("Enter")` (không dùng `Escape`).
- **Datepicker ngày khởi hành**: ô ngày HÔM NAY có text bắt đầu bằng nhãn "Hôm
  nay" chèn TRƯỚC số ngày (VD "Hôm nay92998k" thay vì "92998k") — nếu ngày
  mục tiêu trùng số với hôm nay (VD hôm nay mùng 9, chọn ngày 9 tháng sau),
  phải cho phép prefix "Hôm nay" tuỳ chọn trong regex, nếu không tổng số cell
  khớp sẽ thiếu 1, lệch `.nth(1)`.
- Nút chọn chuyến bay / nút "Chọn" đầu tiên sau khi lọc hãng đôi lúc báo "not
  enabled" dù nhìn bình thường, hoặc bị thanh tab ngày sticky che mất (click
  theo toạ độ trúng overlay thay vì nút thật) — dùng
  `.evaluate(el => el.click())` (click JS thuần, không mô phỏng chuột theo
  toạ độ) thay vì `click({force:true})` (force chỉ bỏ qua check "đang
  visible/enabled", KHÔNG bỏ qua được việc bị element khác che).
- antd dùng `prefixCls="te"` trong app này — class thật của mọi component antd
  là `te-row`/`te-col`/`te-checkbox`... **KHÔNG phải** `ant-row`/`ant-col` mặc
  định. CSS Modules (VD `ModalSeatMap.module.scss`) thì class bị hash lúc
  runtime (VD `ModalSeatMap_cell__xxx`) — phải dùng `[class*="..."]`
  partial-match, không dùng class thật trực tiếp.
- Logo ngân hàng trên OnePay là `<img>` không có text/alt nào trong DOM — không
  thể chọn theo tên, phải chọn theo **vị trí** (Vietcombank luôn là ô đầu tiên).
- Checkbox điều khoản OnePay bị 1 `<span class="checkmark">` che mất — dùng
  `click({ force: true })`.
- Nút "Thanh toán" (submit) trùng tên với text lồng trong 1 payment-method-row
  khác (VD "Ví MoMo") — phải `exact: true` khi `getByRole`.
- Panel "Chi tiết giá" (`.passenger__order--price`): mỗi dòng giá có label có
  thể chứa chữ số (VD "Người lớn x1") — KHÔNG được strip-digit trên toàn bộ
  text của cả dòng (sẽ lẫn số đếm vào giá), phải đọc riêng cột value (`.te-col`
  cuối cùng trong dòng).
- Card hành lý inline (`.passenger__form--baggage-purchase-card`) chỉ render
  SAU KHI khu vực "Hành lý" được cuộn vào viewport (có vẻ fetch data trigger
  lazy theo visibility) — phải `scrollIntoViewIfNeeded()` trước rồi mới
  `waitFor` (poll thật), không dùng `isVisible({timeout})` (không thực sự poll).
- Form hành khách KHÔNG có container class riêng cho từng người (các khối lặp
  qua `Fragment`, không phải `div` riêng) — label/text giống hệt nhau ở mọi
  khối nên KHÔNG scope theo text được khi có ≥2 hành khách. Dùng `name`
  attribute thật (`passengers.${index}.fullName`/`lastName`/`firstName`/
  `birthday`/`nationality`/`documentInfo.0.documentCode`/`documentExpiry` —
  react-hook-form forward thẳng ra DOM) để scope chính xác theo từng người.
- "Danh xưng" (gender) là antd Select hỗ trợ type-ahead (click mở rồi gõ tên
  option + Enter) — đã verify thật, dùng chung cơ chế với "Quốc tịch".
- Hành lý: mỗi hành khách × mỗi chặng có 1 "purchase box" riêng trên trang
  (`.passenger__form--baggage-purchase-box`), KHÔNG dùng chung 1 danh sách
  card cho cả nhóm — xử lý hết MỌI box tìm thấy (không giả định thứ tự
  passenger-major hay leg-major). Ghế: NGƯỢC LẠI, chỉ 1 modal dùng chung cho
  mọi hành khách/chặng — chuyển người qua sidebar (`[class*="passengerCard"]`,
  CSS Module), chuyển chặng qua Segmented "Chiều đi"/"Chiều về" (định vị theo
  text, không theo class vì chưa verify tên class thật), bấm "Áp dụng" 1 LẦN
  DUY NHẤT sau khi chọn xong hết (không phải bấm riêng từng người/chặng).
  Click vào tab chặng đôi khi bị skeleton loading che (đổi chặng trigger load
  lại bản đồ ghế) — dùng click JS thuần (`evaluate(el => el.click())`).
- **Chọn ngày trên date picker dùng `title="YYYY-MM-DD"`, KHÔNG dùng regex
  khớp số ngày hiển thị.** Đã từng dùng regex (`hasText: /^day/`) nhưng phát
  hiện bug thật qua nhiều lần chạy live: text hiển thị mỗi cell là số ngày +
  1 chỉ số ẩn khác + giá dính liền nhau không có dấu phân cách (VD
  "90198k") — ngày 2 chữ số có thể TRÙNG PREFIX với text của 1 ngày khác hoàn
  toàn (VD ngày 1 có chỉ số ẩn bắt đầu bằng "2" ra text "12998k" cũng khớp
  regex `/^12/` tìm ngày 12), khớp nhầm ô — có khi rơi đúng ô bị disabled (quá
  khứ) gây timeout, có khi chỉ random fail. `title` attribute trên mỗi cell
  (kể cả disabled) là ISO date chính xác tuyệt đối, không có rủi ro này — xem
  `FlightSearchWidget.selectDepartureDay(date: Date)`/`selectReturnDay(date:
  Date)` (API mới nhận thẳng `Date` object, không còn `{day, monthColumnIndex}`
  nữa) và `randomPassenger.ts` → `daysFromNowToDate()`. Dùng local date
  components khi build chuỗi `title` để so khớp, KHÔNG dùng `toISOString()`
  (convert UTC, lệch ngày với múi giờ UTC+7 nếu giờ local đang 00:00-07:00).

## Đã làm xong (theo thứ tự plan gốc)

1. ✅ **Đa hành khách** trong `flight-advanced-order*` — random 1-4 người lớn /
   0-3 trẻ em / 0-2 em bé (em bé ≤ người lớn), **tổng cả 3 loại ≤ 8** (ràng
   buộc riêng, không phải từ plan gốc). Dùng `PassengerCountSelector` ở bước
   search + loop `PassengerFormPage.fillPassenger(input, isDomestic, index,
   type)` theo `name="passengers.${index}.xxx"` (react-hook-form forward
   thẳng ra DOM — scope CHÍNH XÁC theo từng hành khách, không như trước đây
   dùng text-scope chỉ chạy đúng với 1 hành khách).
2. ✅ **Khứ hồi (round-trip)** — `enableRoundTrip()` + chọn 2 ngày qua
   `title` attribute đã verify ổn định (6/6 lần chạy pass). Chọn vé: click
   "Chọn chiều đi" (list tự đổi sang hiện chuyến chiều về, KHÔNG mở drawer ở
   bước này) → click "Chọn chiều về" → drawer mở với 2 khối leg ("Chiều
   đi"/"Chiều về") → random/ép hạng vé RIÊNG cho từng leg → bấm **"Đặt ngay"**
   (KHÁC text "Tiếp tục" của 1 chiều) — xem
   `FlightResultsPage.chooseRoundTripFlightsAndContinue()`. Hành lý/ghế đã mở
   rộng theo chặng (xem mục 3). **MỚI VERIFY Ở BẢN NHẸ KHÔNG TẠO ORDER
   (`flight-advanced-order-no-order-report.spec.ts`) — CHƯA PORT sang bản tạo
   order thật (`flight-advanced-order.spec.ts`), đợi ổn định thêm trước.**
3. ✅ **Hành lý/ghế theo từng người × từng chặng** — `BaggageSeatSelector`
   nhận `passengerCount` + `legCount` (1 hoặc 2), ghế trả về MẢNG-CỦA-MẢNG
   (`SeatSelectionResult[][]`, ngoài = chặng, trong = hành khách). Đã verify
   thật: 3 người 1 chiều ra 3 ghế khác nhau (5A/5B/5C); khứ hồi nhiều người ra
   đủ 2 bộ ghế riêng cho từng chặng. **Biết nhưng chưa sửa**: thỉnh thoảng 2
   hành khách liên tiếp bị gán TRÙNG ghế (VD "5E, 5E") — nghi do đọc trạng
   thái ô ghế trước khi UI kịp cập nhật "đã bị chiếm" sau click ngay trước đó;
   không làm fail test nhưng dữ liệu ghế đôi khi không hoàn toàn chính xác.

## Giới hạn hiện tại (chưa làm / chưa verify)

Theo kế hoạch gốc (`public/PLAN/book-test-plan-build.md`), phần II còn thiếu:

4. **Check-in Online** — chưa code gì, dù plan có nhắc tới.
5. **Báo cáo giá theo từng hành khách CÁ NHÂN** (Người A/Người B riêng biệt) —
   hiện `PriceDetailPanel` chỉ cộng gộp theo LOẠI hành khách (tổng người lớn,
   tổng trẻ em), không tách từng người. `BaggageSeatSelector` đã trả mảng
   per-passenger/per-leg nhưng report hiện GỘP lại thành 1 chuỗi tóm tắt (VD
   `baggageInfo: "+15KG, +15KG, +15KG"`) thay vì tách cột riêng từng người.
6. **4 happy-case cụ thể** ở cuối plan (1adt+1chd+1inf 1 chiều/khứ hồi nội địa,
   2adt+1chd+1inf khứ hồi nội địa, 1adt+1chd+1inf khứ hồi nội địa→quốc tế) —
   chưa case nào được build/verify đầy đủ.
7. **Port round-trip sang `flight-advanced-order.spec.ts`** (bản tạo order
   thật) — hiện mới có ở bản nhẹ không tạo order, đợi xác nhận ổn định thêm
   theo yêu cầu trước khi đụng tới flow tạo order thật.

Đang triển khai tuần tự theo đúng thứ tự ở trên.
