// Single-fetch dashboard with zh/en i18n.
// Every tick we pull /api/snapshot and re-render every section.
// All user-facing strings go through t(key, ...args) so flipping language
// instantly relocalises the next render.

const SVG_NS = "http://www.w3.org/2000/svg";

// ─── i18n ───────────────────────────────────────────────────────────────────
const I18N = {
  zh: {
    title: "System Web Monitor",
    subtitle: "实时 GPU + CPU 监控 · nvidia-smi + Intel RAPL",
    status_online: "在线",
    status_connecting: "连接中",

    energy_panel: "能耗",
    energy_sampling: "采样中…",
    energy_start: "启动时间",
    energy_total: "累计耗电 (CPU + GPU)",
    energy_uptime: "已运行 {0}",
    energy_now_total: "当前合计 {0} W",
    energy_breakdown: "CPU {0} W · GPU {1} W",
    energy_waiting: "等待采样…",
    energy_status: "{0} 样本 · {1}s/次",
    energy_chart_title: "按小时耗电 (kWh, 最近 24h)",
    energy_current_hour: "(当前小时)",

    chip_gpu: "nvidia-smi · 1s",
    chip_cpu: "RAPL · 1s",

    cpu_socket: "socket {0}",
    cpu_pkg_label: "Package 功耗",
    cpu_dram_label: "DRAM 功耗",
    cpu_total_label: "合计",
    cpu_dram_sub: "RAPL dram 子域",
    cpu_pkg_dram_sub: "package + dram",
    cpu_default_model: "Intel CPU",
    cpu_pkg_pct: "{0}% / {1} W TDP",

    gpu_util: "GPU 使用率",
    gpu_mem: "显存",
    gpu_temp: "温度",
    gpu_power: "功耗",
    gpu_mem_util: "显存使用率",
    gpu_fan: "风扇",
    gpu_clock_g: "核心频率",
    gpu_clock_m: "显存频率",

    proc_panel: "进程",
    proc_count: "{0} 个",
    proc_empty: "暂无计算进程",
    proc_col_gpu: "GPU",
    proc_col_pid: "PID",
    proc_col_name: "进程名",
    proc_col_mem: "显存",

    chart_hour: "{0}时",
    last_sample: "最后采样 {0} · {1} 张 GPU · {2} 路 CPU",

    dur_d: "{0} 天 {1} 时 {2} 分",
    dur_h: "{0} 时 {1} 分 {2} 秒",
    dur_m: "{0} 分 {1} 秒",
    dur_s: "{0} 秒",

    na: "N/A",
    lang_toggle: "EN",
  },
  en: {
    title: "System Web Monitor",
    subtitle: "Live GPU + CPU monitor · nvidia-smi + Intel RAPL",
    status_online: "Online",
    status_connecting: "Connecting",

    energy_panel: "Energy",
    energy_sampling: "Sampling…",
    energy_start: "Started at",
    energy_total: "Total energy (CPU + GPU)",
    energy_uptime: "Up for {0}",
    energy_now_total: "Total now {0} W",
    energy_breakdown: "CPU {0} W · GPU {1} W",
    energy_waiting: "Waiting for samples…",
    energy_status: "{0} samples · every {1}s",
    energy_chart_title: "Hourly energy (kWh, last 24h)",
    energy_current_hour: "(current hour)",

    chip_gpu: "nvidia-smi · 1s",
    chip_cpu: "RAPL · 1s",

    cpu_socket: "socket {0}",
    cpu_pkg_label: "Package power",
    cpu_dram_label: "DRAM power",
    cpu_total_label: "Total",
    cpu_dram_sub: "RAPL dram subzone",
    cpu_pkg_dram_sub: "package + dram",
    cpu_default_model: "Intel CPU",
    cpu_pkg_pct: "{0}% / {1} W TDP",

    gpu_util: "GPU util",
    gpu_mem: "Memory",
    gpu_temp: "Temperature",
    gpu_power: "Power",
    gpu_mem_util: "Memory util",
    gpu_fan: "Fan",
    gpu_clock_g: "Core clock",
    gpu_clock_m: "Memory clock",

    proc_panel: "Processes",
    proc_count: "{0}",
    proc_empty: "No compute processes",
    proc_col_gpu: "GPU",
    proc_col_pid: "PID",
    proc_col_name: "Name",
    proc_col_mem: "VRAM",

    chart_hour: "{0}h",
    last_sample: "Last sample {0} · {1} GPU(s) · {2} CPU(s)",

    dur_d: "{0}d {1}h {2}m",
    dur_h: "{0}h {1}m {2}s",
    dur_m: "{0}m {1}s",
    dur_s: "{0}s",

    na: "N/A",
    lang_toggle: "中",
  },
};

