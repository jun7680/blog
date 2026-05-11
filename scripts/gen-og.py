#!/usr/bin/env python3
"""
오깅중 블로그용 기본 OG 이미지 생성기.
디자인 시안과 매칭되는 다크 + 노란 액센트 + 워드마크 + 우하단 OG_ 워터마크.
출력: blog/static/og-default.png (1200x630)
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630

# 디자인 토큰 (oklch → sRGB 근사)
BG       = (30, 25, 22)     # oklch(0.16 0.006 80)
BG_DEEP  = (45, 38, 33)     # 워터마크용 음각
INK      = (245, 242, 238)  # oklch(0.96 0.005 80)
INK_2    = (197, 188, 178)
INK_3    = (143, 133, 122)  # oklch(0.56 0.01 80)
ACCENT   = (245, 200, 87)   # oklch(0.88 0.17 95) — 노란색

# 폰트
SANS_TTC = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
MONO_TTC = "/System/Library/Fonts/Menlo.ttc"

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 1) 우하단 큰 OG_ 음각 (시안 hero와 일관)
og_font = ImageFont.truetype(MONO_TTC, 320)
og_w = d.textlength("OG_", font=og_font)
d.text((W - og_w + 20, H - 360), "OG_", fill=BG_DEEP, font=og_font)

# 2) 상단 좌측 작은 모노 라벨
label_font = ImageFont.truetype(MONO_TTC, 18)
d.text((80, 90), "// JUN7680.GITHUB.IO", fill=ACCENT, font=label_font)

# 3) 워드마크 "오깅중"
sans_big = ImageFont.truetype(SANS_TTC, 132, index=4)  # bold weight
d.text((80, 170), "오깅중", fill=INK, font=sans_big)

# 4) 노란색 커서 블록 (워드마크 옆)
tw = d.textlength("오깅중", font=sans_big)
cur_x = 80 + tw + 22
cur_y = 200
d.rectangle([cur_x, cur_y, cur_x + 14, cur_y + 96], fill=ACCENT)

# 5) 모노 부제 "/ OGGING.DEV"
mono_label = ImageFont.truetype(MONO_TTC, 22)
d.text((cur_x + 32, 252), "/ OGGING.DEV", fill=INK_3, font=mono_label)

# 6) 큰 한 줄 디스크립션
desc_font = ImageFont.truetype(SANS_TTC, 38)
d.text((80, 360), "iOS, Swift, 그리고 가끔 다른 것들.", fill=INK_2, font=desc_font)

# 7) 하단 가는 모노 메타
meta_font = ImageFont.truetype(MONO_TTC, 18)
d.text((80, 430), "DEV BLOG · Hugo · oklch palette", fill=INK_3, font=meta_font)

# 8) 좌하단 1px 노란 라인 (악센트)
d.rectangle([80, 510, 280, 512], fill=ACCENT)

# 9) 푸터 URL
foot_font = ImageFont.truetype(MONO_TTC, 16)
d.text((80, 540), "HTTPS://JUN7680.GITHUB.IO/", fill=INK_3, font=foot_font)

out = os.path.join(os.path.dirname(__file__), "..", "static", "og-default.png")
out = os.path.abspath(out)
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out, "PNG", optimize=True)
print(f"saved: {out}  ({os.path.getsize(out)//1024} KB)")
