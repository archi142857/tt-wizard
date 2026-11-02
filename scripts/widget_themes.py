"""홈 화면 위젯의 앱 테마 한 벌(고른 라이트·다크, 크리스마스)을 만든다 (백엔드 update78, 11/2).

위젯은 앱에서 고른 테마로 그린다(11/2 사용자, 폰 위젯 머리 줄에 빨간 동그라미: "색깔이 테마에 맞춰서 바뀌게 색을 넣어줘. 나머지 위젯들도 마찬가지임".
디자인 106판 '홈 화면 위젯'의 '테마'·'크리스마스 한 벌'). 무엇으로 그릴지는 WidgetData.theme(기기 날짜·ttw.scheme·ttw.themeOff):
  기본(기기 설정)        손으로 쓴 판: layout(-night)/widget_*.xml, values(-night)/colors.xml 의 widget_*. 기기 다크 모드를 런처가 바로 따른다
  라이트·다크·크리스마스   이 스크립트가 손으로 쓴 판을 옮겨 색만 그 한 벌로 바꾼 판(widget_next_light·_dark·_xmas …)과 그 색·스타일
                         (values/widget_themes.xml). 기기 다크 모드와 상관없이 같은 색이다(그래서 values-night 에 두지 않는다)
색 값은 web/style.css 의 테마 토큰에서 읽는다: 라이트 :root, 다크 :root[data-scheme="dark"], 크리스마스 html[data-theme="xmas"](없는 토큰은 라이트 값).
WidgetViews 가 한 벌마다 다른 레이아웃을 고른다(런처는 같은 레이아웃이면 전에 펼친 화면 위에 바꿈만 얹어서, 색을 코드로 넣으면 테마를 바꿀 때 남는다).

    python scripts/widget_themes.py          # 다시 만든다
    python scripts/widget_themes.py --check  # 지금 파일과 같은지 본다(다르면 1)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "app" / "android" / "app" / "src" / "main" / "res"
CSS = ROOT / "web" / "style.css"
OUT = RES / "values" / "widget_themes.xml"

# 위젯 색 이름(widget_<이름>) → 웹 토큰. 기본 판(values(-night)/colors.xml)은 이 표 전부, 한 벌 판은 그 레이아웃·그림이 쓰는 것만
COLOR_TOKENS = {
    "bg": "card", "text": "text", "text2": "text2", "text3": "text3", "line": "line", "accent": "accent-text", "accent_weak": "accent-weak",
    "danger": "danger", "band": "bg", "on_band": "on-bg-heading", "on_band3": "on-bg-text3",
    **{f"mark_item{i}": f"item-{i}-dot" for i in range(8)},
    **{f"mark_{k}": f"cls-{k}" for k in ("req", "elec", "gen", "etc")},
    **{f"fill_item{i}": f"item-{i}" for i in range(8)},
    # 동선 지도 위젯의 미리 보기 그림(update71. 미리 보기는 기기 라이트·다크라 한 벌 판이 없다)
    "map_land": "map-land", "map_green": "map-green", "map_road": "map-road", "map_road_line": "map-road-line", "map_building": "map-building",
    "route": "route", "pin": "accent", "on_pin": "on-color", "home": "home", "on_home": "on-home",
}
ATTR_BG = "attr_bg"  # 지도 출처 글 바탕: card 90%(앱 지도의 .map-attr)

# 한 벌: (이름, 스타일 꼬리, web/style.css 의 블록 머리). 라이트 블록이 바탕이고 다른 블록이 그 위에 덮는다
THEMES = (
    ("light", "Light", ":root, .mini.is-light, .mini.is-xmas {"),
    ("dark", "Dark", ':root[data-scheme="dark"]:not([data-theme]) {'),
    ("xmas", "Xmas", 'html[data-theme="xmas"], .mini.is-xmas {'),
)
# 옮기는 판(손으로 쓴 기본 판). 미리 보기(widget_*_preview)는 앱 테마를 모르니 옮기지 않는다. widget_week_hit 은 색이 없다
LAYOUTS = ("widget_next", "widget_today", "widget_today_row", "widget_today_row_past", "widget_week", "widget_map", "widget_empty")
DRAWABLES = ("widget_bg", "widget_band", "widget_block", "widget_dot_ring", "widget_tag_now", "widget_attr_bg", "widget_ic_route", "widget_ic_timetable",
             *(f"widget_mark_item{i}" for i in range(8)), *(f"widget_mark_{k}" for k in ("req", "elec", "gen", "etc")))
MADE = "scripts/widget_themes.py 가"  # 만든 파일의 머리 글(지난 판이 남긴 파일을 찾는다)


def tokens(css: str, start: str) -> dict[str, str]:
    """블록 하나의 --토큰: 값"""
    i = css.index(start)
    return dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", css[i:css.index("\n}", i)]))


def resolve(top: dict[str, str], base: dict[str, str], name: str) -> str:
    """토큰 값(#RRGGBB, 대문자). var(--x) 는 덮는 블록 먼저, 없으면 바탕 블록에서 찾는다"""
    value = top.get(name, base.get(name))
    while value and value.startswith("var(--"):
        ref = value[6:-1]
        value = top.get(ref, base.get(ref))
    if not value or not re.fullmatch(r"#[0-9a-fA-F]{6}", value.strip()):
        raise SystemExit(f"web/style.css: --{name} 을 색으로 풀지 못했다: {value!r}")
    return value.strip().upper()


def palettes() -> dict[str, dict[str, str]]:
    """한 벌마다 위젯 색 이름 → #RRGGBB(출처 글 바탕은 #AARRGGBB)"""
    css = CSS.read_text(encoding="utf-8")
    light = tokens(css, THEMES[0][2])
    out = {}
    for name, _, start in THEMES:
        top = light if name == "light" else tokens(css, start)
        colors = {res: resolve(top, light, token) for res, token in COLOR_TOKENS.items()}
        colors[ATTR_BG] = "#E6" + colors["bg"][1:]
        out[name] = colors
    return out


def styles() -> dict[str, list[tuple[str, str]]]:
    """색·그림을 쓰는 스타일: 이름(TTWWidget.X) → [(항목, 값)]"""
    xml = (RES / "values" / "widget_styles.xml").read_text(encoding="utf-8")
    out = {}
    for name, body in re.findall(r'<style name="(TTWWidget\.\w+)">(.*?)</style>', xml, re.S):
        items = [(k, v) for k, v in re.findall(r'<item name="([\w:]+)">([^<]+)</item>', body) if v.startswith(("@color/widget_", "@drawable/widget_"))]
        if items:
            out[name] = items
    return out


def themed(text: str, theme: str, suffix: str, styled: set[str]) -> str:
    """판 하나를 한 벌로: 위젯 색·그림·스타일·넣는 레이아웃의 이름에 꼬리를 단다"""
    def color(m: re.Match) -> str:
        if m.group(1) not in COLOR_TOKENS and m.group(1) != ATTR_BG:
            raise SystemExit(f"모르는 위젯 색 @color/widget_{m.group(1)}: COLOR_TOKENS 에 더한다")
        return f"@color/widget_{m.group(1)}_{theme}"

    text = re.sub(r"@color/widget_(\w+)", color, text)
    text = re.sub(r"@drawable/(widget_\w+)", lambda m: f"@drawable/{m.group(1)}_{theme}" if m.group(1) in DRAWABLES else m.group(0), text)
    text = re.sub(r"@layout/(widget_\w+)", lambda m: f"@layout/{m.group(1)}_{theme}" if m.group(1) in LAYOUTS else m.group(0), text)
    text = re.sub(r"@style/(TTWWidget\.\w+)", lambda m: f"@style/{m.group(1)}.{suffix}" if m.group(1) in styled else m.group(0), text)
    return text


def copy(src: Path, theme: str, suffix: str, styled: set[str]) -> str:
    """원본 판에서 주석을 빼고 머리 글을 단 한 벌 판"""
    text = re.sub(r"\s*<!--.*?-->", "", src.read_text(encoding="utf-8"), flags=re.S)
    head, rest = text.split("\n", 1)
    folder = src.parent.name
    return (f"{head}\n<!-- {MADE} {folder}/{src.name} 에서 옮겨 만든 '{theme}' 한 벌이다(update78, 위젯이 앱 테마로 그린다). "
            f"여기를 고치지 말고 원본을 고친 뒤 다시 만든다 -->\n" + themed(rest, theme, suffix, styled))


def values(pal: dict[str, dict[str, str]], style: dict[str, list[tuple[str, str]]], used: set[str]) -> str:
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             f"<!-- {MADE} web/style.css 의 테마 토큰과 values/widget_styles.xml 로 만든 파일이다(update78). 여기를 고치지 말고 스크립트·원본을 고친 뒤 다시 만든다.",
             "     위젯이 앱 테마(고른 라이트·다크, 크리스마스 기간)로 그릴 때의 색과 스타일. 기본(기기 설정)은 values(-night)/colors.xml·widget_styles.xml -->",
             "<resources>"]
    for theme, suffix, _ in THEMES:
        lines.append(f"    <!-- {theme} -->")
        for name in sorted(used):
            lines.append(f'    <color name="widget_{name}_{theme}">{pal[theme][name]}</color>')
        for name, items in style.items():
            lines.append(f'    <style name="{name}.{suffix}">')
            for k, v in items:
                lines.append(f'        <item name="{k}">{themed(v, theme, suffix, set(style))}</item>')
            lines.append("    </style>")
    lines.append("</resources>")
    return "\n".join(lines) + "\n"


