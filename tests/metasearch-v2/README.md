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
| `scripts/compare-metasearch-v2.js`, `scripts/metasearch-reports-v2.js` | Lệnh chạy / xem báo cáo v2 |

Dùng chung (không sửa) với v1: `metasearchClient.ts`, `FlightSearchApiCapture.ts`, `MetasearchToolPage.ts`, `reviewBrowser.ts`, `tests/metasearch/open-conditions.spec.ts`.

Kết quả: `.test-state/metasearch-compare-v2/<thời gian chạy>/` (report.html, summary.csv, details.csv, meta/, raw/) — cách đọc giống [v1 mục 3](../metasearch/README.md#3-xem-báo-cáo).
