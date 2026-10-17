#!/usr/bin/env python3
"""Summarize an OWASP ZAP JSON report and fail if it has any high-risk alert.

Usage: zap_check.py <report.json>

Prints every alert with its risk level and writes a table to the GitHub
Actions job summary when GITHUB_STEP_SUMMARY is set. Exit code 1 means at
least one High alert (riskcode 3); medium and lower are reported only.
"""
import json
import os
import sys

RISK = {"3": "High", "2": "Medium", "1": "Low", "0": "Informational"}


def load_alerts(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        report = json.load(f)
    alerts = []
    for site in report.get("site", []):
        for alert in site.get("alerts", []):
            alerts.append(
                {
                    "risk": str(alert.get("riskcode", "0")),
                    "name": alert.get("name") or alert.get("alert", "?"),
                    "id": str(alert.get("pluginid", "?")),
                    "count": int(alert.get("count", len(alert.get("instances", [])))),
                }
            )
    alerts.sort(key=lambda a: (-int(a["risk"]), a["name"]))
    return alerts


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    alerts = load_alerts(argv[1])
    lines = ["| Risk | Alert | ZAP rule | Instances |", "|---|---|---|---|"]
    for a in alerts:
        label = RISK.get(a["risk"], a["risk"])
        print(f"{label:>13}  {a['name']} (rule {a['id']}, {a['count']} instances)")
        lines.append(f"| {label} | {a['name']} | {a['id']} | {a['count']} |")
    high = [a for a in alerts if a["risk"] == "3"]
    verdict = (
        f"FAILED: {len(high)} high-risk alert(s)" if high else "OK: no high-risk alerts"
    )
    print(f"{len(alerts)} alert types. {verdict}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## ZAP baseline scan\n\n**{verdict}**\n\n")
            f.write("\n".join(lines) + "\n" if alerts else "No alerts.\n")
    return 1 if high else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
