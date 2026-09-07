"""Consolidate CUA observations; this does not execute browser tests."""
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parent
records = json.loads((root / "route-audit.json").read_text(encoding="utf-8"))
routes = json.loads((root / "audit-routes.json").read_text(encoding="utf-8"))
latest = {}
excluded = Counter()
for index, record in enumerate(records):
    if (record.get("validWidth") is False or record.get("loading")
            or not record.get("theme")
            or record.get("expectedTheme", record["theme"]) != record["theme"]):
        excluded["size-theme-or-loading"] += 1
        continue
    expected = routes.get(record["name"])
    actual = urlsplit(record["url"])
    if expected:
        target = urlsplit(expected)
        if actual.path != target.path or (target.fragment and actual.fragment != target.fragment):
            excluded["redirected-route-or-wrong-section"] += 1
            continue
    key = (record["name"], record["requestedWidth"], record["theme"])
    latest[key] = {**record, "chronologicalIndex": index}

measurements = list(latest.values())
issues = [r for r in measurements if r["overflow"] or r["footer"] != 1 or r["lowContrast"]]
result = {
    "recordedAt": "2026-09-07",
    "method": "Latest valid observed route/section, width and theme. Earlier failures remain in route-audit.json. Contrast is a computed-style heuristic, not accessibility certification. This is not exhaustive state E2E.",
    "excluded": dict(excluded),
    "routes": routes,
    "summary": {"measurements": len(measurements), "remainingMeasurementIssues": len(issues)},
    "measurements": measurements,
}
(root / "final-route-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["summary"]))
for issue in issues:
    print(json.dumps(issue, ensure_ascii=True))
