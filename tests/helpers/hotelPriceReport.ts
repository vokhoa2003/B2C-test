import fs from "fs";
import path from "path";
import {
  describeConfig,
  flattenFeeConfigs,
  fmt,
  type HotelFeePolicy,
  type HotelRecord,
  type HotelRoom,
  type PriceCalc,
  type PriceStep,
} from "./hotelPricing";

/** Kết quả tính của 1 hệ (web hoặc TMS) cho 1 khách sạn. */
export type SystemHotelCalc = {
  record: HotelRecord;
  list: PriceCalc;
  detail?: {
    error?: string;
    ms?: number;
    roomCount: number;
    room?: HotelRoom;
    perNight?: PriceCalc;
    total?: PriceCalc;
    bookingLines?: { label: string; value: number }[];
    /** Mọi hạng phòng: giá/đêm và tổng theo công thức của hệ này. */
    rooms: { room: HotelRoom; perNight: number; total: number }[];
  };
};

export type HotelRow = { hotelId: number; name: string; web?: SystemHotelCalc; tms?: SystemHotelCalc };

export type SystemSearchInfo = {
  enabled: boolean;
  note?: string;
  status?: number;
  ms?: number;
  error?: string;
  count: number;
  policies: HotelFeePolicy[];
  policy: HotelFeePolicy | null;
  policyWarnings: string[];
};

