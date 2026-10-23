# So sánh kết quả search: Metasearch đối tác vs Web gốc

Tool kiểm tra **danh sách chuyến bay trả cho đối tác** (Skyscanner, qua API metasearch) có **cùng lượng thông tin và cùng giá** với trang web gốc hay không, khi search cùng một điều kiện.

| Bên | Nguồn dữ liệu | Cách lấy |
|---|---|---|
| **Meta** | Trang tool https://api-dev.triphubs.vn/static/tools/metasearch/ | Gọi thẳng API mà trang đó dùng: `POST /auth/login` → `POST /v1/flights/metasearch`. Trang tool chỉ hiển thị nguyên `fareData` nên số liệu là một. |
| **Web** | https://dev.triphubs.vn/vi | Mở trang kết quả `/vi/flights/result?...` trong browser thật, bắt toàn bộ response `POST /flights/search/` (web gọi 1 request cho mỗi system: VN, VJ, VU, _9G, GALILEO_NDC, JQ…). |

Mỗi lần chạy sinh **5 điều kiện search khác nhau** (nội địa xen kẽ quốc tế, 1 chiều/khứ hồi, số khách khác nhau, route + ngày ngẫu nhiên), search **cùng lúc** trên 2 bên rồi xuất báo cáo.

Tool **không tạo đơn**, không đăng nhập web, chỉ đọc dữ liệu search.

## 1. Chuẩn bị

Cài đặt chung của repo (xem [README gốc](../../README.md)):

```bash
yarn install
yarn playwright install chromium
```

Thêm tài khoản metasearch vào file `.env` ở thư mục gốc repo (file này đã được git bỏ qua, không commit):

```env
META_API_URL=https://api-dev.triphubs.vn
META_COMPARE_WEB_URL=https://dev.triphubs.vn
META_CLIENT_ID=<client id>
META_USERNAME=<username>
META_PASSWORD=<password>
```

Thiếu 3 biến `META_CLIENT_ID` / `META_USERNAME` / `META_PASSWORD` thì test tự **skip**.

## 2. Chạy

```bash
yarn compare:metasearch            # chạy ẩn browser (nhanh nhất), mặc định 5 điều kiện trộn mọi loại
yarn compare:metasearch:headed     # hiện browser để xem web load
yarn compare:metasearch --ui       # Playwright UI: xem từng bước, tua lại
```

### 2.1. Chọn loại chặng bằng cờ

| Cờ | Giá trị | Mặc định |
|---|---|---|
| `--trip` | `oneway` (`ow`) · `roundtrip` (`rt`) · `all` | `all` |
| `--route` | `domestic` (`dom`) · `international` (`intl`) · `all` | `all` |
| `--count` | Số điều kiện mỗi lần chạy | `5` |
| `--review` | Mở browser riêng, mỗi điều kiện 2 tab META + WEB, không đóng khi xong (mục 2.2) | — |
| `--repeat` | Bỏ qua lịch sử điều kiện đã chạy cho lần này (mục 2.3) | — |
| `--clear-history` | Xoá lịch sử rồi thoát (= `yarn compare:metasearch:clear`) | — |
| `--headed` / `--ui` / `--debug` | Chuyển thẳng cho Playwright | — |

```bash
yarn compare:metasearch --trip roundtrip --route domestic     # chỉ nội địa khứ hồi
yarn compare:metasearch --trip ow --route intl --count 3      # 3 điều kiện quốc tế 1 chiều
yarn compare:metasearch --route intl --headed                 # quốc tế, cả 1 chiều lẫn khứ hồi, hiện browser
yarn compare:metasearch --trip=rt                             # dạng --cờ=giá trị cũng được
```

### 2.1b. Chỉ định đúng 1 hành trình

```bash
yarn compare:metasearch --from SGN --to HAN --trip rt                                  # khứ hồi, ngày ngẫu nhiên, 1 người lớn
yarn compare:metasearch --from SGN --to HAN --depart 2026-12-01 --return 2026-12-05    # có --return → tự hiểu khứ hồi
yarn compare:metasearch --from HAN --to ICN --depart 2026-12-20 --adt 2 --chd 1 --inf 1 # 1 chiều, 2 NL + 1 TE + 1 EB
yarn compare:metasearch --from SGN --to HAN --trip rt --review                          # kèm 2 tab META + WEB để xem
```