let lang = localStorage.getItem("swm_lang");
if (lang !== "zh" && lang !== "en") {
  lang = navigator.language && navigator.language.startsWith("zh") ? "zh" : "en";
}

function t(key, ...args) {
  const dict = I18N[lang] || I18N.zh;
  let s = dict[key];
  if (s === undefined) s = I18N.zh[key];
  if (s === undefined) return key;
  args.forEach((v, i) => {
    s = s.replaceAll(`{${i}}`, String(v));
  });
  return s;
}

function localeName() {
  return lang === "zh" ? "zh-CN" : "en-US";
}

function applyStaticI18n() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  const lt = document.querySelector("#langToggle");
  if (lt) lt.textContent = t("lang_toggle");
}

// ─── element refs ───────────────────────────────────────────────────────────
const els = {
  cpuGrid: document.querySelector("#cpuGrid"),
  gpuGrid: document.querySelector("#gpuGrid"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  subtitle: document.querySelector("#subtitle"),
  processRows: document.querySelector("#processRows"),
  processCount: document.querySelector("#processCount"),
  energyStart: document.querySelector("#energyStart"),
  energyUptime: document.querySelector("#energyUptime"),
  energyTotal: document.querySelector("#energyTotal"),
  energyNow: document.querySelector("#energyNow"),
  energyBreakdown: document.querySelector("#energyBreakdown"),
  energyStatus: document.querySelector("#energyStatus"),
  energyChart: document.querySelector("#energyChart"),
  energyChartRange: document.querySelector("#energyChartRange"),
  langToggle: document.querySelector("#langToggle"),
};

let lastSnapshot = null;

// ─── formatting helpers ─────────────────────────────────────────────────────
function fmt(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return t("na");
  return `${value}${suffix}`;
}
function mb(value) {
  if (value === null || value === undefined) return t("na");
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${value} MB`;
}
function clamp(value, min = 0, max = 100) {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(min, Math.min(max, value));
}
function fmtDateTime(epoch) {
  const d = new Date(epoch * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) return t("dur_d", d, h, m);
  if (h) return t("dur_h", h, m, s);
  if (m) return t("dur_m", m, s);
  return t("dur_s", s);
}
function fmtKwh(wh) {
  const kwh = wh / 1000;
  if (kwh >= 1) return `${kwh.toFixed(3)} kWh`;
  return `${wh.toFixed(1)} Wh`;
}

function setStatus(ok, text) {
  els.statusDot.classList.toggle("ok", ok);
  els.statusDot.classList.toggle("bad", !ok);
  els.statusText.textContent = text;
}

// ─── GPU per-card mini history chart ────────────────────────────────────────
const gpuHistory = new Map();
const maxHistoryPoints = 90;
let uuidToIndex = new Map();

function rememberGpu(gpu) {
  const points = gpuHistory.get(gpu.uuid) || [];
  points.push({ gpu: gpu.gpu_util ?? 0, mem: gpu.memory_percent ?? 0 });
  while (points.length > maxHistoryPoints) points.shift();
  gpuHistory.set(gpu.uuid, points);
  return points;
}

function gpuChartPath(points, key, width, height) {
  if (!points.length) return "";
  return points
    .map((p, i) => {
      const x = points.length === 1 ? width : (i / (points.length - 1)) * width;
      const y = height - (clamp(p[key]) / 100) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function gpuChart(points) {
  const w = 640;
  const h = 150;
  return `
    <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="GPU history chart">
      <path d="M 0 37.5 H ${w} M 0 75 H ${w} M 0 112.5 H ${w}" stroke="#1e2630" stroke-width="1" />
      <path d="${gpuChartPath(points, "mem", w, h)}" fill="none" stroke="#36d399" stroke-width="3" vector-effect="non-scaling-stroke" />
      <path d="${gpuChartPath(points, "gpu", w, h)}" fill="none" stroke="#38bdf8" stroke-width="3" vector-effect="non-scaling-stroke" />
    </svg>
  `;
}

// ─── card renderers ─────────────────────────────────────────────────────────
function gpuCard(gpu) {
  const points = rememberGpu(gpu);
  const gpuUtil = clamp(gpu.gpu_util);
  const memPercent = clamp(gpu.memory_percent);
  const tempPercent = clamp(gpu.temperature ?? 0);
  const powerPercent = clamp(gpu.power_percent);
  return `
    <article class="gpu-card">
      <div class="gpu-head">
        <div>
          <div class="gpu-name">GPU ${gpu.index}: ${gpu.name}</div>
          <div class="gpu-uuid">${gpu.uuid}</div>
        </div>
        <span class="chip">${t("chip_gpu")}</span>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="label">${t("gpu_util")}</div>
          <div class="value">${fmt(gpu.gpu_util, "%")}</div>
          <div class="bar"><span style="width:${gpuUtil}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_mem")}</div>
          <div class="value">${fmt(gpu.memory_percent, "%")}</div>
          <div class="subvalue">${mb(gpu.memory_used)} / ${mb(gpu.memory_total)}</div>
          <div class="bar mem"><span style="width:${memPercent}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_temp")}</div>
          <div class="value">${fmt(gpu.temperature, "°C")}</div>
          <div class="bar hot"><span style="width:${tempPercent}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_power")}</div>
          <div class="value">${fmt(gpu.power_draw, " W")}</div>
          <div class="subvalue">${fmt(gpu.power_percent, "%")} / ${fmt(gpu.power_limit, " W")}</div>
          <div class="bar"><span style="width:${powerPercent}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_mem_util")}</div>
          <div class="value">${fmt(gpu.mem_util, "%")}</div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_fan")}</div>
          <div class="value">${fmt(gpu.fan_speed, "%")}</div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_clock_g")}</div>
          <div class="value">${fmt(gpu.graphics_clock, " MHz")}</div>
        </div>
        <div class="metric">
          <div class="label">${t("gpu_clock_m")}</div>
          <div class="value">${fmt(gpu.memory_clock, " MHz")}</div>
        </div>
      </div>
      ${gpuChart(points)}
    </article>
  `;
}

function cpuCard(cpu) {
  const pkgW = cpu.package_power_w;
  const dramW = cpu.dram_power_w;
  const pkgLimit = cpu.package_limit_w;
  const pkgPct =
    pkgW !== null && pkgW !== undefined && pkgLimit
      ? clamp((pkgW / pkgLimit) * 100)
      : 0;
  const totalW =
    (typeof pkgW === "number" ? pkgW : 0) + (typeof dramW === "number" ? dramW : 0);
  const totalShown =
    pkgW === null && dramW === null ? t("na") : `${totalW.toFixed(2)} W`;
  const modelText = cpu.model || t("cpu_default_model");
  return `
    <article class="gpu-card">
      <div class="gpu-head">
        <div>
          <div class="gpu-name">CPU ${cpu.index}: ${modelText}</div>
          <div class="gpu-uuid">${t("cpu_socket", cpu.index)}</div>
        </div>
        <span class="chip">${t("chip_cpu")}</span>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="label">${t("cpu_pkg_label")}</div>
          <div class="value">${pkgW !== null && pkgW !== undefined ? `${pkgW.toFixed(2)} W` : t("na")}</div>
          <div class="subvalue">${pkgLimit ? t("cpu_pkg_pct", pkgPct.toFixed(0), pkgLimit) : ""}</div>
          <div class="bar"><span style="width:${pkgPct}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">${t("cpu_dram_label")}</div>
          <div class="value">${dramW !== null && dramW !== undefined ? `${dramW.toFixed(2)} W` : t("na")}</div>
          <div class="subvalue">${t("cpu_dram_sub")}</div>
        </div>
        <div class="metric">
          <div class="label">${t("cpu_total_label")}</div>
          <div class="value">${totalShown}</div>
          <div class="subvalue">${t("cpu_pkg_dram_sub")}</div>
        </div>
      </div>
    </article>
  `;
}

function processRow(proc) {
  const gpuIndex = uuidToIndex.get(proc.gpu_uuid);
  return `
    <tr>
      <td>${gpuIndex === undefined ? proc.gpu_uuid : `GPU ${gpuIndex}`}</td>
      <td>${proc.pid}</td>
      <td>${proc.process_name}</td>
      <td>${mb(proc.used_memory)}</td>
    </tr>
  `;
}

// ─── energy chart (rolling last-24h) ────────────────────────────────────────
function svgEl(name, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function renderEnergyChart(snapshot) {
  const energy = snapshot.energy;
  // Rolling 24h window: start at the bucket containing (now - 24h), or at the
  // server's start hour if it's been up less than 24h. Server may keep older
  // buckets in memory; we just don't show them.
  const cutoff = snapshot.now - 24 * 3600;
  const startHour = Math.max(
    Math.floor(snapshot.start_time / 3600) * 3600,
    Math.floor(cutoff / 3600) * 3600
  );
  const nowHour = Math.floor(snapshot.now / 3600) * 3600;
  const buckets = new Map(energy.hourly.map((b) => [b.hour_start, b.wh]));
  const shown = [];
  for (let h = startHour; h <= nowHour; h += 3600) {
    shown.push({ hourStart: h, wh: buckets.get(h) || 0 });
  }

  const locale = localeName();
  els.energyChartRange.textContent = shown.length
    ? `${new Date(shown[0].hourStart * 1000).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} – ${new Date(shown[shown.length - 1].hourStart * 1000 + 3600 * 1000).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    : "";

  const W = 920;
  const H = 180;
  const padL = 36;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxWh = Math.max(0.001, ...shown.map((b) => b.wh));
  const niceMaxKwh = Math.ceil(maxWh / 100) / 10;
  const niceMaxWh = Math.max(100, niceMaxKwh * 1000);

  els.energyChart.setAttribute("viewBox", `0 0 ${W} ${H}`);
  els.energyChart.innerHTML = "";

  for (const frac of [0, 0.5, 1]) {
    const y = padT + plotH - frac * plotH;
    els.energyChart.appendChild(
      svgEl("line", {
        x1: padL,
        x2: W - padR,
        y1: y.toFixed(1),
        y2: y.toFixed(1),
        class: "grid",
        "stroke-dasharray": frac === 0 ? "" : "2 4",
      })
    );
    els.energyChart.appendChild(
      svgEl(
        "text",
        { x: padL - 6, y: (y + 3).toFixed(1), class: "tick-label", "text-anchor": "end" },
        [document.createTextNode(((frac * niceMaxWh) / 1000).toFixed(2))]
      )
    );
  }

  if (!shown.length) return;

  const barGap = 2;
  const barW = Math.max(2, plotW / shown.length - barGap);
  const currentHour = Math.floor(snapshot.now / 3600) * 3600;

  shown.forEach((b, i) => {
    const x = padL + (plotW / shown.length) * i + barGap / 2;
    const h = (b.wh / niceMaxWh) * plotH;
    const y = padT + plotH - h;
    const isPartial = b.hourStart === currentHour;
    const bar = svgEl("rect", {
      x: x.toFixed(1),
      y: y.toFixed(1),
      width: barW.toFixed(1),
      height: Math.max(0, h).toFixed(1),
      class: `bar${isPartial ? " partial" : ""}`,
      rx: "1",
    });
    const d = new Date(b.hourStart * 1000);
    bar.appendChild(
      svgEl("title", {}, [
        document.createTextNode(
          `${d.toLocaleString(locale)} — ${(b.wh / 1000).toFixed(3)} kWh${isPartial ? " " + t("energy_current_hour") : ""}`
        ),
      ])
    );
    els.energyChart.appendChild(bar);
  });

  const tickEvery = shown.length <= 8 ? 1 : shown.length <= 16 ? 2 : 4;
  shown.forEach((b, i) => {
    if (i % tickEvery !== 0 && i !== shown.length - 1) return;
    const x = padL + (plotW / shown.length) * i + barW / 2 + barGap / 2;
    const d = new Date(b.hourStart * 1000);
    const label = t("chart_hour", String(d.getHours()).padStart(2, "0"));
    els.energyChart.appendChild(
      svgEl(
        "text",
        { x: x.toFixed(1), y: (H - 6).toFixed(1), class: "tick-label", "text-anchor": "middle" },
        [document.createTextNode(label)]
      )
    );
  });
}