export type HotelCondition = {
  id: string;
  description: string;
  location: { term: string; id?: number; name?: string; searchType?: string; isDomestic?: boolean };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  adults: number;
  children: number;
  childrenAges: number[];
  searchedAt: string;
  error?: string;
  web: SystemSearchInfo;
  tms: SystemSearchInfo;
  hotels: HotelRow[];
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function renderSteps(steps: PriceStep[]): string {
  return `<div class="steps">${steps
    .map(
      (s) =>
        `<span class="step${s.op === "=" ? " eq" : ""}">${s.op ? `<i>${esc(s.op)}</i>` : ""}<b>${fmt(s.value)}</b><small>${esc(s.label)}${
          s.note ? ` · ${esc(s.note)}` : ""
        }</small></span>`
    )
    .join("")}</div>`;
}

function renderCalc(title: string, calc: PriceCalc | undefined): string {
  if (!calc) return "";
  const original = calc.originalPrice ? ` <s title="giá gạch = giá + savingAmount">${fmt(calc.originalPrice)}</s>` : "";
  const warn = calc.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
  return `<div class="calc"><div class="calc-h"><span>${esc(title)}</span><strong>${fmt(calc.result)}</strong>${original}</div>${renderSteps(calc.steps)}${warn}</div>`;
}

function rateText(r: HotelRoom["perRoomPerNightRate"]): string {
  if (!r) return "—";
  return `excl ${fmt(r.exclusive)} · tax ${fmt(r.tax)} · fees ${fmt(r.fees)} · incl ${fmt(r.inclusive)}`;
}

/**
 * List trả giá của phòng rẻ nhất (basePrice = exclusive, setTotalPrice = inclusive). Detail gọi sau đó
 * có thể ra giá khác (giá sống, đổi giữa 2 lần gọi) → cảnh báo để biết giá list và detail không cùng gốc.
 */
export function listDetailGap(r: HotelRecord, room: HotelRoom | undefined): string | null {
  const p = room?.perRoomPerNightRate;
  if (!p || r.basePrice == null || r.basePrice === p.exclusive) return null;
  const incl = r.setTotalPrice != null && r.setTotalPrice !== p.inclusive ? `, setTotalPrice ${fmt(r.setTotalPrice)} ≠ inclusive ${fmt(p.inclusive)}` : "";
  return `Giá gốc list ≠ phòng rẻ nhất ở detail: basePrice ${fmt(r.basePrice)} ≠ exclusive ${fmt(p.exclusive)}${incl}`;
}

function renderRawRecord(r: HotelRecord): string {
  const cpn = r.costPerNight;
  const parts = [
    `basePrice (exclusive) <b>${r.basePrice == null ? "—" : fmt(r.basePrice)}</b>`,
    r.taxAndServiceFree != null && `taxAndServiceFree ${fmt(r.taxAndServiceFree)}`,
    r.setTotalPrice != null && `setTotalPrice (inclusive) ${fmt(r.setTotalPrice)}`,
    cpn && `costPerNight: ${rateText(cpn)}`,
    r.basePriceBeforePromo != null && `basePriceBeforePromo ${fmt(r.basePriceBeforePromo)}`,
    r.promotionDetails?.savingAmount && `savingAmount ${fmt(r.promotionDetails.savingAmount)}`,
    r.supplier && `supplier ${esc(r.supplier)}`,
  ].filter(Boolean);
  return `<div class="raw">${parts.join(" · ")}</div>`;
}

function renderSystem(label: string, calc: SystemHotelCalc | undefined, info: SystemSearchInfo): string {
  if (!info.enabled) return `<div class="sys off"><h4>${label}</h4><div class="muted">${esc(info.note ?? "không chạy")}</div></div>`;
  if (!calc) return `<div class="sys off"><h4>${label}</h4><div class="muted">Không có trong kết quả search của ${label}</div></div>`;
  const d = calc.detail;
  let detailHtml = "";
  if (d) {
    if (d.error) detailHtml = `<div class="warn">⚠ Detail lỗi: ${esc(d.error)}</div>`;
    else if (!d.room) detailHtml = `<div class="muted">Detail không có phòng (${d.roomCount})</div>`;
    else {
      const roomName = d.room.translatedRoomName || d.room.roomName || d.room.roomId;
      const booking = d.bookingLines?.length
        ? `<table class="lines">${d.bookingLines.map((l) => `<tr><td>${esc(l.label)}</td><td>${fmt(l.value)}</td></tr>`).join("")}</table>`
        : "";
      const roomsTable = `<details><summary>${d.rooms.length} lựa chọn phòng (${d.ms ?? "?"} ms)</summary><table class="rooms"><thead><tr><th>Phòng</th><th>perRoomPerNightRate</th><th>Giá/đêm ${label}</th><th>Tổng ${label}</th></tr></thead><tbody>${d.rooms
        .map(
          (x) =>
            `<tr${x.room === d.room ? ' class="pick"' : ""}><td>${esc(x.room.translatedRoomName || x.room.roomName || x.room.roomId)}${
              x.room.promotionDetail?.savingAmount ? ` <span class="tag">-${fmt(x.room.promotionDetail.savingAmount)}</span>` : ""
            }</td><td>${rateText(x.room.perRoomPerNightRate)}</td><td>${fmt(x.perNight)}</td><td>${fmt(x.total)}</td></tr>`
        )
        .join("")}</tbody></table></details>`;
      const gap = listDetailGap(calc.record, d.room);
      detailHtml = `<div class="sub">Detail — phòng rẻ nhất: <b>${esc(roomName)}</b> <span class="muted">(${rateText(d.room.perRoomPerNightRate)})</span></div>${
        gap ? `<div class="warn">⚠ ${esc(gap)}</div>` : ""
      }${renderCalc(
        "Giá/phòng/đêm ở detail",
        d.perNight
      )}${renderCalc(label === "WEB" ? "Booking — tổng tiền" : "Tổng cả kỳ ở (đặt phòng)", d.total)}${booking}${roomsTable}`;
    }
  }
  return `<div class="sys"><h4>${label}</h4>${renderCalc("List — giá trên thẻ khách sạn", calc.list)}${detailHtml}</div>`;
}

function renderPolicy(label: string, info: SystemSearchInfo): string {
  if (!info.enabled) return `<div class="pol"><b>${label}</b>: ${esc(info.note ?? "không chạy")}</div>`;
  const hotel = info.policies.filter((p) => p.productType === "HOTEL");
  const chosen = info.policy
    ? `<b>${esc(info.policy.name ?? info.policy.id)}</b> (priority ${info.policy.priority}): ${flattenFeeConfigs(info.policy.feeConfigs)
        .map((c) => esc(describeConfig(c)))
        .join(" + ")}`
    : "<b>không có policy markup</b> → giá hiển thị = giá gốc";
  const others = hotel
    .filter((p) => p !== info.policy)
    .map((p) => `${esc(p.name ?? p.id)} [${esc(p.status)}, priority ${p.priority}]`)
    .join("; ");
  const warn = info.policyWarnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
  const err = info.error ? `<div class="warn">⚠ Search lỗi: ${esc(info.error)}</div>` : "";
  return `<div class="pol"><b>${label}</b> — ${info.count} khách sạn, ${info.ms ?? "?"} ms. Policy áp dụng: ${chosen}${
    others ? `<div class="muted">Policy HOTEL khác: ${others}</div>` : ""
  }${warn}${err}</div>`;
}

function renderCondition(c: HotelCondition): string {
  const guests = `${c.rooms} phòng · ${c.adults} NL${c.children ? ` · ${c.children} TE (${c.childrenAges.join(", ")} tuổi)` : ""}`;
  const loc = `${esc(c.location.name ?? c.location.term)}${c.location.id ? ` <span class="muted">#${c.location.id} ${esc(c.location.searchType ?? "")}${c.location.isDomestic === false ? " · quốc tế" : c.location.isDomestic ? " · nội địa" : ""}</span>` : ""}`;
  const hotels = c.hotels
    .map(
      (h, i) => `<section class="hotel"><h3>${i + 1}. ${esc(h.name)} <span class="muted">#${h.hotelId}${
        (h.web ?? h.tms)?.record.starRating ? ` · ${esc((h.web ?? h.tms)!.record.starRating)}★` : ""
      }</span></h3>${renderRawRecord((h.web ?? h.tms)!.record)}<div class="cols">${renderSystem("WEB", h.web, c.web)}${renderSystem("TMS", h.tms, c.tms)}</div></section>`
    )
    .join("");
  return `<article class="cond" id="${esc(c.id)}"><h2>${esc(c.id)} · ${loc}</h2><div class="meta">${esc(c.description)} — ${c.checkIn} → ${c.checkOut} (${c.nights} đêm) · ${guests} · search lúc ${esc(
    c.searchedAt
  )}</div>${c.error ? `<div class="warn">⚠ ${esc(c.error)}</div>` : ""}${renderPolicy("WEB", c.web)}${renderPolicy("TMS", c.tms)}${hotels}</article>`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2430;--muted:#6b7380;--line:#e3e6eb;--accent:#1f6feb;--eq:#e8f1ff;--warn:#b54708;--warnbg:#fff4e5;--pick:#f0f7ff}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1f26;--fg:#e6e9ee;--muted:#9aa3ae;--line:#2c333d;--accent:#58a6ff;--eq:#16263d;--warn:#f0b35a;--warnbg:#2b2112;--pick:#16263d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:0 0 4px}h3{font-size:15px;margin:0 0 4px}h4{margin:0 0 6px;font-size:13px;letter-spacing:.05em;color:var(--accent)}
.muted{color:var(--muted);font-weight:normal}.meta{color:var(--muted);margin-bottom:8px}
nav a{margin-right:12px;color:var(--accent)}
.cond{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.pol{border-left:3px solid var(--accent);padding:4px 10px;margin:6px 0}
.hotel{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}
.raw{font-size:12px;color:var(--muted);margin-bottom:8px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:900px){.cols{grid-template-columns:1fr}}
.sys{border:1px solid var(--line);border-radius:8px;padding:10px;min-width:0}.sys.off{opacity:.7}
.calc{margin:6px 0 10px}.calc-h{display:flex;gap:8px;align-items:baseline}.calc-h strong{font-size:16px}.calc-h s{color:var(--muted)}
.steps{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.step{display:inline-flex;align-items:baseline;gap:4px;border:1px solid var(--line);border-radius:6px;padding:2px 6px;font-size:12px}
.step i{font-style:normal;font-weight:700;color:var(--accent)}.step small{color:var(--muted)}.step.eq{background:var(--eq)}
.sub{margin-top:8px}.warn{color:var(--warn);background:var(--warnbg);border-radius:4px;padding:2px 6px;margin:4px 0;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}td,th{border-bottom:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}td:last-child,th:last-child{text-align:right}
.rooms td:nth-child(3),.rooms th:nth-child(3){text-align:right}.rooms tr.pick{background:var(--pick)}
.tag{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px}
details{margin-top:6px}summary{cursor:pointer;color:var(--accent)}
`;

/** Ghi report.html + summary.csv + raw.json vào thư mục kết quả, trả đường dẫn report.html. */
export function writeHotelPriceReport(outDir: string, conditions: HotelCondition[], meta: { startedAt: string; apiUrl: string }): string {
  fs.mkdirSync(outDir, { recursive: true });
  const nav = conditions.map((c) => `<a href="#${esc(c.id)}">${esc(c.id)} ${esc(c.location.name ?? c.location.term)} (${c.hotels.length})</a>`).join("");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Giá khách sạn</title><style>${CSS}</style></head><body>
<h1>Giá khách sạn — web vs TMS (chỉ hiển thị, không so sánh)</h1>
<div class="meta">Chạy lúc ${esc(meta.startedAt)} · API ${esc(meta.apiUrl)} · ${conditions.length} điều kiện. Mỗi khách sạn: giá gốc API trả → từng bước FE cộng markup → giá hiển thị. Công thức xem tests/hotel-price/README.md.</div>
<nav>${nav}</nav>${conditions.map(renderCondition).join("")}</body></html>`;
  const file = path.join(outDir, "report.html");
  fs.writeFileSync(file, html, "utf-8");

  const csvRows = [
    ["condition", "location", "checkIn", "nights", "rooms", "adults", "children", "hotelId", "hotelName", "basePrice", "excl", "tax", "fees", "incl", "webList", "webDetailPerNight", "webBookingTotal", "tmsList", "tmsDetailPerNight", "tmsStayTotal"],
  ];
  for (const c of conditions) {
    for (const h of c.hotels) {
      const rec = (h.web ?? h.tms)!.record;
      const cpn = rec.costPerNight;
      csvRows.push([
        c.id, c.location.name ?? c.location.term, c.checkIn, String(c.nights), String(c.rooms), String(c.adults), String(c.children),
        String(h.hotelId), h.name, String(rec.basePrice ?? ""), String(cpn?.exclusive ?? ""), String(cpn?.tax ?? ""), String(cpn?.fees ?? ""), String(cpn?.inclusive ?? ""),
        String(h.web?.list.result ?? ""), String(h.web?.detail?.perNight?.result ?? ""), String(h.web?.detail?.total?.result ?? ""),
        String(h.tms?.list.result ?? ""), String(h.tms?.detail?.perNight?.result ?? ""), String(h.tms?.detail?.total?.result ?? ""),
      ]);
    }
  }
  const csv = csvRows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n");
  fs.writeFileSync(path.join(outDir, "summary.csv"), "﻿" + csv, "utf-8");

  // Số liệu từng điều kiện cho trang tổng quan (scripts/hotel-price-reports.js).
  const overview = conditions.map((c) => ({
    id: c.id,
    description: c.description,
    location: c.location.name ?? c.location.term,
    isDomestic: c.location.isDomestic,
    checkIn: c.checkIn,
    nights: c.nights,
    rooms: c.rooms,
    adults: c.adults,
    children: c.children,
    error: c.error ?? c.web.error ?? null,
    webCount: c.web.count,
    webMs: c.web.ms ?? null,
    webPolicy: c.web.policy?.name ?? null,
    tmsCount: c.tms.count,
    tmsMs: c.tms.note ? null : c.tms.ms ?? null,
    tmsPolicy: c.tms.policy?.name ?? null,
    tmsUsesWebData: !!c.tms.note,
    policyWarnings: [...new Set([...c.web.policyWarnings, ...c.tms.policyWarnings])],
    hotels: c.hotels.length,
    listDetailGaps: c.hotels.filter((h) => h.web && listDetailGap(h.web.record, h.web.detail?.room)).length,
    detailErrors: c.hotels.filter((h) => h.web?.detail?.error || h.tms?.detail?.error).length,
  }));
  fs.writeFileSync(path.join(outDir, "overview.json"), JSON.stringify({ startedAt: meta.startedAt, apiUrl: meta.apiUrl, conditions: overview }, null, 2), "utf-8");
  return file;
}