| Cờ | Ý nghĩa | Mặc định |
|---|---|---|
| `--from`, `--to` | Điểm đi / điểm đến (mã 3 chữ). **Bắt buộc cả 2** khi chỉ định hành trình. | — |
| `--trip` | `oneway`/`ow` hoặc `roundtrip`/`rt` | Có `--return` → khứ hồi, không có → 1 chiều |
| `--depart`, `--return` | Ngày đi / ngày về, dạng `YYYY-MM-DD` | Ngẫu nhiên như thường (mục 5) |
| `--adt`, `--chd`, `--inf` | Số người lớn / trẻ em / em bé | 1 / 0 / 0 |

- Có `--from`/`--to` thì chạy **đúng 1 điều kiện** đó, bỏ qua `templates`, `--route`, `--count` và lịch sử (vẫn ghi vào lịch sử).
- Nội địa/quốc tế tự suy từ `airports.domestic` trong JSON — sân bay Việt Nam chưa có trong danh sách đó sẽ bị coi là quốc tế.
- Script kiểm tra trước khi chạy: thiếu `--from`/`--to`, trùng điểm đi/đến, ngày sai định dạng, ngày về trước ngày đi, `--trip ow` kèm `--return`, em bé nhiều hơn người lớn, NL + TE > 9.

### 2.2. Chế độ review — xem tận mắt 2 trang

```bash
yarn compare:metasearch:review                        # = yarn compare:metasearch --review
yarn compare:metasearch --review --trip rt --count 3  # kết hợp được với mọi cờ khác
```

- Mở **1 cửa sổ Chrome riêng**. Mỗi điều kiện mở **2 tab**: `[cond-N META]` (trang tool metasearch — tự đăng nhập, điền đúng điều kiện, bấm Search) và `[cond-N WEB]` (trang kết quả dev.triphubs.vn).
- Xong 1 điều kiện **không đóng tab**, mở tiếp 2 tab cho điều kiện sau. Tab cuối là `report.html` của lần chạy.
- Chạy xong **browser vẫn mở** (VD 5 điều kiện → 10 tab META/WEB + 1 tab báo cáo). Tự đóng khi xem xong.
- Ở chế độ này, dữ liệu meta lấy từ **đúng lượt search trên trang tool** (thấy gì so nấy). Tool kiểm tra body trang tool gửi đi khớp điều kiện mong muốn; điền form sai thì điều kiện đó báo "KHÔNG SO ĐƯỢC".
- Chậm hơn chế độ thường vài giây/điều kiện (phải đăng nhập lại trang tool ở mỗi tab). Mỗi lần chạy dùng 1 profile Chrome riêng trong thư mục báo cáo (`review-browser-profile/`), không đụng Chrome cá nhân.

### 2.3. Tránh lặp hành trình đã chạy

Mỗi điều kiện **so được** (cả 2 bên trả dữ liệu) được ghi vào `.test-state/metasearch-compare/history.json`. Các lần chạy sau **bỏ qua** hành trình đã có trong lịch sử, để dần phủ hết route.

- "Trùng" = cùng **điểm đi → điểm đến** (có chiều: SGN→HAN khác HAN→SGN) + cùng **1 chiều/khứ hồi**. Ngày bay và số khách không tính.
- Điều kiện "KHÔNG SO ĐƯỢC" (lỗi/timeout) không ghi lịch sử → lần sau được chạy lại.
- Tool liệt kê mọi route hợp lệ theo danh sách sân bay (mục 5), loại các route đã chạy rồi mới chọn ngẫu nhiên. **Hết tổ hợp mới** thì mới cho lặp lại để đủ số điều kiện; console báo số điều kiện bị lặp.
- Template cố định `from`/`to` (tái hiện case) luôn được chạy, không bị lịch sử chặn.

```bash
yarn compare:metasearch:clear                 # xoá lịch sử → lần sau chạy lại từ đầu
yarn compare:metasearch --repeat              # lần này bỏ qua lịch sử (vẫn ghi thêm vào lịch sử)
```

