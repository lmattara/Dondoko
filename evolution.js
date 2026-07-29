// Evolution animation popup: classic Pokemon-style evolution sequence
// rendered on a 16:9 Canvas 2D window centered on screen. No external
// assets or animation libraries; silhouettes are generated from the sprite
// PNGs themselves at runtime. Ends on a held frame; the player closes the
// popup with the X button in the top-right corner.
//
// Usage:
//   playEvolutionAnimation({ spriteAtualUrl, spriteNovoUrl, nomeDoMonstro, tipoDoMonstro, onComplete });

(function(){

  const BLINK_COUNT = 4;
  const BLINK_DURATION = 150;          // ms per blink frame
  const RISE_FADE_DURATION = 900;      // old silhouette rises + fades, particles
  const REVEAL_DURATION = 900;         // new silhouette wipes in bottom-to-top
  const COLOR_CROSSFADE_DURATION = 400;// silhouette -> final colored sprite

  const BLINK_PHASE_DURATION = BLINK_COUNT * 2 * BLINK_DURATION;

  // Background gradient tuned per Pokemon type (light core -> saturated edge).
  const TYPE_GRADIENT = {
    normal:   ['#e6e2d0', '#8f8a6d'],
    fire:     ['#ffd9c8', '#c81e1e'],
    water:    ['#cfe8ff', '#1e5fc8'],
    electric: ['#fff6c2', '#d8b800'],
    grass:    ['#d9f7d0', '#1e9c3c'],
    ice:      ['#e3fbfb', '#22c2c2'],
    fighting: ['#f5dccb', '#a8451e'],
    poison:   ['#f0d6f7', '#8c1ea8'],
    ground:   ['#f2e3c2', '#a87a2e'],
    flying:   ['#e6e8ff', '#6b78d8'],
    psychic:  ['#ffd6ec', '#d81e7a'],
    bug:      ['#eaf7c2', '#7ba020'],
    rock:     ['#e6dfc2', '#8f7a3e'],
    ghost:    ['#ded0f7', '#4a2a80'],
    dragon:   ['#dccbff', '#4a1ec8'],
    dark:     ['#cfcfd6', '#28282f'],
    steel:    ['#e6ecf2', '#7a8a9c'],
    fairy:    ['#ffe3f2', '#d868b0']
  };
  function gradientForType(type){
    return TYPE_GRADIENT[(type || '').toLowerCase()] || TYPE_GRADIENT.normal;
  }

  function loadImage(url){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // Fills every non-transparent pixel of the source image with solid white,
  // producing the classic evolution silhouette on an offscreen canvas.
  function makeSilhouette(img){
    const off = document.createElement('canvas');
    off.width = img.naturalWidth || img.width;
    off.height = img.naturalHeight || img.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, off.width, off.height);
    return off;
  }

  function drawBackground(ctx, w, h, t, colors){
    const pulse = 0.5 + 0.5 * Math.sin(t / 650);
    const innerR = Math.max(w, h) * (0.15 + 0.05 * pulse);
    const outerR = Math.max(w, h) * 0.75;
    const cx = w / 2, cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.45, colors[1]);
    grad.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Plain outlined text (no background plate), sitting near the bottom of
  // the canvas. Defaults to a bold white look; pass opts to soften it (used
  // for the closing "Congratulations" line).
  function drawMessage(ctx, w, h, text, opts){
    opts = opts || {};
    const weight = opts.weight || 700;
    const color = opts.color || '#ffffff';
    const fontFamily = opts.fontFamily || "'Inter', sans-serif";
    const fontSize = Math.max(9, Math.round(h * 0.05));
    ctx.save();
    ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,10,10,0.65)';
    ctx.lineJoin = 'round';
    const y = h - Math.max(20, h * 0.16);
    ctx.strokeText(text, w / 2, y);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, y);
    ctx.restore();
  }

  // Scales sprites by an integer factor only, so pixel art never blurs or
  // stretches past its native resolution — just centers it larger if the
  // native size is already bigger than the target area.
  function fitRect(img, w, h){
    const maxW = w * 0.32;
    const maxH = h * 0.62;
    const iw = img.width, ih = img.height;
    const rawScale = Math.min(maxW / iw, maxH / ih);
    const scale = Math.max(1, Math.floor(rawScale));
    const dw = iw * scale, dh = ih * scale;
    return { x: (w - dw) / 2, y: (h - dh) / 2 - h * 0.05, w: dw, h: dh };
  }

  function spawnParticles(rect){
    const particles = [];
    const count = 36;
    for(let i = 0; i < count; i++){
      particles.push({
        x: rect.x + Math.random() * rect.w,
        y: rect.y + rect.h * (0.4 + Math.random() * 0.6),
        vy: -(0.4 + Math.random() * 0.9),
        vx: (Math.random() - 0.5) * 0.3,
        r: 1.5 + Math.random() * 2.5,
        delay: Math.random() * 300
      });
    }
    return particles;
  }

  window.playEvolutionAnimation = function playEvolutionAnimation(props){
    const { spriteAtualUrl, spriteNovoUrl, nomeDoMonstro, tipoDoMonstro, onComplete } = props || {};
    const colors = gradientForType(tipoDoMonstro);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;';

    const card = document.createElement('div');
    card.style.cssText = 'position:relative;background:#050807;border:2px solid #1a1a1a;border-radius:16px;box-shadow:0 0 40px rgba(0,0,0,0.5);overflow:hidden;';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.cssText = `
      position:absolute; top:8px; right:10px; border:none; background:transparent;
      color:#d8d8d8; font:600 12px/1 'Inter', sans-serif; letter-spacing:.02em;
      cursor:pointer; padding:4px 2px; z-index:1; transition:color .15s ease;
    `;
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#ffffff'; closeBtn.style.textDecoration = 'underline'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#d8d8d8'; closeBtn.style.textDecoration = 'none'; });

    card.appendChild(canvas);
    card.appendChild(closeBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // 16:9 popup window, capped so it never overflows the viewport.
    function sizeCard(){
      const maxW = Math.min(window.innerWidth * 0.9, 400);
      const maxH = window.innerHeight * 0.8;
      let width = Math.max(280, maxW);
      let height = Math.round(width * 9 / 16);
      if(height > maxH){
        height = maxH;
        width = Math.round(height * 16 / 9);
      }
      card.style.width = width + 'px';
      card.style.height = height + 'px';
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = false;
    }
    sizeCard();
    window.addEventListener('resize', sizeCard);

    let rafId = null;
    function finish(){
      window.removeEventListener('resize', sizeCard);
      if(rafId !== null) cancelAnimationFrame(rafId);
      overlay.remove();
      if(typeof onComplete === 'function') onComplete();
    }
    closeBtn.addEventListener('click', finish);

    Promise.all([loadImage(spriteAtualUrl), loadImage(spriteNovoUrl)])
      .then(([imgOld, imgNew]) => {
        const silOld = makeSilhouette(imgOld);
        const silNew = makeSilhouette(imgNew);

        let particles = null;
        let start = null;
        const T1 = BLINK_PHASE_DURATION;
        const T2 = T1 + RISE_FADE_DURATION;
        const T3 = T2 + REVEAL_DURATION;
        const T4 = T3 + COLOR_CROSSFADE_DURATION;

        function frame(now){
          if(start === null) start = now;
          const t = now - start;
          const w = canvas.width, h = canvas.height;

          drawBackground(ctx, w, h, t, colors);

          if(t < T1){
            const rect = fitRect(imgOld, w, h);
            const blinkIndex = Math.floor(t / BLINK_DURATION);
            const showSilhouette = blinkIndex % 2 === 1;
            ctx.drawImage(showSilhouette ? silOld : imgOld, rect.x, rect.y, rect.w, rect.h);
            drawMessage(ctx, w, h, `What? ${nomeDoMonstro} is evolving!`);

          } else if(t < T2){
            const rect = fitRect(imgOld, w, h);
            if(!particles) particles = spawnParticles(rect);
            const progress = (t - T1) / RISE_FADE_DURATION;
            const riseY = rect.y - progress * rect.h * 0.6;
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - progress);
            ctx.drawImage(silOld, rect.x, riseY, rect.w, rect.h);
            ctx.restore();

            const pt = t - T1;
            ctx.fillStyle = '#ffffff';
            particles.forEach(p => {
              if(pt < p.delay) return;
              const pAge = pt - p.delay;
              const px = p.x + p.vx * pAge * 0.05;
              const py = p.y + p.vy * pAge * 0.05;
              const alpha = Math.max(0, 1 - pAge / 700);
              if(alpha <= 0) return;
              ctx.save();
              ctx.globalAlpha = alpha;
              ctx.beginPath();
              ctx.arc(px, py, p.r, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            });
            drawMessage(ctx, w, h, `What? ${nomeDoMonstro} is evolving!`);

          } else if(t < T3){
            const rect = fitRect(imgNew, w, h);
            const progress = (t - T2) / REVEAL_DURATION;
            ctx.save();
            ctx.beginPath();
            const revealTop = rect.y + rect.h * (1 - progress);
            ctx.rect(rect.x, revealTop, rect.w, rect.h * progress);
            ctx.clip();
            ctx.drawImage(silNew, rect.x, rect.y, rect.w, rect.h);
            ctx.restore();
            drawMessage(ctx, w, h, `What? ${nomeDoMonstro} is evolving!`);

          } else if(t < T4){
            const rect = fitRect(imgNew, w, h);
            const progress = (t - T3) / COLOR_CROSSFADE_DURATION;
            ctx.drawImage(silNew, rect.x, rect.y, rect.w, rect.h);
            ctx.save();
            ctx.globalAlpha = progress;
            ctx.drawImage(imgNew, rect.x, rect.y, rect.w, rect.h);
            ctx.restore();
            drawMessage(ctx, w, h, `Congratulations! Your ${nomeDoMonstro} evolved!`, { weight: 500, color: '#c9c9c9' });

          } else {
            const rect = fitRect(imgNew, w, h);
            ctx.drawImage(imgNew, rect.x, rect.y, rect.w, rect.h);
            drawMessage(ctx, w, h, `Congratulations! Your ${nomeDoMonstro} evolved!`, { weight: 500, color: '#c9c9c9' });
          }

          rafId = requestAnimationFrame(frame);
        }

        rafId = requestAnimationFrame(frame);
      })
      .catch(() => {
        finish();
      });
  };

})();
