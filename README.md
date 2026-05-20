# System Web Monitor

A zero-dependency LAN dashboard for live GPU + CPU monitoring. The backend is pure Python stdlib + `nvidia-smi` + Intel RAPL; the frontend is plain HTML/CSS/JS.

## Features

- **GPU**: real-time utilisation, memory, temperature, power, fan and clocks from `nvidia-smi`. One card per GPU plus a 90-second mini history chart.
- **CPU**: per-socket package + DRAM power read from Intel RAPL `energy_uj` counters (requires the RAPL nodes to be readable — see below).
- **Energy**: cumulative CPU + GPU energy (kWh) since the service started, plus a rolling **last-24-hour** per-hour histogram. CPU integration is exact (μJ deltas); GPU is trapezoidal on `nvidia-smi` power.
- **Processes**: GPU compute processes from `nvidia-smi --query-compute-apps`.
- **Single data path**: one backend sampler thread polls everything once per second; every HTTP handler serves from the cached snapshot. Connecting more clients does not increase the sampling rate.
- **Bilingual UI**: top-right `EN` / `中` toggles between English and Chinese; preference is persisted in `localStorage` (`swm_lang`).

## Running

### Ad-hoc

```bash
./start.sh                                  # default 0.0.0.0:8765
PORT=9000 ./start.sh                        # change port
HOST=127.0.0.1 PORT=9000 ./start.sh         # change bind address + port
python3 app.py --interval 0.5               # change sampling interval (default 1s)
```

### Install as a systemd service (auto-start on boot)

```bash
bash install-service.sh                     # uses sudo to install + start the unit
# Custom port / interval:
PORT=9000 INTERVAL=2.0 bash install-service.sh
# Uninstall:
bash uninstall-service.sh
```

The unit is installed at `/etc/systemd/system/system-web-monitor.service` and runs as the invoking user (or `$SUDO_USER` if the script is run via `sudo`). It ships with lightweight hardening (`NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome=read-only`) that does not interfere with `nvidia-smi` or RAPL sysfs reads.

Useful commands:
```bash
sudo systemctl status system-web-monitor
sudo systemctl restart system-web-monitor
sudo journalctl -u system-web-monitor -f
```

### Access

- Local: `http://127.0.0.1:8765`
- LAN: `http://<host-ip>:8765`

## Enabling CPU power readout (optional)

Linux 5.10+ locks `/sys/class/powercap/intel-rapl/*/energy_uj` to root-only by default (PLATYPUS side-channel mitigation). To let a normal user read it:

```bash
sudo chmod a+r /sys/class/powercap/intel-rapl:*/energy_uj \
               /sys/class/powercap/intel-rapl:*:*/energy_uj
```

To persist across reboots, install a udev rule:

```bash
echo 'ACTION=="add", SUBSYSTEM=="powercap", KERNEL=="intel-rapl:*", RUN+="/bin/chmod a+r /sys/%p/energy_uj"' \
  | sudo tee /etc/udev/rules.d/99-intel-rapl.rules
sudo udevadm control --reload-rules
```

> Granting this permission exposes the RAPL energy counters to every local process. In principle this can be used as a side channel; fine for single-user dev machines, do **not** enable it on multi-tenant or production hosts.
>
> Without the permission the CPU cards display N/A but the GPU sections and the GPU portion of the energy totals continue to work.

## API

The frontend talks to a single endpoint: `GET /api/snapshot`. It returns the full current state:

```jsonc
{
  "ok": true,
  "now": 1779266033.5,
  "start_time": 1779266021.3,
  "interval": 1.0,
  "sample_count": 13,
  "gpus":      [/* per-card: util, mem, temp, power_draw, power_limit, ... */],
  "cpus":      [/* per-socket: package_power_w, dram_power_w, package_limit_w, model */],
  "processes": [/* nvidia-smi compute apps */],
  "energy": {
    "total_wh":     0.409,
    "gpu_power_w":  27.9,
    "cpu_power_w":  64.41,
    "hourly":       [{"hour_start": 1779264000, "wh": 0.409}]
  },
  "errors": {"gpu": null, "processes": null}
}
```

## Architecture

```
Monitor background thread
  ├─ every `interval` seconds:
  │    nvidia-smi (GPU + processes)
  │    read RAPL energy_uj
  │    trapezoidal / exact integration → total_wh + hourly_wh
  └─ writes a lock-protected state dict

HTTP handler ── reads the Monitor cache only (zero system calls per request)

Frontend ── fetches /api/snapshot every second ──► render(snapshot)
```

## File layout

```
app.py                  # backend, Monitor class, HTTP server
start.sh                # launcher (honours PORT / HOST / INTERVAL env vars)
install-service.sh      # one-shot systemd unit installer
uninstall-service.sh    # removes the systemd unit
static/index.html       # page skeleton (data-i18n tagged)
static/styles.css       # styling
static/app.js           # single-fetch render loop + i18n
```

## Requirements

- Linux with `nvidia-smi` available in `PATH` (any recent NVIDIA driver).
- Python 3.10+ (uses standard library only, no `pip install` needed).
- Optional: Intel CPU with RAPL support exposed under `/sys/class/powercap/intel-rapl*` for CPU power.

## License

MIT.