Đầu mỗi lần chạy, console in số điều kiện đã có trong lịch sử.

Cờ chỉ **lọc `templates`** trong file JSON (mục 5) — số khách lấy theo các template còn lại; muốn tổ hợp khách khác thì thêm template. Cờ chạy được trên cả PowerShell lẫn bash (script `scripts/compare-metasearch.js` đổi cờ thành biến môi trường `META_TRIP_TYPE`, `META_ROUTE_TYPE`, `META_CONDITIONS` rồi gọi `playwright test`). Muốn đặt mặc định cố định thì sửa `filters` trong JSON; cờ dòng lệnh luôn được ưu tiên hơn.

- Thời gian: khoảng **1,5–3 phút** cho 5 điều kiện (web ~15–30 s/điều kiện, meta ~1–7 s).
- Thời gian chờ tối đa mỗi bên: **5 phút/điều kiện** (`webTimeoutMs`, `metaTimeoutMs`). Web được coi là load xong khi hết request `/flights/search/` đang chạy, thanh loading tắt và yên lặng thêm 8 s.
- Chỉ chạy trên project `chromium`, không retry (mỗi lần chạy là 5 lượt search thật mỗi bên).
- Web đôi khi kẹt lúc tải trang, không bắn request `/flights/search/` nào. Sau **60 s** không có request, tool **tải lại trang 1 lần**; vẫn không có thì dừng điều kiện đó (không chờ hết 5 phút).
- Test chỉ **fail** khi 1 bên lỗi hoặc timeout; điều kiện đó ghi kết luận **"KHÔNG SO ĐƯỢC (…)"** trong báo cáo. Chênh lệch số liệu là **kết quả**, ghi vào báo cáo chứ không làm fail test. Gặp "KHÔNG SO ĐƯỢC" thì chạy lại.

Console in tóm tắt từng điều kiện, ví dụ:

```
[metasearch-compare] cond-1 DAD->HAN 2026-11-12 1A 0C 0I | meta=24 khớp=24 lệch giá=0 lệch phí=0 có voucher=22 chỉ meta=0 chỉ web=0 | deeplink=... | => KHỚP
    web: OK 25s (VU=201/2 _9G=201/20 VJ=201/0 VN=201/0) | meta: OK 200 2.2s (24 item)
```

`VU=201/2` nghĩa là request web cho system VU trả HTTP 201 với 2 item.

## 3. Xem báo cáo

Mỗi lần chạy tạo 1 thư mục `.test-state/metasearch-compare/<thời gian chạy>/`:

| File | Nội dung |
|---|---|
| `report.html` | **Báo cáo chính**, mở bằng trình duyệt (double-click). Bảng tổng quan + chi tiết từng chuyến lệch/thiếu. |
| `summary.csv` | 1 dòng / điều kiện (mở bằng Excel). |
| `details.csv` | 1 dòng / hành trình, kể cả dòng khớp — để lọc/sort. |
| `meta/cond-N-metasearch.html` | **Trang metaSearch** (giao diện + code thật của trang tool) tự điền điều kiện N và hiện **kết quả META đã lưu lúc chạy** — bộ lọc, thống kê, chi tiết như trang thật. Mở từ link **"mở trang metaSearch"**. |
| `meta/cond-N.html` | Bảng kết quả META của điều kiện N (system, hãng, số hiệu, giờ bay, hạng vé, giá, voucher, phí, deeplink) có ô lọc. Mở từ link **"bảng kết quả meta"**. |
| `raw/cond-N-web.json`, `raw/cond-N-meta.json` | Dữ liệu gốc 2 bên để tra lại. |

Mỗi điều kiện trong `report.html` có các link để đối chiếu thủ công:

- **mở trang web** — trang kết quả dev.triphubs.vn đúng điều kiện (search live).
- **mở trang metaSearch** — trang tool metasearch đúng điều kiện, hiện kết quả meta **đã lưu lúc chạy** (dải vàng "BẢN LƯU" ở đầu trang). Trang tool thật không nhận điều kiện qua URL nên không link thẳng trang live được; bản sao chặn request của trang và trả dữ liệu đã lưu (không gọi API search), còn giao diện/JS tải từ server thật.
- **bảng kết quả meta** — bảng gọn của cùng dữ liệu.

