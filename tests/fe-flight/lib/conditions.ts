import fs from "fs";
import path from "path";
import {
  AIRPORT_CATALOG,
  airportLabel,
  airportsInRegions,
  allInternational,
  domesticAirports,
  featuredInternational,
  findAirport,
} from "../../helpers/airportCatalog";

/**
 * Sinh điều kiện search theo ĐÚNG pattern của metasearch v2 (tests/metasearch-v2/metasearch-vs-web-v2.spec.ts):
 * dùng chung bộ case study (PAX / TRIP / ROUTE) trong metasearch-vs-web-v2.json — chỉ ĐỌC file đó —, xen kẽ
 * nội địa/quốc tế, case chưa chạy ưu tiên trước, chặng + ngày ngẫu nhiên, không lặp chặng đã kiểm ở lần trước
 * (lịch sử RIÊNG của FE: .test-state/fe-flight/history.json).
 *
 * Mặc định = đa dạng (ngẫu nhiên theo case study). Có chỉ định (--from/--to, --case, --adt…, --24h) thì theo chỉ định.
 * FE hiện chỉ kiểm 1 chiều → mẫu khứ hồi được bỏ qua (Mốc 3).
 */

type RouteType = "domestic" | "international";

export type Template = {
  id?: string;
  description: string;
  routeType: RouteType;
  tripType: "oneway" | "roundtrip";
  adults: number;
  children: number;
  infants: number;
  routes?: [string, string][];
  region?: string[];
  vnEnd?: string[];
  pool?: "featured" | "all";
  daysAhead?: [number, number];
  from?: string;
  to?: string;
  departDate?: string;
};

export type Condition = {
  id: string;
  template?: string;
  description: string;
  from: string;
  to: string;
  departDate: string;
  adults: number;
  children: number;
  infants: number;
  /** Chặng này đã kiểm ở lần chạy trước (chỉ khi đã hết tổ hợp mới). */
  repeated?: boolean;
  fixture?: string;
};

type MetaData = {
  templates: Template[];
  airports: { domesticHubs: string[]; domestic: string[]; vnInternationalGateways: string[]; international: string[] };
  defaults: { domesticMinDays: number; internationalMinDays: number; randomExtraDays: number };
};

const ROOT = path.join(__dirname, "..", "..", "..");
export const META_TEMPLATES_FILE = path.join(ROOT, "tests", "metasearch-v2", "metasearch-vs-web-v2.json");
export const HISTORY_FILE = path.join(ROOT, ".test-state", "fe-flight", "history.json");

// ── Lịch sử (riêng FE) ────────────────────────────────────────────────────────────────────────────
export type HistoryEntry = { key: string; template?: string; from: string; to: string; departDate: string; pax: string; state: string; runDir: string; at: string };
export const historyKey = (from: string, to: string) => `${from}-${to}|oneway`;

export function loadHistory(): HistoryEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

export function appendHistory(entry: HistoryEntry) {
  const entries = loadHistory();
  entries.push(entry);
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ entries }, null, 1));
}

// ── Sinh điều kiện ─────────────────────────────────────────────────────────────────────────────────
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const shuffle = <T>(list: T[]): T[] => [...list].sort(() => Math.random() - 0.5);
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const paxText = (p: { adults: number; children: number; infants: number }) =>
  [`${p.adults} người lớn`, p.children && `${p.children} trẻ em`, p.infants && `${p.infants} em bé`].filter(Boolean).join(" + ");

export type BuildOptions = {
  count: number;
  /** Chỉ case có mã / tiền tố này (VD ["PAX-09", "ROUTE"]). */
  cases?: string[];
  routeType?: RouteType | "all";
  /** Ghi đè số khách cho mọi điều kiện. */
  pax?: { adults: number; children: number; infants: number } | null;
  /** Ép ngày bay hôm nay / ngày mai. */
  near24h?: boolean;
  ignoreHistory?: boolean;
  /** Chỉ định đúng 1 hành trình (bỏ qua mẫu và lịch sử). */
  custom?: { from: string; to: string; departDate?: string } | null;
};