function renderEnergyPanel(snapshot) {
  const e = snapshot.energy;
  els.energyStart.textContent = fmtDateTime(snapshot.start_time);
  els.energyUptime.textContent = t(
    "energy_uptime",
    fmtDuration(snapshot.now - snapshot.start_time)
  );
  els.energyTotal.textContent = fmtKwh(e.total_wh);

  const cpuW = e.cpu_power_w;
  const gpuW = e.gpu_power_w;
  const haveCpu = cpuW !== null && cpuW !== undefined;
  const haveGpu = gpuW !== null && gpuW !== undefined;
  const totalW = (haveCpu ? cpuW : 0) + (haveGpu ? gpuW : 0);
  els.energyNow.textContent = haveCpu || haveGpu
    ? t("energy_now_total", totalW.toFixed(1))
    : t("energy_waiting");
  els.energyBreakdown.textContent = t(
    "energy_breakdown",
    haveCpu ? cpuW.toFixed(1) : "—",
    haveGpu ? gpuW.toFixed(1) : "—"
  );
  els.energyStatus.textContent = t("energy_status", snapshot.sample_count, snapshot.interval);
  renderEnergyChart(snapshot);
}

// ─── unified render entry point ─────────────────────────────────────────────
function render(snapshot) {
  lastSnapshot = snapshot;

  uuidToIndex = new Map(snapshot.gpus.map((g) => [g.uuid, g.index]));
  els.gpuGrid.innerHTML = snapshot.gpus.map(gpuCard).join("");
  els.cpuGrid.innerHTML = snapshot.cpus.map(cpuCard).join("");

  els.processCount.textContent = t("proc_count", snapshot.processes.length);
  if (!snapshot.processes.length) {
    els.processRows.innerHTML = `<tr><td colspan="4" class="empty">${t("proc_empty")}</td></tr>`;
  } else {
    els.processRows.innerHTML = snapshot.processes.map(processRow).join("");
  }

  renderEnergyPanel(snapshot);

  const sampleTime = new Date(snapshot.now * 1000).toLocaleTimeString(localeName());
  const errors = snapshot.errors || {};
  setStatus(!errors.gpu, errors.gpu ? errors.gpu : t("status_online"));
  els.subtitle.textContent = t(
    "last_sample",
    sampleTime,
    snapshot.gpus.length,
    snapshot.cpus.length
  );
}

async function tick() {
  try {
    const res = await fetch("/api/snapshot", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "snapshot failed");
    render(data);
  } catch (error) {
    setStatus(false, error.message);
  }
}

// ─── language toggle wiring ─────────────────────────────────────────────────
els.langToggle.addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  localStorage.setItem("swm_lang", lang);
  applyStaticI18n();
  if (lastSnapshot) render(lastSnapshot);
});

// ─── boot ───────────────────────────────────────────────────────────────────
applyStaticI18n();
tick();
setInterval(tick, 1000);
