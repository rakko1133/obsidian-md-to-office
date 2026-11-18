"""テスト用 Vault の word3a/attachments/ に、画像・PDF・音声・Canvas のサンプルを作る（Pillow が必要）。

使い方: python scripts/make-word3a-assets.py test-vault/word3a/attachments
"""
import json
import struct
import sys
import wave
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def picture(w, h, color, label):
    img = Image.new("RGB", (w, h), color)
    d = ImageDraw.Draw(img)
    d.rectangle([4, 4, w - 5, h - 5], outline=(40, 40, 40), width=4)
    d.line([0, 0, w, h], fill=(255, 255, 255), width=3)
    d.line([0, h, w, 0], fill=(255, 255, 255), width=3)
    d.text((16, 16), f"{label} {w}x{h}", fill=(0, 0, 0))
    return img


picture(640, 400, (120, 180, 240), "PNG").save(out / "sample-png.png")
picture(1600, 900, (240, 200, 120), "JPEG").save(out / "sample-large.jpg", quality=85)
picture(300, 200, (160, 220, 160), "WebP").save(out / "sample-webp.webp")
picture(200, 120, (230, 150, 200), "GIF").convert("P").save(out / "sample-gif.gif")
(out / "sample-svg.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">'
    '<rect x="2" y="2" width="236" height="156" fill="#fde68a" stroke="#333" stroke-width="4"/>'
    '<circle cx="120" cy="80" r="50" fill="#60a5fa"/>'
    '<text x="12" y="28" font-family="sans-serif" font-size="16">SVG 240x160</text></svg>\n',
    encoding="utf8",
)
picture(400, 300, (255, 255, 255), "PDF page").save(out / "sample.pdf")

with wave.open(str(out / "sample-audio.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(8000)
    w.writeframes(b"".join(struct.pack("<h", 0) for _ in range(800)))

(out.parent / "sample-canvas.canvas").write_text(
    json.dumps({"nodes": [{"id": "a", "type": "text", "text": "Canvas のノード", "x": 0, "y": 0, "width": 200, "height": 60}], "edges": []}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf8",
)
print("ok")
