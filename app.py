#!/usr/bin/env python3
"""LAN-friendly GPU + CPU dashboard with per-hour energy tracking.

Architecture:
  * One background `Monitor` thread polls nvidia-smi and Intel-RAPL once per
    `interval` (default 1s) and updates a shared state under a lock.
  * HTTP handlers do NOT touch nvidia-smi or sysfs themselves — they just
    serialise the cached snapshot. This avoids double-polling and keeps the
    sampling cadence consistent regardless of how many clients are connected.
  * Energy is integrated incrementally on each tick:
      - GPU: trapezoidal integration of nvidia-smi power_draw.
      - CPU: exact integration via Intel-RAPL `energy_uj` μJ deltas.
    Both feed the same per-hour bucket dictionary and `total_wh`.
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"

GPU_FIELDS = [
    "index",
    "name",
    "uuid",
    "utilization.gpu",
    "utilization.memory",
    "memory.total",
    "memory.used",
    "memory.free",
    "temperature.gpu",
    "power.draw",
    "power.limit",
    "fan.speed",
    "clocks.current.graphics",
    "clocks.current.memory",
]

PROCESS_FIELDS = [
    "gpu_uuid",
    "pid",
    "process_name",
    "used_memory",
]

RAPL_ROOT = Path("/sys/class/powercap")


# ─────────────────────────────────────────────────────────────────────────────
# System probes (pure functions, no shared state)
# ─────────────────────────────────────────────────────────────────────────────

def run_nvidia_smi(args: list[str], timeout: float = 2.0) -> str:
    completed = subprocess.run(
        ["nvidia-smi", *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    return completed.stdout.strip()


def parse_csv(text: str) -> list[list[str]]:
    if not text:
        return []
    return [[cell.strip() for cell in row] for row in csv.reader(text.splitlines())]


def to_number(value: str) -> float | int | None:
    value = value.strip()
    if value in {"", "[Not Supported]", "N/A", "Not Active"}:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    if number.is_integer():
        return int(number)
    return number


def query_gpus() -> list[dict[str, Any]]:
    query = ",".join(GPU_FIELDS)
    text = run_nvidia_smi([f"--query-gpu={query}", "--format=csv,noheader,nounits"])
    rows = parse_csv(text)
    gpus: list[dict[str, Any]] = []
    for row in rows:
        if len(row) != len(GPU_FIELDS):
            continue
        raw = dict(zip(GPU_FIELDS, row, strict=True))
        memory_total = to_number(raw["memory.total"])
        memory_used = to_number(raw["memory.used"])
        memory_percent: float | None = None
        if (
            isinstance(memory_total, (int, float))
            and memory_total > 0
            and isinstance(memory_used, (int, float))
        ):
            memory_percent = round(memory_used / memory_total * 100, 1)

        power_draw = to_number(raw["power.draw"])
        power_limit = to_number(raw["power.limit"])
        power_percent: float | None = None
        if (
            isinstance(power_limit, (int, float))
            and power_limit > 0
            and isinstance(power_draw, (int, float))
        ):
            power_percent = round(power_draw / power_limit * 100, 1)

        gpus.append(
            {
                "index": to_number(raw["index"]),
                "name": raw["name"],
                "uuid": raw["uuid"],
                "gpu_util": to_number(raw["utilization.gpu"]),
                "mem_util": to_number(raw["utilization.memory"]),
                "memory_total": memory_total,
                "memory_used": memory_used,
                "memory_free": to_number(raw["memory.free"]),
                "memory_percent": memory_percent,
                "temperature": to_number(raw["temperature.gpu"]),
                "power_draw": power_draw,
                "power_limit": power_limit,
                "power_percent": power_percent,
                "fan_speed": to_number(raw["fan.speed"]),
                "graphics_clock": to_number(raw["clocks.current.graphics"]),
                "memory_clock": to_number(raw["clocks.current.memory"]),
            }
        )
    return gpus


def query_processes() -> list[dict[str, Any]]:
    query = ",".join(PROCESS_FIELDS)
    try:
        text = run_nvidia_smi(
            [f"--query-compute-apps={query}", "--format=csv,noheader,nounits"],
            timeout=2.0,
        )
    except subprocess.CalledProcessError:
        return []
    rows = parse_csv(text)
    processes: list[dict[str, Any]] = []
    for row in rows:
        if len(row) != len(PROCESS_FIELDS):
            continue
        raw = dict(zip(PROCESS_FIELDS, row, strict=True))
        processes.append(
            {
                "gpu_uuid": raw["gpu_uuid"],
                "pid": to_number(raw["pid"]),
                "process_name": raw["process_name"],
                "used_memory": to_number(raw["used_memory"]),
            }
        )
    return processes


def discover_rapl_zones() -> list[dict[str, Any]]:
    """Return all readable Intel-RAPL zones with metadata for integration."""
    if not RAPL_ROOT.exists():
        return []
    zones: list[dict[str, Any]] = []
    for d in sorted(RAPL_ROOT.iterdir()):
        if not d.name.startswith("intel-rapl:"):
            continue
        energy_f = d / "energy_uj"
        name_f = d / "name"
        if not (energy_f.exists() and name_f.exists()):
            continue
        try:
            zone_name = name_f.read_text().strip()
            with open(energy_f, "r") as fh:  # readability probe
                fh.read(1)
        except (PermissionError, OSError):
            continue
        max_uj: int | None = None
        try:
            max_uj = int((d / "max_energy_range_uj").read_text().strip())
        except (FileNotFoundError, ValueError, OSError):
            pass
        power_limit_w: float | None = None
        try:
            limit = (d / "constraint_0_power_limit_uw").read_text().strip()
            power_limit_w = int(limit) / 1e6 if limit else None
        except (FileNotFoundError, ValueError, OSError):
            pass
        parts = d.name.split(":")
        package_index = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0
        sub_index = int(parts[2]) if len(parts) >= 3 and parts[2].isdigit() else None
        zones.append(
            {
                "path": str(d),
                "name": zone_name,
                "energy_file": str(energy_f),
                "max_uj": max_uj,
                "package_index": package_index,
                "sub_index": sub_index,
                "is_package": sub_index is None,
                "power_limit_w": power_limit_w,
            }
        )
    return zones


def read_zone_energy_uj(zone: dict[str, Any]) -> int | None:
    try:
        with open(zone["energy_file"], "r") as fh:
            return int(fh.read().strip())
    except (FileNotFoundError, PermissionError, ValueError, OSError):
        return None


def read_cpu_model() -> str | None:
    try:
        with open("/proc/cpuinfo", "r") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        return None
    return None


def get_lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


# ─────────────────────────────────────────────────────────────────────────────
# Monitor — single source of truth
# ─────────────────────────────────────────────────────────────────────────────


def _hourly_integrate(
    buckets: dict[int, float], t0: float, t1: float, avg_power_w: float
) -> float:
    """Slice [t0, t1] at epoch-hour boundaries; add Wh to buckets; return total."""
    added = 0.0
    t = t0
    while t < t1:
        hour_start = int(t // 3600) * 3600
        seg_end = min(t1, hour_start + 3600)
        dt = seg_end - t
        wh = avg_power_w * dt / 3600.0
        buckets[hour_start] = buckets.get(hour_start, 0.0) + wh
        added += wh
        t = seg_end
    return added


class Monitor:
    """Background sampler + cached state shared by every HTTP handler."""

    def __init__(self, interval: float = 1.0) -> None:
        self.interval = interval
        self.start_time = time.time()
        # Static topology
        self.cpu_zones = discover_rapl_zones()
        self.cpu_model = read_cpu_model()
        # Mutable state — all under self._lock
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="monitor")
        self._gpus: list[dict[str, Any]] = []
        self._processes: list[dict[str, Any]] = []
        self._gpu_error: str | None = None
        self._proc_error: str | None = None
        self._cpu_zone_state: dict[str, dict[str, Any]] = {
            z["path"]: {"last_uj": None, "last_t": None, "last_power_w": None}
            for z in self.cpu_zones
        }
        self._last_gpu_power_w: float | None = None
        self._last_sample_t: float | None = None
        self._gpu_total_w: float | None = None
        self._cpu_total_w: float | None = None
        self._total_wh = 0.0
        self._hourly_wh: dict[int, float] = {}
        self._sample_count = 0

    # ----- lifecycle -----
    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    # ----- main loop -----
    def _loop(self) -> None:
        # Take a first CPU reading so the next tick has a delta baseline.
        now = time.time()
        with self._lock:
            for z in self.cpu_zones:
                self._cpu_zone_state[z["path"]].update(
                    last_uj=read_zone_energy_uj(z), last_t=now
                )
        while not self._stop.is_set():
            self._tick()
            self._stop.wait(self.interval)

    def _tick(self) -> None:
        now = time.time()
        # Slow subprocess calls happen outside the lock so HTTP requests are
        # never blocked by the sampler.
        try:
            gpus = query_gpus()
            gpu_err: str | None = None
        except FileNotFoundError:
            gpus, gpu_err = [], "nvidia-smi not found"
        except Exception as exc:
            gpus, gpu_err = [], str(exc)
        try:
            processes = query_processes()
            proc_err: str | None = None
        except Exception as exc:
            processes, proc_err = [], str(exc)
        cpu_readings = {z["path"]: read_zone_energy_uj(z) for z in self.cpu_zones}

        with self._lock:
            self._gpus = gpus
            self._processes = processes
            self._gpu_error = gpu_err
            self._proc_error = proc_err

            gpu_power: float | None = None
            if gpus:
                samples = [
                    float(g["power_draw"]) for g in gpus
                    if isinstance(g.get("power_draw"), (int, float))
                ]
                gpu_power = sum(samples) if samples else None
            self._update_gpu_energy(now, gpu_power)
            self._update_cpu_energy(now, cpu_readings)

            self._last_sample_t = now
            self._sample_count += 1

    # ----- integration helpers -----
    def _update_gpu_energy(self, now: float, gpu_power: float | None) -> None:
        if (
            gpu_power is not None
            and self._last_gpu_power_w is not None
            and self._last_sample_t is not None
        ):
            avg = (self._last_gpu_power_w + gpu_power) / 2.0
            self._total_wh += _hourly_integrate(
                self._hourly_wh, self._last_sample_t, now, avg
            )
        if gpu_power is not None:
            self._last_gpu_power_w = gpu_power
            self._gpu_total_w = gpu_power

    def _update_cpu_energy(self, now: float, readings: dict[str, int | None]) -> None:
        any_value = False
        total_w = 0.0
        for z in self.cpu_zones:
            uj = readings.get(z["path"])
            state = self._cpu_zone_state[z["path"]]
            last_uj = state["last_uj"]
            last_t = state["last_t"]
            state["last_uj"] = uj
            state["last_t"] = now
            if uj is None or last_uj is None or last_t is None:
                continue
            delta_uj = uj - last_uj
            if delta_uj < 0 and z["max_uj"]:
                delta_uj += z["max_uj"]
            dt = now - last_t
            if dt <= 0:
                continue
            avg_w = (delta_uj / 1e6) / dt
            state["last_power_w"] = avg_w
            # Only top-level package + dram contribute to total to avoid
            # double-counting subzones like cores/uncore (subset of package).
            if z["name"].startswith("package-") or z["name"] == "dram":
                self._total_wh += _hourly_integrate(
                    self._hourly_wh, last_t, now, avg_w
                )
                total_w += avg_w
                any_value = True
        self._cpu_total_w = total_w if any_value else None

    # ----- serializers -----
    def _cpu_cards(self) -> list[dict[str, Any]]:
        by_pkg: dict[int, dict[str, Any]] = {}
        for z in self.cpu_zones:
            idx = z["package_index"]
            entry = by_pkg.setdefault(
                idx,
                {
                    "index": idx,
                    "model": self.cpu_model,
                    "package_power_w": None,
                    "package_limit_w": None,
                    "dram_power_w": None,
                    "subzones": [],
                },
            )
            w = self._cpu_zone_state[z["path"]]["last_power_w"]
            rounded = round(w, 2) if w is not None else None
            if z["name"].startswith("package-"):
                entry["package_power_w"] = rounded
                entry["package_limit_w"] = z["power_limit_w"]
            elif z["name"] == "dram":
                entry["dram_power_w"] = rounded
            else:
                entry["subzones"].append({"name": z["name"], "power_w": rounded})
        return [by_pkg[k] for k in sorted(by_pkg)]

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "ok": True,
                "now": time.time(),
                "start_time": self.start_time,
                "interval": self.interval,
                "sample_count": self._sample_count,
                "gpus": list(self._gpus),
                "processes": list(self._processes),
                "cpus": self._cpu_cards(),
                "errors": {"gpu": self._gpu_error, "processes": self._proc_error},
                "energy": {
                    "total_wh": round(self._total_wh, 3),
                    "gpu_power_w": (
                        round(self._gpu_total_w, 1)
                        if self._gpu_total_w is not None else None
                    ),
                    "cpu_power_w": (
                        round(self._cpu_total_w, 2)
                        if self._cpu_total_w is not None else None
                    ),
                    "hourly": [
                        {"hour_start": h, "wh": round(self._hourly_wh[h], 3)}
                        for h in sorted(self._hourly_wh)
                    ],
                },
            }


MONITOR: Monitor | None = None


# ─────────────────────────────────────────────────────────────────────────────
# HTTP layer
# ─────────────────────────────────────────────────────────────────────────────


def json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    server_version = "SystemWebMonitor/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        now = time.strftime("%H:%M:%S")
        print(f"[{now}] {self.address_string()} {fmt % args}")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/snapshot":
            self.handle_snapshot()
            return
        self.handle_static(path)

    def handle_snapshot(self) -> None:
        if MONITOR is None:
            json_response(self, {"ok": False, "error": "monitor not running"}, status=500)
            return
        json_response(self, MONITOR.snapshot())

    def handle_static(self, path: str) -> None:
        if path in {"/", ""}:
            file_path = STATIC_DIR / "index.html"
        else:
            file_path = (STATIC_DIR / path.lstrip("/")).resolve()
            if STATIC_DIR.resolve() not in file_path.parents and file_path != STATIC_DIR.resolve():
                self.send_error(403)
                return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────


def main() -> None:
    global MONITOR
    parser = argparse.ArgumentParser(description="Serve a live GPU + CPU dashboard.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address. Use 0.0.0.0 for LAN access.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Sampling interval in seconds (default 1).",
    )
    args = parser.parse_args()

    MONITOR = Monitor(interval=args.interval)
    MONITOR.start()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    lan_ip = get_lan_ip()
    print(f"GPU monitor running on http://{args.host}:{args.port}")
    print(f"LAN URL: http://{lan_ip}:{args.port}")
    print(f"Sampling every {args.interval}s ({len(MONITOR.cpu_zones)} RAPL zones)")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping GPU monitor.")
    finally:
        MONITOR.stop()
        server.server_close()


if __name__ == "__main__":
    main()
