# Frontend wording review

This review covers the public HTML and user-facing strings in `app.js`,
`epochs.js`, `brightness.js`, `color-bar.js`, `wcs-axes.js` and `config.js`.
It follows the preceding FLAGS/Log/footer edits already present in the workspace.
No scientific calculations, API contracts, quality policies, layout rules or
deployment settings were changed.

## Before and after

| Location | Before | After | Reason |
| --- | --- | --- | --- |
| Search hint | Search Radius controls the SIA search area only. Preview Cutout Size sets the requested image field; Multi-epoch keeps its 3 arcmin cutouts. | Search Radius sets the search area. Cutout Size sets the Preview image field; Multi-epoch uses 3 arcmin cutouts. | Preserve the search/cutout distinction without internal terminology. |
| Declination hint | -90 < Dec ≤ 90 | -90 ≤ Dec ≤ 90 | Match the existing inclusive input and validation boundary. |
| Preview histogram accessibility label | Histogram of all valid raw IMAGE pixels; horizontal axis: MJy/sr; vertical axis: pixel count | Histogram of original valid pixels; horizontal axis: MJy/sr; vertical axis: pixel count | Describe the data without an extension name. |
| Preview brightness help | The histogram includes all valid raw pixels. Brightness adjustments do not change the distribution or FITS data. Invalid pixels are transparent; FLAGS quality exclusions remain in effect. Orange indicates quality information only, not brightness. | Adjust Min/Max and Stretch to explore faint detail. The histogram shows original valid pixels. See the data quality help below for FLAGS definitions. | Keep guidance local and consolidate quality rules in the shared help. |
| Preview brightness help, moving targets | The WCS position marks the input coordinates without correcting for proper motion. Interpret it using the coordinate reference epoch and actual observation date. The target may not be identifiable in the image. | Removed from this location; see Viewer help below. | One home for the moving-target guidance. |
| Preview Viewer help | Fit includes the full image, WCS axes and Color Bar. Manual zoom changes display size only; scroll inside the viewer to inspect enlarged pixels. WCS marks the input position without correcting proper motion; use the coordinate reference epoch and observation date. The target may not be identifiable. | Fit shows the full image, sky coordinates and Color Bar. Zoom in and scroll to inspect enlarged pixels. Coordinates are shown as entered. For moving targets, check the coordinate epoch and observation date when identifying a source. | Explain the unchanged coordinate behavior and identification task without repeating a disclaimer. |
| Preview color bar note | Transparent/masked pixels excluded. Orange FLAGS: quality only. | Removed; the stretch name and inversion state remain. | Quality meaning is already in the shared help and overlay control. |
| Preview image note | Invalid pixels are transparent. The viewport background does not represent a valid zero value. | Gaps show missing or excluded pixels, rather than zero brightness. | One concise interpretation of gaps beside the image. |
| Preview legacy-image fallback | This API provides a PNG preview only. | Image preview available; brightness controls are unavailable. | State what the user can do and which controls are unavailable. Specific API-provided reasons are preserved. |
| Multi-epoch viewer accessibility label | Backend PNG on a common WCS grid | Aligned observation image viewer | Remove implementation language. |
| Multi-epoch player | Observations are unevenly spaced. Playback follows frame order, not elapsed observation time. | Frames play at a steady pace; observation intervals vary. | Explain playback timing once, beside the controls. |
| Multi-epoch brightness help | Histogram: valid native IMAGE pixels before reprojection. Controls: aligned MJy/sr pixels. Shared mapping in comparison mode; independent ranges in browse mode. | The histogram shows original valid pixels before alignment. Brightness controls adjust the aligned image. | Keep the scientifically meaningful distinction; mapping status appears beside the sequence. |
| Multi-epoch histogram accessibility label | Histogram of valid native IMAGE values | Histogram of original valid pixels before alignment | Use the same plain-language distinction. |
| Multi-epoch Viewer help | Display zoom leaves the common WCS grid and source pixels unchanged. Scroll inside the viewer at manual magnifications. | Zoom in and scroll inside the viewer to inspect enlarged pixels. | Focus on the interaction. |
| Multi-epoch Observation Details | Observations are unevenly spaced in time. The slider follows frame order; playback speed does not represent elapsed observation time. Use for visual inspection only, not to infer variability. | Visual exploration; measuring variability requires additional photometric analysis. | Remove the duplicate timing explanation; keep one analysis-scope statement in Details. |
| Pagination button | More epochs (same search snapshot) | More observations | The snapshot is an internal detail. Expiration errors remain actionable. |
| Shared quality help | These are project display policies, not a photometry recommendation. | Removed. | Concrete masking rules already explain the policy. |
| Observation selection Details | Warning text repeated in the description and metadata; `not_requested` in the description | Warning text appears in metadata once; `not requested` in the description | Preserve warnings while removing duplication and an internal token. |
| Multi-epoch color bar, shared scale | Shared mapping; visual comparison only, not photometry. Transparent/masked pixels excluded. | Removed; the stretch name remains. | Mapping status belongs beside the sequence; scope belongs in Details. |
| Multi-epoch color bar, independent scales | Per-frame mapping; do not compare brightness between frames. Transparent/masked pixels excluded. | Removed; the stretch name remains. | The direct-comparison warning appears once beside the sequence. |
| Multi-epoch image alternative text | PNG reprojected to WCS by the backend · [date] · [observation ID] | Aligned observation · [date] · [observation ID] | Preserve image identity without backend terminology. |
| Sequence mode, shared scale | comparable_visualization · The backend permits visual comparison using a shared brightness range. This is not a photometric sequence. | Observations aligned on a common sky grid. | Remove internal mode names and the duplicate scope warning. |
| Sequence mode, independent scales | observation_browse · Each frame uses its own brightness range. For observation browsing only; do not compare brightness or infer variability. | Observations aligned on a common sky grid. | Scale interpretation is already beside the sequence. |
| Main sequence note, shared scale | Shared brightness range for visual comparison only; not a photometric sequence. | Shared brightness scale. | Describe the display without claiming photometric qualification. |
| Main sequence note, independent scales | Each frame uses its own brightness range. Do not compare brightness or infer variability. | Independent brightness scales; displayed intensities are not directly comparable. | Retain the actual interpretation constraint once. |
| Main sequence note, incompatible wavelength/calibration | Compatibility could be visible only in Details unless accompanied by an API warning. | Wavelengths are not compatible for direct comparison. / Calibrations are not compatible for direct comparison. | Keep explicit false compatibility results visible. Missing results never become a positive claim. |
| Fixed general backend warning | Visualization only; target bandpass is not full-field equivalence. No PSF/background/variance correction or light-curve inference. | Details: Wavelength matching applies at the target position, not across the whole image. Differences in image sharpness, background and measurement uncertainty are not corrected. | Only this exact known warning is moved and translated; the variability-analysis scope is stated once in Details. All unknown warning strings remain visible unchanged. |
| Repeated warnings | Identical strings could repeat across warning sources. | Identical strings appear once per warning group. | Remove repetition while retaining each distinct warning and source data. |
| Load completion | Retained [n] slots; loaded [m] PNGs. Playback and scrubbing make no additional requests. | Loaded [m] of [n] frames. Ready to explore. | Show completion and partial success in user terms; failed frames retain their reasons. |
| Color bar with no explanatory note | Stretch name followed by an empty sentence separator | Stretch name only | Avoid trailing punctuation after consolidating the notes. |

