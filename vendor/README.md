# Reviewed browser dependencies

`xlsx-0.20.3.min.js` is an unmodified SheetJS CE 0.20.3 browser distribution:

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
- License: Apache-2.0, included as `SHEETJS-LICENSE.txt`.
- SHA-256: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`.
- `npm run check:assets` verifies the local copy. All Excel-enabled pages reference this same file.

This replaces the mixed 0.18.5 / 0.20.1 CDN copies affected by CVE-2024-22363.
When upgrading, review the official release/advisories, update all references and the checksum,
then run unit and browser tests. The file is vendored so static GitHub Pages does not need a
package installation or a third-party CDN to parse Excel files.
