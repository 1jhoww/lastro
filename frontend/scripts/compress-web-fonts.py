"""Regenerate full Inter WOFF2 assets.

Requires fonttools[woff]==4.60.1 and brotli==1.2.0.

Source: installed @expo-google-fonts/inter. No glyph subsetting or design changes.
Native platforms continue to load the package's original TTF files.
"""
import hashlib
import json
from pathlib import Path
from shutil import copyfile
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
package = root / "node_modules/@expo-google-fonts/inter"
output = root / "assets/fonts"
output.mkdir(parents=True, exist_ok=True)
records = []
for style in ["400Regular", "500Medium", "600SemiBold", "700Bold"]:
    source = package / style / f"Inter_{style}.ttf"
    target = output / f"Inter_{style}.woff2"
    font = TTFont(source, recalcTimestamp=False)
    font.flavor = "woff2"
    font.save(target)
    restored = TTFont(target, recalcTimestamp=False)
    assert font.getGlyphOrder() == restored.getGlyphOrder()
    assert font.getBestCmap() == restored.getBestCmap()
    assert font["hmtx"].metrics == restored["hmtx"].metrics
    records.append({"style": style, "sourceBytes": source.stat().st_size,
                    "woff2Bytes": target.stat().st_size, "glyphs": len(font.getGlyphOrder()),
                    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "woff2Sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
copyfile(package / "LICENSE_FONT", output / "LICENSE-Inter.txt")
copyfile(package / "LICENSE", output / "LICENSE-Expo.txt")
public_licenses = root / "public/font-licenses"
public_licenses.mkdir(parents=True, exist_ok=True)
copyfile(package / "LICENSE_FONT", public_licenses / "Inter-OFL.txt")
copyfile(package / "LICENSE", public_licenses / "Expo-MIT.txt")
(output / "provenance.json").write_text(json.dumps({"source": "@expo-google-fonts/inter@0.4.2",
    "converter": "fonttools[woff]==4.60.1; brotli==1.2.0", "subset": False, "fonts": records}, indent=2) + "\n", encoding="utf-8")
print(json.dumps(records, indent=2))
