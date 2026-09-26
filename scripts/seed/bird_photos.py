"""Bird photos for the demo seed: a few CC-licensed Wikimedia Commons photos per species, cached in
scripts/seed/.photo_cache/ (gitignored) with their credits in credits.json next to them.

    cd api
    .venv/Scripts/python ../scripts/seed/bird_photos.py            # download what's missing
    .venv/Scripts/python ../scripts/seed/bird_photos.py --sheet    # also write contact-sheet.jpg to eyeball them

Commons search by scientific name finds mostly photos of the bird; the filters below drop maps, drawings, eggs and
odd crops. Anything that still looks wrong can go in SKIP (file titles).
"""

import io
import json
import sys
import time
from pathlib import Path

import httpx
from PIL import Image, ImageOps

CACHE = Path(__file__).resolve().parent / ".photo_cache"
UA = {"User-Agent": "BirdseyeHackathonDemoSeed/1.0 (https://github.com/alexrivercoleman/birdseye)"}
PER_SPECIES = 3
LONG_EDGE = 1280

# code: scientific name (the search term)
PHOTO_SPECIES = {
    "norcar": "Cardinalis cardinalis", "carwre": "Thryothorus ludovicianus", "blujay": "Cyanocitta cristata",
    "carchi": "Poecile carolinensis", "tuftit": "Baeolophus bicolor", "rebwoo": "Melanerpes carolinus",
    "dowwoo": "Dryobates pubescens", "pilwoo": "Dryocopus pileatus", "norfli": "Colaptes auratus",
    "easblu": "Sialia sialis", "brnthr": "Toxostoma rufum", "normoc": "Mimus polyglottos",
    "amerob": "Turdus migratorius", "amegfi": "Spinus tristis", "whbnut": "Sitta carolinensis",
    "bnhnut": "Sitta pusilla", "reshaw": "Buteo lineatus", "rethaw": "Buteo jamaicensis",
    "coohaw": "Accipiter cooperii", "brdowl": "Strix varia", "grbher3": "Ardea herodias", "greegr": "Ardea alba",
    "grnher": "Butorides virescens", "wooduc": "Aix sponsa", "belkin1": "Megaceryle alcyon",
    "osprey": "Pandion haliaetus", "baleag": "Haliaeetus leucocephalus", "easpho": "Sayornis phoebe",
    "rthhum": "Archilochus colubris", "indbun": "Passerina cyanea", "sumtan": "Piranga rubra",
    "scatan": "Piranga olivacea", "cedwax": "Bombycilla cedrorum", "eastow": "Pipilo erythrophthalmus",
    "magwar": "Setophaga magnolia", "amered": "Setophaga ruticilla", "btnwar": "Setophaga virens",
    "norpar": "Setophaga americana", "robgro": "Pheucticus ludovicianus", "wiltur": "Meleagris gallopavo",
    "pinwar": "Setophaga pinus", "grycat": "Dumetella carolinensis", "yebcuc": "Coccyzus americanus",
    # rarities and out-of-range birds
    "perfal": "Falco peregrinus", "merlin": "Falco columbarius", "limpki": "Aramus guarauna",
    "swtkit": "Elanoides forficatus", "paibun": "Passerina ciris", "cerwar": "Setophaga cerulea",
    "bkbcuc": "Coccyzus erythropthalmus", "olsfly": "Contopus cooperi", "phivir": "Vireo philadelphicus",
}
# Commons file titles that passed the filters but aren't good feed photos
SKIP = {
    'File:Brown Headed Nuthatch in snowfall.jpg',
    'File:Brown-headed nuthatch blackwater nwr 9.8.24 DSC 7161-topaz-rawdenoise.jpg',
    'File:The birds of America (Pl. 276) (8576560909).jpg',
    'File:Setophaga cerúlea - Reinita cerúlea.jpg',
    'File:Contopus cooperi - El pibí boreal.jpg',
    'File:Vireo philadelphicus.jpg',
    'File:Merlin pea island 10.4.24 DSC 9785-topaz-rawdenoise.jpg',
    'File:Pine Warbler, Haiti 250470618.jpg',
    'File:Bird and reflection, automobile window.jpg',
    'File:Aramus guarauna (Limpkin) 38.jpg',
    'File:Aramus guarauna (Limpkin) 52.jpg',
}
BAD_WORDS = ("map", "range", "egg", "nest", "skeleton", "skull", "specimen", "museum", "drawing", "illustration",
             "plate", "audubon", "stamp", "painting", "distribution", "dead", "taxiderm", "chart", "sign", "logo")


