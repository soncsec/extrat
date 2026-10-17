"""Tests for scripts/smoke_test.py against a local web server.

Run: python3 -m unittest discover -s tests/release -p 'test_*.py'
"""
import contextlib
import functools
import http.server
import io
import json
import pathlib
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))
import smoke_test  # noqa: E402

PAGE = """<!doctype html><html><head><title>Game Template</title>
<script type="module" crossorigin src="./assets/index-AbC123xY.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-ZzZz9999.css">
</head><body><div id="game"></div></body></html>"""

HEADERS = {
    "Content-Security-Policy": "default-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=()",
}


class Site:
    """A release folder served over HTTP, optionally with security headers."""

    def __init__(self, page=PAGE, release_id="20261017T120000Z-0123abcd", headers=True,
                 files=("assets/index-AbC123xY.js", "assets/index-ZzZz9999.css")):
        self.dir = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.dir.name) / "game-template"
        (root / "assets").mkdir(parents=True)
        (root / "index.html").write_text(page)
        (root / "release.json").write_text(json.dumps({"id": release_id}))
        for f in files:
            (root / f).write_text("x")
        send = HEADERS if headers else {}

        class Handler(http.server.SimpleHTTPRequestHandler):
            def end_headers(self):
                for k, v in send.items():
                    self.send_header(k, v)
                super().end_headers()

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(Handler, directory=self.dir.name))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_port}/game-template/"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()


def smoke(site, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = smoke_test.main([site.base, *args])
    return code, out.getvalue()


class SmokeTest(unittest.TestCase):
    def check(self, site, *args):
        self.addCleanup(site.close)
        return smoke(site, *args)

    def test_passes_on_a_good_release(self):
        code, out = self.check(Site(), "--release-id", "20261017T120000Z-0123abcd",
                               "--title", "Game Template", "--require-headers")
        self.assertEqual(code, 0, out)
        self.assertIn("ok   ./assets/index-AbC123xY.js", out)

    def test_fails_when_the_switch_did_not_happen(self):
        code, out = self.check(Site(release_id="20261016T000000Z-old00000"),
                               "--release-id", "20261017T120000Z-0123abcd")
        self.assertEqual(code, 1)
        self.assertIn("release.json: expected", out)

    def test_fails_on_a_missing_asset(self):
        code, out = self.check(Site(files=("assets/index-AbC123xY.js",)))
        self.assertEqual(code, 1)
        self.assertIn("index-ZzZz9999.css: HTTP 404", out)

    def test_fails_on_the_wrong_title(self):
        code, out = self.check(Site(), "--title", "Other Game")
        self.assertEqual(code, 1)
        self.assertIn("title: expected", out)

    def test_fails_on_a_third_party_reference(self):
        page = PAGE.replace("./assets/index-AbC123xY.js", "https://cdn.example.com/x.js")
        code, out = self.check(Site(page=page))
        self.assertEqual(code, 1)
        self.assertIn("third-party reference", out)

    def test_fails_when_the_page_loads_nothing(self):
        code, out = self.check(Site(page="<title>Game Template</title>It works!"))
        self.assertEqual(code, 1)
        self.assertIn("references no scripts", out)

    def test_missing_headers_warn_by_default(self):
        code, out = self.check(Site(headers=False))
        self.assertEqual(code, 0, out)
        self.assertIn("WARN missing security headers", out)

    def test_missing_headers_fail_when_required(self):
        code, out = self.check(Site(headers=False), "--require-headers")
        self.assertEqual(code, 1)
        self.assertIn("FAIL missing security headers", out)


if __name__ == "__main__":
    unittest.main()
