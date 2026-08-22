# Third-party notices

## libheif-js / libheif

Trail's optional HEIC decode path includes `libheif-js` 1.19.8, an Emscripten/WebAssembly distribution of libheif, under the GNU Lesser General Public License v3.0. The package's license text is distributed in the installed dependency and its source is available from:

- https://github.com/catdad-experiments/libheif-js/tree/v1.19.8
- https://github.com/strukturag/libheif

Any distributed Trail build that contains this module must retain the LGPL notice and license, provide the corresponding source and build information for the exact library version, preserve users' ability to replace/relink the LGPL component, and avoid technical measures that prohibit that replacement. Release packaging and written offers must be reviewed against LGPL-3.0 before distribution. This notice is not legal advice.

HEIC commonly uses patent-encumbered HEVC decoding. Technical support does not establish a patent license. Shipping HEIC remains blocked until counsel confirms the applicable codec-patent, territory, store-distribution, and LGPL obligations. If approval is not obtained, remove the HEIC contract option and decoder dependency before release; JPEG and WebP remain supported.
