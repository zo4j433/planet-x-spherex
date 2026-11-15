/* Bounded multi-epoch viewer. PNGs are fetched once per explicit Load frames. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let brightnessRanges = new Map(), epochStretch = null, loadGeneration = 0;
  let view, returnFocus = null, previousOverflow = "", loadedSelection = null, expiresAt = null;
  function openSelection() {
    if (!products.length || $("observations-modal").open) return;
    if (!snapshot || (expiresAt && Date.parse(expiresAt) <= Date.now())) status("The search snapshot has expired. Search epochs again before loading a new selection.", true);
    returnFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    $("observations-modal").showModal();
    $("observations-title").focus();
  }
  function dismissSelection() { loadGeneration++; closeSelection(); }
  function closeSelection() { $("observations-modal").close(); }
  let context, snapshot = null, query = null, base = "", cursor = null, working = false;
  let products = [], selected = new Set(), slots = [], position = 0, timer = null, wcsAxes = null, sequenceDisplay = null;
  const active = () => $("explorer-mode").value === "epochs";
  const sources = p => (p.source_collections || [p.obs_collection]).filter(Boolean).join(", ") || "Not available";
  // Move only these known general scope notes into Observation Details.
  // Unknown warnings remain visible beside the sequence.
  const scopeWarnings = new Set([
    "Visualization only; target bandpass is not full-field equivalence. No PSF/background/variance correction or light-curve inference."
  ]);
  const scopeNote = "Wavelength matching applies at the target position, not across the whole image. Differences in image sharpness, background and measurement uncertainty are not corrected.";
  const mjdTime = p => Number.isFinite(p.t_min) ? new Date((p.t_min - 40587) * 86400000).toISOString() : "Time not available";
  const date = p => p.observation_utc || mjdTime(p);
  const errorText = error => typeof error === "object" && error ? [error.code, error.message].filter(Boolean).join(": ") : String(error);
  const order = (a, b) => {
    const time = p => Number.isFinite(Date.parse(p.observation_utc)) ? Date.parse(p.observation_utc) : Number.isFinite(p.t_min) ? (p.t_min - 40587) * 86400000 : Infinity;
    return time(a) - time(b) || a.product_id.localeCompare(b.product_id);
  };
  const exposure = p => typeof p.obs_id === "string" ? p.obs_id.trim() : "";
  const eligible = p => [1, 2, 3, 4, 5, 6].includes(p.detector)
    && typeof p.product_id === "string" && p.product_id.trim()
    && exposure(p) && !/^(unknown(?:[-_ ].*)?|未知|n\/a|null|none|undefined)$/i.test(exposure(p));
  function visibleProducts() {
    if (!snapshot) return [];
    const chosen = products.filter(p => selected.has(p.product_id));
    const compatible = products.filter(p => eligible(p) && (!chosen.length || p.detector === chosen[0].detector));
    const representatives = new Map();
    // Preserve a selected representative across pagination; otherwise use the
    // first returned product, without implying scientific version preference.
    for (const p of [...compatible.filter(p => selected.has(p.product_id)), ...compatible]) {
      if (!representatives.has(exposure(p))) representatives.set(exposure(p), p);
    }
    return [...representatives.values()].filter(p => selected.has(p.product_id) || chosen.length < 3).sort(order);
  }
  function firstProducts(count) {
    const visible = visibleProducts();
    return visible.filter(p => p.detector === visible[0]?.detector).slice(0, count);
  }
  function selectFirst(count) {
    if (working || !snapshot) return;
    const first = firstProducts(count);
    if (first.length !== count) return;
    selected = new Set(first.map(p => p.product_id));
    renderProducts(); controls();
  }
  function status(message, error = false) {
    $("epochs-status").textContent = message;
    $("modal-status").textContent = message;
    $("epochs-status").dataset.state = error ? "error" : "idle";
  }
  function pause() {
    clearInterval(timer); timer = null;
    $("epoch-play").textContent = "Play"; $("epoch-play").setAttribute("aria-pressed", "false");
  }
  function clearFrames() {
    pause();
    for (const slot of slots) if (slot.url) URL.revokeObjectURL(slot.url);
    slots = []; position = 0; loadedSelection = null;
    wcsAxes = null; $("epoch-image").replaceChildren(); $("epoch-axes").replaceChildren(); $("epoch-player").hidden = true;
    brightnessRanges.clear(); epochStretch = null; $("epoch-brightness-controls").hidden = true;
    sequenceDisplay = null; $("epoch-colorbar").replaceChildren(); $("epoch-frame").hidden = true;
    $("epoch-view-note").hidden = false;
    $("epoch-information").hidden = true;
    $("sequence-warning").textContent = ""; $("epoch-scale-note").textContent = "";
  }
  function controls() {
    for (const id of ["search", "detector", "explorer-mode", "ra", "dec", "radius"]) $(id).disabled = working;
    $("search").textContent = working ? "Processing multi-epoch data…" : active() ? "Search epochs" : "Search NASA images ↗";
    $("load-frames").disabled = working || !snapshot || selected.size < 2 || selected.size > 3;
    $("change-selection").disabled = working || !products.length;
    $("change-selection").textContent = slots.length ? "Change Selection" : "Select Observations";
    $("change-selection").title = products.length ? "Choose from existing search results" : "Search epochs first to find available observations";
    $("epoch-fit-view").disabled = $("epoch-zoom").disabled = !slots.length;
    $("clear-selection").disabled = working;
    $("epochs-more").disabled = working || !cursor;
    for (const count of [2, 3]) $("select-first-" + count).disabled = working || firstProducts(count).length !== count;
    $("epoch-products").setAttribute("aria-busy", String(working));
  }
  function renderProducts() {
    const focusId = document.activeElement?.dataset?.productId;
    $("epoch-products").replaceChildren();
    const visible = visibleProducts();
    for (const p of visible) {
      const tr = document.createElement("tr"), cell = document.createElement("td"), check = document.createElement("input");
      tr.dataset.productId = p.product_id;
      check.dataset.productId = p.product_id;
      check.type = "checkbox"; check.checked = selected.has(p.product_id);
      check.setAttribute("aria-label", `${date(p)} D${p.detector} ${p.obs_id || p.product_id}`);
      check.disabled = working;
      check.addEventListener("change", () => {
        if (working || check.disabled) return;
        if (check.checked) selected.add(p.product_id); else selected.delete(p.product_id);
        renderProducts(); controls();
      });
      cell.append(check); tr.append(cell);
      const needsReview = p.warnings?.length || p.error || p.calibration_status;
      for (const value of [date(p), p.detector == null ? "Unknown" : `D${p.detector}`, `${String(p.frame_status || "not_requested").replaceAll("_", " ")}${needsReview ? "; review details" : ""}`]) {
        const td = document.createElement("td"); td.textContent = value; tr.append(td);
      }
      const detailCell = document.createElement("td"), details = document.createElement("details"), heading = document.createElement("summary");
      heading.textContent = "Details";
      const description = document.createElement("p"), metadata = document.createElement("dl");
      description.textContent = `${sources(p)} · ${p.obs_id || "Unknown exposure (unavailable for selection)"} · ${String(p.frame_status || "not_requested").replaceAll("_", " ")} · ${p.calibration_status || ""}`;
      window.SpherexUI.fields(metadata, window.SpherexUI.details(p));
      details.append(heading, description, metadata); detailCell.append(details); tr.append(detailCell);
      $("epoch-products").append(tr);
      if (focusId === p.product_id) check.focus();
    }
    $("epoch-selection").textContent = `Selected ${selected.size} / 3; showing ${visible.length} available exposures.`;
    $("epochs-more").hidden = !cursor;
  }
  async function request(path, body, png = false) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), png ? 30000 : 180000);
    try {
      const response = await fetch(base + path, { method: png ? "GET" : "POST", headers: png ? {} : { "Content-Type": "application/json" }, ...(png ? {} : { body: JSON.stringify(body) }), signal: controller.signal, credentials: "omit" });
      if (png && response.ok) return await response.blob();
      let data;
      try { data = await response.json(); } catch { throw Error(`The image service returned an unexpected response (invalid JSON; HTTP ${response.status}). Please try again shortly; the service may be starting up or temporarily unavailable.`); }
      if (!response.ok) {
        const code = data.error?.code || "request_failed", retry = response.headers.get("Retry-After");
        const error = Error(`${data.error?.message || "Request failed"} (HTTP ${response.status} / ${code})${retry ? `; Retry-After: ${retry}. Wait, then retry manually.` : ""}`);
        error.code = code; throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function message(error) {
    if (["search_expired", "invalid_cursor", "frame_not_found"].includes(error.code)) return `${error.message}; the search or frame cache has expired. Search epochs again, select products, then select Load frames.`;
    if (error.name === "AbortError") return "The request timed out. Backend processing may still be running. Retry manually later.";
    if (error instanceof TypeError) return "Could not connect to the image service. Check your connection and try again shortly. The service may be starting up or temporarily unavailable.";
    return error.message;
  }
  async function search(more = false) {
    if (working) return;
    pause();
    if (!more) {
      clearFrames(); snapshot = null; cursor = null; products = []; selected.clear();
      $("epochs-sources").textContent = "";
    }
    try {
      if (!more) {
        base = context.apiBase(); const { detector, ...coordinates } = context.payload();
        query = { ...coordinates, ...(detector ? { detectors: [detector] } : {}), limit: 100 };
      }
      working = true; controls(); renderProducts(); status("Searching epoch metadata without downloading FITS…");
      const data = await request("/api/epochs/search", { ...query, ...(more ? { cursor } : {}) });
      if (!data.search_id || !Array.isArray(data.products) || (more && data.search_id !== snapshot)) throw Error("The API search response is missing products or has an inconsistent snapshot. Search again.");
      expiresAt = data.expires_at || null;
      snapshot = data.search_id; cursor = data.pagination?.next_cursor || null;
      const merged = new Map(products.map(p => [p.product_id, p]));
      data.products.forEach(p => merged.set(p.product_id, p)); products = [...merged.values()];
      $("epochs-sources").textContent = `Sources: ${(data.collections || []).map(c => `${c.name}: ${c.status}${c.truncated ? " (truncated)" : ""}${c.error ? ` ${errorText(c.error)}` : ""}`).join("; ")}. ${data.complete === false ? "Search incomplete; only retrieved candidates are shown." : ""}`;
      $("modal-sources").textContent = $("epochs-sources").textContent;
      if (products.length) openSelection();
      status(products.length ? `Found ${products.length} products${cursor ? "; more epochs are available" : ""}. Select products manually.` : "No observation products are available in this area.");
    } catch (error) {
      if (["search_expired", "invalid_cursor"].includes(error.code)) { snapshot = null; cursor = null; }
      status(message(error), true);
    } finally { working = false; renderProducts(); controls(); }
  }
  function describe(slot) {
    const f = slot.frame;
    return `slot ${f.index} · ${f.status || "Not available"} · alignment: ${f.alignment?.status || "Not available"}${slot.error ? ` · ${slot.error}` : ""}`;
  }
  function zoom() {
    const current = slots[position];
    if (current) {
      const [height, width] = current.image ? [current.image.naturalHeight, current.image.naturalWidth] : wcsAxes?.shape_yx || [29, 29];
      const plan = view.geometry(width, height), { factor } = plan;
      if (current.image) {
        current.image.style.width = `${width * factor}px`; current.image.style.height = `${height * factor}px`;
      }
      $("epoch-image").style.width = `${width * factor}px`; $("epoch-image").style.height = `${height * factor}px`;
      const axes = window.SpherexAxes.render($("epoch-axes"), wcsAxes, width, height, factor);
      $("epoch-image").style.left = `${axes.margin.left}px`; $("epoch-image").style.top = `${axes.margin.top}px`;
      const range = brightnessRanges.get(rangeKey(current));
      const scale = current.image ? range ? window.SpherexColorBar.mapping({ ...range, stretch: epochStretch || "asinh", a: 10, denominator: range.hi - range.lo, unit: "MJy/sr" }) : window.SpherexColorBar.epoch(sequenceDisplay, current.frame) : null;
      const note = "";
      const size = window.SpherexColorBar.render($("epoch-colorbar"), scale, axes, note, $("epoch-scale-note"), plan.stacked);
      view.apply(size, plan);
    }
  }
  const rangeKey = slot => sequenceDisplay?.mode === "comparable_visualization" ? "shared" : slot.frame.product_id;
  function applyBrightness() {
    const slot = slots[position], display = slot?.frame.display;
    if (!slot?.image || !display?.available || !brightnessRanges.has(rangeKey(slot))) return;
    const { lo, hi } = brightnessRanges.get(rangeKey(slot));
    const pixels = window.SpherexBrightness.rgba(display, lo, hi, epochStretch || "asinh", false, false);
    const canvas = document.createElement("canvas"); [canvas.height, canvas.width] = display.shape;
    const ctx = canvas.getContext("2d"), frame = ctx.createImageData(canvas.width, canvas.height);
    frame.data.set(pixels); ctx.putImageData(frame, 0, 0); slot.image.src = canvas.toDataURL("image/png");
  }
  function brightness() {
    const slot = slots[position], display = slot?.frame.display;
    $("epoch-brightness-controls").hidden = !slot?.image || !display?.available;
    if (!slot?.image || !display?.available) return;
    const range = brightnessRanges.get(rangeKey(slot)) || { lo: display.lo, hi: display.hi };
    $("epoch-minimum").value = String(range.lo); $("epoch-maximum").value = String(range.hi);
    $("epoch-stretch").value = epochStretch || "asinh";
    window.SpherexBrightness.histogram($("epoch-histogram"), display, $("epoch-histogram-x"), $("epoch-histogram-y"));
    applyBrightness();
  }
  function changeBrightness() {
    const slot = slots[position]; if (!slot?.frame.display?.available) return;
    try {
      const low = $("epoch-minimum").value.trim(), high = $("epoch-maximum").value.trim();
      const lo = Number(low), hi = Number(high), method = $("epoch-stretch").value;
      if (!low || !high) throw Error("Enter a minimum and maximum.");
      // Validate before updating either the image or the shared mapping.
      window.SpherexBrightness.rgba(slot.frame.display, lo, hi, method, false, false);
      epochStretch = method; brightnessRanges.set(rangeKey(slot), { lo, hi });
      // Apply the same stretch to each independent frame range when visited.
      for (const other of slots) if (other.frame.display?.available && !brightnessRanges.has(rangeKey(other)))
        brightnessRanges.set(rangeKey(other), { lo: other.frame.display.lo, hi: other.frame.display.hi });
      show(position); $("epoch-brightness-status").textContent = `${method}: ${lo} to ${hi} MJy/sr`;
    } catch (error) { $("epoch-brightness-status").textContent = error.message; }
  }
  function show(next) {
    if (!slots.length) return;
    position = (next + slots.length) % slots.length;
    $("epoch-time").value = String(position);
    $("epoch-position").textContent = `${position + 1} / ${slots.length} · ${date(slots[position].frame)}`;
    $("epoch-current").textContent = describe(slots[position]);
    const slot = slots[position], f = slot.frame;
    $("epoch-frame-warnings").textContent = [...new Set([...(f.warnings || []), f.alignment?.reason, f.calibration?.warning].filter(Boolean))].join(" ");
    $("epoch-frame-status").textContent = `Frame ${position + 1} / ${slots.length} · ${f.status || "Status unavailable"}${slot.error ? ` · ${slot.error}` : ""}`;
    $("epoch-summary").replaceChildren();
    const rows = [["Observation UTC", date(f)], ["Detector", f.detector == null ? null : `D${f.detector}`],
      ["Wavelength (μm)", f.target_wavelength_um],
      f.valid_pixels == null && Number.isFinite(f.valid_fraction) && f.valid_fraction >= 0 && f.valid_fraction <= 1
        ? ["Valid pixels (%)", window.SpherexUI.number(f.valid_fraction * 100)] : ["Valid pixel count", f.valid_pixels],
      ["Status", slot.error ? `Failed: ${slot.error}` : f.status]];
    for (const [label, value] of rows) {
      if (label === "Valid pixel count" && value == null) continue;
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = window.SpherexUI.number(value) ?? "Not available";
      $("epoch-summary").append(dt, dd);
    }
    const range = brightnessRanges.get(rangeKey(slot)) || f.display || f.normalization || {};
    window.SpherexUI.fields($("epoch-metadata"), { ...window.SpherexUI.details(f, sequenceDisplay),
      "Data quality": f.display?.reason,
      "WCS status": f.wcs_axes?.available === false ? "WCS unavailable" : null,
      "Brightness stretch": epochStretch || f.normalization?.stretch,
      "Display range (MJy/sr)": range.lo != null && range.hi != null ? range.lo + " to " + range.hi : null });
    $("epoch-image").replaceChildren(slots[position].image || slots[position].placeholder);
    brightness(); zoom();
  }
  function play() {
    pause(); if (slots.length < 2 || !slots.some(s => s.image)) return;
    $("epoch-play").textContent = "Pause"; $("epoch-play").setAttribute("aria-pressed", "true");
    timer = setInterval(() => show(position + 1), Number($("epoch-speed").value));
  }
  async function loadPng(frame, sequenceId) {
    if (!frame.image_url) throw Error(`${frame.error?.code || "frame_failed"}: ${frame.error?.message || "No PNG is available for this slot"}`);
    const path = new URL(frame.image_url, base).pathname;
    if (path !== `/api/epoch-frames/${sequenceId}/${frame.index}.png` || !/^[0-9a-f]{32}$/.test(sequenceId)) throw Error("The API returned an invalid frame PNG path.");
    const blob = await request(path, null, true), url = URL.createObjectURL(blob), img = document.createElement("img");
    img.alt = `Aligned observation · ${date(frame)} · ${frame.obs_id}`;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(Error("PNG decoding timed out. Search again.")); }, 30000);
        function cleanup() { clearTimeout(timeout); img.onload = null; img.onerror = null; }
        img.onload = () => { cleanup(); resolve(); };
        img.onerror = () => { cleanup(); reject(Error("Could not decode the PNG. Search again.")); };
        img.src = url;
      });
      return { image: img, url };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  async function load() {
    if (working || !snapshot || selected.size < 2 || selected.size > 3) return;
    const chosen = products.filter(p => selected.has(p.product_id)).sort(order);
    if (chosen.length !== selected.size || chosen.some(p => !eligible(p) || p.detector !== chosen[0].detector) || new Set(chosen.map(exposure)).size !== chosen.length) return;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      snapshot = null; cursor = null; status("The search snapshot has expired. Search epochs again before loading a new selection.", true); controls(); return;
    }
    const selectionKey = JSON.stringify([snapshot, chosen.map(p => p.product_id).sort()]);
    if (selectionKey === loadedSelection) { closeSelection(); status("This selection is already loaded. No frames were downloaded."); return; }
    const generation = loadGeneration;
    working = true; controls(); renderProducts(); status("Loading selected frames. FITS processing may take a few minutes…");
    try {
      const data = await request("/api/epoch-frames", { search_id: snapshot, product_ids: chosen.map(p => p.product_id) });
      if (generation !== loadGeneration) { status("Loading was cancelled. Previous images are retained."); return; }
      if (data.search_id !== snapshot || !Array.isArray(data.frames) || data.frames.length !== chosen.length || data.frames.some((f, i) => f.product_id !== chosen[i].product_id || f.index !== i)) throw Error("The frame API response does not match the selected slots. Search again.");
      const pendingSlots = await Promise.all(data.frames.map(async (frame, i) => {
        const slot = { frame: { ...chosen[i], ...frame } };
        try { Object.assign(slot, await loadPng(frame, data.sequence_id)); }
        catch (error) {
          slot.error = message(error); slot.placeholder = document.createElement("p");
          slot.placeholder.textContent = `Cannot display this slot: ${slot.error}`;
        }
        return slot;
      }));
      if (generation !== loadGeneration) {
        for (const slot of pendingSlots) if (slot.url) URL.revokeObjectURL(slot.url);
        status("Loading was cancelled. Previous images are retained."); return;
      }
      if (slots.some(s => s.image) && !pendingSlots.some(s => s.image)) {
        $("epoch-slots").replaceChildren();
        for (const slot of pendingSlots) { const li = document.createElement("li"); li.textContent = describe(slot); $("epoch-slots").append(li); }
        throw Error("The replacement selection could not be displayed. Previous images are retained. Failed replacement slots are listed in Observation Details.");
      }
      clearFrames(); slots = pendingSlots; loadedSelection = selectionKey;
      wcsAxes = data.wcs_axes; sequenceDisplay = data;
      $("change-selection").hidden = false;
      closeSelection();
      slots.sort((a, b) => order(a.frame, b.frame));
      $("sequence-mode").textContent = "Observations aligned on a common sky grid.";
      $("sequence-warning").textContent = [...new Set([
        data.mode === "comparable_visualization" ? "Shared brightness scale."
          : "Independent brightness scales; displayed intensities are not directly comparable.",
        data.wavelength_compatible === false ? "Wavelengths are not compatible for direct comparison." : "",
        data.calibration_compatible === false ? "Calibrations are not compatible for direct comparison." : "",
        ...(data.warnings || []).filter(warning => !scopeWarnings.has(warning))
      ].filter(Boolean))].join(" ");
      $("sequence-details").textContent = "Loaded frames remain available for offline playback. Search again if a new selection has expired.";
      window.SpherexUI.fields($("sequence-metadata"), {
        "Wavelength compatibility": data.wavelength_compatible == null ? null : data.wavelength_compatible ? "Compatible" : "Not compatible",
        "Calibration compatibility": data.calibration_compatible == null ? null : data.calibration_compatible ? "Compatible" : "Not compatible",
        "Warnings": data.warnings?.length ? [...new Set(data.warnings.map(warning => scopeWarnings.has(warning) ? scopeNote : warning))] : null
      });
      $("epoch-slots").replaceChildren();
      slots.forEach(slot => { const li = document.createElement("li"); li.textContent = describe(slot); $("epoch-slots").append(li); });
      $("epoch-time").max = String(slots.length - 1); $("epoch-player").hidden = false; $("epoch-frame").hidden = false; $("epoch-view-note").hidden = true;
      $("epoch-information").hidden = !active();
      $("epoch-play").disabled = !slots.some(s => s.image); show(0);
      status(`Loaded ${slots.filter(s => s.image).length} of ${slots.length} frames. Ready to explore.`);
    } catch (error) {
      if (error.code === "search_expired") { snapshot = null; cursor = null; }
      status(message(error), true);
    } finally { working = false; controls(); renderProducts(); }
  }
  function mount(shared) {
    context = shared;
    for (const id of ["epoch-stretch", "epoch-minimum", "epoch-maximum"]) $(id).addEventListener("change", changeBrightness);
    $("epoch-reset-brightness").addEventListener("click", () => {
      const d = slots[position]?.frame.display; if (!d?.available) return;
      $("epoch-minimum").value = String(d.lo); $("epoch-maximum").value = String(d.hi); $("epoch-stretch").value = "asinh"; changeBrightness();
    });
    $("change-selection").addEventListener("click", openSelection);
    for (const id of ["observations-close", "observations-cancel"]) $(id).addEventListener("click", dismissSelection);
    $("observations-modal").addEventListener("close", () => {
      document.body.style.overflow = previousOverflow;
      (returnFocus?.isConnected && !returnFocus.disabled ? returnFocus : slots.length ? $("epoch-viewport") : $("change-selection")).focus();
    });
    $("observations-modal").addEventListener("cancel", event => { event.preventDefault(); dismissSelection(); });
    $("observations-modal").addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const modal = $("observations-modal");
      const focusable = [...modal.querySelectorAll('button, input, select, summary, a[href], [tabindex="0"]')]
        .filter(node => !node.disabled && node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === $("observations-title"))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    $("clear-selection").addEventListener("click", () => { if (!working) { selected.clear(); renderProducts(); controls(); } });
    $("epoch-frame").hidden = true;
    view = window.SpherexView.create({ viewport: $("epoch-viewport"), stage: $("epoch-stage"), frame: $("epoch-frame"),
      slider: $("epoch-zoom"), button: $("epoch-fit-view"), output: $("epoch-zoom-value"), image: () => slots[position]?.image, redraw: zoom });
    $("explorer-mode").addEventListener("change", () => {
      pause(); $("preview-panel").hidden = active();
      $("epoch-view-panel").hidden = !active(); $("preview-summary").hidden = active(); $("preview-display-controls").hidden = active();
      $("epoch-information").hidden = !active() || !slots.length;
      shared.refreshPreview(); zoom(); controls();
    });
    $("load-frames").addEventListener("click", load);
    for (const count of [2, 3]) $("select-first-" + count).addEventListener("click", () => selectFirst(count));
    $("epochs-more").addEventListener("click", () => search(true));
    $("epoch-prev").addEventListener("click", () => { pause(); show(position - 1); });
    $("epoch-next").addEventListener("click", () => { pause(); show(position + 1); });
    $("epoch-time").addEventListener("input", () => { pause(); show(Number($("epoch-time").value)); });
    $("epoch-play").addEventListener("click", () => timer === null ? play() : pause());
    $("epoch-speed").addEventListener("change", () => { if (timer !== null) play(); });

  }
  window.SpherexEpochs = { mount, active, search: () => search(false) };
})();
