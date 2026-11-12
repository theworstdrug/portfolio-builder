/*
 * Aquarium backdrop: bubbles, swaying seaweed and a few kinds of fish.
 *
 * Every element uses an uploaded image if one is set in Admin → Site → Aquarium,
 * and falls back to a simple drawn placeholder otherwise.
 *
 * Image tips:
 *  - Transparent PNG / WebP. Fish should face one direction (set "Image faces" to match).
 *  - Animated fish: a horizontal sprite strip (all frames side by side, equal widths)
 *    and set "Frames" + "FPS".
 *  - Seaweed: a tall image, base at the bottom. It's sliced into bands that sway, so it bends.
 *
 * Two canvases: "back" sits behind the menu text, "front" sits over the menu (but under
 * the window), so some seaweed / fish can drift in front of the type.
 */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FLOOR_PAD = 30; // keep bottom-walkers above the footer line

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  class Tank {
    constructor(config, media) {
      this.cfg = config;
      this.media = media || {};
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.back = this.makeCanvas('aq-back');
      this.front = this.makeCanvas('aq-front');
      this.pointer = { x: -9999, y: -9999 };
      this.bubbles = [];
      this.weeds = [];
      this.fish = [];
      this.t = 0;
      this.running = false;
      this.onResize = () => this.resize();
      this.onMove = (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; };
      this.onLeave = () => { this.pointer.x = this.pointer.y = -9999; };
    }

    makeCanvas(id) {
      let c = document.getElementById(id);
      if (!c) { c = document.createElement('canvas'); c.id = id; c.setAttribute('aria-hidden', 'true'); document.body.append(c); }
      return { el: c, ctx: c.getContext('2d') };
    }

    src(id) { return id && this.media[id] ? this.media[id].src : null; }

    async start() {
      const c = this.cfg;
      const [bubbleImg, weedImgs, fishImgs] = await Promise.all([
        loadImage(this.src(c.bubbles.image)),
        Promise.all(c.seaweed.images.map((id) => loadImage(this.src(id)))),
        Promise.all(c.fish.map((f) => loadImage(this.src(f.image)))),
      ]);
      this.bubbleImg = bubbleImg;
      this.weedImgs = weedImgs.filter(Boolean);
      this.fishImgs = fishImgs;
      this.resize();
      this.populate();
      addEventListener('resize', this.onResize);
      addEventListener('pointermove', this.onMove, { passive: true });
      document.addEventListener('pointerleave', this.onLeave);
      this.running = true;
      this.last = performance.now();
      if (this.reduce) { this.step(0); this.draw(); return; } // one still frame
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.step(dt);
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      removeEventListener('resize', this.onResize);
      removeEventListener('pointermove', this.onMove);
      document.removeEventListener('pointerleave', this.onLeave);
      [this.back, this.front].forEach((c) => c.ctx.clearRect(0, 0, c.el.width, c.el.height));
    }

    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.W = innerWidth; this.H = innerHeight; this.dpr = dpr;
      for (const c of [this.back, this.front]) {
        c.el.width = Math.round(this.W * dpr);
        c.el.height = Math.round(this.H * dpr);
        c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (this.weeds.length) this.placeWeeds();
      if (this.reduce && this.running) this.draw();
    }

    /* ---------------- setup ---------------- */
    populate() {
      const c = this.cfg;
      // seaweed
      this.weeds = Array.from({ length: c.seaweed.count }, (_, i) => ({
        img: this.weedImgs.length ? this.weedImgs[i % this.weedImgs.length] : null,
        front: Math.random() * 100 < c.seaweed.front,
        phase: rand(0, TAU),
        speed: rand(0.6, 1.2),
        amp: rand(10, 26),
        hue: rand(-18, 18),
      }));
      this.placeWeeds();

      // fish
      this.fish = [];
      c.fish.forEach((type, ti) => {
        const img = this.fishImgs[ti];
        const make = () => this.makeFish(type, img);
        if (type.behavior === 'school') {
          if (!type.count) return;
          const leader = make();
          leader.isLeader = true;
          leader.hidden = true; // the leader is an invisible guide
          this.fish.push(leader);
          for (let i = 0; i < type.count; i++) {
            const f = make();
            f.leader = leader;
            f.offset = { x: rand(-1, 1) * type.size * 4, y: rand(-1, 1) * type.size * 2.2 };
            f.lag = rand(1.2, 2.6);
            f.x = leader.x + f.offset.x; f.y = leader.y + f.offset.y;
            this.fish.push(f);
          }
        } else {
          for (let i = 0; i < type.count; i++) this.fish.push(make());
        }
      });
      this.fish.sort((a, b) => a.z - b.z);

      // a few bubbles already on screen
      const n = Math.round(c.bubbles.amount / 4);
      for (let i = 0; i < n; i++) this.spawnBubble(rand(0, this.W), rand(0, this.H));
    }

    placeWeeds() {
      const n = this.weeds.length;
      const maxH = this.H * (this.cfg.seaweed.height / 100);
      this.weeds.forEach((w, i) => {
        w.x = ((i + 0.5) / n) * this.W + rand(-0.3, 0.3) * (this.W / n);
        w.h = maxH * rand(0.55, 1);
        w.w = w.img ? w.h * (w.img.width / w.img.height) : rand(14, 26);
      });
    }

    makeFish(type, img) {
      const z = type.layer === 'front' ? 1.15 : rand(0.6, 1);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const size = type.size * z;
      const aspect = img ? (img.height / (img.width / type.frames)) : type.behavior === 'drifter' ? 1.1 : type.behavior === 'bottom' ? 0.6 : 0.5;
      const f = {
        type, img, z, size, aspect, dir,
        face: dir,
        x: rand(0, this.W),
        y: rand(this.H * 0.12, this.H * 0.8),
        vx: 0, vy: 0,
        phase: rand(0, TAU),
        speed: type.speed * rand(0.75, 1.25),
        state: 'rest', timer: rand(0.3, 2),
        targetY: 0, squash: 1,
      };
      f.baseY = f.y;
      f.targetY = f.y;
      if (type.behavior === 'bottom') f.y = this.floorY(f);
      return f;
    }

    floorY(f) { return this.H - FLOOR_PAD - (f.size * f.aspect) / 2; }

    spawnBubble(x, y, r) {
      if (this.bubbles.length > 220) return;
      r = r || rand(1.5, 6);
      this.bubbles.push({ x, y, r, vy: 22 + r * 9 + rand(0, 15), phase: rand(0, TAU), wob: rand(4, 12) });
    }

    /* ---------------- simulation ---------------- */
    step(dt) {
      this.t += dt;
      const { W, H } = this;

      // bubbles
      const rate = (this.cfg.bubbles.amount / 100) * 9; // per second at 100
      let toSpawn = rate * dt;
      while (toSpawn > 0) {
        if (Math.random() < toSpawn) {
          // rise from the floor, sometimes from a seaweed base
          const w = this.weeds.length && Math.random() < 0.35 ? pick(this.weeds) : null;
          this.spawnBubble(w ? w.x + rand(-6, 6) : rand(0, W), H + 8);
        }
        toSpawn -= 1;
      }
      for (const b of this.bubbles) {
        b.y -= b.vy * dt;
        b.phase += dt * 2.2;
        b.r += dt * 0.15; // expand slightly as they rise
      }
      this.bubbles = this.bubbles.filter((b) => b.y > -20);

      // fish
      for (const f of this.fish) this.moveFish(f, dt);
    }

    flee(f) {
      // scatter away from the cursor
      const dx = f.x - this.pointer.x, dy = f.y - this.pointer.y;
      const d2 = dx * dx + dy * dy, R = 130;
      if (d2 > R * R) return 0;
      const d = Math.sqrt(d2) || 1;
      const push = (1 - d / R);
      f.vx += (dx / d) * push * 600 * (1 / 60);
      f.vy += (dy / d) * push * 400 * (1 / 60);
      if (Math.abs(dx) > 4) f.dir = Math.sign(dx);
      return push;
    }

    moveFish(f, dt) {
      const { W, H } = this;
      const b = f.type.behavior;
      const margin = f.size * 1.5;
      f.phase += dt;

      if (b === 'cruiser' || (b === 'school' && f.isLeader)) {
        const base = (b === 'school' ? 55 : 42) * f.speed * (0.6 + f.z * 0.4);
        // wander vertically
        f.timer -= dt;
        if (f.timer <= 0) { f.targetY = rand(H * 0.1, H * 0.78); f.timer = rand(3, 8); if (Math.random() < 0.15) f.dir *= -1; }
        f.baseY += (f.targetY - f.baseY) * dt * 0.25;
        f.vx += (f.dir * base - f.vx) * dt * 1.5;
        f.vy *= 0.9;
        if (b === 'cruiser') this.flee(f);
        f.x += f.vx * dt;
        f.y = f.baseY + Math.sin(f.phase * 0.9) * 10 + f.vy * 0.2;
        if (f.x > W + margin) f.dir = -1;
        if (f.x < -margin) f.dir = 1;
        // the occasional bubble
        if (b === 'cruiser' && Math.random() < dt * 0.15) this.spawnBubble(f.x + f.face * f.size * 0.45, f.y, rand(1.5, 3));
      } else if (b === 'school') {
        const L = f.leader;
        const tx = L.x - L.dir * Math.abs(f.offset.x) + Math.sin(f.phase + f.offset.y) * 8;
        const ty = L.y + f.offset.y + Math.cos(f.phase * 1.3 + f.offset.x) * 6;
        f.vx += ((tx - f.x) * f.lag - f.vx) * dt * 3;
        f.vy += ((ty - f.y) * f.lag - f.vy) * dt * 3;
        this.flee(f);
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (Math.abs(f.vx) > 6) f.dir = Math.sign(f.vx);
      } else if (b === 'darter') {
        f.timer -= dt;
        if (f.state === 'rest') {
          f.vx *= 0.92; f.vy *= 0.92;
          f.y += Math.sin(f.phase * 3) * 0.15;
          if (f.timer <= 0) {
            f.state = 'dart';
            f.tx = clamp(f.x + rand(-1, 1) * W * 0.45, margin * 0.5, W - margin * 0.5);
            f.ty = clamp(f.y + rand(-1, 1) * H * 0.25, H * 0.08, H * 0.82);
            f.dir = Math.sign(f.tx - f.x) || f.dir;
            f.timer = rand(0.5, 1.1);
          }
        } else {
          const k = 4.5 * f.speed;
          f.vx += ((f.tx - f.x) * k - f.vx) * dt * 6;
          f.vy += ((f.ty - f.y) * k - f.vy) * dt * 6;
          if (f.timer <= 0) { f.state = 'rest'; f.timer = rand(0.6, 2.8); }
        }
        if (this.flee(f) > 0.3) { f.state = 'dart'; f.tx = clamp(f.x + f.dir * W * 0.3, 0, W); f.ty = f.y; f.timer = 0.6; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.x = clamp(f.x, -margin, W + margin); f.y = clamp(f.y, 0, H);
      } else if (b === 'drifter') {
        // pulse up, sink slowly; wrap from top to bottom
        const period = 3.2 / f.speed;
        const p = ((f.phase + f.timer) % period) / period;
        const thrust = p < 0.18 ? Math.sin((p / 0.18) * Math.PI) : 0;
        f.vy += (-thrust * 70 * f.speed - f.vy * 0.6 + 8) * dt;
        f.squash = 1 - thrust * 0.22;
        f.x += Math.sin(f.phase * 0.35 + f.timer) * 8 * dt;
        f.y += f.vy * dt;
        if (f.y < -f.size * 2) { f.y = H + f.size; f.x = rand(0, W); }
        if (f.y > H + f.size * 2) f.y = -f.size;
      } else if (b === 'bottom') {
        // walk, pause, turn around
        f.timer -= dt;
        if (f.timer <= 0) {
          f.state = f.state === 'walk' ? 'rest' : 'walk';
          f.timer = f.state === 'walk' ? rand(2, 6) : rand(1, 4);
          if (f.state === 'walk' && Math.random() < 0.4) f.dir *= -1;
        }
        const target = f.state === 'walk' ? f.dir * 22 * f.speed : 0;
        f.vx += (target - f.vx) * dt * 3;
        f.x += f.vx * dt;
        if (f.x < f.size) f.dir = 1;
        if (f.x > W - f.size) f.dir = -1;
        f.y = this.floorY(f) - (f.state === 'walk' ? Math.abs(Math.sin(f.phase * 9)) * 1.5 : 0);
      }

      // smooth turn: "face" eases toward dir, which squashes the sprite as it turns
      f.face += (f.dir - f.face) * Math.min(1, dt * 7);
    }

    /* ---------------- drawing ---------------- */
    draw() {
      const b = this.back.ctx, fr = this.front.ctx;
      b.clearRect(0, 0, this.W, this.H);
      fr.clearRect(0, 0, this.W, this.H);

      for (const w of this.weeds) if (!w.front) this.drawWeed(b, w);
      for (const f of this.fish) if (!f.hidden && f.type.layer !== 'front') this.drawFish(b, f);
      for (const bb of this.bubbles) this.drawBubble(b, bb);
      for (const f of this.fish) if (!f.hidden && f.type.layer === 'front') this.drawFish(fr, f);
      for (const w of this.weeds) if (w.front) this.drawWeed(fr, w);
    }

    drawBubble(ctx, bb) {
      const x = bb.x + Math.sin(bb.phase) * bb.wob * 0.5;
      if (this.bubbleImg) {
        ctx.drawImage(this.bubbleImg, x - bb.r, bb.y - bb.r, bb.r * 2, bb.r * 2);
        return;
      }
      ctx.beginPath();
      ctx.arc(x, bb.y, bb.r, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - bb.r * 0.35, bb.y - bb.r * 0.35, bb.r * 0.25, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fill();
    }

    // horizontal sway at height fraction s (0 = base, 1 = tip)
    sway(w, s) {
      return Math.sin(this.t * w.speed + w.phase + s * 2.2) * w.amp * Math.pow(s, 1.4)
        + Math.sin(this.t * 0.4 + w.phase) * 6 * s;
    }

    drawWeed(ctx, w) {
      const base = this.H;
      const N = w.img ? 28 : 14;
      if (w.img) {
        // slice the image into bands and offset each one -> the strand bends
        const iw = w.img.width, ih = w.img.height, bandH = w.h / N;
        for (let i = 0; i < N; i++) {
          const s = (i + 0.5) / N;
          const dx = this.sway(w, s);
          ctx.drawImage(w.img, 0, ih * (1 - (i + 1) / N), iw, ih / N + 1,
            w.x - w.w / 2 + dx, base - bandH * (i + 1), w.w, bandH + 1);
        }
        return;
      }
      // placeholder: tapered ribbon
      const left = [], right = [];
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const x = w.x + this.sway(w, s);
        const y = base - w.h * s;
        const half = (w.w / 2) * (1 - s * 0.85);
        left.push([x - half, y]);
        right.push([x + half, y]);
      }
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      left.forEach(([x, y]) => ctx.lineTo(x, y));
      right.reverse().forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fillStyle = shade(this.cfg.seaweed.color, w.hue);
      ctx.globalAlpha = w.front ? 0.95 : 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawFish(ctx, f) {
      const t = f.type;
      const w = f.size, h = f.size * f.aspect;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.globalAlpha = t.layer === 'front' ? 1 : 0.45 + 0.55 * f.z;
      // sprite art faces t.facing; flip so it faces the swim direction
      const flip = t.behavior === 'drifter' ? 1 : f.face * (t.facing === 'left' ? -1 : 1);
      const tilt = t.behavior === 'drifter' || t.behavior === 'bottom' ? 0 : clamp(f.vy / 300, -0.35, 0.35) * (f.face < 0 ? -1 : 1);
      ctx.rotate(tilt);
      ctx.scale(flip || 0.001, f.squash || 1);

      if (f.img) {
        const frames = t.frames || 1;
        const fw = f.img.width / frames;
        const frame = frames > 1 ? Math.floor((this.t + f.phase) * t.fps) % frames : 0;
        ctx.drawImage(f.img, frame * fw, 0, fw, f.img.height, -w / 2, -h / 2, w, h);
      } else {
        placeholder(ctx, t, w, h, this.t + f.phase);
      }
      ctx.restore();
    }
  }

  /* ---------------- placeholder art ---------------- */
  function shade(hex, deg) {
    // tiny hue/lightness nudge so strands aren't identical
    const n = parseInt(hex.slice(1).padEnd(6, '0').slice(0, 6), 16);
    const k = deg / 100;
    const ch = (v) => clamp(Math.round(v * (1 + k)), 0, 255);
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  function placeholder(ctx, t, w, h, time) {
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color;
    if (t.behavior === 'drifter') {
      // jellyfish: dome + wavy tentacles
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.15, w / 2, h * 0.32, 0, Math.PI, 0);
      ctx.closePath();
      ctx.globalAlpha *= 0.85;
      ctx.fill();
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const x0 = (i - 2) * (w / 6);
        ctx.beginPath();
        ctx.moveTo(x0, -h * 0.15);
        for (let s = 1; s <= 8; s++) {
          ctx.lineTo(x0 + Math.sin(time * 3 + s * 0.8 + i) * 3, -h * 0.15 + (s / 8) * h * 0.65);
        }
        ctx.stroke();
      }
      return;
    }
    if (t.behavior === 'bottom') {
      // crab: shell, legs, claws, eyes
      ctx.lineWidth = 2;
      for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(s * w * 0.2, h * 0.05);
          ctx.lineTo(s * w * (0.38 + i * 0.05), h * (0.25 + Math.sin(time * 9 + i) * 0.04));
          ctx.lineTo(s * w * (0.42 + i * 0.05), h * 0.5);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(s * w * 0.42, -h * 0.25, w * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.3, h * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-w * 0.08, -h * 0.3, 2, 0, Math.PI * 2); ctx.arc(w * 0.08, -h * 0.3, 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // fish: body faces right, tail wags
    const wag = Math.sin(time * (t.behavior === 'darter' ? 14 : 8)) * h * 0.18;
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, 0);
    ctx.lineTo(-w / 2, -h / 2 + wag);
    ctx.lineTo(-w / 2, h / 2 + wag);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w * 0.05, 0, w * 0.4, h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(w * 0.27, -h * 0.08, Math.max(1.5, h * 0.09), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(w * 0.29, -h * 0.08, Math.max(0.8, h * 0.045), 0, Math.PI * 2); ctx.fill();
  }

  let tank = null;
  window.Aquarium = {
    start(config, media) {
      if (tank) tank.stop();
      tank = new Tank(config, media);
      return tank.start();
    },
    stop() { if (tank) { tank.stop(); tank = null; } },
    get running() { return !!tank; },
  };
})();
