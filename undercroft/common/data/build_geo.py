"""Rebuilds the location reference data in this folder from public sources.

    python -I build_geo.py <download-cache-dir>

Source: GeoNames country, first-level-region and postal-code files (CC BY 4.0,
https://www.geonames.org). Run rarely; the app only ever reads the output.

Writes geo-countries.json, geo-regions.json ({country: [{code, name}]}) and geo-us-areas.json
({zip3: place name}) beside this file.
"""
import io
import json
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

GEONAMES = "https://download.geonames.org/export"
OUT = Path(__file__).resolve().parent


def fetch(url: str, cache: Path) -> Path:
    target = cache / url.rsplit("/", 1)[1]
    if not target.exists():
        print("downloading", url, flush=True)
        urllib.request.urlretrieve(url, target)
    return target


def write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def build_countries_and_regions(cache: Path) -> None:
    countries = []
    for line in fetch(GEONAMES + "/dump/countryInfo.txt", cache).read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            fields = line.split("\t")
            countries.append({"code": fields[0], "name": fields[4]})
    countries.sort(key=lambda c: c["name"])
    write(OUT / "geo-countries.json", countries)
    regions = defaultdict(list)
    for line in fetch(GEONAMES + "/dump/admin1CodesASCII.txt", cache).read_text(encoding="utf-8").splitlines():
        key, name, _ascii, _id = line.split("\t")
        country, code = key.split(".", 1)
        regions[country].append({"code": code, "name": name})
    write(OUT / "geo-regions.json", {country: sorted(entries, key=lambda r: r["name"]) for country, entries in sorted(regions.items())})
    print(len(countries), "countries,", len(regions), "with regions")


def build_us_areas(cache: Path) -> None:
    names = defaultdict(Counter)
    archive = zipfile.ZipFile(fetch(GEONAMES + "/zip/allCountries.zip", cache))
    for line in io.TextIOWrapper(archive.open("allCountries.txt"), encoding="utf-8"):
        fields = line.rstrip("\n").split("\t")
        if fields[0] == "US" and len(fields[1]) == 5 and fields[1].isdigit():
            names[fields[1][:3]][f"{fields[2]}, {fields[4]}"] += 1
    areas = {}
    for prefix, counter in names.items():
        areas[prefix] = sorted(counter.items(), key=lambda item: (-item[1], item[0]))[0][0]
    write(OUT / "geo-us-areas.json", dict(sorted(areas.items())))
    print(len(areas), "ZIP3 areas")


if __name__ == "__main__":
    cache_dir = Path(sys.argv[1])
    cache_dir.mkdir(parents=True, exist_ok=True)
    build_countries_and_regions(cache_dir)
    build_us_areas(cache_dir)
