# FE flight: giao diện hiển thị có đúng với API không

Folder độc lập, không dùng chung code với `tests/metasearch*` hay `tests/pages`. Chỉ thêm 2 lệnh vào `package.json` và file `scripts/fe-flight.js`.

## Cách hoạt động

1. Mở trang `/vi/flights/result?...` (desktop 1440×900).
2. Lấy response `POST /flights/search/` **ngay trong phiên trình duyệt đó** bằng `page.route`.
   - Request đi qua Playwright (`route.fetch()`), nên đọc được cả response GALILEO_NDC lớn (10–20 MB) mà Chrome không cho đọc.
   - Không search riêng lần 2, nên không bị lệch kiểu "vendor trả khác nhau giữa 2 phiên".
3. Cuộn hết danh sách (web chỉ hiện khoảng 15 card, cuộn mới hiện thêm), rồi đọc mọi card.
4. Từ response, tính **card mong đợi** (`lib/expectedCards.ts`), sau đó so từng card theo khoá `số hiệu chuyến | giờ đi | giờ đến`.

## Hiện kiểm gì (Mốc 1: kết quả 1 chiều)

| Field | Giá trị mong đợi lấy từ |
|---|---|
| Card có trong API không | khoá chuyến |
| Điểm đi/đến, điểm dừng | `segments`, `stopNumber` |
| Giờ đi/đến, +Nd | `startTime`/`endTime` lấy nguyên HH:mm (giờ địa phương, chữ "Z" là giả), ngày đến − ngày đi |
| Thời gian bay | **giờ đến − giờ đi quy về UTC theo múi giờ sân bay** (`lib/airportTime.ts`) |
| Giá / khách | (Σ vé + Σ thuế + Σ phí hãng + phí hệ thống − giảm giá API) ÷ (NL + TE + EB), hạng rẻ nhất |
| Hành lý xách tay, số vé còn | hạng đầu tiên, `segments[0].seat` |

Một số quy tắc cần biết:

- **Voucher trừ dần:** card gạch giá gốc và hiện badge "Đã giảm X". Tool chấp nhận giá hiển thị = giá gốc − X ÷ số khách, và ghi chú lại.
- **Card web tự ẩn:** fare GALILEO có chặng VJ/JQ, hạng "HF", hạng trùng tên. Các card này được đếm ở dòng "Bỏ qua".
- **Không dùng `flight.duration` làm chuẩn** vì mỗi system hiểu một kiểu. Đã đo trên HAN→NRT:
  - VN: đúng thời gian thực.
  - GALILEO_NDC: chỉ có giờ bay, thiếu thời gian nối chuyến.
  - VJ: lệch đúng bằng chênh lệch múi giờ.
- **Giờ API là giờ địa phương của từng sân bay**, không phải GMT. Ví dụ VN310 `00:25Z` → `07:00Z` = 00:25 giờ HAN → 07:00 giờ NRT, bay 4h35m, khớp `duration: 275`. Báo cáo hiển thị giống card web (`20:10 HAN → 06:10+1d NRT`) và có thêm 1 dòng quy đổi GMT (`HAN GMT+7 → 13:10 20/12 GMT · NRT GMT+9 → 21:10 20/12 GMT`). Không biết múi giờ thì ghi "chưa rõ GMT".
- **Múi giờ:** tra theo quốc gia trong `public/PLAN/airports.json`; nước nhiều múi giờ thì tra theo từng sân bay. Sân bay chưa có trong bảng thì **không kiểm** thời gian bay và ghi ở dòng "Bỏ qua". Bổ sung vào `AIRPORT_TZ` khi gặp.

## Chạy

```bash
yarn fe:flight                                   # mọi case trong cases.json
yarn fe:flight --case OW-01,OW-04                # chỉ vài case
yarn fe:flight --from SGN --to HAN --depart +7 --adt 2 --inf 1
yarn fe:flight --fixture <thư mục>               # không gọi API search thật
yarn fe:flight:headed                            # xem trình duyệt
```

Script luôn chạy chromium, 1 worker, không retry, vì mỗi lần retry là thêm 1 lần search thật.

## Kết quả

`.test-state/fe-flight/<thời điểm>/`:

- `report.html`:
  - bảng tổng quan;
  - mỗi case liệt kê card có vấn đề, mỗi card kèm: field lệch (UI và API), cách tính giá API, và ảnh chụp card.
- `<CASE>/responses/<SYSTEM>.json`: response đầy đủ từng system, dùng lại làm fixture được.
- `<CASE>/result.json`: toàn bộ card đã đọc và kết quả so.
- `<CASE>/card-N.png`: ảnh card lệch (tối đa 20 ảnh).

## Fixture

`--fixture <dir>`: trang web vẫn mở thật, nhưng mọi request search được trả bằng file `<dir>/<SYSTEM>.json`. System nào không có file thì nhận 0 kết quả.

- Điều kiện search (chặng, ngày, số khách) lấy từ `request` trong file.
- Dùng được thư mục `responses/` của lần chạy trước, hoặc các file `web-response-*.json` của metasearch v2.
- Có thể sửa JSON để tạo case biên: em bé, giá 0, thiếu hành lý, qua ngày…
- Ngày bay trong fixture phải còn ở tương lai, vì web có thể chặn ngày đã qua.

## Lộ trình tiếp

- Mốc 2: popup chi tiết giá (hover giá) — bảng NL/TE/EB, phí hệ thống, em bé không phí.
- Mốc 3: khứ hồi (combo Galileo/VN và tách chặng), bộ lọc, sắp xếp.
- Mốc 4: sang bước đặt chỗ — giá giữ nguyên, API kiểm tra lại giá.
