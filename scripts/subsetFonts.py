"""Build small Turkish supplements; retain full Latin Extended fallbacks.

Optional regeneration: pip install -r scripts/font-requirements.txt
                      python scripts/subsetFonts.py
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parents[1] / "public" / "fonts"
# Dotless i (0131), ç/ö/ü and ASCII are already in the Latin fonts.
TURKISH = {0x011E, 0x011F, 0x0130, 0x015E, 0x015F}


def generate(family: str) -> None:
    source = FONT_DIR / f"{family}-latin-ext.woff2"
    destination = FONT_DIR / f"{family}-tr.woff2"
    font = TTFont(source, recalcTimestamp=False)
    cmap = font.getBestCmap()
    assert TURKISH <= cmap.keys(), f"Missing Turkish glyphs in {source}"
    widths = {cp: font["hmtx"][cmap[cp]] for cp in TURKISH}
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=TURKISH)
    subsetter.subset(font)
    # Clearly identify this OFL derivative while keeping the original notices.
    name = f"MAKAM {family.title()} TR"
    for record in font["name"].names:
        if record.nameID in (1, 16):
            record.string = name.encode(record.getEncoding())
        elif record.nameID == 4:
            record.string = f"{name} Regular".encode(record.getEncoding())
        elif record.nameID in (3, 6):
            record.string = f"{name.replace(' ', '')}-Regular".encode(record.getEncoding())
    font.flavor = "woff2"
    font.save(destination)
    result = TTFont(destination)
    assert TURKISH == set(result.getBestCmap()), "Unexpected output character map"
    assert widths == {cp: result["hmtx"][result.getBestCmap()[cp]] for cp in TURKISH}, "Glyph metrics changed"
    assert result["fvar"].axes[0].minValue == font["fvar"].axes[0].minValue
    assert result["fvar"].axes[0].maxValue == font["fvar"].axes[0].maxValue
    print(f"{family}: {source.stat().st_size} -> {destination.stat().st_size} bytes")


if __name__ == "__main__":
    for font_family in ("inter", "outfit"):
        generate(font_family)
