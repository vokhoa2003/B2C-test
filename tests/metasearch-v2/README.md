# So sánh Metasearch vs Web — v2

Bản v2 của [tool so sánh metasearch](../metasearch/README.md). **Bản v1 giữ nguyên**, v2 chạy song song, có lệnh, cấu hình, lịch sử và báo cáo riêng.

v2 giống v1 ở mọi thứ (cách lấy dữ liệu 2 bên, ghép hành trình, cờ dòng lệnh, chế độ review, trang metaSearch trong báo cáo…), **chỉ khác công thức giá**.

## Công thức giá v2

```
Giá so sánh = giá vé + (phí ADULT × số người lớn + phí CHILD × số trẻ em) × (2 nếu khứ hồi, 1 nếu 1 chiều)
```

- **Giá vé** tuỳ system (giống cách nhận diện `isGalileoSystem` của web):
  - **GALILEO** (`GALILEO_NDC`, `GALILEO`): `totalAmount` API trả (combo khứ hồi: giá trọn gói ở chặng đầu).
  - **System khác** (VN, VJ, VU, 9G…): **theo số khách**, cộng từng chiều — `NL × totalAdt + TE × totalChd + EB × totalInf` (`totalAdt`/`totalChd`/`totalInf` là giá 1 người).
  - **Vé combo** không phải GALILEO (VD VN quốc tế khứ hồi — meta `compositeFareId` không có `_`, web 1 item chứa cả 2 chiều): mỗi chiều đã mang giá **cả chuyến** → chỉ lấy giá chiều đầu, không cộng 2 chiều (như FE web xử lý VN combo).
- **Em bé không tính phí.**
- **Phí** lấy từ `fees` theo loại khách: meta ở `flights[0].fees`, web ở `fareData.fees` (combo: của item; 2 chặng lẻ: của chặng đi).
- **Voucher meta**: meta đã trừ voucher AUTO_APPLY (phân bổ vào giá từng khách) → cộng lại `estimatedVoucherDiscount` trước khi so (web chưa trừ voucher).
- **Khớp** = giá vé bằng 1 trong các hạng vé web **và** phí bằng nhau. Trạng thái giống v1: KHỚP / LỆCH GIÁ / LỆCH PHÍ / CHỈ CÓ Ở META / CHỈ CÓ Ở WEB.

Ví dụ VJ ICN⇄PQC, 2 NL + 1 TE, phí Ticketing 140.000, chiều đi `2 × 3.440.000 + 3.317.000 = 10.197.000` + chiều về `10.331.000` → giá vé `20.528.000`; cộng phí `140.000 × 3 × 2 = 840.000` → **21.368.000**.

### Cảnh báo ⚠ (trong report và console, không ảnh hưởng kết luận)

- `totalAmount lệch` — `totalAmount` ≠ NL × `totalAdt` + TE × `totalChd` + EB × `totalInf`. Dùng để kiểm tra lỗi "chỉ cộng 1 người lớn" đã hết chưa.
- `serviceFeeAmount khác phí theo công thức` — `serviceFeeAmount` meta trả khác phí tính theo công thức v2 (VD hành trình ghép 2 hãng có phí 2 chiều khác nhau, công thức lấy phí chiều đi × 2).

## Case study (metasearch-vs-web-v2.json)

40 case, mỗi case có mã (hiện trong báo cáo: `PAX-09 · Số khách: …`). Mỗi lần chạy lấy `conditionsPerRun` case (xen kẽ nội địa / quốc tế), **ưu tiên case chưa chạy lần nào** (ghi trong lịch sử v2) → chạy vài lần là phủ hết bộ.