Muốn trang metaSearch **search live** đúng điều kiện (đặt cạnh trang web): `yarn compare:metasearch:open <số | latest | tên thư mục> [--cond cond-2]` — mở Chrome riêng, mỗi điều kiện 2 tab META (tự đăng nhập, điền, Search) + WEB, không so sánh, browser giữ nguyên. Hoặc chạy cả lượt ở chế độ review (mục 2.2).

`report.html` cũng được đính kèm vào Playwright report: `yarn report` → mở test → **Attachments** → `report`.

### Danh sách mọi báo cáo

Chỉ đọc file trên máy, không gọi mạng:

```bash
yarn compare:metasearch:reports                  # in danh sách mọi lần chạy (mới nhất = #1) + tóm tắt từng lần
yarn compare:metasearch:reports --open           # mở trang tổng hợp index.html (ô lọc, link tới từng báo cáo)
yarn compare:metasearch:reports 3                # mở báo cáo #3
yarn compare:metasearch:reports latest           # mở báo cáo mới nhất
yarn compare:metasearch:reports --find SGN       # chỉ liệt kê lần chạy có route/kết luận chứa "SGN"
yarn compare:metasearch:reports --limit 10       # chỉ in 10 lần gần nhất
```

Trang tổng hợp `.test-state/metasearch-compare/index.html` được tạo lại mỗi lần chạy lệnh trên: lọc theo chữ (route, "khứ hồi", "lệch"…) và tick **"Chỉ lần chạy có lệch / không so được"**. Mỗi điều kiện ✗lệch / ✗lỗi được đánh dấu ngay trong danh sách. Lần chạy định dạng cũ (chưa có `report.html`) mở file tóm tắt thay thế.

> File `.html` mở trong VS Code chỉ thấy mã nguồn — phải mở bằng trình duyệt.

### 3.1. Trạng thái của từng dòng

| Trạng thái | Ý nghĩa |
|---|---|
| **KHỚP** | Web có đúng hành trình này, giá meta trước voucher = 1 trong các giá web, phí hệ thống bằng nhau. |
| **LỆCH GIÁ** | Có hành trình ở cả 2 bên nhưng giá khác. Cột "Chặng lệch" cho biết chiều đi / chiều về / cả hành trình. |
| **LỆCH PHÍ** | Giá khớp nhưng phí hệ thống (`serviceFeeAmount` meta ≠ phí web). |
| **CHỈ CÓ Ở META** | Meta trả hành trình mà web không có (ghi chú nói rõ thiếu chặng nào). |
| **CHỈ CÓ Ở WEB** | Web có mà meta không trả. Với hãng bán chặng lẻ (VJ/VU/9G khứ hồi) tính theo **từng chặng**. |

Mỗi dòng hiện: bên có chuyến, system, hãng, số hiệu + chặng + giờ đi → đáp của từng chiều, giá meta (trước voucher, kèm giá API trả + voucher), giá web (mức gần nhất + các mức hạng vé), chênh lệch, phí hệ thống 2 bên, giá cuối khách thấy.

## 4. Logic so khớp

### 4.1. Ghép hành trình (lấy meta làm chuẩn)

Mỗi hành trình meta được tìm ở web theo **đúng system** và **từng chặng khớp**: số hiệu mọi segment (kể cả chặng nối), giờ khởi hành, giờ đáp.

- Web có 2 kiểu item:
  - **combo** — 1 item chứa đủ đi + về (VD GALILEO_NDC khứ hồi; mọi item 1 chiều);
  - **chặng lẻ** — khứ hồi nhưng mỗi item 1 chiều (VJ, VU, 9G): ghép chiều đi + chiều về, giá = tổng 2 chiều.
