# -*- coding: utf-8 -*-
"""
生成应用图标：assets/icon.png 与 assets/icon.ico
依赖 Pillow：D:\\40_Runtime\\anaconda3\\python.exe 已自带。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "app", "assets")
SIZE = 256


def find_font():
    for path in (
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ):
        if os.path.exists(path):
            return path
    return None


def main():
    os.makedirs(OUT, exist_ok=True)

    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 纵向渐变底（#3a6be8 → #1f47b0）
    for y in range(SIZE):
        t = y / SIZE
        r = int(58 + (31 - 58) * t)
        g = int(107 + (71 - 107) * t)
        b = int(232 + (176 - 232) * t)
        d.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

    # 圆角遮罩
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=56, fill=255)
    img.putalpha(mask)

    font_path = find_font()
    if font_path:
        font = ImageFont.truetype(font_path, 150)
        d = ImageDraw.Draw(img)
        bbox = d.textbbox((0, 0), "社", font=font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        d.text(((SIZE - w) / 2 - bbox[0], (SIZE - h) / 2 - bbox[1]), "社", font=font, fill=(255, 255, 255, 255))
    else:
        print("未找到中文字体，图标将不含文字")

    png = os.path.join(OUT, "icon.png")
    ico = os.path.join(OUT, "icon.ico")
    img.save(png)
    img.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("已生成:", png)
    print("已生成:", ico)


if __name__ == "__main__":
    main()
