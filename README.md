# SystemWebMonitor

A zero-dependency LAN dashboard for live GPU + CPU monitoring. The backend is pure Python stdlib + `nvidia-smi` + Intel RAPL; the frontend is plain HTML/CSS/JS.

## One-click setup

```bash
bash install.sh           # checks Python + nvidia-smi, marks scripts executable
./start.sh                # foreground, http://<host>:8765
bash install-service.sh   # enable as a boot-time systemd service
bash uninstall-service.sh # remove the systemd service
```

Environment overrides honored by `start.sh` / `install-service.sh`:

| Var        | Default     | Meaning                          |
|------------|-------------|----------------------------------|
| `HOST`     | `0.0.0.0`   | bind address                     |
| `PORT`     | `8765`      | bind port                        |
| `INTERVAL` | `1.0`       | sampling interval (seconds)      |

Example: `PORT=9000 INTERVAL=2.0 bash install-service.sh`

## Features

- **GPU**: real-time utilisation, memory, temperature, power, fan and clocks from `nvidia-smi`. One card per GPU plus a 90-second mini history chart.
- **CPU**: per-socket package + DRAM power read from Intel RAPL `energy_uj` counters (see "Enabling CPU power readout" below).
- **Energy**: cumulative CPU + GPU energy (kWh) since the service started, plus a rolling **last-24-hour** per-hour histogram.
- **Processes**: GPU compute processes from `nvidia-smi --query-compute-apps`.
- **Single data path**: one backend sampler thread polls everything once per second; every HTTP handler serves from the cached snapshot.
- **Bilingual UI**: top-right `EN` / `中` toggle, preference persisted in `localStorage`.

## Enabling CPU power readout (optional)

Linux 5.10+ locks `/sys/class/powercap/intel-rapl/*/energy_uj` to root only (PLATYPUS mitigation). To let a normal user read it:

```bash
sudo chmod a+r /sys/class/powercap/intel-rapl:*/energy_uj \
               /sys/class/powercap/intel-rapl:*:*/energy_uj
```

Persistent (udev rule):

```bash
echo 'ACTION=="add", SUBSYSTEM=="powercap", KERNEL=="intel-rapl:*", RUN+="/bin/chmod a+r /sys/%p/energy_uj"' \
  | sudo tee /etc/udev/rules.d/99-intel-rapl.rules
sudo udevadm control --reload-rules
```

> This exposes RAPL counters to every local process and can be used as a side channel. Fine for single-user dev boxes, **do not** enable on multi-tenant hosts.
>
> Without it the CPU cards display N/A; GPU cards keep working.

## API

The frontend talks to a single endpoint: `GET /api/snapshot`. It returns the full current state — GPUs, CPUs, processes, energy totals, and per-hour history.

## Requirements

- Linux with `nvidia-smi` available in `PATH` (any recent NVIDIA driver).
- Python 3.8+ (standard library only, no `pip install` needed).
- Optional: Intel CPU with RAPL support exposed under `/sys/class/powercap/intel-rapl*` for CPU power.
