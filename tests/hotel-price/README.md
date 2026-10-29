# Giá khách sạn — web vs TMS (chỉ hiển thị)

Tool search khách sạn qua API rồi **tính lại giá đúng như 2 FE đang hiển thị**, in ra từng bước:
giá gốc API → markup theo policy → giá khách thấy. **Không so sánh web với TMS** vì 2 hệ cố ý tính khác nhau.

```bash
yarn hotel:price                                     # 3 điều kiện ngẫu nhiên, 20 KS mỗi điều kiện
yarn hotel:price --hotels 30 --count 5               # 5 điều kiện, 30 KS (giới hạn 10–30)
yarn hotel:price --case H-03,H-09                    # chỉ case trong hotel-price.json
yarn hotel:price --region intl                       # chỉ case quốc tế (dom / intl)
yarn hotel:price --loc "Đà Nẵng" --in +14 --nights 3 --rooms 2 --adt 4
yarn hotel:price --loc "Nha Trang" --chd 2 --ages 5,9
yarn hotel:price --no-detail                         # chỉ list, không mở detail từng KS (nhanh)
```

Kết quả: `.test-state/hotel-price/<thời gian chạy>/`. Thư mục gồm `report.html`, `summary.csv` (mỗi khách sạn 1 dòng), `overview.json` (số liệu cho trang tổng quan) và `raw.json` (response gốc).

```bash
yarn hotel:price:reports                   # in danh sách lần chạy (mới nhất = #1) + tạo trang tổng quan
yarn hotel:price:reports --open            # mở trang tổng quan .test-state/hotel-price/index.html
yarn hotel:price:reports latest            # mở báo cáo mới nhất (hoặc số: 3)
yarn hotel:price:reports --find "Da Nang"  # lọc theo địa điểm / case
```

Mỗi điều kiện có lệnh **chạy lại đúng điều kiện đó** (case, địa điểm, ngày, số đêm, phòng, khách, tuổi trẻ em, số KS), kèm nút Copy. Lệnh này có trong `report.html`, trang tổng quan, console lúc chạy và danh sách `hotel:price:reports`. Ví dụ:

```bash
yarn hotel:price --count 1 --case H-04 --loc "Hội An" --in 2026-11-23 --nights 2 --rooms 1 --adt 2 --chd 1 --ages 6 --hotels 10
```

Giá là giá sống, nên chạy lại có thể ra kết quả khác lần trước. Ngày nhận phòng đã qua thì API không trả khách sạn.

Trang tổng quan: mỗi lần chạy là 1 bảng các điều kiện, gồm địa điểm, ngày, số phòng/khách, số khách sạn, thời gian search, policy web/TMS. Hàng vàng là có cảnh báo (giá list ≠ detail, lỗi detail, cảnh báo policy). Hàng đỏ là lỗi hoặc 0 khách sạn.

## Token

| Hệ | Biến `.env` | Ghi chú |
|---|---|---|
| WEB | `WEB_API_TOKEN` hoặc `WEB_API_CLIENT_ID` / `WEB_API_USERNAME` / `WEB_API_PASSWORD` | dùng chung với tool metasearch |
| TMS | `TMS_API_TOKEN` hoặc `TMS_API_CLIENT_ID` / `TMS_API_USERNAME` / `TMS_API_PASSWORD` | client của đối tác TMS, nên `feePolicies` khác web. Lấy token trên tms_user: DevTools → request `hotel/searchHotels` → `authorization`. **Bỏ trống thì dùng chung token WEB/flight**: cùng dữ liệu và policy với web, chỉ khác công thức (report ghi "chung token WEB") |
| URL WEB | `HOTEL_API_URL` (mặc định `WEB_API_URL`, rồi `https://api-dev.triphubs.vn`) | gọi `{url}/hotel/...` |
| URL TMS | `TMS_API_URL` (mặc định URL web) · `TMS_AUTH_URL` (mặc định `TMS_API_URL`) | API hotel: `{TMS_API_URL}/hotel/...` (như `NEXT_PUBLIC_API_BASE` của tms_user). Đăng nhập lấy token: `POST {TMS_AUTH_URL}/auth/login` |

## Dữ liệu API (đã đối chiếu list với detail)

- **List** (`POST /hotel/searchHotels`):
  - `basePrice` = **exclusive** /phòng/đêm của phòng rẻ nhất.
  - `taxAndServiceFree` = tax + fees.
  - `setTotalPrice` = inclusive.
  - `promotionDetails.savingAmount` = tiền khuyến mãi.
  - Không có `costPerNight`.
