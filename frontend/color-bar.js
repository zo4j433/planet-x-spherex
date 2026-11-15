/* Physical values mapped through the same display stretch as the image. */
(() => {
  "use strict";
  const unitIsSupported = unit => typeof unit === "string" && unit.replaceAll(" ", "") === "MJy/sr";
  function mapping({ lo, hi, stretch, a, denominator, unit, inverse = false, rounding = "half_up" } = {}) {
    const span = hi - lo;
    if (!unitIsSupported(unit) || ![lo, hi, span, denominator].every(Number.isFinite) || span <= 0
      || denominator <= 0 || denominator < span || !["linear", "asinh", "log", "sqrt"].includes(stretch)
      || (stretch === "asinh" && (!Number.isFinite(a) || a <= 0)) || typeof inverse !== "boolean"
      || !["half_up", "nearest_even"].includes(rounding)) return null;
    return { lo, hi, stretch, a: stretch === "asinh" ? a : null, denominator, unit: "MJy/sr", inverse, rounding };
  }
  function preview(metadata, controls, inverse = false) {
    const display = metadata?.display;
    if (metadata?.valid_pixels === 0) return null;
    if (controls) {
      if (!display?.available || !Array.isArray(display.values) || !Array.isArray(display.valid)
        || !display.values.some((v, i) => display.valid[i] === true && Number.isFinite(v))) return null;
      return mapping({ ...controls, a: 10, denominator: controls.hi - controls.lo, unit: display.unit, inverse });
    }
    // Legacy PNGs declare their actual stretch separately from the client default.
    const stretch = metadata?.stretch;
    if (stretch?.method !== "asinh(10x)") return null;
    const unit = display?.unit ?? metadata?.observation?.BUNIT;
    return mapping({ lo: stretch.p1, hi: stretch.p99, stretch: "asinh", a: 10,
      denominator: stretch.p99 - stretch.p1, unit, inverse, rounding: "nearest_even" });
  }
  function epoch(sequence, frame) {
    if (!sequence || !frame || !unitIsSupported(sequence.normalization?.bunit)) return null;
    const fromFrame = f => !f?.normalization?.rounding || (f.bunit && !unitIsSupported(f.bunit)) ? null
      : mapping({ ...f?.normalization, unit: sequence.normalization.bunit });
    const current = fromFrame(frame);
    if (!current) return null;
    if (sequence.mode === "observation_browse") return current;
    if (sequence.mode !== "comparable_visualization") return null;
    const shared = sequence.normalization;
    if (current.lo !== shared.lo || current.hi !== shared.hi) return null;
    // Never advertise a common bar if any delivered frame declares another map.
    const delivered = sequence.frames?.filter(f => f.image_url);
    if (!delivered?.length || !delivered.every(f => {
      const candidate = fromFrame(f);
      return candidate && JSON.stringify(candidate) === JSON.stringify(current);
    })) return null;
    return current;
  }
  function gray(scale, value) {
    if (!scale || !Number.isFinite(value)) return null;
    let fraction = Math.max(0, Math.min(1, (value - scale.lo) / scale.denominator));
    if (scale.stretch === "asinh") fraction = Math.asinh(scale.a * fraction) / Math.asinh(scale.a);
    if (scale.stretch === "sqrt") fraction = Math.sqrt(fraction);
    if (scale.stretch === "log") fraction = Math.log1p(1000 * fraction) / Math.log1p(1000);
    const scaled = 255 * fraction, lower = Math.floor(scaled);
    const result = scale.rounding === "nearest_even" && scaled - lower === .5 ? lower + lower % 2 : Math.round(scaled);
    return scale.inverse ? 255 - result : result;
  }
  function ramp(scale, rows = 256, columns = 18) {
    const pixels = new Uint8ClampedArray(rows * columns * 4);
    if (!scale) return pixels;
    for (let y = 0; y < rows; y++) {
      const value = y === 0 ? scale.hi : y === rows - 1 ? scale.lo : scale.lo + (scale.hi - scale.lo) * (1 - y / (rows - 1));
      const shade = gray(scale, value);
      for (let x = 0; x < columns; x++) {
        const offset = (y * columns + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade; pixels[offset + 3] = 255;
      }
    }
    return pixels;
  }
  const format = (value, scale) => {
    const step = (scale.hi - scale.lo) / 4;
    const magnitude = Math.max(Math.abs(scale.lo), Math.abs(scale.hi));
    // Keep close scientific endpoints distinguishable even when six digits
    // would collapse them to the same label.
    const precision = step > 0 ? Math.min(17, Math.max(6, Math.ceil(Math.log10(magnitude) - Math.log10(step)) + 2)) : 17;
    return Number(value.toPrecision(precision)).toString();
  };
  function measure(axes, includeNote = true, stacked = false) {
    const height = stacked ? 128 : Math.max(128, Math.min(512, axes.height));
    const axesWidth = axes.width + axes.margin.left + axes.margin.right;
    const left = stacked ? Math.max(0, Math.min(axes.margin.left, axesWidth - 210)) : axes.margin.left + axes.width + 30;
    const top = stacked ? axes.height + axes.margin.top + axes.margin.bottom + 12 : Math.max(0, axes.margin.top + (axes.height - height) / 2 - 24);
    return { left, top, barHeight: height,
      width: Math.max(axes.width + axes.margin.left + axes.margin.right, left + 210),
      height: Math.max(axes.height + axes.margin.top + axes.margin.bottom, top + height + (includeNote ? 140 : 52)) };
  }
  function render(host, scale, axes, note, noteHost, stacked = false) {
    host.replaceChildren();
    if (noteHost) noteHost.textContent = "";
    const size = measure(axes, !noteHost, stacked), { left, top, barHeight: height } = size;
    host.style.left = `${left}px`; host.style.top = `${top}px`;
    const add = (tag, className, text) => {
      const node = document.createElement(tag); node.className = className;
      if (text !== undefined) node.textContent = text;
      host.append(node); return node;
    };
    add("div", "colorbar-title", "Surface Brightness (MJy/sr)");
    if (!scale) {
      add("p", "colorbar-note", "Color Bar unavailable");
    } else {
      const body = add("div", "colorbar-body"); body.style.height = `${height}px`;
      const canvas = document.createElement("canvas"); canvas.width = 18; canvas.height = 256;
      canvas.style.height = `${height}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${scale.stretch} grayscale: ${scale.lo} to ${scale.hi} MJy/sr${scale.inverse ? ", inverted" : ""}`);
      const context = canvas.getContext("2d"), image = context.createImageData(18, 256);
      image.data.set(ramp(scale)); context.putImageData(image, 0, 0); body.append(canvas);
      for (const fraction of [0, .25, .5, .75, 1]) {
        const tick = document.createElement("span"); tick.className = "colorbar-tick";
        tick.style.top = `${(1 - fraction) * height}px`;
        tick.textContent = format(fraction === 1 ? scale.hi : scale.lo + (scale.hi - scale.lo) * fraction, scale);
        body.append(tick);
      }
      const explanation = `${scale.stretch === "asinh" ? `Asinh (${scale.a}x)` : scale.stretch === "log" ? "Log (1000x)" : scale.stretch === "sqrt" ? "Sqrt" : "Linear"}${scale.inverse ? "; inverted" : ""}${note ? `. ${note}` : ""}`;
      if (noteHost) noteHost.textContent = explanation;
      else add("p", "colorbar-note", explanation);
    }
    return { width: size.width, height: size.height };
  }
  window.SpherexColorBar = Object.freeze({ mapping, preview, epoch, gray, ramp, measure, render });
})();