| Nhóm | Nội dung |
|---|---|
| **PAX-01 … 15** — số khách | 1 NL · 1 NL + 1 EB · 1 NL + 1 TE · 1 NL + 1 TE + 1 EB · 2 NL · 2 NL + 2 EB (EB = NL) · 2 NL + 1 TE + 1 EB · 2 NL + 2 TE + 2 EB · 3 NL + 2 TE + 1 EB · **9 NL** · **4 NL + 3 TE + 2 EB** · **3 NL + 3 TE + 3 EB** · **1 NL + 8 TE** · **5 NL + 4 TE** (đủ 9) · 1 NL + 1 EB quốc tế khứ hồi — chặng phổ biến để chắc có kết quả |
| **TRIP-01 … 09** — hành trình | 1 chiều gần ngày (3–7 ngày tới) / xa ngày (90–150) · khứ hồi **trong ngày** · khứ hồi 1 đêm · khứ hồi dài 14–21 ngày · quốc tế khứ hồi ngắn 2–3 ngày / dài 20–30 ngày · quốc tế 1 chiều gần ngày · quốc tế xa ngày (120–180) |
| **TRIP-10 … 12** — case 24h | bay **hôm nay / ngày mai** (`daysAhead: [0, 1]`): nội địa 1 chiều · nội địa khứ hồi (2 NL + 1 TE, về sau 0–3 ngày) · quốc tế 1 chiều |
| **ROUTE-01 … 13** — chặng | trục SGN/HAN/DAD · trục ↔ miền Bắc / Trung / Nam · liên vùng không qua trục · Trung ↔ Nam không qua trục · sân bay nhỏ (DIN, VDO, VCS, VKG, CAH, TBB, PXU, VCL, VDH) · quốc tế **Đông Nam Á + Đông Dương** · **Đông Bắc Á** · **đường dài** (Úc, châu Âu, Mỹ - Canada) · **Tây Á / Nam Á / châu Phi** · quốc tế từ sân bay VN phụ (CXR, PQC, HPH, DLI, VCA, VDO, HUI, VII, VCL) · **khám phá** (sân bay bất kỳ trên thế giới) — các case in đậm chọn ngẫu nhiên theo danh mục sân bay |

- **Đủ 22 sân bay Việt Nam** (đã đối chiếu `GET /flights/airports`: BMV, CAH, CXR, DAD, DIN, DLI, HAN, HPH, HUI, PQC, PXU, SGN, TBB, THD, UIH, VCA, VCL, VCS, VDH, VDO, VII, VKG) — sân bay nào cũng làm điểm đi / điểm đến trong ít nhất 1 case.
- **Kiểm tra số khách** khi khởi động, giống ô chọn khách trên web: người lớn ≥ 1, **em bé ≤ người lớn**, **tổng NL + TE + EB ≤ 9**. Case sai → dừng ngay, báo rõ case nào sai gì.
- Field thêm của case (đều tuỳ chọn): `id` (mã case), `routes` (nhóm chặng, chọn ngẫu nhiên 1 cặp, cả 2 chiều), `region` / `vnEnd` / `pool` (xem mục dưới), `daysAhead: [min, max]` (ngày bay = hôm nay + …), `stayDays: [min, max]` (khứ hồi: số ngày lưu trú, `0` = về trong ngày).

### Danh mục sân bay (public/PLAN/airports.json)

File export danh sách điểm đi/đến của web (~2.400 điểm). Tool tự đọc khi khởi động (đổi đường dẫn: env `META_AIRPORTS_FILE`); không có file thì dùng danh sách trong `metasearch-vs-web-v2.json` như cũ.

- **Lọc bỏ** điểm không phải sân bay: ga tàu, heliport, bãi thủy phi cơ, căn cứ quân sự, mã "TẤT CẢ CÁC SÂN BAY" của thành phố (NYC, LON, JKT…).
- **Nội địa** = `isDomestic = 1` (22 sân bay). **Quốc tế mặc định** = điểm web đã xếp nhóm (`subject`/`continent`, ~79 sân bay) + danh sách `airports.international` trong JSON.
- `region` — đầu nước ngoài chọn ngẫu nhiên theo vùng của file (khớp `subject` hoặc `continent`): `Đông Nam Á`, `Đông dương`, `Đông Bắc Á`, `Tây Á`, `Hoa kỳ - Canada`, `Châu Á`, `Châu Âu`, `Châu Úc`, `Châu Mỹ`, `Châu Phi`. Ghi sai tên vùng → dừng ngay, in danh sách vùng hợp lệ.
- `vnEnd` — đầu Việt Nam cho `region`/`pool` (mặc định `airports.vnInternationalGateways`).
- `pool: "all"` — chọn trong **mọi sân bay thế giới** của file (~2.300) — case khám phá, thường ra 0 kết quả hoặc chỉ GALILEO có.
- Báo cáo và dry-run hiện thêm tên thành phố / quốc gia: `FRA (Frankfurt, Đức) → HAN (Hà Nội, Việt Nam)`.
- Mã sân bay trong template hoặc cờ `--from/--to` không có trong file → chỉ cảnh báo ⚠, vẫn chạy.

### Chuyến bay trong 24h

Mọi điều kiện đều ghi lại **lúc gửi search** và tính số giờ tới giờ cất cánh chặng đi của từng hành trình:

