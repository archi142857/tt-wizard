"""앱 안 구글 로그인(update111)이 들여오는 Google 라이브러리의 고지문 licenses/google.txt 를 만든다.

Google Play 서비스 클라이언트 라이브러리와 Google ID(googleid)는 Android SDK 라이선스를 따르고, 그 안에 든 다른 사람의 코드(오픈소스)
고지문을 AAR 안의 third_party_licenses.json·.txt 로 함께 싣는다(Google 의 oss-licenses 플러그인이 보여 주는 것과 같은 글).
이 스크립트는 안드로이드 빌드 뒤 Gradle 캐시의 그 AAR 들에서 고지문을 모아, 같은 글은 한 번만 적고 이름을 묶어 쓴다.
AndroidX 줄은 licenses/androidx.txt 가 맡아서 뺀다.

  python scripts/google_notices.py            # ~/.gradle 캐시에서 찾는다(app/android 에서 ./gradlew assembleDebug 한 뒤)
  python scripts/google_notices.py --check    # 지금 파일과 같은지만 본다

라이브러리 판을 올리면(app/android/variables.gradle) 빌드한 뒤 다시 돌린다(tests/test_app.py 가 머리의 판을 본다).
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "licenses" / "google.txt"
CACHE = Path.home() / ".gradle" / "caches" / "modules-2" / "files-2.1"
GROUPS = ("com.google.android.gms", "com.google.android.libraries.identity.googleid")
LINE = "-" * 72

HEAD = """Google Play 서비스 클라이언트 라이브러리와 Google ID — https://developers.google.com/android/guides/overview
안드로이드 앱에 들어갑니다. 앱 안 구글 로그인(폰의 구글 계정 고르기, AndroidX Credential Manager)에 씁니다:
{libs}

Copyright Google LLC
Android Software Development Kit License 를 따릅니다: https://developer.android.com/studio/terms

아래는 이 라이브러리들 안에 든 다른 사람의 코드와 그 고지문입니다(라이브러리가 함께 싣는 third_party_licenses 그대로,
같은 글은 한 번만 적고 이름을 묶었습니다. AndroidX 는 androidx.txt 에 있습니다).
"""


def resolved(deps: Path | None) -> dict[str, str]:
    """쓰는 판: Gradle 이 고른 판(dependencies 출력 파일이 있으면 그것, 없으면 캐시에서 가장 높은 판)"""
    out: dict[str, str] = {}
    if deps and deps.exists():
        for line in deps.read_text(encoding="utf-8").splitlines():
            m = re.match(r"(com\.google\.android\.(?:gms|libraries\.identity\.googleid)):([\w.-]+):(?:[\w.-]+ -> )?([\w.-]+)$", line.strip())
            if m:
                out[f"{m.group(1)}:{m.group(2)}"] = m.group(3)
        return out
    for group in GROUPS:
        for art in sorted((CACHE / group).glob("*")):
            versions = sorted((v.name for v in art.iterdir()), key=lambda v: [int(x) if x.isdigit() else x for x in re.split(r"[.-]", v)])
            out[f"{group}:{art.name}"] = versions[-1]
    return out


def aar(coord: str, version: str) -> Path | None:
    group, name = coord.split(":")
    found = sorted((CACHE / group / name / version).glob(f"*/{name}-{version}.aar"))
    return found[0] if found else None


def notices(paths: list[Path]) -> list[tuple[list[str], str]]:
    """(이름들, 글) 묶음. AndroidX 는 뺀다. 같은 이름이 라이브러리마다 다른 판의 글을 실으면 가장 긴 글(여러 판의 고지를 다 품는 쪽)을,
    띄어쓰기만 다른 글은 같은 글로 본다"""
    by_name: dict[str, str] = {}
    for path in paths:
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
            if not {"third_party_licenses.json", "third_party_licenses.txt"} <= names:
                continue
            index = json.loads(z.read("third_party_licenses.json"))
            raw = z.read("third_party_licenses.txt")
        for name, span in index.items():
            if name.startswith("AndroidX "):
                continue
            text = raw[span["start"]:span["start"] + span["length"]].decode("utf-8", "replace")
            text = "\n".join(line.rstrip() for line in text.splitlines()).strip("\n")
            if len(text) > len(by_name.get(name, "")):
                by_name[name] = text
    by_text: dict[str, tuple[list[str], str]] = {}
    for name, text in by_name.items():
        key = re.sub(r"\s+", " ", text).strip()
        by_text.setdefault(key, ([], text))[0].append(name)
    return sorted(((sorted(n, key=str.lower), t) for n, t in by_text.values()), key=lambda x: x[0][0].lower())


def render(versions: dict[str, str], groups: list[tuple[list[str], str]]) -> str:
    libs = ",\n".join(f"  {coord} {v}" for coord, v in sorted(versions.items()))
    parts = [HEAD.format(libs=libs)]
    for names, text in groups:
        parts.append(f"{LINE}\n{', '.join(names)}\n\n{text}\n")
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--deps", type=Path, help="./gradlew -q :app:dependencies --configuration releaseRuntimeClasspath 출력을 정리한 파일")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    versions = resolved(args.deps)
    paths = [p for c, v in versions.items() if (p := aar(c, v))]
    missing = [c for c, v in versions.items() if not aar(c, v)]
    if missing or not paths:
        raise SystemExit(f"Gradle 캐시에 AAR 이 없다: {', '.join(missing) or '전부'} (app/android 에서 ./gradlew assembleDebug 먼저)")
    text = render(versions, notices(paths))
    if args.check:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print("같다" if same else "다르다")
        return 0 if same else 1
    OUT.write_text(text, encoding="utf-8")
    print(f"저장: {OUT} (라이브러리 {len(versions)}개, 고지문 {text.count(LINE)}묶음, {len(text.encode('utf-8')) / 1e3:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