def search(client: httpx.Client, sci: str) -> list[dict]:
    r = client.get("https://commons.wikimedia.org/w/api.php", params={
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 30,
        "gsrsearch": f'"{sci}" filetype:bitmap', "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata", "iiurlwidth": LONG_EDGE,
    })
    r.raise_for_status()
    pages = sorted((r.json().get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    out = []
    for p in pages:
        info = (p.get("imageinfo") or [{}])[0]
        title = p["title"]
        meta = info.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value", "")
        w, h = info.get("width", 0), info.get("height", 0)
        if (info.get("mime") != "image/jpeg" or title in SKIP or any(b in title.lower() for b in BAD_WORDS)
                or w < 1000 or not 1.1 <= w / max(h, 1) <= 1.8
                or not any(k in lic for k in ("CC", "Public domain", "PD"))):
            continue
        artist = (meta.get("Artist") or {}).get("value", "")
        out.append({"title": title, "thumb": info.get("thumburl"), "page": info.get("descriptionurl"),
                    "license": lic, "artist": _strip_html(artist)})
    return out


def _strip_html(s: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", s).strip()


def download() -> dict:
    CACHE.mkdir(exist_ok=True)
    credits_path = CACHE / "credits.json"
    credits = json.loads(credits_path.read_text(encoding="utf-8")) if credits_path.exists() else {}
    with httpx.Client(headers=UA, timeout=30, follow_redirects=True) as client:
        for code, sci in PHOTO_SPECIES.items():
            have = [k for k in credits if k.startswith(code + "_") and (CACHE / k).exists()]
            if len(have) >= PER_SPECIES:
                continue
            try:
                hits = search(client, sci)
            except httpx.HTTPError as e:
                print(f"{code}: search failed ({e})")
                continue
            used = {credits[k]["title"] for k in have}
            n = len(have)
            for hit in hits:
                if n >= PER_SPECIES:
                    break
                if hit["title"] in used:
                    continue
                try:
                    img = client.get(hit["thumb"])
                    img.raise_for_status()
                except httpx.HTTPError as e:
                    print(f"{code}: download failed ({e})")
                    time.sleep(2)
                    continue
                im = ImageOps.exif_transpose(Image.open(io.BytesIO(img.content))).convert("RGB")
                im.thumbnail((LONG_EDGE, LONG_EDGE))
                name = f"{code}_{n}.jpg"
                im.save(CACHE / name, quality=85)
                credits[name] = hit
                n += 1
                time.sleep(0.3)
            print(f"{code}: {n} photos", flush=True)
            credits_path.write_text(json.dumps(credits, indent=1), encoding="utf-8")
    return credits


def contact_sheet(credits: dict) -> Path:
    names = sorted(credits)
    cols, cell = 9, 200
    sheet = Image.new("RGB", (cols * cell, ((len(names) + cols - 1) // cols) * cell), "white")
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        im = Image.open(CACHE / name)
        im.thumbnail((cell, cell - 14))
        x, y = (i % cols) * cell, (i // cols) * cell
        sheet.paste(im, (x, y))
        d.text((x + 2, y + cell - 13), name, fill="black")
    out = CACHE / "contact-sheet.jpg"
    sheet.save(out, quality=80)
    return out


def photos_by_species() -> dict[str, list[Path]]:
    credits = json.loads((CACHE / "credits.json").read_text(encoding="utf-8"))
    out: dict[str, list[Path]] = {}
    for name in sorted(credits):
        if (CACHE / name).exists():
            out.setdefault(name.rsplit("_", 1)[0], []).append(CACHE / name)
    return out


if __name__ == "__main__":
    c = download()
    print(f"{len(c)} photos in {CACHE}")
    if "--sheet" in sys.argv:
        print(contact_sheet(c))