- `< 24h` → nhãn tím **≤24h · còn 5h20** cạnh chặng đi; giờ cất cánh đã qua lúc search mà vẫn được trả về → nhãn đỏ **đã qua giờ bay**. Chuyến ≥ 24h không gắn nhãn.
- Bảng chi tiết có ô **"Chỉ chuyến bay trong 24h (N)"** để lọc; mở dòng ra xem số giờ chính xác.
- Tổng quan có cột **Bay trong 24h** (số chuyến, kèm số lệch/thiếu); mỗi điều kiện ghi rõ mốc search.
- CSV: `summary.csv` thêm `searchedAt`, `within24h`, `within24hProblems`; `details.csv` thêm `hoursToDepart`, `within24h`.
- Giờ bay API trả là **giờ địa phương sân bay đi**, so với giờ máy (VN) → chặng xuất phát ở nước ngoài lệch đúng bằng chênh múi giờ.

```bash
yarn compare:metasearch:v2 --24h                                       # case ngẫu nhiên bất kỳ, ép bay hôm nay / ngày mai
yarn compare:metasearch:v2 --case TRIP-10,TRIP-11,TRIP-12 --count 3   # chạy cả 3 case 24h
yarn compare:metasearch:v2 --from SGN --to HAN --depart today          # chỉ định: bay hôm nay (today / tomorrow / +N)
```

```bash
yarn compare:metasearch:v2 --dry-run --count 10               # chỉ in 10 điều kiện sẽ chạy, KHÔNG search
yarn compare:metasearch:v2 --case PAX                          # chỉ nhóm PAX
yarn compare:metasearch:v2 --case PAX-10,PAX-12,TRIP-03 --count 3
yarn compare:metasearch:v2 --case ROUTE --route dom --count 7  # mọi case chặng nội địa
yarn compare:metasearch:v2 --count 40                          # chạy hết 40 case 1 lượt
```

## Dữ liệu web

Đặt `WEB_API_TOKEN` trong `.env` để tool gọi thẳng API web thay vì bắt qua browser (browser không đọc được response lớn như GALILEO_NDC ~10 MB) — cách lấy token xem [v1 mục 1](../metasearch/README.md#1-chuẩn-bị). Áp dụng cho cả v1 lẫn v2.

## Lệnh

Cờ y hệt v1 (`--from/--to/--depart/--return`, `--trip`, `--route`, `--adt/--chd/--inf`, `--airline`, `--count`, `--repeat`, `--review`…):

```bash
yarn compare:metasearch:v2                                          # 5 điều kiện ngẫu nhiên
yarn compare:metasearch:v2 --from ICN --to PQC --adt 2 --chd 1 --depart 2026-12-16 --return 2026-12-23
yarn compare:metasearch:v2 --route dom --trip rt --airline VNA --adt 2 --chd 1
yarn compare:metasearch:v2:review                                   # 2 tab META + WEB mỗi điều kiện, browser giữ nguyên
yarn compare:metasearch:v2:reports [--open | số | latest]           # danh sách / mở báo cáo v2
yarn compare:metasearch:v2:open latest [--cond cond-2]              # mở lại điều kiện: tab META + WEB live
yarn compare:metasearch:v2:clear                                    # xoá lịch sử điều kiện đã chạy (của v2)
```

## File

| File | Vai trò |
|---|---|
| `tests/metasearch-v2/metasearch-vs-web-v2.spec.ts` | Spec v2 (bản sao spec v1, dùng module v2) |
| `tests/metasearch-v2/metasearch-vs-web-v2.json` | Cấu hình v2 (mẫu điều kiện, sân bay, timeout) — sửa riêng, không ảnh hưởng v1 |
| `tests/helpers/metasearchCompareV2.ts` | Ghép hành trình + **công thức giá v2** + cảnh báo |
| `tests/helpers/metasearchReportV2.ts` | Báo cáo `report.html` / CSV / trang metaSearch v2 |
| `tests/helpers/metasearchHistoryV2.ts` | Lịch sử riêng v2 |
| `tests/helpers/airportCatalog.ts` | Đọc danh mục sân bay `public/PLAN/airports.json`: lọc, nhóm vùng, nhãn thành phố/quốc gia |
| `scripts/compare-metasearch-v2.js`, `scripts/metasearch-reports-v2.js` | Lệnh chạy / xem báo cáo v2 |

Dùng chung (không sửa) với v1: `metasearchClient.ts`, `FlightSearchApiCapture.ts`, `MetasearchToolPage.ts`, `reviewBrowser.ts`, `tests/metasearch/open-conditions.spec.ts`.

Kết quả: `.test-state/metasearch-compare-v2/<thời gian chạy>/` (report.html, summary.csv, details.csv, meta/, raw/) — cách đọc giống [v1 mục 3](../metasearch/README.md#3-xem-báo-cáo).
