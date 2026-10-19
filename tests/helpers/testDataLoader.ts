import fs from "fs";
import path from "path";

/**
 * Load test data từ file JSON cùng tên với spec file (VD: `foo.spec.ts` ->
 * `foo.json` trong CÙNG thư mục). Nếu file tồn tại, merge NÔNG (1 cấp) đè lên
 * defaults — field nào JSON không khai báo thì giữ nguyên giá trị mặc định
 * trong code. Nếu file không tồn tại hoặc parse lỗi, dùng nguyên defaults.
 *
 * Dùng `__filename` của spec khi gọi hàm này để tự suy ra đường dẫn JSON.
 */
export function loadTestData<T extends Record<string, unknown>>(
  specFilePath: string,
  defaults: T
): T {
  const jsonPath = specFilePath.replace(/\.(spec\.ts|spec\.js)$/, ".json");

  if (!fs.existsSync(jsonPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const overrides = JSON.parse(raw) as Partial<T>;
    const merged = { ...defaults, ...overrides };
    console.log(`[testDataLoader] Đã nạp data override từ ${path.basename(jsonPath)}`);
    return merged;
  } catch (err) {
    console.warn(
      `[testDataLoader] Không đọc/parse được ${jsonPath}, dùng data mặc định hard-code. Lỗi: ${err}`
    );
    return defaults;
  }
}