- Ưu tiên combo, không có thì ghép 2 chặng lẻ.
- **Không gộp khác system**: cùng chuyến VZ980 bán qua VJ và qua GALILEO_NDC có giá và cả giờ đáp khác nhau.
- Meta có thể ghép 2 chiều **khác hãng** (đi 9G + về VU) nhưng `system` của item chỉ ghi 1 giá trị → tool đọc system thật từng chiều từ deeplink (`out_system`, `in_system`). Web ghi `_9G`, meta ghi `9G` → bỏ dấu `_` khi so.
- Web có nhiều hạng vé cho 1 hành trình → giá meta khớp khi bằng **1 trong các** giá web.

### 4.2. Giá và phí — web và meta tính khác chỗ

Đối chiếu source `traveleasy-web-user` và `traveleasy-cms`:

| | Web (FE tự tính) | Meta (server tính sẵn) |
|---|---|---|
| Giá hãng | `inventory.totalAmount` nguyên từ API | `totalAmount` **đã trừ voucher AUTO_APPLY** |
| Voucher | Chỉ trừ khi khách nhập mã lúc thanh toán | `estimatedVoucherCode` / `estimatedVoucherDiscount`, phân bổ: fee → tax; em bé → trẻ em → người lớn; chiều đi trước (`metasearch/README.md` §2.2 của cms) |
| Phí hệ thống | FE cộng `fareData.fees`: ADULT × số NL + CHILD × số TE, em bé không tính (`useChoosenFlightsDetailPrice.ts`) | `serviceFeeAmount`, không nằm trong `totalAmount` |

Vì vậy tool so:

- **Giá**: `totalAmount + estimatedVoucherDiscount` (meta trước voucher) với giá hãng web (tổng mọi khách, gồm thuế phí).
- **Phí**: `serviceFeeAmount` meta với phí hệ thống web.
- **Giá cuối khách thấy** (chỉ để tham khảo): meta = `totalAmount + serviceFeeAmount`; web = giá hãng + phí hệ thống, chưa nhập voucher.

> Ví dụ: thuế trẻ em chiều đi 9G1203 trên meta là 402.091, web 552.091 → chính là voucher `TEV_XLMI23` 150.000 được trừ vào thuế trẻ em chiều đi. Sau khi cộng lại voucher thì khớp.
> Giá meta có số lẻ (VD 568.257,38) là do voucher không chia hết số khách.

Mảng `e4t` trong response web là bản sao dữ liệu vendor (snake_case); web chỉ dùng nó cho điểm dừng ẩn và tiện ích chuyến bay, **không dùng để tính giá** → tool bỏ qua.

### 4.3. Kiểm tra deeplink

Cột `metaDeeplinkRoute` / mục "Deeplink meta" kiểm tra `dayViewDeeplinks` của meta có trỏ đúng route không. Web đọc `f1` = điểm đi, `t1` = điểm đến (`useSearchFlightParams.ts`), trong khi meta đang sinh `t1` = điểm đi, `f1` = điểm đến → tool báo `SAI`.

## 5. Cấu hình — `metasearch-vs-web.json`

Sửa file JSON, không cần sửa code. Field nào bỏ trống thì dùng mặc định trong `DEFAULT_DATA` của spec.

| Field | Ý nghĩa |
|---|---|
| `conditionsPerRun` | Số điều kiện mỗi lần chạy (mặc định 5). Cờ `--count` ghi đè. |
| `filters.tripType` / `filters.routeType` | Lọc template mặc định (`all`, `oneway`/`roundtrip`, `domestic`/`international`). Cờ `--trip` / `--route` ghi đè. |
| `templates[]` | Mẫu điều kiện: `routeType` (`domestic`/`international`), `tripType` (`oneway`/`roundtrip`), `adults`/`children`/`infants`, `description`. Mỗi lần chạy xáo nhóm nội địa và quốc tế rồi **xen kẽ**, nên lần nào cũng có cả 2 loại. |
| `templates[].from/to/departDate/returnDate` | (Tuỳ chọn) cố định route/ngày để **tái hiện đúng 1 case** đã gặp. |
| `airports.domesticHubs` | Sân bay trục (SGN, HAN, DAD). Chặng nội địa luôn có 1 đầu ở đây — ghép 2 sân bay nhỏ thường không có đường bay. |
| `airports.domestic` | 22 sân bay nội địa (đã đối chiếu `isDomestic = 1` từ `GET /flights/airports`). |
| `airports.vnInternationalGateways` | Đầu Việt Nam của chặng quốc tế. |
| `airports.international` | Đầu nước ngoài: Đông Bắc Á, Đông Nam Á, Úc, Trung Đông, châu Âu, Mỹ. |
| `defaults.domesticMinDays` / `internationalMinDays` / `randomExtraDays` | Ngày bay = hôm nay + min + ngẫu nhiên 0..extra ngày. |
| `defaults.returnAfterDaysMin/Max` | Ngày về = ngày đi + ngẫu nhiên min..max ngày. |
| `defaults.webTimeoutMs` / `metaTimeoutMs` | Thời gian chờ tối đa mỗi bên / điều kiện. |

