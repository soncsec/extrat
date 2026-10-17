#!/usr/bin/env python3
"""Repo hygiene checks run in CI.

- The source art pack (legacy/) and OS junk files are never committed.
- Every image in public/assets/ is a real PNG and is listed in CREDITS.md.
- Every asset listed in CREDITS.md exists.
- No committed file is larger than 5 MB.
- No private network addresses (server or dev machine) in tracked text files;
  they belong in the git-ignored deploy/server.env.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_BYTES = 5 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
FORBIDDEN = re.compile(r"(^|/)(legacy(/|$)|__MACOSX/|\.DS_Store$)")
PRIVATE_IP = re.compile(
    r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b"
)
TEXT_SUFFIXES = {".md", ".ts", ".js", ".json", ".yml", ".yaml", ".py", ".sh", ".html", ".css", ".txt", ".example", ".conf", ""}


def main() -> int:
    errors = []
    tracked = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.splitlines()

    for path in tracked:
        if FORBIDDEN.search(path):
            errors.append(f"must not be committed: {path}")
        full = ROOT / path
        if full.is_file() and full.stat().st_size > MAX_BYTES:
            errors.append(f"file over 5 MB: {path}")
        if full.is_file() and full.suffix in TEXT_SUFFIXES and path != "package-lock.json":
            match = PRIVATE_IP.search(full.read_text(errors="ignore"))
            if match:
                errors.append(f"private network address {match.group()} in {path}")

    credits_file = ROOT / "CREDITS.md"
    credits = credits_file.read_text() if credits_file.exists() else ""
    if not credits:
        errors.append("CREDITS.md is missing or empty")
    credited = set(re.findall(r"`(assets/[^`]+\.png)`", credits))

    assets_dir = ROOT / "public" / "assets"
    on_disk = set()
    for png in sorted(assets_dir.rglob("*")) if assets_dir.exists() else []:
        if not png.is_file():
            continue
        rel = str(png.relative_to(ROOT / "public"))
        on_disk.add(rel)
        if png.suffix != ".png":
            errors.append(f"unexpected non-PNG asset: {rel}")
        elif png.read_bytes()[:8] != PNG_SIGNATURE:
            errors.append(f"not a valid PNG: {rel}")
        if rel not in credited:
            errors.append(f"asset not listed in CREDITS.md: {rel}")

    for rel in sorted(credited - on_disk):
        errors.append(f"CREDITS.md lists a missing asset: {rel}")

    for e in errors:
        print(f"ERROR: {e}")
    print(f"checked {len(tracked)} tracked files, {len(on_disk)} assets: "
          f"{'FAILED' if errors else 'OK'}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
