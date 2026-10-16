# 图标资源说明

## 现状

仓库目前只提供 `resources/icon.svg` 源文件。**electron-builder 打包 AppImage 需要 PNG 文件**(256x256、512x512、1024x1024 至少要前两个)。

## 如何生成图标

### 方法 1:使用 Arch 仓库自带工具(推荐)

```bash
# 安装 librsvg / imagemagick
sudo pacman -S librsvg imagemagick

# 用 scripts/make-icon.sh 自动生成
./scripts/make-icon.sh
```

### 方法 2:用 Inkscape

```bash
sudo pacman -S inkscape

cd resources
mkdir -p icons
inkscape icon.svg --export-type=png --export-width=512 --export-filename=icons/512x512.png
inkscape icon.svg --export-type=png --export-width=256 --export-filename=icons/256x256.png
inkscape icon.svg --export-type=png --export-width=1024 --export-filename=icons/1024x1024.png
```

### 方法 3:用 rsvg-convert

```bash
cd resources
mkdir -p icons
rsvg-convert -w 256 -h 256 icon.svg -o icons/256x256.png
rsvg-convert -w 512 -h 512 icon.svg -o icons/512x512.png
rsvg-convert -w 1024 -h 1024 icon.svg -o icons/1024x1024.png
```

## 替换自己的图标

把你自己的图标(同名)覆盖这些文件即可。打包脚本会自动用最新文件。

- `icons/256x256.png` — AppImage 列表 / Steam 网格视图
- `icons/512x512.png` — AppImage 高 DPI / Steam 大图
- `icons/1024x1024.png` — 大封面(可选)

## 关于图标版权

`icon.svg` 是为本项目原创,使用明日方舟终末地 UI 配色灵感,不包含任何官方美术资源。若计划公开发布,请考虑换成全原创设计。
