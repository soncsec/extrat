#!/usr/bin/env python3
"""Smoke test a deployed release.

Usage: smoke_test.py <base-url> [--host NAME] [--release-id ID] [--title TEXT]
                     [--require-headers]

Checks, against the live server:
- <base-url>release.json exists and names the expected release (proves the switch happened)
- the page loads (200) and has the expected <title>
- every script, stylesheet, icon and image the page references loads (200)
- the security headers from the Apache config are present (a warning unless
  --require-headers is given)

--host sends a Host header, so the server can be reached by IP before DNS exists.
Exit code 0 = pass, 1 = fail.
"""
import argparse
import html.parser
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

SECURITY_HEADERS = [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
]


class _Refs(html.parser.HTMLParser):
    """Collects the URLs a page loads: scripts, stylesheets, icons, images."""

    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script" and a.get("src"):
            self.refs.append(a["src"])
        elif tag == "link" and a.get("href") and a.get("rel") in (
            "stylesheet",
            "icon",
            "modulepreload",
        ):
            self.refs.append(a["href"])
        elif tag == "img" and a.get("src"):
            self.refs.append(a["src"])
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def fetch(url: str, host: str | None) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers={"Host": host} if host else {})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), b""


def run(base: str, host: str | None, release_id: str | None, title: str | None,
        require_headers: bool) -> list[str]:
    """Returns a list of failures; prints progress and warnings."""
    if not base.endswith("/"):
        base += "/"
    failures: list[str] = []

    if release_id:
        status, _, body = fetch(urllib.parse.urljoin(base, "release.json"), host)
        live = json.loads(body).get("id") if status == 200 else None
        if live != release_id:
            failures.append(f"release.json: expected {release_id}, got {live} (HTTP {status})")
        else:
            print(f"ok   release.json names {release_id}")

    status, headers, body = fetch(base, host)
    if status != 200:
        return failures + [f"page: HTTP {status}"]
    print(f"ok   page {base} (HTTP 200)")

    page = _Refs()
    page.feed(body.decode("utf-8", errors="replace"))
    if title and page.title.strip() != title:
        failures.append(f"title: expected {title!r}, got {page.title.strip()!r}")
    elif title:
        print(f"ok   title {title!r}")

    for ref in sorted(set(page.refs)):
        url = urllib.parse.urljoin(base, ref)
        if urllib.parse.urlsplit(url).netloc != urllib.parse.urlsplit(base).netloc:
            failures.append(f"third-party reference: {ref}")
            continue
        code, _, _ = fetch(url, host)
        if code != 200:
            failures.append(f"{ref}: HTTP {code}")
        else:
            print(f"ok   {ref}")
    if not page.refs:
        failures.append("page references no scripts or styles (wrong page?)")

    lower = {k.lower() for k in headers}
    missing = [h for h in SECURITY_HEADERS if h.lower() not in lower]
    if missing:
        msg = "missing security headers: " + ", ".join(missing)
        if require_headers:
            failures.append(msg)
        else:
            print(f"WARN {msg} (Apache config not applied yet?)")
    else:
        print("ok   security headers present")
    return failures


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("base")
    p.add_argument("--host")
    p.add_argument("--release-id")
    p.add_argument("--title")
    p.add_argument("--require-headers", action="store_true")
    a = p.parse_args(argv)
    failures = run(a.base, a.host, a.release_id, a.title, a.require_headers)
    for f in failures:
        print(f"FAIL {f}")
    print("smoke test:", "FAILED" if failures else "passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