Trong 1 lần chạy không lặp lại cùng route (kể cả đảo chiều). Mã sân bay thêm mới phải có trong `GET /flights/airports`; `flightType` (DOMESTIC/INTERNATIONAL) suy ra từ việc cả 2 đầu có nằm trong `airports.domestic` hay không.

Ví dụ tái hiện đúng 1 case:

```json
{
  "conditionsPerRun": 1,
  "templates": [
    { "description": "Tái hiện 9G HAN-PQC", "routeType": "domestic", "tripType": "roundtrip",
      "adults": 2, "children": 1, "infants": 0,
      "from": "HAN", "to": "PQC", "departDate": "2026-11-11", "returnDate": "2026-11-14" }
  ]
}
```

## 6. Cấu trúc code

| File | Vai trò |
|---|---|
| `tests/metasearch/metasearch-vs-web.spec.ts` | Sinh điều kiện, chạy song song 2 bên, ghi báo cáo. |
| `tests/metasearch/metasearch-vs-web.json` | Cấu hình. |
| `scripts/compare-metasearch.js` | Đọc cờ `--trip` / `--route` / `--count`, đổi thành biến môi trường rồi chạy Playwright. |
| `scripts/metasearch-reports.js` | Liệt kê mọi báo cáo, tạo trang `index.html`, mở báo cáo theo số thứ tự. |
| `tests/helpers/metasearchClient.ts` | Gọi API metasearch (login + search). |
| `tests/pages/flight/FlightSearchApiCapture.ts` | Mở trang kết quả web, bắt response `/flights/search/`, đọc sidebar lọc. |
| `tests/metasearch/open-conditions.spec.ts` | `yarn compare:metasearch:open`: mở lại điều kiện của 1 lần chạy (tab META + WEB live), không so sánh. |
| `tests/pages/metasearch/MetasearchToolPage.ts` | Thao tác trang tool metasearch (đăng nhập, điền điều kiện, Search) — chế độ review. |
| `tests/helpers/reviewBrowser.ts` | Mở Chrome riêng qua CDP để browser không bị đóng khi test xong. |
| `tests/helpers/metasearchCompare.ts` | Logic ghép hành trình + so giá/phí/voucher. |
| `tests/helpers/metasearchReport.ts` | Ghi `report.html`, `summary.csv`, `details.csv`. |
| `tests/helpers/metasearchHistory.ts` | Đọc/ghi lịch sử điều kiện đã chạy (`history.json`). |

## 7. Lưu ý & giới hạn

- Dữ liệu là giá **live** từ hãng/GDS: 2 bên search cùng lúc nhưng vẫn có thể lệch nhẹ do cache hoặc tồn chỗ thay đổi giữa 2 lần gọi. Gặp lệch thì chạy lại case đó (mục 5) để xác nhận.
- Khuyến mãi chỉ hiển thị ở FE web (flat fare VJ, `routesPromotionSUN` của 9G, giảm giá trừ dần khi nhập mã) **không** nằm trong giá API nên không được so.
- Meta có giới hạn số offer theo cấu hình `resultLimit` → với route quốc tế nhiều chuyến (GALILEO_NDC), "chỉ có ở web" có thể là do giới hạn này chứ chưa chắc là lỗi.
- Route nội địa ít chuyến (sân bay nhỏ) hoặc ngày xa có thể ra 0 kết quả ở cả 2 bên → dòng đó "KHỚP" với 0 hành trình.
