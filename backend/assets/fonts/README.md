# Fonts for PDF export

| File | Covers |
| --- | --- |
| `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` | Latin (incl. Vietnamese), Greek, Cyrillic |
| `NotoSansDevanagari-Regular.ttf`, `NotoSansDevanagari-Bold.ttf` | Hindi, Marathi, Nepali |

The fonts are from the [Noto project](https://github.com/notofonts) and are
licensed under the SIL Open Font License 1.1 — see `OFL.txt`.

## Adding a script

To support another writing system in PDF export, add its Noto Sans regular and
bold TTF files to this folder and list them in `FAMILIES` in
`src/pdf/fonts.ts`. Text is drawn with the first listed font that has a glyph
for each character. Right-to-left scripts also need bidirectional layout,
which the PDF renderer does not do.
