/* Scroll-driven product showcase
 *
 * Markup contract:
 *   <section class="scroll-seq" data-scroll-seq="iron" data-total="150">
 *     <div class="scroll-seq__sticky">
 *       <div class="scroll-seq__copy"> ... </div>
 *       <div class="scroll-seq__stage"><canvas></canvas></div>
 *     </div>
 *   </section>
 *
 * Frames live at /frames/<slug>/ezgif-frame-<NNN>.jpg (3-digit zero pad, 1-based).
 *
 * Behaviour:
 *   - Preloads frames with an 8-in-flight cap to avoid hammering the network.
 *   - Canvas pixel buffer tracks CSS box × DPR (clamped to 2) via ResizeObserver.
 *   - Scroll progress (0..1) is computed from the section's travel. The
 *     CSS gives this section ~150vh of scroll travel, so the playback feels
 *     slow and deliberate.
 *   - DISPLAYED frame index lerps toward the scroll target every animation
 *     frame. This means even on a fast scroll the rotation still plays back
 *     smoothly instead of jumping straight to the end — buttery Apple feel.
 *   - Draws are RAF-driven and short-circuit when the integer frame index
 *     hasn't changed since the last draw.
 *   - Errors (404, decode fail) are tolerated; the section still functions
 *     on whichever frames did load.
 */
(function () {
  const SELECTOR = '[data-scroll-seq]';
  const CONCURRENCY = 8;
  // Lerp factor: how much of the gap (target - displayed) is closed each tick.
  // 0.22 ≈ 95% caught up in ~13 frames at 60fps (~210ms). High enough that
  // slow scrolls track 1:1; low enough that fast flicks still ease in.
  const LERP_FACTOR = 0.22;
  // Tick stops when displayed is within this many frames of target.
  const SNAP_EPSILON = 0.25;

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll(SELECTOR).forEach(init);
  });

  function init(root) {
    const slug = root.dataset.scrollSeq;
    const total = parseInt(root.dataset.total || '150', 10);
    const canvas = root.querySelector('canvas');
    if (!slug || !canvas || total <= 0) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    function applyCtxQuality() {
      // Setting canvas.width/height resets context state — call after resize.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
    applyCtxQuality();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const images = new Array(total);
    let lastDrawn = -1;
    let targetFrame = 0;    // where scroll says we should be (float 0..total-1)
    let displayedFrame = 0; // what's currently on-screen (float, lerps toward target)
    let tickRaf = null;     // RAF handle for the lerp loop

    const progressBar = root.querySelector('.scroll-seq__progress > span');

    // ---- preload with concurrency cap ----
    const queue = [];
    for (let i = 1; i <= total; i++) queue.push(i);
    let loaded = 0;
    function loadNext() {
      const i = queue.shift();
      if (i === undefined) return;
      const img = new Image();
      img.decoding = 'async';
      const padded = String(i).padStart(3, '0');
      img.src = `/frames/${slug}/ezgif-frame-${padded}.jpg`;
      images[i - 1] = img;
      const onSettle = () => {
        loaded++;
        if (loaded === Math.min(8, total)) requestDraw(); // first paint as soon as a few are in
        if (loaded < total) loadNext();
      };
      img.onload = onSettle;
      img.onerror = onSettle;
    }
    for (let k = 0; k < Math.min(CONCURRENCY, total); k++) loadNext();

    // ---- canvas sizing ----
    function resize() {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      applyCtxQuality();
      lastDrawn = -1;
      drawAt(displayedFrame);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ---- scroll math ----
    function progress() {
      const r = root.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      if (travel <= 0) return 0;
      const p = (-r.top) / travel;
      return Math.max(0, Math.min(1, p));
    }

    function drawAt(frameFloat) {
      const i = Math.max(0, Math.min(total - 1, Math.round(frameFloat)));
      if (progressBar) progressBar.style.transform = `scaleX(${frameFloat / (total - 1)})`;
      if (i === lastDrawn) return;
      let img = images[i];
      // Fallback: walk back to nearest loaded frame if this one hasn't arrived yet.
      if (!img || !img.complete || !img.naturalWidth) {
        for (let j = i - 1; j >= 0; j--) {
          if (images[j] && images[j].complete && images[j].naturalWidth) {
            img = images[j];
            break;
          }
        }
      }
      if (!img || !img.complete || !img.naturalWidth) return;

      const cw = canvas.width, ch = canvas.height;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const k = Math.min(cw / iw, ch / ih);
      const dw = iw * k, dh = ih * k;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      lastDrawn = i;
    }

    function tick() {
      tickRaf = null;
      const diff = targetFrame - displayedFrame;
      if (Math.abs(diff) > SNAP_EPSILON) {
        displayedFrame += diff * LERP_FACTOR;
        drawAt(displayedFrame);
        tickRaf = requestAnimationFrame(tick);
      } else {
        displayedFrame = targetFrame;
        drawAt(displayedFrame);
      }
    }

    function requestDraw() {
      // Refresh target from scroll, kick the lerp loop if it's idle.
      targetFrame = progress() * (total - 1);
      if (tickRaf == null) tickRaf = requestAnimationFrame(tick);
    }

    window.addEventListener('scroll', requestDraw, { passive: true });
    window.addEventListener('resize', () => {
      lastDrawn = -1;
      requestDraw();
    });
    // Initial sync — important if the section is already partially in view on load.
    requestDraw();
  }
})();
