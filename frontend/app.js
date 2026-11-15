/* Shared display geometry only: source pixels and celestial metadata stay intact. */
(() => {
  "use strict";
  // Text formatting never feeds back into inputs, source data or display math.
  const number = value => typeof value === "number" && Number.isFinite(value)
    ? Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString() : value;
  function fields(host, data) {
    host.replaceChildren();
    function visit(value, path) {
      if (value == null || typeof value === "string" && !value.trim() || Array.isArray(value) && !value.length) return;
      if (Array.isArray(value) && value.some(item => item && typeof item === "object")) {
        value.forEach((item, index) => visit(item, [...path, String(index + 1)]));
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, item] of Object.entries(value)) visit(item, [...path, key.replaceAll("_", " ")]);
        return;
      }
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = path.join(" / ");
      dd.textContent = value == null ? "Not available" : Array.isArray(value)
        ? value.map(number).join(", ")
        : String(number(value));
      host.append(dt, dd);
    }
    visit(data, []);
    host.hidden = host.children.length === 0;
  }
  const compatibility = v => v == null ? null : typeof v === "boolean" ? (v ? "Compatible" : "Not compatible") : v;
  function details(data = {}, sequence = null, preview = false) {
    const spectral = data.target_spectral;
    return {
      "Observation ID": data.obs_id ?? data.sia?.obs_id,
      "Collection": (data.source_collections || [data.obs_collection ?? data.sia?.obs_collection]).filter(Boolean).join(", ") || null,
      "Target bandwidth (μm)": spectral?.available && spectral.units?.every(u => u === "um") ? spectral.bandwidth : data.target_bandwidth_um,
      "Alignment status": preview ? null : data.alignment?.status,
      "Wavelength compatibility": preview ? null : compatibility((sequence || data).wavelength_compatible),
      "Calibration compatibility": preview ? null : compatibility((sequence || data).calibration_compatible ?? data.calibration_status ?? data.calibration?.status),
      "Warnings": [...new Set([...(data.warnings || []), data.calibration?.warning, data.alignment?.reason].filter(Boolean))].join("; ") || null,
      "Failure reason": data.error ? [data.error.code, data.error.message ?? (typeof data.error === "string" ? data.error : null)].filter(Boolean).join(": ") : null
    };
  }
  window.SpherexUI = { number, fields, details };
  function viewportHeight(screenHeight, workspaceTop, chromeHeight) {
    return Math.max(300, Math.floor(screenHeight - workspaceTop - chromeHeight - 16));
  }
  function fit(width, height, availableWidth, availableHeight, stacked = false) {
    const extent = factor => window.SpherexColorBar.measure(window.SpherexAxes.layout(null, width, height, factor), false, stacked);
    // Reserve room for a visible image before shrinking the fixed annotation gutters.
    const referenceSize = stacked ? Math.max(40, Math.min(180, availableWidth - 200, availableHeight - 350)) : 240;
    const reference = extent(referenceSize / Math.max(width, height));
    // On narrow screens the fixed annotation gutters also need uniform scaling.
    const stageScale = Math.min(1, availableWidth / (reference.width + 1), availableHeight / (reference.height + 1));
    let low = 0, high = Math.max(availableWidth / width, availableHeight / height) / stageScale;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2, size = extent(mid);
      if (size.width * stageScale <= availableWidth && size.height * stageScale <= availableHeight) low = mid;
      else high = mid;
    }
    return { factor: low, stageScale, stacked };
  }
  function create({ viewport, stage, frame, slider, button, output, redraw, image }) {
    let fitting = true, last = { factor: 1, stageScale: 1 };
    const panel = viewport.closest?.(".viewer");
    function sizeViewport() {
      if (!panel || panel.hidden || !window.matchMedia("(min-width: 1100px)").matches) {
        viewport.style.removeProperty?.("--available-view-height");
        return;
      }
      const workspace = panel.closest(".workspace");
      // Document coordinates keep Fit stable when the page is scrolled.
      const top = workspace.getBoundingClientRect().top + window.scrollY;
      const chrome = panel.getBoundingClientRect().height - viewport.getBoundingClientRect().height;
      viewport.style.setProperty("--available-view-height", `${viewportHeight(window.innerHeight, top, chrome)}px`);
    }
    function geometry(width, height) {
      const css = window.getComputedStyle?.(viewport);
      const horizontal = css ? parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) : 0;
      const vertical = css ? parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) : 0;
      const w = viewport.clientWidth - horizontal - 2, h = viewport.clientHeight - vertical - 2;
      // Hidden panels are measured again after becoming visible.
      if (fitting && w > 0 && h > 0) last = fit(width, height, w, h, w < 500);
      if (fitting) last.factor = Math.min(last.factor, 32 / last.stageScale);
      if (!fitting) last = { factor: Math.max(Number(slider.min) || .001, Math.min(32, Number(slider.value))), stageScale: 1 };
      const effective = last.factor * last.stageScale;
      slider.min = String(Math.min(1, effective)); slider.step = "any";
      slider.value = String(effective);
      const currentImage = image?.();
      if (currentImage) currentImage.style.cursor = effective >= 32 ? "default" : "zoom-in";
      button.setAttribute("aria-pressed", String(fitting));
      output.textContent = fitting ? `Fit (${(last.factor * last.stageScale).toFixed(2)}\u00d7)` : `${last.factor}\u00d7`;
      return last;
    }
    function apply(size, plan) {
      stage.style.width = `${size.width}px`; stage.style.height = `${size.height}px`;
      stage.style.transform = `scale(${plan.stageScale})`;
      frame.style.width = `${size.width * plan.stageScale}px`; frame.style.height = `${size.height * plan.stageScale}px`;
    }
    viewport.addEventListener("click", event => {
      const target = image?.();
      if (!target || event.target !== target || slider.disabled) return;
      const effective = last.factor * last.stageScale;
      if (effective >= 32) return;
      const before = target.getBoundingClientRect();
      if (!before.width || !before.height) return;
      const x = (event.clientX - before.left) / before.width, y = (event.clientY - before.top) / before.height;
      slider.value = String(Math.min(32, effective * 1.5));
      fitting = false; redraw();
      const after = target.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      viewport.scrollLeft += after.left + x * after.width - bounds.left - viewport.clientWidth / 2;
      viewport.scrollTop += after.top + y * after.height - bounds.top - viewport.clientHeight / 2;
    });
    slider.addEventListener("input", () => { fitting = false; redraw(); });
    button.addEventListener("click", () => { fitting = true; viewport.scrollLeft = viewport.scrollTop = 0; redraw(); });
    function resize() { sizeViewport(); if (fitting) redraw(); }
    if (window.ResizeObserver) {
      const observer = new window.ResizeObserver(resize);
      observer.observe(viewport);
      if (panel) observer.observe(panel);
    }
    window.addEventListener?.("resize", resize);
    sizeViewport();
    return { geometry, apply };
  }
  window.SpherexView = { fit, create, viewportHeight };
})();
/* Existing preview/PNG endpoints plus bounded raw-pixel display metadata. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  // Explicit development override only. Legacy storage is intentionally never read.
  const apiOrigin = localPage
    ? new URLSearchParams(location.search || "").get("devApiOrigin") || "http://127.0.0.1:8015"
    : "https://planet-x-spherex.onrender.com";
  let result = null, mode = "black", busy = false, scienceDisplay = null, wcsAxes = null, previewMetadata = null, colorScale = null;
  let displayPlan = { factor: 1, stageScale: 1 };
  const view = window.SpherexView.create({ viewport: $("viewport"), stage: $("preview-stage"), frame: $("preview-frame"),
    slider: $("zoom"), button: $("fit-view"), output: $("zoom-value"), image: () => result ? $("preview") : null, redraw: () => { if (result) zoom(); } });
  function colorBar() {
    const axes = window.SpherexAxes.layout(wcsAxes, $("preview").naturalWidth, $("preview").naturalHeight, displayPlan.factor);
    const size = window.SpherexColorBar.render($("preview-colorbar"), colorScale, axes,
      "", $("preview-scale-note"), displayPlan.stacked);
    view.apply(size, displayPlan);
  }
  function redrawBrightness() {
    if (!scienceDisplay) return;
    try {
      const loText = $("minimum-number").value.trim(), hiText = $("maximum-number").value.trim();
      if (!loText || !hiText) throw Error("Enter a minimum and maximum.");
      const lo = Number(loText), hi = Number(hiText);
      const pixels = window.SpherexBrightness.rgba(scienceDisplay, lo, hi, $("stretch").value, mode === "white", $("quality-overlay").checked);
      const canvas = document.createElement("canvas");
      [canvas.height, canvas.width] = scienceDisplay.shape;
      const context = canvas.getContext("2d"), frame = context.createImageData(canvas.width, canvas.height);
      frame.data.set(pixels); context.putImageData(frame, 0, 0);
      $("preview").src = canvas.toDataURL("image/png");
      for (const id of ["minimum", "maximum"]) {
        $(id).min = Math.min(scienceDisplay.min, scienceDisplay.lo, lo);
        $(id).max = Math.max(scienceDisplay.max, scienceDisplay.hi, hi);
      }
      $("minimum").value = lo; $("maximum").value = hi;
      $("brightness-status").textContent = `${$("stretch").value} · ${window.SpherexUI.number(lo)} – ${window.SpherexUI.number(hi)} MJy/sr`;
      colorScale = window.SpherexColorBar.preview(previewMetadata, { lo, hi, stretch: $("stretch").value }, mode === "white");
      colorBar();
      window.SpherexUI.fields($("preview-display-details"), { "Brightness stretch": $("stretch").value,
        "Display range (MJy/sr)": window.SpherexUI.number(lo) + " to " + window.SpherexUI.number(hi) });
      return true;
    } catch (error) { $("brightness-status").textContent = error.message; return false; }
  }
  function resetBrightness() {
    if (!scienceDisplay) return;
    $("minimum-number").value = String(scienceDisplay.lo);
    $("maximum-number").value = String(scienceDisplay.hi);
    $("stretch").value = "linear";
    redrawBrightness();
  }
  function setupBrightness(display) {
    scienceDisplay = display?.available && window.SpherexBrightness ? display : null;
    $("brightness").hidden = !scienceDisplay; $("brightness-controls").hidden = !scienceDisplay;
    $("display-note").textContent = scienceDisplay ? "Gaps show missing or excluded pixels, rather than zero brightness." : display?.reason || "Image preview available; brightness controls are unavailable.";
    if (!scienceDisplay) {
      colorScale = window.SpherexColorBar.preview(previewMetadata, null, mode === "white"); colorBar(); return;
    }
    const { counts, edges } = display.histogram;
    const { peak } = window.SpherexBrightness.histogram($("histogram"), display, $("histogram-x"), $("histogram-y"));
    $("histogram-range").textContent = `Horizontal: ${window.SpherexUI.number(edges[0])} – ${window.SpherexUI.number(edges.at(-1))} MJy/sr; vertical: 0 – ${peak} pixels; total ${counts.reduce((a, b) => a + b, 0)}. ${display.fallback ? `Range safeguard: ${display.fallback}` : ""}`;
    resetBrightness();
  }
  for (const id of ["minimum", "maximum"]) $(id).addEventListener("input", () => { $(id + "-number").value = $(id).value; redrawBrightness(); });
  for (const id of ["minimum-number", "maximum-number", "stretch", "quality-overlay"]) $(id).addEventListener("change", redrawBrightness);
  $("reset-brightness").addEventListener("click", resetBrightness);
  function status(message, state = "idle") {
    $("status").textContent = message;
    $("status").dataset.state = state;
  }
  function apiBase() {
    let url;
    try { url = new URL(apiOrigin); } catch { throw new Error("Invalid development API origin. Use a complete http(s) origin."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
      throw new Error("The development API origin must use http(s) without a path, credentials, or query parameters.");
    }
    if (location.protocol === "https:" && url.protocol !== "https:") {
      throw new Error("An HTTPS frontend requires an HTTPS API connection.");
    }
    return url.origin;
  }
  function payload() {
    const values = ["ra", "dec", "radius"].map(id => $(id).value.trim());
    const [ra, dec, radiusArcmin] = values.map(Number);
    const radius_deg = radiusArcmin / 60;
    if (values.some(v => !v) || ![ra, dec, radius_deg].every(Number.isFinite) || ra < 0 || ra >= 360 || dec < -90 || dec > 90 || radius_deg <= 0 || radius_deg > 5 / 60) {
      throw new Error("Check coordinates: 0 ≤ RA < 360 and −90 ≤ Dec ≤ 90. The radius must be greater than 0 and at most 5 arcmin.");
    }
    const detector = $("detector").value;
    if (detector && !/^[1-6]$/.test(detector)) throw new Error("Select Auto or D1–D6.");
    return detector ? { ra, dec, radius_deg, detector: Number(detector) } : { ra, dec, radius_deg };
  }
  function controls() {
    $("brightness").disabled = busy || !scienceDisplay;
    for (const id of ["black", "white", "zoom", "fit-view"]) $(id).disabled = busy || !result;
    for (const id of ["search", "detector", "explorer-mode", "cutout-profile"]) $(id).disabled = busy;
    $("search").textContent = busy ? "Fetching NASA images…" : "Search NASA images ↗";
    $("viewport").setAttribute("aria-busy", String(busy));
  }
  function zoom() {
    displayPlan = view.geometry($("preview").naturalWidth, $("preview").naturalHeight);
    const { factor } = displayPlan;
    $("preview").style.width = `${$("preview").naturalWidth * factor}px`;
    $("preview").style.height = `${$("preview").naturalHeight * factor}px`;
    const axes = window.SpherexAxes.render($("preview-axes"), wcsAxes, $("preview").naturalWidth, $("preview").naturalHeight, factor);
    $("preview").style.left = `${axes.margin.left}px`; $("preview").style.top = `${axes.margin.top}px`;
    colorBar();
  }

  function imageUrl(base, value) {
    // Keep image requests on the chosen API. Reverse proxies may return an
    // internal HTTP hostname; only the endpoint path is needed by this client.
    const url = new URL(value, base);
    if (!/^\/api\/images\/[0-9a-f]{32}(?:-inverse)?\.png$/.test(url.pathname)) throw new Error("The API returned an invalid PNG path.");
    return base + url.pathname;
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = $("preview");
      const timer = setTimeout(() => { clean(); img.removeAttribute("src"); reject(new Error("PNG loading timed out. Search again.")); }, 30000);
      function clean() { clearTimeout(timer); img.onload = null; img.onerror = null; }
      img.onload = () => { clean(); resolve(); };
      img.onerror = () => { clean(); reject(new Error("Could not load the PNG. The cache may have expired or the backend may have restarted. Search again.")); };
      img.src = url;
    });
  }
  function metadata(data) {
    const m = data.metadata, sia = m.sia || {};
    const summary = [
      ["Observation UTC", m.t_min_utc ?? m.observation?.["DATE-OBS"]],
      ["Detector", m.detector ?? sia.detector],
      ["Wavelength (μm)", m.target_spectral?.available && m.target_spectral.units?.every(u => u === "um") ? m.target_spectral.wavelength : null],
      ["Valid pixel count", m.valid_pixels],
      ["Status", m.valid_pixels === 0 ? "No valid pixels" : "Image loaded"]
    ];
    $("observation-summary").replaceChildren();
    const cutout = $("preview-cutout-details");
    cutout.hidden = m.requested_cutout_arcmin == null;
    cutout.textContent = `Requested: ${m.requested_cutout_arcmin} arcmin (${m.cutout_profile}) · FITS (y × x): ${m.actual_shape_yx?.join(" × ") || "Unavailable"} · WCS span (horizontal × vertical): ` + (m.wcs_field?.available
      ? `${window.SpherexUI.number(m.wcs_field.horizontal_arcmin)} × ${window.SpherexUI.number(m.wcs_field.vertical_arcmin)} arcmin (sampled centre lines)` : "Unavailable");
    for (const [label, value] of summary) {
      if (label === "Valid pixel count" && value == null) continue;
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = window.SpherexUI.number(value) ?? "Not available";
      $("observation-summary").append(dt, dd);
    }
    window.SpherexUI.fields($("metadata"), { ...window.SpherexUI.details(m, null, true), "Warnings": null });
    window.SpherexUI.fields($("technical-metadata"), {
      "Data quality": m.display?.reason,
      "WCS status": m.wcs_axes?.available === false ? "WCS unavailable" : null,
      "Cutout coverage": m.wcs_field?.coverage_note,
      "WCS span method": m.wcs_field?.method
    });
    $("scientific-limitations").hidden = $("technical-metadata").hidden;
    if (!scienceDisplay) window.SpherexUI.fields($("preview-display-details"), {
      "Brightness stretch": m.stretch?.method, "Display range (MJy/sr)": m.stretch?.p1 != null && m.stretch?.p99 != null ? m.stretch.p1 + " to " + m.stretch.p99 : null });
    $("preview-warnings").textContent = [...new Set([m.truncated ? "Search incomplete; only retrieved candidates are shown." : "", ...(m.warnings || []), m.calibration?.warning, m.alignment?.reason].filter(Boolean))].join(" ");
    $("preview-warnings").hidden = !$("preview-warnings").textContent;
    $("info").hidden = false;
  }
  function display() {
    if (!scienceDisplay) colorScale = window.SpherexColorBar.preview(previewMetadata, null, mode === "white");
    $("preview-stage").hidden = false; $("preview-frame").hidden = false;
    $("preview").hidden = false; $("placeholder").hidden = true;
    $("viewport").classList.toggle("light", mode === "white");
    $("black").setAttribute("aria-pressed", String(mode === "black"));
    $("white").setAttribute("aria-pressed", String(mode === "white"));
    $("image-size").textContent = `PNG · ${$("preview").naturalWidth} × ${$("preview").naturalHeight}`;
    zoom();
  }
  async function switchMode(next) {
    if (!result || busy || next === mode) return;
    if (scienceDisplay) { const previous = mode; mode = next; if (redrawBrightness()) display(); else mode = previous; return; }
    busy = true; controls(); $("preview").hidden = true;
    status("Switching PNG…", "loading");
    try { await loadImage(next === "black" ? result.black : result.white); mode = next; display(); status("Image loaded. Switch display modes or adjust zoom.", "success"); }
    catch (e) { result = null; $("preview-stage").hidden = true; $("preview-frame").hidden = true; $("info").hidden = true; $("placeholder").hidden = false; $("image-size").textContent = "PNG · —"; status(e.message, "error"); }
    finally { busy = false; controls(); }
  }
  $("black").addEventListener("click", () => switchMode("black"));
  $("white").addEventListener("click", () => switchMode("white"));
  async function requestPreview(event) {
    event.preventDefault(); if (busy) return;
    if (window.SpherexEpochs?.active()) return window.SpherexEpochs.search();
    let base, body;
    try {
      base = apiBase(); body = payload();
      const profile = $("cutout-profile").value || "small";
      if (!["small", "medium"].includes(profile)) throw new Error("Select Small or Medium Cutout Size.");
      // Omit the default for compatibility with older Preview API deployments.
      if (profile !== "small") body.cutout_profile = profile;
    } catch (e) { status(e.message, "error"); return; }
    busy = true; result = null; scienceDisplay = null; $("brightness").hidden = true; $("brightness-controls").hidden = true; $("preview-scale-note").textContent = ""; $("display-note").textContent = ""; controls();
    wcsAxes = null; $("preview-stage").hidden = true; $("preview-frame").hidden = true; $("preview-axes").replaceChildren();
    previewMetadata = null; colorScale = null; $("preview-colorbar").replaceChildren();
    $("preview-cutout-details").hidden = true;
    $("preview").hidden = true; $("info").hidden = true; $("placeholder").hidden = false;
    $("viewport").classList.remove("light"); $("image-size").textContent = "PNG · —";
    status("Querying NASA and generating a PNG. This may take a few minutes; a Render cold start may add to the wait.", "loading");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(`${base}/api/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal, credentials: "omit" });
      let data;
      try { data = await response.json(); } catch { throw new Error(`The image service returned an unexpected response (invalid JSON; HTTP ${response.status}). Please try again shortly; the service may be starting up or temporarily unavailable.`); }
      if (!response.ok) {
        const code = data.error?.code;
        if (code === "no_images") { status("No images found in this search area. Adjust the coordinates or radius and try again.", "empty"); return; }
        const retry = response.headers.get("Retry-After");
        const hint = code === "busy" ? `The backend is busy. ${retry ? `Wait as specified by Retry-After (${retry})` : "Wait a moment"}, then retry manually.` : data.error?.message || "API request failed";
        throw new Error(`${hint} (HTTP ${response.status}${code ? ` / ${code}` : ""})`);
      }
      if (!data.metadata || typeof data.metadata !== "object" || !data.image_url || !data.inverted_image_url) throw new Error("The API response is missing images or metadata.");
      const images = { black: imageUrl(base, data.image_url), white: imageUrl(base, data.inverted_image_url) };
      await loadImage(mode === "black" ? images.black : images.white);
      wcsAxes = data.metadata.wcs_axes;
      previewMetadata = data.metadata;
      result = images; $("preview").alt = `SPHEREx infrared observation at RA ${body.ra}°, Dec ${body.dec}°`;
      display(); metadata(data); setupBrightness(data.metadata.display); status("Image loaded. Switch display modes or adjust zoom.", "success");
    } catch (e) {
      status(e.name === "AbortError" ? "The API did not respond within 180 seconds. Retry later; backend processing may still be running." : e instanceof TypeError ? "Could not connect to the image service. Check your connection and try again shortly. The service may be starting up or temporarily unavailable." : e.message, "error");
    } finally { clearTimeout(timer); busy = false; controls(); }
  }
  $("search-form").addEventListener("submit", requestPreview);
  $("cutout-profile").addEventListener("change", () => {
    if (result && !busy && !window.SpherexEpochs?.active()) return requestPreview({ preventDefault() {} });
  });
  window.SpherexEpochs?.mount({ apiBase, payload, refreshPreview: () => { if (result) zoom(); } });
})();
