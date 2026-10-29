# So sánh Metasearch vs Web — v2

Bản v2 của [tool so sánh metasearch](../metasearch/README.md). **Bản v1 giữ nguyên**, v2 chạy song song, có lệnh, cấu hình, lịch sử và báo cáo riêng.

v2 giống v1 ở cách lấy dữ liệu 2 bên, ghép hành trình, cờ dòng lệnh, chế độ review, trang metaSearch trong báo cáo…; khác ở **công thức giá** (theo luồng CMS mới), **hạng ghế** của từng giá, case study, cảnh báo 24h, danh mục sân bay.

## Công thức giá v2

Theo traveleasy-cms từ 28/10 (`includeMarkupFees()` trong `metasearch.utils.ts`): **meta đã cộng phí markup vào giá trả về**, nên tool không cộng phí cho meta nữa.

```
META = totalAmount + estimatedVoucherDiscount                 (đã gồm phí, cộng lại voucher)
WEB  = giá vé hạng đó + (phí ADULT × số NL + phí CHILD × số TE) của từng chiều
```

- **Meta**: `totalAmount` (= deeplink `total_amount`) đã gồm phí markup (cộng vào `tax*`/`total*` của NL, TE) và đã trừ voucher AUTO_APPLY → cộng lại voucher để so với web (web chưa trừ voucher). Response cũ (trước 28/10: `total_amount` = `totalAmount` + `serviceFeeAmount`) được tự nhận ra và vẫn cộng `serviceFeeAmount`.
- **Web**: FE tự cộng phí, nên tool cộng phí theo công thức:
  - **Giá vé** tuỳ system (giống `isGalileoSystem` của web): **GALILEO** (`GALILEO_NDC`, `GALILEO`) = `totalAmount`; **system khác** (VN, VJ, VU, 9G…) = `NL × totalAdt + TE × totalChd + EB × totalInf` (giá 1 người).
  - **Phí** lấy từ `fareData.fees`: combo khứ hồi = phí × 2; 2 chặng lẻ = mỗi chiều cộng phí của chính nó (như CMS tính SEPARATE).
- **Em bé**: không cộng phí, **không trừ voucher** → giá 1 em bé (`totalInf`) meta phải bằng web; lệch → cảnh báo ⚠.
- **Hạng ghế**: mỗi giá (meta, web, từng mức giá web) hiện kèm hạng ghế `cabinClass · fareType`, VD `Eco · A`, `ECONOMY LITE · E`; khứ hồi 2 chặng lẻ: `hạng đi | hạng về`. CSV `details.csv` có cột `metaClass`, `webClass`.
- **Dữ liệu API** — mở 1 dòng trong bảng chi tiết, mục "Dữ liệu API — số từ đâu ra": mỗi bên (META | WEB) từng chiều có bảng `fare / tax / fee / total` 1 người theo loại khách (người lớn / trẻ em / em bé) × số khách, `totalAmount` của chiều, phí markup (`fees`) và các bước ra giá so sánh (voucher, phí). Bên web là đúng hạng vé đã dùng để so; hành trình chỉ web có thì lấy hạng rẻ nhất.
- **JSON hành trình lệch** — mỗi hành trình **LỆCH GIÁ / LỆCH PHÍ** được lưu 1 file `diffs/cond-N/<NNN>-<system>-<số hiệu>.json` gồm `condition`, `request` (body search), `comparison` (giá 2 bên, chênh, hạng ghế, cách tính) và **nguyên item API**: `metaItem` (offer meta) + `webItems` (các item combo / chặng lẻ web đã dùng để so). Cùng thư mục có **response web đầy đủ** của từng system có hành trình lệch: `web-response-<SYSTEM>.json` (`request` đã gửi, `status`, `ms`, `response` nguyên vẹn — các field của response + toàn bộ `fareData`; ghi gọn 1 dòng, GALILEO_NDC ~20 MB, mở bằng editor rồi Format Document); file hành trình trỏ tới qua `webResponseFiles`. Lần search đầu (khi đã tự search lại) lưu ở `diffs/cond-N-lan-dau/`. Mở: dòng "JSON từng hành trình lệch" của điều kiện, link "JSON hành trình này" khi mở 1 dòng, hoặc cột `jsonFile` trong `details.csv`.
- **Khớp** = giá meta bằng 1 trong các mức giá web. Giá vé bằng nhau (bỏ phí 2 bên) mà giá cuối khác → **LỆCH PHÍ**. Chênh < 1.000đ → **Lệch giá dưới 1k** (cảnh báo).

Ví dụ VJ899 SGN→DPS, 1 NL: meta `1.519.000` (đã gồm phí) = web `1.379.000` (Eco · A) + phí `140.000` → **KHỚP**.

### Cảnh báo ⚠ (trong report và console, không ảnh hưởng kết luận)

- `totalAmount lệch` — `totalAmount` ≠ NL × `totalAdt` + TE × `totalChd` + EB × `totalInf`. Dùng để kiểm tra lỗi "chỉ cộng 1 người lớn" đã hết chưa.
- `serviceFeeAmount khác phí theo công thức` — phí meta trả khác phí tính lại (COMBINED: phí chiều đầu × số chiều; SEPARATE: mỗi chiều phí của chính nó).
- `giá em bé khác web` — em bé bị trừ voucher hoặc bị cộng phí (không được phép).
- `định dạng cũ` — response meta chưa gồm phí trong `totalAmount`.

### Tự search lại khi lệch giá

Lần search đầu một điều kiện hay **lệch giá ở GALILEO_NDC**, chạy lại cùng điều kiện thì hết. Đối chiếu các cặp lần chạy trùng điều kiện cho thấy lỗi không nằm ở phần ghép dữ liệu:
- meta và web gọi vendor **2 phiên riêng, cùng lúc** → vendor NDC trả giá/offer khác nhau (VD LAX⇄HAN: meta có mức 197.449.000, web lần đó không có);
- lần sau vendor trả từ cache (web chỉ ~1,5s) → 2 bên cùng dữ liệu, khớp hết.

Vì vậy, điều kiện nào có **lệch giá** ở lần đầu thì tool **tự search lại 1 lần** và lấy kết quả lần 2 làm kết luận. Lệch của lần đầu vẫn được ghi lại vì khách thật cũng có thể gặp:
- báo cáo: dòng ⚠ "Lần search đầu lệch giá N (GALILEO_NDC …) → đã tự search lại: hết lệch X, còn Y"; cột Lệch giá ghi thêm "lần đầu N"; kết luận vàng `CẢNH BÁO · lần search đầu lệch giá N (search lại hết X)`;
- `summary.csv`: cột `firstRunPriceDiffs`, `firstRunCleared`; dữ liệu lần đầu: `raw/cond-N-meta-1.json`, `raw/cond-N-web-1.json`.

Tắt: `--no-recheck` (hoặc `"recheckOnPriceDiff": false` trong JSON).

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