def build() -> dict[Path, str]:
    """만들 파일 → 내용"""
    pal, style = palettes(), styles()
    sources = [RES / "layout" / f"{n}.xml" for n in LAYOUTS] + [RES / "drawable" / f"{n}.xml" for n in DRAWABLES]
    used: set[str] = set()
    for src in sources:
        used |= set(re.findall(r"@color/widget_(\w+)", src.read_text(encoding="utf-8")))
    for items in style.values():
        used |= {v[len("@color/widget_"):] for _, v in items if v.startswith("@color/widget_")}
    files = {}
    for theme, suffix, _ in THEMES:
        for src in sources:
            files[src.with_name(f"{src.stem}_{theme}.xml")] = copy(src, theme, suffix, set(style))
    files[OUT] = values(pal, style, used)
    return files


def stale(files: dict[Path, str]) -> list[Path]:
    """지난 판이 만들고 이번에는 만들지 않는 파일: 이름 끝이 한 벌(_light·_dark·_xmas)이고 둘째 줄이 이 스크립트의 머리 글인 것만(손으로 쓴 판은 건드리지 않는다)"""
    out = []
    for folder in ("layout", "drawable"):
        for p in sorted((RES / folder).glob("widget_*.xml")):
            lines = p.read_text(encoding="utf-8").split("\n", 2)
            if (p not in files and p.stem.endswith(tuple(f"_{t}" for t, _, _ in THEMES)) and len(lines) > 1
                    and lines[1].startswith(f"<!-- {MADE} ")):
                out.append(p)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="만든 파일이 지금 것과 같은지만 본다")
    args = ap.parse_args(argv)
    files = build()
    old = stale(files)
    if args.check:
        bad = [p for p, text in files.items() if not p.exists() or p.read_text(encoding="utf-8") != text] + old
        for p in bad:
            print(f"다시 만들어야 한다: {p.relative_to(ROOT)}", file=sys.stderr)
        return 1 if bad else 0
    for p, text in files.items():
        if not p.exists() or p.read_text(encoding="utf-8") != text:
            p.write_text(text, encoding="utf-8", newline="\n")
    for p in old:
        p.unlink()
    print(f"{len(files)}개 파일(한 벌 {len(THEMES)}), 지운 것 {len(old)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