export function buildConditions(opts: BuildOptions): { conditions: Condition[]; notes: string[] } {
  const data = JSON.parse(fs.readFileSync(META_TEMPLATES_FILE, "utf8")) as MetaData;
  const notes: string[] = [];
  const airports = AIRPORT_CATALOG.size
    ? {
        ...data.airports,
        domestic: [...new Set([...domesticAirports(), ...data.airports.domestic])],
        international: [...new Set([...featuredInternational(), ...data.airports.international])],
      }
    : data.airports;
  const isDomesticCode = (code: string) => findAirport(code)?.isDomestic ?? airports.domestic.includes(code);

  if (opts.custom) {
    const { from, to } = opts.custom;
    const pax = opts.pax ?? { adults: 1, children: 0, infants: 0 };
    const near = opts.near24h && !opts.custom.departDate;
    return {
      conditions: [{
        id: "01-CHI-DINH",
        description: `Chỉ định: ${from}→${to}, 1 chiều, ${paxText(pax)}${near ? " · bay trong 24h" : ""} — ${airportLabel(from)} → ${airportLabel(to)}`,
        from,
        to,
        departDate: opts.custom.departDate ?? daysFromNow(near ? randInt(0, 1) : isDomesticCode(from) && isDomesticCode(to) ? data.defaults.domesticMinDays : data.defaults.internationalMinDays),
        ...pax,
      }],
      notes,
    };
  }

  const caseFilter = (opts.cases ?? []).map((c) => c.toUpperCase());
  const all = data.templates.filter((t) => !caseFilter.length || caseFilter.some((c) => (t.id ?? "").toUpperCase() === c || (t.id ?? "").toUpperCase().startsWith(c + "-")));
  const roundtrip = all.filter((t) => t.tripType === "roundtrip");
  if (roundtrip.length) notes.push(`bỏ ${roundtrip.length} mẫu khứ hồi (FE chưa kiểm khứ hồi): ${roundtrip.map((t) => t.id).join(", ")}`);
  const templates = all
    .filter((t) => t.tripType === "oneway")
    .filter((t) => !opts.routeType || opts.routeType === "all" || t.routeType === opts.routeType)
    .map((t) => (opts.pax ? { ...t, ...opts.pax, description: `${t.description} · ${paxText(opts.pax)} (theo cờ)` } : t))
    .map((t) => (opts.near24h && !t.departDate ? { ...t, daysAhead: [0, 1] as [number, number], description: `${t.description} · bay trong 24h` } : t));
  if (!templates.length) {
    notes.push("không còn mẫu 1 chiều nào khớp bộ lọc");
    return { conditions: [], notes };
  }

  const history = opts.ignoreHistory ? [] : loadHistory();
  const done = new Set(history.map((h) => h.key));
  const usedTemplates = new Set(history.map((h) => h.template).filter(Boolean) as string[]);
  const key = (t: Template) => t.id ?? t.description;

  // Xen kẽ nội địa / quốc tế, case chưa chạy lên trước (giống meta v2).
  const rotate = (list: Template[]) => [...shuffle(list.filter((t) => !usedTemplates.has(key(t)))), ...shuffle(list.filter((t) => usedTemplates.has(key(t))))];
  const dom = rotate(templates.filter((t) => t.routeType === "domestic"));
  const intl = rotate(templates.filter((t) => t.routeType === "international"));
  const [first, second] = Math.random() < 0.5 ? [dom, intl] : [intl, dom];
  const order: Template[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) order.push(first[i]);
    if (second[i]) order.push(second[i]);
  }

  const candidateRoutes = (t: Template): [string, string][] => {
    const routes = new Map<string, [string, string]>();
    const add = (a: string, b: string) => {
      if (a === b) return;
      routes.set(`${a}-${b}`, [a, b]);
      routes.set(`${b}-${a}`, [b, a]);
    };
    const vnEnd = t.vnEnd ?? airports.vnInternationalGateways;
    if (t.routes?.length || t.region?.length) {
      for (const [a, b] of t.routes ?? []) add(a.toUpperCase(), b.toUpperCase());
      if (t.region?.length) for (const vn of vnEnd) for (const x of airportsInRegions(t.region)) add(vn, x);
    } else if (t.routeType === "international" && t.pool === "all" && AIRPORT_CATALOG.size) {
      for (const vn of vnEnd) for (const x of allInternational()) add(vn, x);
    } else if (t.routeType === "domestic") {
      for (const hub of airports.domesticHubs) for (const other of airports.domestic) add(hub, other);
    } else {
      for (const vn of airports.vnInternationalGateways) for (const x of airports.international) add(vn, x);
    }
    return [...routes.values()];
  };

  const conditions: Condition[] = [];
  const usedInRun = new Set<string>();
  let cursor = 0;
  for (const allowRepeat of [false, true]) {
    for (let i = 0; conditions.length < opts.count && i < order.length * opts.count; i++) {
      const t = order[cursor++ % order.length];
      const fresh = t.from && t.to
        ? [[t.from, t.to] as [string, string]]
        : candidateRoutes(t).filter(([a, b]) => !usedInRun.has([a, b].sort().join("-")) && (allowRepeat || !done.has(historyKey(a, b))));
      if (!fresh.length) continue;
      const [from, to] = pick(fresh);
      const routeKey = [from, to].sort().join("-");
      if (usedInRun.has(routeKey)) continue;
      usedInRun.add(routeKey);
      const minDays = t.routeType === "domestic" ? data.defaults.domesticMinDays : data.defaults.internationalMinDays;
      const [aMin, aMax] = t.daysAhead ?? [minDays, minDays + data.defaults.randomExtraDays];
      const n = conditions.length + 1;
      conditions.push({
        id: `${String(n).padStart(2, "0")}-${t.id ?? "CASE"}`,
        template: key(t),
        description: `${t.id ? `${t.id} · ` : ""}${t.description} — ${airportLabel(from)} → ${airportLabel(to)}`,
        from,
        to,
        departDate: t.departDate ?? daysFromNow(randInt(aMin, aMax)),
        adults: t.adults,
        children: t.children,
        infants: t.infants,
        repeated: done.has(historyKey(from, to)),
      });
    }
  }
  return { conditions, notes };
}
