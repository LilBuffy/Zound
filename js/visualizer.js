const Visualizer = (() => {
  let canvas = null, ctx = null;
  let rafId = null;
  let style = 'bars';
  let running = false;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function accent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff8a4c';
  }

  function drawBars(data, w, h) {
    const barCount = 48;
    const step = Math.floor(data.length / barCount);
    const gap = w / barCount * 0.28;
    const barW = (w / barCount) - gap;
    ctx.fillStyle = accent();
    for (let i = 0; i < barCount; i++) {
      const v = data[i * step] / 255;
      const barH = Math.max(3, v * h);
      const x = i * (barW + gap) + gap / 2;
      const y = h - barH;
      ctx.globalAlpha = 0.55 + v * 0.45;
      roundedRect(x, y, barW, barH, Math.min(4, barW / 2));
    }
    ctx.globalAlpha = 1;
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function drawWave(data, w, h) {
    ctx.strokeStyle = accent();
    ctx.lineWidth = 2;
    ctx.beginPath();
    const step = w / data.length;
    data.forEach((v, i) => {
      const norm = v / 255;
      const y = h - norm * h;
      const x = i * step;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function drawRadial(data, w, h) {
    const cx = w / 2, cy = h / 2;
    const baseR = Math.min(w, h) * 0.22;
    const count = 64;
    const step = Math.floor(data.length / count);
    ctx.strokeStyle = accent();
    ctx.lineWidth = Math.max(1.5, w / 260);
    for (let i = 0; i < count; i++) {
      const v = data[i * step] / 255;
      const angle = (i / count) * Math.PI * 2;
      const r1 = baseR;
      const r2 = baseR + v * baseR * 1.4;
      ctx.globalAlpha = 0.5 + v * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
      ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    if (!running) return;
    const analyser = Player.getAnalyser();
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);

    const data = new Uint8Array(analyser.frequencyBinCount);
    if (style === 'wave') analyser.getByteTimeDomainData(data); else analyser.getByteFrequencyData(data);

    if (Player.isPlaying) {
      if (style === 'bars') drawBars(data, w, h);
      else if (style === 'wave') drawWave(data, w, h);
      else drawRadial(data, w, h);
    } else {
      drawIdle(w, h);
    }
    rafId = requestAnimationFrame(frame);
  }

  let idlePhase = 0;
  function drawIdle(w, h) {
    // A gentle, low-cost breathing line so the panel doesn't look "broken"
    // when nothing is playing.
    idlePhase += 0.02;
    ctx.strokeStyle = accent();
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h / 2 + Math.sin(x * 0.03 + idlePhase) * (h * 0.06);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  return {
    mount(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
    },
    setStyle(s) { style = s; },
    get style() { return style; },
    start() {
      if (running || !canvas) return;
      running = true;
      resize();
      if (reduceMotion) {
        // Draw a single static-ish frame instead of animating continuously.
        const analyser = Player.getAnalyser();
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const w = canvas.getBoundingClientRect().width, h = canvas.getBoundingClientRect().height;
        ctx.clearRect(0, 0, w, h);
        drawBars(data, w, h);
        return;
      }
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
})();
