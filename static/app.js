// Single-fetch dashboard: every tick we pull /api/snapshot and render every
// section from the same payload. No section makes its own request.

const SVG_NS = "http://www.w3.org/2000/svg";

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
};

const gpuHistory = new Map();
const maxHistoryPoints = 90;
let uuidToIndex = new Map();

// ─── formatting helpers ─────────────────────────────────────────────────────
function fmt(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${value}${suffix}`;
}
function mb(value) {
  if (value === null || value === undefined) return "N/A";
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
  if (d) return `${d} 天 ${h} 时 ${m} 分`;
  if (h) return `${h} 时 ${m} 分 ${s} 秒`;
  if (m) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
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

// ─── GPU history (for the inline mini-chart inside each GPU card) ───────────
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
        <span class="chip">nvidia-smi · 1s</span>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="label">GPU 使用率</div>
          <div class="value">${fmt(gpu.gpu_util, "%")}</div>
          <div class="bar"><span style="width:${gpuUtil}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">显存</div>
          <div class="value">${fmt(gpu.memory_percent, "%")}</div>
          <div class="subvalue">${mb(gpu.memory_used)} / ${mb(gpu.memory_total)}</div>
          <div class="bar mem"><span style="width:${memPercent}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">温度</div>
          <div class="value">${fmt(gpu.temperature, "°C")}</div>
          <div class="bar hot"><span style="width:${tempPercent}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">功耗</div>
          <div class="value">${fmt(gpu.power_draw, " W")}</div>
          <div class="subvalue">${fmt(gpu.power_percent, "%")} / ${fmt(gpu.power_limit, " W")}</div>
          <div class="bar"><span style="width:${powerPercent}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">显存使用率</div>
          <div class="value">${fmt(gpu.mem_util, "%")}</div>
        </div>
        <div class="metric">
          <div class="label">风扇</div>
          <div class="value">${fmt(gpu.fan_speed, "%")}</div>
        </div>
        <div class="metric">
          <div class="label">核心频率</div>
          <div class="value">${fmt(gpu.graphics_clock, " MHz")}</div>
        </div>
        <div class="metric">
          <div class="label">显存频率</div>
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
    pkgW === null && dramW === null ? "N/A" : `${totalW.toFixed(2)} W`;
  const limitText = pkgLimit ? ` / ${pkgLimit} W TDP` : "";
  const modelText = cpu.model || "Intel CPU";
  return `
    <article class="gpu-card">
      <div class="gpu-head">
        <div>
          <div class="gpu-name">CPU ${cpu.index}: ${modelText}</div>
          <div class="gpu-uuid">socket ${cpu.index}</div>
        </div>
        <span class="chip">RAPL · 1s</span>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="label">Package 功耗</div>
          <div class="value">${pkgW !== null && pkgW !== undefined ? `${pkgW.toFixed(2)} W` : "N/A"}</div>
          <div class="subvalue">${pkgLimit ? `${pkgPct.toFixed(0)}%${limitText}` : ""}</div>
          <div class="bar"><span style="width:${pkgPct}%"></span></div>
        </div>
        <div class="metric">
          <div class="label">DRAM 功耗</div>
          <div class="value">${dramW !== null && dramW !== undefined ? `${dramW.toFixed(2)} W` : "N/A"}</div>
          <div class="subvalue">RAPL dram 子域</div>
        </div>
        <div class="metric">
          <div class="label">合计</div>
          <div class="value">${totalShown}</div>
          <div class="subvalue">package + dram</div>
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

// ─── energy panel ───────────────────────────────────────────────────────────
function svgEl(name, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function renderEnergyChart(snapshot) {
  const energy = snapshot.energy;
  const startHour = Math.floor(snapshot.start_time / 3600) * 3600;
  const nowHour = Math.floor(snapshot.now / 3600) * 3600;
  const buckets = new Map(energy.hourly.map((b) => [b.hour_start, b.wh]));
  const series = [];
  for (let h = startHour; h <= nowHour; h += 3600) {
    series.push({ hourStart: h, wh: buckets.get(h) || 0 });
  }
  const shown = series.slice(-24); // last 24 hours

  els.energyChartRange.textContent = shown.length
    ? `${new Date(shown[0].hourStart * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} – ${new Date(shown[shown.length - 1].hourStart * 1000 + 3600 * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
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
          `${d.toLocaleString("zh-CN")} — ${(b.wh / 1000).toFixed(3)} kWh${isPartial ? " (当前小时)" : ""}`
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
    const label = `${String(d.getHours()).padStart(2, "0")}时`;
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
  els.energyUptime.textContent = `已运行 ${fmtDuration(snapshot.now - snapshot.start_time)}`;
  els.energyTotal.textContent = fmtKwh(e.total_wh);

  const cpuW = e.cpu_power_w;
  const gpuW = e.gpu_power_w;
  const haveCpu = cpuW !== null && cpuW !== undefined;
  const haveGpu = gpuW !== null && gpuW !== undefined;
  const totalW = (haveCpu ? cpuW : 0) + (haveGpu ? gpuW : 0);
  els.energyNow.textContent =
    haveCpu || haveGpu ? `当前合计 ${totalW.toFixed(1)} W` : "等待采样…";
  els.energyBreakdown.textContent =
    `CPU ${haveCpu ? cpuW.toFixed(1) : "—"} W · GPU ${haveGpu ? gpuW.toFixed(1) : "—"} W`;
  els.energyStatus.textContent = `${snapshot.sample_count} 样本 · ${snapshot.interval}s/次`;
  renderEnergyChart(snapshot);
}

// ─── single render entry point ──────────────────────────────────────────────
function render(snapshot) {
  // GPUs
  uuidToIndex = new Map(snapshot.gpus.map((g) => [g.uuid, g.index]));
  els.gpuGrid.innerHTML = snapshot.gpus.map(gpuCard).join("");

  // CPUs
  els.cpuGrid.innerHTML = snapshot.cpus.map(cpuCard).join("");

  // Processes
  els.processCount.textContent = `${snapshot.processes.length} 个`;
  if (!snapshot.processes.length) {
    els.processRows.innerHTML = '<tr><td colspan="4" class="empty">暂无计算进程</td></tr>';
  } else {
    els.processRows.innerHTML = snapshot.processes.map(processRow).join("");
  }

  // Energy
  renderEnergyPanel(snapshot);

  // Status bar
  const sampleTime = new Date(snapshot.now * 1000).toLocaleTimeString();
  const errors = snapshot.errors || {};
  if (errors.gpu) {
    setStatus(false, errors.gpu);
  } else {
    setStatus(true, "在线");
  }
  els.subtitle.textContent = `最后采样 ${sampleTime} · ${snapshot.gpus.length} 张 GPU · ${snapshot.cpus.length} 路 CPU`;
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

tick();
setInterval(tick, 1000);
