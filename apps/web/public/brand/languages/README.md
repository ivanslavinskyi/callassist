# Language medallions

Unmodified 64 x 64 PNGs from the supplied
`Design/shprohli_language_medallions_ui_pack` artwork. Display at 32 x 32 CSS
pixels for 2x density. The seven images total about 68 KiB; the detailed source
SVGs are substantially larger and are not served by the dropdown.

Mapping follows the supplied filenames and preview captions:

| UI locale | Artwork |
| --- | --- |
| de | Goethe |
| fr | Moliere |
| it | Dante |
| rm | Peider Lansel |
| en | Shakespeare |
| ru | Pushkin |
| uk | Shevchenko |

Runtime mapping lives in `packages/contracts/src/ui-locales.ts`. Medallions are
decorative: each option retains its native language name and pressed state for
accessible identification. The closed control retains its two-letter code.
