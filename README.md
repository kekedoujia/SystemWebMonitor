# System Web Monitor

零第三方依赖的 LAN 级 GPU + CPU 监控面板。后端使用 Python 标准库 + `nvidia-smi` + Intel RAPL,前端纯 HTML/CSS/JS。

## 功能

- **GPU**:`nvidia-smi` 实时读取使用率、显存、温度、功耗、风扇、频率,每卡一张卡片 + 90 秒迷你折线图。
- **CPU**:Intel RAPL `energy_uj` 计数器读取每个 socket 的 package + DRAM 功耗(需要 RAPL 节点可读,见下方)。
- **能耗**:从启动开始累计的 CPU + GPU 总耗电(kWh),按小时分桶的直方图。CPU 使用 μJ 增量精确积分,GPU 用 nvidia-smi 报告功率做梯形积分。
- **进程**:`nvidia-smi --query-compute-apps` 列出占用 GPU 的进程。
- **单一数据通路**:后端一个采样线程每秒采一次,所有 HTTP 请求都从同一份内存缓存返回。多客户端连接不会增加系统采样频率。

## 启动

### 临时运行

```bash
./start.sh                                  # 默认 0.0.0.0:8765
PORT=9000 ./start.sh                        # 换端口
HOST=127.0.0.1 PORT=9000 ./start.sh         # 改绑定地址 + 端口
python3 app.py --interval 0.5               # 改采样间隔(默认 1s)
```

### 装成 systemd 服务(开机自启)

```bash
bash install-service.sh                     # 会用 sudo 写入 unit 并启动
# 自定义端口 / 间隔:
PORT=9000 INTERVAL=2.0 bash install-service.sh
# 卸载:
bash uninstall-service.sh
```

unit 安装到 `/etc/systemd/system/system-web-monitor.service`,运行用户取自当前用户(若用 `sudo` 运行脚本则取 `$SUDO_USER`)。开了 `NoNewPrivileges` / `ProtectSystem=full` / `ProtectHome=read-only` 等轻量加固,不影响 `nvidia-smi` 和 RAPL sysfs 读取。

常用命令:
```bash
sudo systemctl status system-web-monitor
sudo systemctl restart system-web-monitor
sudo journalctl -u system-web-monitor -f
```

### 访问

- 本机:`http://127.0.0.1:8765`
- 局域网:`http://<本机 IP>:8765`
- 右上角 `EN` / `中` 按钮切换中英文,选择持久化在浏览器 localStorage。

## CPU 功耗读取(可选)

Linux 5.10+ 默认把 `/sys/class/powercap/intel-rapl/*/energy_uj` 锁成 root-only(PLATYPUS 侧信道修复)。给普通用户读取权限:

```bash
sudo chmod a+r /sys/class/powercap/intel-rapl:*/energy_uj \
               /sys/class/powercap/intel-rapl:*:*/energy_uj
```

想开机自动生效,加一条 udev 规则:

```bash
echo 'ACTION=="add", SUBSYSTEM=="powercap", KERNEL=="intel-rapl:*", RUN+="/bin/chmod a+r /sys/%p/energy_uj"' \
  | sudo tee /etc/udev/rules.d/99-intel-rapl.rules
sudo udevadm control --reload-rules
```

> 打开这个权限会把 RAPL 计数器暴露给所有本地进程,理论上可被用作侧信道。单用户开发机无所谓,多租户/生产机请勿开启。
>
> 不开权限时,CPU 卡片会显示 N/A,但 GPU 和能耗的 GPU 部分仍正常工作。

## API

唯一端点:`GET /api/snapshot`。返回当前所有状态:

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

## 架构

```
Monitor 后台线程
  ├─ 每 interval 秒采集一次
  │    nvidia-smi 查 GPU + 进程
  │    读 RAPL energy_uj
  │    梯形 / 精确积分 → total_wh + hourly_wh
  └─ 写入受锁保护的状态字典

HTTP handler ── 只读 Monitor 缓存(零系统调用)

前端 ── 每秒 fetch /api/snapshot ──► render(snapshot)
```

## 文件

```
app.py              # 后端 + Monitor 类 + HTTP server
start.sh            # 启动脚本
static/index.html   # 页面骨架
static/styles.css   # 样式
static/app.js       # 单 fetch 渲染入口
```
