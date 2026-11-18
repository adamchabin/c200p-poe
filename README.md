# Cudy C200P PoE (PSE) support

LuCI page and build tooling for the Power over Ethernet controller on the
Cudy C200P (IC Plus IP804AR, 4 ports, I2C). PoE is driven by the kernel PSE
framework through `ethtool --show-pse` / `--set-pse`. There is no userspace
daemon.

Kernel driver and DTS come from OpenWrt PR
[#26334](https://github.com/openwrt/openwrt/pull/26334) (not merged yet).

## Contents

| Path | What it is |
| --- | --- |
| `src/luci-app-pse/` | LuCI view (`pse.js`), rpcd ACL and menu entry |
| `scripts/build-apk.sh` | Builds `luci-app-pse` as an apk v3 package and a local index |
| `openwrt/config.seed` | `.config` fragment for the OpenWrt image build |

## Requirements

### Kernel (router image)

- Linux **6.18.x** (built here: 6.18.55), target `ramips/mt7621`, profile `cudy_c200p`.
- Kernel options:
  - `CONFIG_PSE_CONTROLLER=y`
  - `CONFIG_PSE_ICPLUS_IP804=m` (module `icplus_ip804`, package `kmod-pse-icplus-ip804`)
  - `CONFIG_I2C=y`
- The device tree must describe the controller at I2C address `0x74`, with
  `pse-pis` and `reset-gpios` on GPIO14. This is in the PR's DTS.
- Ports `lan2..lan5` are linked to `pse_pi0..3` through `ethphy0..3`.

Stock OpenWrt snapshot images do **not** contain this driver. You need an image
built from the PR.

### Userspace (router)

- `ethtool-full` (OpenWrt package, 7.2 or newer). The plain `ethtool` package
  is built without netlink and reports "requires kernel netlink support". The
  PSE commands need `ethtool-full`.
- `luci-base` (for the LuCI page).
- `/etc/apk/arch` must contain the device architecture, `mipsel_24kc`.
  Packages built for `arch: all` are rejected if `all` is missing from that
  file.

### Host (to build the apk)

- apk-tools **3.x** with `mkpkg` and `mkndx`. apk-tools 2.x (for example the
  Alpine 3.20 package) does not have these commands.
  Tested with 3.0.9-r0.

## Build the router image

```sh
git clone https://github.com/openwrt/openwrt.git
cd openwrt
git fetch origin pull/26334/head:pr26334
git checkout pr26334
./scripts/feeds update -a && ./scripts/feeds install -a
cp /path/to/c200p-poe/openwrt/config.seed .config
make defconfig
make -j$(nproc) download
make -j$(nproc)
```

The sysupgrade image is written to
`bin/targets/ramips/mt7621/openwrt-ramips-mt7621-cudy_c200p-squashfs-sysupgrade.bin`.
The initramfs image (`...-initramfs-kernel.bin`) can be tested from RAM through
U-Boot/TFTP without writing to flash.

## Build the LuCI package

```sh
APK=/path/to/apk.static sh scripts/build-apk.sh
```

Output:

- `dist/luci-app-pse-<version>.apk`
- `dist/packages.adb` (local repository index)

Environment variables: `APK` (apk 3.x binary), `VERSION` (default `1.0.0-r1`),
`OUT` (default `dist/`).

The package is `arch: mipsel_24kc`. It declares `depends: luci-base` and
`depends: ethtool-full`. The post-install hook reloads rpcd.

## Install on the router

Install `ethtool-full` from the OpenWrt feeds first, then `luci-app-pse`:

```sh
ssh root@192.168.1.1 'apk update && apk add ethtool-full'
scp dist/luci-app-pse-1.0.0-r1.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/luci-app-pse-1.0.0-r1.apk'
```

Then open **Services → PoE Manager**.

## Verify on the router

```sh
ethtool --show-pse lan2
ethtool --show-pse lan5
dmesg | grep -i -E 'pse|ip804' | tail
```

Expected output for an idle port:

```
Clause 33 PSE Admin State: enabled
Clause 33 PSE Power Detection Status: searching
Clause 33 PSE Available Power Limit: 30000
```

Per-port power draw appears as `Clause 33 PSE Actual Power: <mW>` when the
driver reports it. Not confirmed yet with a powered device.

## Known limits

- **Port mapping for `lan2..lan4` is not confirmed.** Only `lan5` was checked
  on hardware. The table in `pse.js` (`PORTS`) follows the PR DTS. Confirm by
  connecting a PoE device to each port and checking which `lanX` changes to
  `deliveringPower`.
- **Per-port power draw** depends on the driver reporting `actual_pw`. Not
  verified yet.
- **Voltage and current** are not shown. `ethtool` does not print them, and the
  driver reports only a shared supply voltage.
- The PR is open and its driver may change (a maintainer asked for a generic
  IP802AR/IP804AR driver). Rebuild after the PR changes.
- Tested on a Cudy C200P with a snapshot image of the PR, flashed with
  `sysupgrade -n`. Not tested on other boards.

## Commands used in ethtool

```sh
ethtool --set-pse lan5 c33-pse-admin-control enable|disable
ethtool --set-pse lan5 c33-pse-avail-pw-limit <mW>
```

## Legacy

Older work on this board used a userspace `pse-daemon` that talked to the
IP804AR over I2C. It conflicts with the kernel driver and is not included here.
