import { Page, Route } from "@playwright/test";
import fs from "fs";
import path from "path";

/** Response `/flights/search/` của 1 system đúng như trang web nhận (live) hoặc được trả giả (fixture). */
export type SystemResponse = {
  system: string;
  request: Record<string, unknown> | null;
  status: number;
  ms: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: Record<string, any>;
  error?: string;
};

export type CaptureResult = { responses: SystemResponse[]; ms: number; error: string };

const IS_SEARCH = /\/flights\/search\/?$/;
const systemOf = (body: Record<string, unknown> | null) =>
  String((body?.flights as { airline?: string }[] | undefined)?.[0]?.airline ?? "?");
/** Tên file an toàn: "_9G" → "9G". */
export const systemFile = (system: string) => system.replace(/^_+/, "").replace(/[^\w-]/g, "");

function parseJson(text: string | null | undefined): Record<string, unknown> | null {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
}

/** Đọc response đã lưu `<dir>/<SYSTEM>.json` (cùng dạng SystemResponse, hoặc web-response-*.json của metasearch v2). */
export function readFixture(dir: string, system: string): SystemResponse | null {
  for (const name of [`${systemFile(system)}.json`, `web-response-${systemFile(system)}.json`]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return null;
}

/**
 * Mở trang kết quả và lấy response `/flights/search/` NGAY TRONG phiên trình duyệt đó, bằng `page.route`:
 * request đi qua Playwright (`route.fetch()` phía Node) nên đọc được cả body lớn (GALILEO_NDC ~10–20 MB)
 * mà `response.json()` của Chrome không đọc được, rồi trả nguyên response cho trang.
 *
 * `fixtureDir`: không gọi API thật — trả response đã lưu cho từng system (system không có file → 0 kết quả).
 */
export async function openResultAndCapture(
  page: Page,
  url: string,
  { fixtureDir, timeout = 240_000, quietMs = 6_000, noSearchMs = 60_000 }: { fixtureDir?: string; timeout?: number; quietMs?: number; noSearchMs?: number } = {}
): Promise<CaptureResult> {
  const responses: SystemResponse[] = [];
  let inFlight = 0;
  let started = 0;
  let lastActivity = Date.now();

  const corsHeaders = (route: Route) => ({
    "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
  });

  await page.route(
    (u) => IS_SEARCH.test(u.pathname),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS" && fixtureDir) return route.fulfill({ status: 204, headers: corsHeaders(route) });
      if (req.method() !== "POST") return route.fallback();

      const request = parseJson(req.postData());
      const system = systemOf(request);
      inFlight++;
      started++;
      lastActivity = Date.now();
      const t0 = Date.now();
      try {
        if (fixtureDir) {
          const saved = readFixture(fixtureDir, system);
          const status = saved?.status || 200;
          const response = saved?.response ?? { fareData: [] };
          responses.push({ system, request, status, ms: 0, response });
          await route.fulfill({ status, headers: corsHeaders(route), contentType: "application/json", body: JSON.stringify(response) });
        } else {
          const res = await route.fetch({ timeout });
          const body = await res.text();
          responses.push({ system, request, status: res.status(), ms: Date.now() - t0, response: parseJson(body) ?? {} });
          await route.fulfill({ response: res, body });
        }
      } catch (err) {
        responses.push({ system, request, status: 0, ms: Date.now() - t0, response: {}, error: (err as Error).message.split("\n")[0] });
        await route.abort().catch(() => {});
      } finally {
        inFlight--;
        lastActivity = Date.now();
      }
    }
  );

  const t0 = Date.now();
  await page.goto(url, { timeout: 120_000 });
  const progressBar = page.locator(".flights__list--progress");
  let error = "";
  for (;;) {
    await page.waitForTimeout(1_000);
    if (started === 0 && Date.now() - t0 > noSearchMs) {
      error = `web không gọi /flights/search/ sau ${Math.round(noSearchMs / 1000)}s`;
      break;
    }
    const loading = await progressBar.isVisible().catch(() => false);
    if (started > 0 && inFlight === 0 && !loading && Date.now() - lastActivity > quietMs) break;
    if (Date.now() - t0 > timeout) {
      error = `web chưa load xong sau ${Math.round(timeout / 1000)}s`;
      break;
    }
  }
  return { responses, ms: Date.now() - t0, error };
}

/** Lưu response từng system để xem lại hoặc dùng làm fixture (FE_FLIGHT_FIXTURE=<dir>). */
export function saveResponses(dir: string, responses: SystemResponse[]) {
  fs.mkdirSync(dir, { recursive: true });
  for (const r of responses) fs.writeFileSync(path.join(dir, `${systemFile(r.system)}.json`), JSON.stringify(r));
}
