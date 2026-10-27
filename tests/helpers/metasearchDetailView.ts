/**
 * Bảng chi tiết từng hành trình trong report.html — dùng chung cho báo cáo v1 (metasearchReport.ts)
 * và v2 (metasearchReportV2.ts). Dữ liệu nhúng dạng JSON, render bằng JS trong trang để xử lý được
 * vài nghìn dòng: lọc theo trạng thái / system / số hiệu, sắp xếp, phân trang, bấm dòng xem chi tiết.
 */

/** Đủ field mà cả DetailRow v1 lẫn v2 đều có. */
export type DetailRowLike = {
  status: string;
  side: string;
  system: string;
  airline: string;
  legs: { dir: number; flightNumbers: string; route: string; depart: string; arrive: string }[];
  metaPrice: number | null;
  voucherCode: string;
  voucherDiscount: number;
  metaBasePrice: number | null;
  metaLegPrices: (number | null)[];
  webPrices: number[];
  webLegPrices: number[][];
  webClosestPrice: number | null;
  diff: number | null;
  diffLegs: string;
  metaServiceFee: number | null;
  webServiceFee: number | null;
  metaFinal: number | null;
  webFinal: number | null;
  webSource: string;
  metaDuplicates: number;
  note: string;
};

export type DetailViewLabels = {
  /** Cột giá chính META, VD "Giá META (trước voucher)" / "Giá vé META (+ voucher)". */
  metaPrice: string;
  webPrice: string;
  fee: string;
  final: string;
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Chỗ đặt bảng cho 1 điều kiện + dữ liệu JSON của nó (rút gọn tên field cho nhẹ file). */
export function detailView(condId: string, rows: DetailRowLike[], labels: DetailViewLabels): string {
  const data = rows.map((r) => ({
    s: r.status, sd: r.side, sy: r.system, al: r.airline,
    lg: r.legs.map((l) => [l.dir, l.flightNumbers, l.route, l.depart, l.arrive]),
    mp: r.metaPrice, vc: r.voucherCode, vd: r.voucherDiscount, mb: r.metaBasePrice, ml: r.metaLegPrices,
    wc: r.webClosestPrice, wp: r.webPrices, wl: r.webLegPrices, d: r.diff, dl: r.diffLegs,
    mf: r.metaServiceFee, wf: r.webServiceFee, mt: r.metaFinal, wt: r.webFinal,
    src: r.webSource, dup: r.metaDuplicates, n: r.note,
  }));
  // Thoát "<" để chuỗi "</script>" trong dữ liệu không đóng thẻ.
  const json = JSON.stringify({ labels, rows: data }).replace(/</g, "\\u003c");
  return `<div class="dv" data-cond="${esc(condId)}"></div>
<script type="application/json" id="dv-data-${esc(condId)}">${json}</script>`;
}

export const detailViewCss = `
  .dv { margin-top: 12px; }
  .dv-sys { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
  .dv-sys button { font: inherit; font-size: 12px; border: 1px solid #d0d4da; background: #fff; border-radius: 999px; padding: 2px 10px; cursor: pointer; }
  .dv-sys button.on { border-color: #2563eb; background: #eff6ff; }
  .dv-sys .bad { color: #b42318; font-weight: 600; }
  .dv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
  .dv-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .dv-chips button { font: inherit; font-size: 12px; border: 1px solid #d0d4da; background: #fff; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
  .dv-chips button.on { background: #1f2328; color: #fff; border-color: #1f2328; }
  .dv-chips button:disabled { opacity: .45; cursor: default; }
  .dv-bar input, .dv-bar select { font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid #d0d4da; border-radius: 6px; background: #fff; }
  .dv-bar input { min-width: 180px; }
  .dv table { table-layout: auto; }
  .dv tbody tr.row { cursor: pointer; }
  .dv tbody tr.row:hover { background: #f8fafc; }
  .dv tbody tr.open { background: #f1f5f9; }
  .dv td.it { font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.5; }
  .dv td.it .d { color: #6b7280; display: inline-block; width: 22px; }
  .dv td.it .t { color: #6b7280; }
  .dv .caret { color: #9ca3af; width: 14px; }
  .dv tr.detail td { background: #f8fafc; padding: 10px 14px 14px 36px; }
  .dv .grid { display: grid; grid-template-columns: max-content 1fr 1fr; gap: 4px 18px; font-size: 13px; max-width: 820px; }
  .dv .grid .h { font-weight: 600; color: #6b7280; font-size: 12px; }
  .dv .levels { display: flex; flex-wrap: wrap; gap: 4px; }
  .dv .levels span { background: #fff; border: 1px solid #e3e5e8; border-radius: 4px; padding: 0 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .dv .levels span.hit { border-color: #16a34a; background: #dcfce7; }
  .dv .notes { margin-top: 8px; font-size: 12px; color: #4b5563; }
  .dv-pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 8px; font-size: 12px; color: #6b7280; }
  .dv-pager button { font: inherit; font-size: 12px; padding: 2px 10px; border: 1px solid #d0d4da; background: #fff; border-radius: 6px; cursor: pointer; }
  .dv-pager button:disabled { opacity: .4; cursor: default; }
  .dv .fee-ok { color: #6b7280; } .dv .fee-bad { color: #b42318; font-weight: 600; }
  .tag.warn { background: #fef9c3; color: #854d0e; }
  .dv-sys .warn-t { color: #a16207; font-weight: 600; }
  .dv .small-diff { color: #a16207; font-weight: 600; }
`;

/** JS chạy trong trang: render mọi `.dv` từ JSON tương ứng. Không dùng regex/backslash để an toàn trong template. */
export const detailViewScript = `<script>
(() => {
  const SMALL = "Lệch giá dưới 1k"; // chênh do làm tròn → cảnh báo vàng, không tính là lệch
  const STATUSES = ["LỆCH GIÁ", "LỆCH PHÍ", "CHỈ CÓ Ở META", "CHỈ CÓ Ở WEB", SMALL, "KHỚP"];
  const TAG = { "KHỚP": "ok", "LỆCH GIÁ": "diff", [SMALL]: "warn", "LỆCH PHÍ": "diff", "CHỈ CÓ Ở META": "meta", "CHỈ CÓ Ở WEB": "web" };
  const isProblem = (r) => r.s !== "KHỚP" && r.s !== SMALL;
  const money = (v) => (typeof v === "number" ? v.toLocaleString("vi-VN") : "—");
  const short = (v) => {
    if (typeof v !== "number") return "—";
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + "tr";
    if (a >= 1e3) return Math.round(v / 1e3).toLocaleString("vi-VN") + "k";
    return String(v);
  };
  const esc = (s) => String(s == null ? "" : s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
  // "2026-12-16T09:40:00Z" -> "16/12 09:40"
  const hm = (iso) => {
    const s = String(iso || "");
    if (s.length < 16) return s;
    return s.slice(8, 10) + "/" + s.slice(5, 7) + " " + s.slice(11, 16);
  };
  // Giờ đến; khác ngày giờ đi thì thêm "+N" (bay qua đêm).
  const arrive = (dep, arr) => {
    const t = String(arr || "").slice(11, 16);
    const days = Math.round((Date.parse(String(arr).slice(0, 10)) - Date.parse(String(dep).slice(0, 10))) / 86400000);
    return days > 0 ? t + "+" + days : t;
  };

  document.querySelectorAll(".dv").forEach((root) => {
    const id = root.dataset.cond;
    const { labels, rows } = JSON.parse(document.getElementById("dv-data-" + id).textContent);
    if (!rows.length) { root.innerHTML = '<p class="muted">Không có hành trình nào.</p>'; return; }

    const problems = rows.filter(isProblem).length;
    const st = { status: problems ? "PROBLEMS" : "ALL", system: "", q: "", sort: "default", page: 0, size: 25, open: new Set() };

    // Tóm tắt theo system
    const bySys = new Map();
    rows.forEach((r) => {
      const e = bySys.get(r.sy) || { ok: 0, bad: 0, warn: 0 };
      if (r.s === "KHỚP") e.ok++; else if (r.s === SMALL) e.warn++; else e.bad++;
      bySys.set(r.sy, e);
    });
    const counts = {};
    rows.forEach((r) => (counts[r.s] = (counts[r.s] || 0) + 1));

    root.innerHTML =
      '<div class="dv-sys"></div>' +
      '<div class="dv-bar"><div class="dv-chips"></div>' +
      '<select class="dv-sort"><option value="default">Sắp xếp: mặc định</option><option value="diff">Chênh lệch lớn nhất</option><option value="price">Giá META thấp nhất</option><option value="depart">Giờ đi sớm nhất</option></select>' +
      '<input class="dv-q" type="search" placeholder="Tìm số hiệu / chặng (VD VJ975, ICN)">' +
      '<select class="dv-size"><option>25</option><option>50</option><option>100</option></select></div>' +
      '<div class="scroll"><table><thead><tr><th></th><th>Trạng thái</th><th>System</th><th>Hành trình</th>' +
      '<th class="num">' + esc(labels.metaPrice) + '</th><th class="num">' + esc(labels.webPrice) + '</th><th class="num">Chênh</th><th class="num">' + esc(labels.fee) + '</th></tr></thead><tbody></tbody></table></div>' +
      '<div class="dv-pager"></div>';
    const $ = (sel) => root.querySelector(sel);

    const sysBox = $(".dv-sys");
    const renderSys = () => {
      sysBox.innerHTML = [...bySys.entries()].sort((a, b) => b[1].bad - a[1].bad || b[1].ok - a[1].ok).map(([sy, e]) =>
        '<button data-sy="' + esc(sy) + '" class="' + (st.system === sy ? "on" : "") + '"><b>' + esc(sy) + '</b>: ' +
        [e.bad && '<span class="bad">' + e.bad + " lệch/thiếu</span>", e.warn && '<span class="warn-t">' + e.warn + " lệch &lt;1k</span>", e.ok && e.ok + " khớp"]
          .filter(Boolean).join(" · ") + "</button>").join("");
    };
    sysBox.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.system = st.system === b.dataset.sy ? "" : b.dataset.sy; st.page = 0; renderSys(); render();
    });

    const chips = $(".dv-chips");
    const chipDefs = [["PROBLEMS", "Lệch / thiếu", problems], ["ALL", "Tất cả", rows.length]].concat(STATUSES.map((s) => [s, s.charAt(0) + s.slice(1).toLowerCase(), counts[s] || 0]));
    const renderChips = () => {
      chips.innerHTML = chipDefs.map(([k, label, n]) =>
        '<button data-k="' + esc(k) + '" class="' + (st.status === k ? "on" : "") + '"' + (n ? "" : " disabled") + '>' + esc(label) + " (" + n + ")</button>").join("");
    };
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      st.status = b.dataset.k; st.page = 0; renderChips(); render();
    });
    $(".dv-sort").addEventListener("change", (e) => { st.sort = e.target.value; st.page = 0; render(); });
    $(".dv-size").addEventListener("change", (e) => { st.size = Number(e.target.value); st.page = 0; render(); });
    $(".dv-q").addEventListener("input", (e) => { st.q = e.target.value.trim().toLowerCase(); st.page = 0; render(); });

    const legLine = (l) =>
      '<div><span class="d">' + (l[0] ? "Về" : "Đi") + "</span>" + esc(l[1]) + " " + esc(l[2]) +
      ' <span class="t">' + esc(hm(l[3])) + "→" + esc(arrive(l[3], l[4])) + "</span></div>";
    const feeCell = (r) => {
      if (r.mf == null && r.wf == null) return "";
      if (r.mf != null && r.wf != null && r.mf !== r.wf) return '<span class="fee-bad">' + short(r.mf) + " ≠ " + short(r.wf) + "</span>";
      return '<span class="fee-ok">' + short(r.mf != null ? r.mf : r.wf) + "</span>";
    };
    const levels = (list, hit) => '<div class="levels">' + (list || []).map((p) => '<span class="' + (p === hit ? "hit" : "") + '">' + money(p) + "</span>").join("") + "</div>";
    const detail = (r) => {
      const metaLines = [];
      if (r.mb != null) metaLines.push("<b>" + money(r.mb) + "</b>");
      if (r.vd) metaLines.push('<div class="muted">API trả ' + money(r.mp) + " + voucher " + esc(r.vc) + " " + money(r.vd) + "</div>");
      // Combo: mỗi chiều mang giá cả chuyến → không tách đi/về.
      if (r.ml && r.ml.length > 1 && r.src !== "combo") metaLines.push('<div class="muted">đi ' + money(r.ml[0]) + " · về " + money(r.ml[1]) + (r.vd ? " (đã trừ voucher)" : "") + "</div>");
      const webLines = [];
      if (r.wc != null) webLines.push("<b>" + money(r.wc) + "</b>");
      if (r.wp && r.wp.length > 1) webLines.push('<div class="muted">các mức hạng vé:</div>' + levels(r.wp, r.mb));
      (r.wl || []).forEach((p, i) => p.length && webLines.push('<div class="muted">' + (i ? "về" : "đi") + ":</div>" + levels(p, r.ml ? r.ml[i] : null)));
      const notes = [r.dl && "Chặng lệch: " + r.dl, r.src && "Nguồn web: " + r.src, r.dup > 1 && r.dup + " offer meta trùng", r.n].filter(Boolean);
      return '<div class="grid">' +
        '<div class="h"></div><div class="h">META</div><div class="h">WEB</div>' +
        "<div>" + esc(labels.metaPrice.replace(" META", "")) + "</div><div>" + (metaLines.join("") || "—") + "</div><div>" + (webLines.join("") || "—") + "</div>" +
        "<div>" + esc(labels.fee) + "</div><div>" + money(r.mf) + "</div><div>" + money(r.wf) + "</div>" +
        "<div>" + esc(labels.final) + "</div><div><b>" + money(r.mt) + "</b></div><div><b>" + money(r.wt) + "</b></div>" +
        "</div>" + (notes.length ? '<div class="notes">' + notes.map(esc).join(" · ") + "</div>" : "");
    };

    const tbody = $("tbody"), pager = $(".dv-pager");
    const filtered = () => {
      let list = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
        (st.status === "ALL" || (st.status === "PROBLEMS" ? isProblem(r) : r.s === st.status)) &&
        (!st.system || r.sy === st.system) &&
        (!st.q || (r.lg.map((l) => l[1] + " " + l[2]).join(" ") + " " + r.sy + " " + r.al).toLowerCase().includes(st.q)));
      const by = {
        diff: (a, b) => Math.abs(b.r.d || 0) - Math.abs(a.r.d || 0),
        price: (a, b) => (a.r.mb == null ? Infinity : a.r.mb) - (b.r.mb == null ? Infinity : b.r.mb),
        depart: (a, b) => String((a.r.lg[0] || [])[3]).localeCompare(String((b.r.lg[0] || [])[3])),
      }[st.sort];
      return by ? list.sort(by) : list;
    };
    const render = () => {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / st.size));
      st.page = Math.min(st.page, pages - 1);
      const slice = list.slice(st.page * st.size, (st.page + 1) * st.size);
      tbody.innerHTML = slice.map(({ r, i }) => {
        const open = st.open.has(i);
        const diffClass = r.s === SMALL ? "small-diff" : r.d > 0 ? "up" : "down";
        const diff = r.d ? '<b class="' + diffClass + '">' + (r.d > 0 ? "+" : "") + money(r.d) + "</b>" : "";
        return '<tr class="row' + (open ? " open" : "") + '" data-i="' + i + '">' +
          '<td class="caret">' + (open ? "▾" : "▸") + "</td>" +
          '<td><span class="tag ' + (TAG[r.s] || "") + '">' + esc(r.s) + "</span></td>" +
          "<td>" + esc(r.sy) + (r.al && r.al !== r.sy ? ' <span class="muted">' + esc(r.al) + "</span>" : "") + "</td>" +
          '<td class="it">' + r.lg.map(legLine).join("") + "</td>" +
          '<td class="num">' + (r.mb != null ? money(r.mb) : "—") + (r.vd ? '<div class="muted">voucher −' + short(r.vd) + "</div>" : "") + "</td>" +
          '<td class="num">' + (r.wc != null ? money(r.wc) : "—") + (r.wp && r.wp.length > 1 ? '<div class="muted">' + r.wp.length + " mức</div>" : "") + "</td>" +
          '<td class="num">' + diff + "</td>" +
          '<td class="num">' + feeCell(r) + "</td></tr>" +
          (open ? '<tr class="detail"><td colspan="8">' + detail(r) + "</td></tr>" : "");
      }).join("") || '<tr><td colspan="8" class="muted">Không có dòng nào khớp bộ lọc.</td></tr>';
      pager.innerHTML = list.length
        ? "<span>" + (st.page * st.size + 1) + "–" + Math.min((st.page + 1) * st.size, list.length) + " / " + list.length + "</span>" +
          '<button data-p="-1"' + (st.page ? "" : " disabled") + ">‹ Trước</button>" +
          '<button data-p="1"' + (st.page < pages - 1 ? "" : " disabled") + ">Sau ›</button>"
        : "";
    };
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr.row"); if (!tr || e.target.closest("a")) return;
      const i = Number(tr.dataset.i);
      st.open.has(i) ? st.open.delete(i) : st.open.add(i);
      render();
    });
    pager.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      st.page += Number(b.dataset.p); render();
    });
    renderSys(); renderChips(); render();
  });
})();
</script>`;