- **Detail** (`GET /hotel/search/detail/{hotelId}/{searchId}`): mỗi phòng có `perRoomPerNightRate {exclusive, tax, fees, inclusive}`.
- Giá là giá sống: phòng rẻ nhất ở detail có thể khác `basePrice` của list (lần thử đầu: 9/46 khách sạn). Report gắn ⚠ "Giá gốc list ≠ phòng rẻ nhất ở detail".
- **feePolicies**: CMS trả **mọi** policy HOTEL + PAYMENT_GATEWAY đang ACTIVE của client, chưa match điều kiện. FE tự chọn policy.

## Công thức

**Chọn policy (cả 2 hệ):**
- Chỉ xét policy HOTEL + ACTIVE, có feeConfig không phải `ORIGINAL_CANCELLATION_FEE`.
- Lấy `priority` cao nhất; bằng nhau thì lấy cái đứng trước.
- **Bỏ qua điều kiện** (nội địa/quốc tế, sao…) và **không đổi currency**. Report cảnh báo ⚠ khi gặp.

R = số phòng, N = số đêm. Mỗi feeConfig:

| calculationMethod | WEB | TMS |
|---|---|---|
| `PER_BOOKING` | PERCENT: % × base cả đơn · FIXED: amount × 1 | giống web |
| `PER_ROOM` | % × base · FIXED × R | giống web |
| `PER_ROOM_NIGHT` | % × base · FIXED × R×N | giống web |
| `BASE_PRICE` | như PER_BOOKING (FIXED × 1) | % trên **exclusive** · FIXED × R×N |

| Màn | WEB (traveleasy-web-user) | TMS (tms_user) |
|---|---|---|
| **List** | `basePrice×R×N + markup` → ÷ R×N (**không** cộng `taxAndServiceFree`, dù web ghi "giá đã gồm thuế phí") | giống web (base = `basePrice`). Giá gạch = giá + `savingAmount` |
| **Detail /đêm** | markup trên **exclusive** + tax + fees | markup trên **inclusive** |
| **Đặt phòng** | tổng = giá/đêm × N × R. Dòng "Thuế và phí" = tax + fees + markup. `serviceAmount` = markup. `feeAmount` = fees×N×R. Base voucher = exclusive×N×R | tổng = inclusive×R×N + markup (chưa có voucher) |

Ví dụ thật (Đà Nẵng, 2 phòng × 2 đêm, policy 12% PER_BOOKING):

```
WEB list   7.493.448 (basePrice) × 4 = 29.973.792 + 3.596.855 (12%) ÷ 4 = 8.392.662/đêm
WEB detail 8.392.662 (exclusive sau markup) + 646.520 (tax) + 357.602 (fees) = 9.396.784/đêm
TMS detail 8.497.570 (inclusive) × 4 = 33.990.280 + 4.078.834 (12%) ÷ 4 = 9.517.279/đêm
```

## Case (hotel-price.json)

`H-01` … `H-10`: số phòng / người lớn / trẻ em (tuổi), số đêm `[min, max]`, ngày nhận phòng = hôm nay + `daysAhead [min, max]`, `region` (`domestic` mặc định / `international`). Địa điểm chọn ngẫu nhiên trong `locations`. Tool tìm địa điểm qua `GET /hotel/location/search`, ưu tiên CITY → AREA → COUNTRY và bỏ kết quả là 1 khách sạn lẻ. Địa điểm phải đúng tên trên hệ (VD `Phu Quoc Island`, không phải `Phú Quốc`).

## File

| File | Vai trò |
|---|---|
| `tests/hotel-price/hotel-price.spec.ts` | Chạy điều kiện, gọi API, ghép web/TMS theo hotelId |
| `tests/hotel-price/hotel-price.json` | Cấu hình: số KS, case, địa điểm, timeout |
| `tests/helpers/hotelPricing.ts` | Công thức web + TMS, trả từng bước tính |
| `tests/helpers/hotelApiClient.ts` | Gọi location search / searchHotels / detail |
| `tests/helpers/hotelPriceReport.ts` | `report.html`, `summary.csv` |
| `scripts/hotel-price.js` | Đổi cờ dòng lệnh thành biến `HOTEL_*` rồi chạy Playwright |