## Retained information

- The complete FLAGS exclusions, missing-FLAGS distinction, unknown-bit policy,
  gap handling and orange overlay meaning remain in the shared quality help.
- Original-value histogram semantics, units and Log's support for zero and
  negative values remain. No image, mask, normalization or stretch logic changed.
- Actual cutout dimensions and field variability remain visible; the size note
  describes a real service behavior rather than a generic disclaimer.
- Search incompleteness, source failures, frame failures, quality warnings,
  alignment reasons, calibration warnings and API errors remain available.
  Unknown API warning text is not heuristically filtered or reinterpreted.
- Error messages in image loading and request validation remain because they
  identify failures and recovery steps. WCS/Color Bar unavailable states remain.
- FITS flag definitions, RA/Dec, WCS, units and named stretch controls remain
  where they help identify scientific quantities or diagnostics.
- The source attribution and safe official links from the preceding edit remain.

## Validation

`node frontend/tools/test.mjs`: **153 passed, 0 failed, 0 skipped**.

Coverage includes both scale modes, masks, Log/Sqrt, histogram invariance,
playback without extra requests, WCS, failed frames, partial searches, and the
updated English copy. New assertions check the single homes for timing,
moving-target guidance and analysis scope; incompatible and unknown-warning
visibility; exact warning deduplication; and preservation of quality policies.

`git diff --check` passed. No external service, deployment, commit or push was
performed. Existing uncommitted changes and untracked files were preserved.
