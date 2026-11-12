/* Portfolio front end: looping vertical carousel + pop-up window. No dependencies. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => matchMedia('(max-width: 760px)').matches;

  const menu = $('#menu'), track = $('#track'), probe = $('#probe');
  const panel = $('#panel'), panelBody = $('#panel-body'), panelTitle = $('#panel-title');

  let data = { site: {}, sections: [], media: {} };
  let entries = [];   // {label, section|null}
  let els = [];       // DOM nodes for every slot (entries repeated to fill the screen)
  let slots = 0, lh = 100;
  let pos = 0, target = 0, activeSlot = -1;
  let openSlug = null;

  /* ---------------- helpers ---------------- */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // only ever used with escaped markdown output
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mod = (a, n) => ((a % n) + n) % n;
  const fmtTime = (t) => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');

  // Tiny, safe markdown: paragraphs, line breaks, **bold**, *italic*, [text](url), bare URLs.
  function inline(s) {
    let out = esc(s);
    out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/(^|[\s(])((https?:\/\/)[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    out = out.replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+\w)/g, '$1<a href="mailto:$2">$2</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    return out;
  }
  const md = (s) => String(s || '').trim().split(/\n{2,}/).map((p) => `<p>${inline(p).replace(/\n/g, '<br>')}</p>`).join('');

  /* ---------------- boot ---------------- */
  fetch('/api/content').then((r) => r.json()).then((json) => {
    data = json;
    applySite();
    buildEntries();
    if (!entries.length) {
      track.replaceChildren(h('div', { class: 'item is-active', style: 'transform:translateY(-50%)' }, 'Hello.'));
      $('#foot').prepend(h('a', { href: '/admin' }, 'New site: set it up at /admin'));
    }
    buildCarousel();
    route(true);
    requestAnimationFrame(tick);
  }).catch((err) => {
    document.body.append(h('p', { style: 'padding:1rem' }, 'Could not load content.'));
    console.error(err);
  });

  function applySite() {
    const s = data.site;
    document.title = s.title || 'Portfolio';
    $('meta[name="description"]').setAttribute('content', s.description || '');
    const root = document.documentElement.style;
    if (s.theme?.background) root.setProperty('--theme-bg', s.theme.background);
    if (s.theme?.text) root.setProperty('--theme-fg', s.theme.text);
    if (s.theme?.font) root.setProperty('--font', s.theme.font);
    const aq = s.aquarium;
    const toggle = aq && aq.mode !== 'off'
      ? h('button', { class: 'link', type: 'button', id: 'aq-toggle', onclick: () => setAquarium(!aquariumOn, true) })
      : null;
    $('#foot').replaceChildren(
      h('span', { class: 'foot-left' }, s.updated || '', toggle),
      ...(s.footer || []).map((l) => h('a', { href: l.url, target: /^https?:/.test(l.url) ? '_blank' : null, rel: 'noopener' }, l.label)),
    );
    if (aq && aq.mode !== 'off') {
      root.setProperty('--aq-top', aq.top);
      root.setProperty('--aq-bottom', aq.bottom);
      root.setProperty('--aq-text', aq.text);
      const bg = aq.background && data.media[aq.background];
      if (bg) root.setProperty('--aq-image', `url("${bg.src}")`);
      document.documentElement.classList.toggle('aq-solid', aq.panel === 'solid');
      let pref = null;
      try { pref = sessionStorage.getItem(AQ_KEY); } catch { /* storage blocked */ }
      setAquarium(pref ? pref === 'on' : aq.mode === 'on', false);
    }
  }

  /* ---------------- aquarium theme ---------------- */
  // Site-wide mode is set in the admin (off / optional / on by default).
  // Visitors can flip it for their own session with the footer toggle.
  const AQ_KEY = 'aquarium';
  let aquariumOn = false, aqStopTimer = null;
  function setAquarium(on, remember) {
    aquariumOn = on;
    if (remember) { try { sessionStorage.setItem(AQ_KEY, on ? 'on' : 'off'); } catch { /* ignore */ } }
    const btn = $('#aq-toggle');
    if (btn) { btn.textContent = on ? '(Aquarium on)' : '(Aquarium off)'; btn.setAttribute('aria-pressed', on); }
    clearTimeout(aqStopTimer);
    if (on) {
      if (!window.Aquarium.running) window.Aquarium.start(data.site.aquarium, data.media);
      requestAnimationFrame(() => document.documentElement.classList.add('aquarium'));
    } else {
      document.documentElement.classList.remove('aquarium');
      aqStopTimer = setTimeout(() => window.Aquarium.stop(), 1000); // after the fade-out
    }
  }

  function buildEntries() {
    entries = data.sections.map((section) => ({ label: section.title, section }));
    if (data.site.colophon) entries.push({ label: data.site.colophon, section: null });
    $('#sr-nav').replaceChildren(h('ul', {}, data.sections.map((s) =>
      h('li', {}, h('a', { href: s.kind === 'link' ? s.url : `#/${s.slug}` }, s.title)))));
  }

  /* ---------------- carousel ---------------- */
  function buildCarousel() {
    lh = probe.getBoundingClientRect().height || 100;
    const n = Math.max(entries.length, 1);
    const needed = Math.ceil(menu.clientHeight / lh) + 4; // enough slots that wrapping happens off-screen
    const copies = Math.max(1, Math.ceil(needed / n));
    slots = n * copies;
    els = [];
    if (!entries.length) return;
    track.replaceChildren();
    for (let i = 0; i < slots; i++) {
      const e = entries[i % n];
      if (!e) break;
      const el = h('div', { class: 'item' + (isInteractive(e) ? '' : ' is-label') }, e.label);
      el.addEventListener('click', () => onItemClick(i));
      track.append(el);
      els.push(el);
    }
    activeSlot = -1;
    render();
  }

  const isInteractive = (e) => e && e.section && e.section.kind !== 'label';
  const entryAt = (slot) => entries[mod(slot, entries.length)];
  const wrapDist = (i, p) => { const d = mod(i - p, slots); return d > slots / 2 ? d - slots : d; };

  function render() {
    for (let i = 0; i < els.length; i++) {
      const d = wrapDist(i, pos);
      const a = Math.abs(d);
      els[i].style.transform = `translate3d(0, ${(d - 0.5) * lh}px, 0)`;
      els[i].style.opacity = a > slots / 2 - 1 ? 0 : Math.max(0.12, 1 - a * 0.16).toFixed(3);
    }
    const now = mod(Math.round(pos), slots);
    if (now !== activeSlot) {
      els[activeSlot]?.classList.remove('is-active');
      els[now]?.classList.add('is-active');
      activeSlot = now;
    }
  }

  let last = performance.now();
  function tick(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (reduceMotion) pos = target;
    else pos += (target - pos) * (1 - Math.exp(-dt * 11));
    if (Math.abs(target - pos) < 0.0005) pos = target;
    render();
    requestAnimationFrame(tick);
  }

  // Step to the next interactive entry in a direction.
  function step(dir) {
    let t = Math.round(target);
    for (let k = 0; k < entries.length; k++) {
      t += dir;
      if (isInteractive(entryAt(t))) break;
    }
    target = t;
  }

  function centerSlug(slug, instant) {
    const idx = entries.findIndex((e) => e.section && e.section.slug === slug);
    if (idx < 0) return;
    // nearest slot holding this entry
    let best = null;
    for (let i = idx; i < slots; i += entries.length) {
      const d = wrapDist(i, target);
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    target = Math.round(target + best);
    if (instant) pos = target;
  }

  function onItemClick(slot) {
    const e = entryAt(slot);
    target = Math.round(target + wrapDist(slot, target));
    if (isInteractive(e)) openEntry(e);
  }

  function openEntry(e) {
    if (!isInteractive(e)) return;
    if (e.section.kind === 'link') { window.open(e.section.url, '_blank', 'noopener'); return; }
    location.hash = `#/${e.section.slug}`;
  }

  /* ---------------- input ---------------- */
  let snapTimer = null;
  const scheduleSnap = (ms = 140) => {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => { target = Math.round(target); }, ms);
  };

  menu.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    target += dy / lh * 0.9;
    scheduleSnap();
  }, { passive: false });

  let touchY = null, touchV = 0, touchT = 0;
  menu.addEventListener('touchstart', (ev) => { touchY = ev.touches[0].clientY; touchV = 0; touchT = performance.now(); clearTimeout(snapTimer); }, { passive: true });
  menu.addEventListener('touchmove', (ev) => {
    if (touchY == null) return;
    const y = ev.touches[0].clientY, now = performance.now();
    const d = (touchY - y) / lh;
    target += d;
    touchV = d / Math.max(1, now - touchT) * 16;
    touchY = y; touchT = now;
  }, { passive: true });
  menu.addEventListener('touchend', () => {
    touchY = null;
    target = Math.round(target + touchV * 8);
  });

  document.addEventListener('keydown', (ev) => {
    if (lightbox.isOpen) {
      if (ev.key === 'Escape') lightbox.close();
      else if (ev.key === 'ArrowRight') lightbox.go(1);
      else if (ev.key === 'ArrowLeft') lightbox.go(-1);
      else return;
      ev.preventDefault();
      return;
    }
    const inPanel = panel.contains(document.activeElement) && document.activeElement !== panelBody;
    const typing = /INPUT|TEXTAREA|SELECT|VIDEO|AUDIO/.test(document.activeElement?.tagName);
    if (ev.key === 'Escape' && openSlug) { ev.preventDefault(); closePanel(); return; }
    if (typing || inPanel) return;
    switch (ev.key) {
      case 'ArrowDown': case 'j': step(1); break;
      case 'ArrowUp': case 'k': step(-1); break;
      case 'PageDown': target = Math.round(target) + 3; break;
      case 'PageUp': target = Math.round(target) - 3; break;
      case 'Home': target = Math.round(target) - mod(Math.round(target), entries.length); break;
      case 'Enter': case ' ': openEntry(entryAt(Math.round(target))); break;
      default: return;
    }
    ev.preventDefault();
  });

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const keep = entryAt(Math.round(target));
      pos = target = 0;
      buildCarousel();
      if (keep?.section) centerSlug(keep.section.slug, true);
    }, 150);
  });

  /* ---------------- routing ---------------- */
  // #/section-slug        open a section
  // #/section-slug/proj   open a section and scroll to a project
  // #/tag/name            everything tagged "name"
  addEventListener('hashchange', () => route(false));

  function route(initial) {
    const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent).filter(Boolean);
    if (!parts.length) { hidePanel(); return; }
    if (parts[0] === 'tag' && parts[1]) {
      showPanel(`tag:${parts[1]}`, `#${parts[1]}`, () => renderTag(parts[1]));
      return;
    }
    const section = data.sections.find((s) => s.slug === parts[0]);
    if (!section) { hidePanel(); return; }
    centerSlug(section.slug, initial);
    showPanel(section.slug, section.title, () => renderSection(section), parts[1]);
  }

  function closePanel() {
    history.pushState(null, '', location.pathname + location.search);
    hidePanel();
    document.activeElement?.blur?.();
  }

  /* ---------------- panel ---------------- */
  $('#panel-close').addEventListener('click', closePanel);
  let swapTimer = null;

  function showPanel(key, title, build, scrollTo) {
    const wasOpen = panel.classList.contains('is-open');
    const fill = () => {
      panelTitle.textContent = title;
      const nodes = build();
      nodes.forEach((n, i) => n.style?.setProperty('--i', Math.min(i, 8)));
      panelBody.replaceChildren(...nodes);
      panelBody.scrollTop = 0;
      panelBody.classList.remove('is-swapping');
      if (scrollTo) {
        const el = document.getElementById(`p-${scrollTo}`);
        if (el) setTimeout(() => el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }), 350);
      }
    };
    clearTimeout(swapTimer);
    if (wasOpen && openSlug !== key) {
      panelBody.classList.add('is-swapping');
      swapTimer = setTimeout(fill, reduceMotion ? 0 : 220);
    } else if (!wasOpen || openSlug !== key) {
      fill();
    } else if (scrollTo) {
      document.getElementById(`p-${scrollTo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    openSlug = key;
    panel.classList.add('is-open');
  }

  function hidePanel() {
    openSlug = null;
    panel.classList.remove('is-open');
    pauseAll();
  }

  function pauseAll() {
    panel.querySelectorAll('video, audio').forEach((m) => m.pause());
  }

  function renderSection(section) {
    if (section.kind === 'tags') return renderTagIndex();
    if (!section.projects.length) return [h('p', { class: 'empty' }, 'Nothing here yet.')];
    return section.projects.map((p) => renderProject(p, section));
  }

  function renderProject(p, section) {
    const media = p.media.map((id) => data.media[id]).filter(Boolean);
    const art = h('article', { class: 'project' + (p.collapsed ? ' is-collapsed' : ''), id: `p-${p.slug}` });
    const head = h('div', { class: 'proj-head' },
      h('div', { class: 'proj-id' },
        h('div', { html: inline(p.title) }),
        p.subtitle ? h('div', { html: inline(p.subtitle) }) : null,
        p.fields.length ? h('dl', { class: 'proj-fields' }, p.fields.flatMap((f) => [h('dt', {}, f.label), h('dd', { html: inline(f.value) })])) : null,
      ),
      h('div', { class: 'proj-body' },
        p.body ? h('div', { class: 'md', html: md(p.body) }) : null,
        p.links.length ? h('ul', { class: 'proj-links' }, p.links.map((l) =>
          h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label || l.url)))) : null,
        tagLinks(p.tags),
      ),
    );
    art.append(head);
    if (media.length) art.append(h('div', { class: `proj-media layout-${p.layout}` }, media.map((m, i) => renderMedia(m, media, i))));
    const foot = h('div', { class: 'proj-foot' });
    if (p.collapsed) {
      const more = h('button', { class: 'link', type: 'button' }, '(More…)');
      more.addEventListener('click', () => {
        const c = art.classList.toggle('is-collapsed');
        more.textContent = c ? '(More…)' : '(Less)';
      });
      foot.append(more);
    }
    foot.append(h('button', { class: 'link', type: 'button', onclick: closePanel }, '(Close)'));
    art.append(foot);
    return art;
  }

  function tagLinks(tags) {
    if (!tags || !tags.length) return null;
    return h('div', { class: 'tags' }, tags.map((t) => h('a', { href: `#/tag/${encodeURIComponent(t)}` }, t)));
  }

  function caption(m) {
    if (!m.title && !m.caption && !m.credit && !m.tags.length) return null;
    return h('figcaption', {},
      h('div', {}, m.title ? h('div', {}, m.title) : null, m.credit ? h('div', { class: 'cap-credit' }, m.credit) : null),
      h('div', {}, m.caption ? h('div', { class: 'md', html: md(m.caption) }) : null, tagLinks(m.tags)),
    );
  }

  function renderMedia(m, group, index) {
    let body;
    if (m.type === 'image') {
      body = h('img', { src: m.src, alt: m.alt || m.title || '', loading: 'lazy', decoding: 'async' });
      body.addEventListener('click', () => lightbox.open(group, index));
    } else if (m.type === 'video') {
      body = m.autoplay
        ? h('video', { src: m.src, muted: true, autoplay: true, loop: true, playsinline: true, preload: 'metadata', 'aria-label': m.alt || m.title })
        : h('video', { src: m.src, controls: true, playsinline: true, preload: 'metadata', 'aria-label': m.alt || m.title });
      if (m.autoplay) body.muted = true;
    } else if (m.type === 'audio') {
      body = audioPlayer(m);
    } else {
      body = h('a', { class: 'doc', href: m.src, target: '_blank', rel: 'noopener' }, h('span', {}, m.title || m.original), h('span', {}, '(Open PDF)'));
    }
    return h('figure', { class: `media media-${m.type}` }, body, m.type === 'document' ? null : caption(m));
  }

  // Minimal audio player that matches the type-only look.
  function audioPlayer(m) {
    const audio = h('audio', { src: m.src, preload: 'metadata' });
    const btn = h('button', { class: 'link', type: 'button' }, '(Play)');
    const fill = h('div', { class: 'fill' });
    const bar = h('div', { class: 'bar', role: 'slider', 'aria-label': 'Seek', tabindex: '0' }, fill);
    const time = h('span', { class: 'time' }, '0:00');
    btn.addEventListener('click', () => {
      if (audio.paused) { pauseAll(); audio.play(); } else audio.pause();
    });
    audio.addEventListener('play', () => { btn.textContent = '(Pause)'; });
    audio.addEventListener('pause', () => { btn.textContent = '(Play)'; });
    audio.addEventListener('loadedmetadata', () => { time.textContent = fmtTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      fill.style.width = `${(audio.currentTime / audio.duration) * 100 || 0}%`;
      time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
    });
    bar.addEventListener('click', (ev) => {
      const r = bar.getBoundingClientRect();
      if (audio.duration) audio.currentTime = ((ev.clientX - r.left) / r.width) * audio.duration;
    });
    bar.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight') audio.currentTime += 5;
      else if (ev.key === 'ArrowLeft') audio.currentTime -= 5;
    });
    return h('div', { class: 'audio' }, btn, bar, time, audio);
  }

  /* ---------------- tags ---------------- */
  function allTagged() {
    const map = new Map();
    const add = (t, kind, item) => {
      if (!map.has(t)) map.set(t, { projects: [], media: [] });
      const bucket = map.get(t)[kind];
      if (!bucket.includes(item)) bucket.push(item);
    };
    data.sections.forEach((s) => s.projects.forEach((p) => {
      p.tags.forEach((t) => add(t, 'projects', { p, s }));
      p.media.forEach((id) => { const m = data.media[id]; m?.tags.forEach((t) => add(t, 'media', m)); });
    }));
    return map;
  }

  function renderTagIndex() {
    const map = allTagged();
    if (!map.size) return [h('p', { class: 'empty' }, 'No tags yet.')];
    const tags = [...map.keys()].sort();
    return [h('div', { class: 'tag-index' }, tags.map((t) => {
      const b = map.get(t);
      return h('a', { href: `#/tag/${encodeURIComponent(t)}` }, `${t} `, h('span', {}, `(${b.projects.length + b.media.length})`));
    }))];
  }

  function renderTag(tag) {
    const b = allTagged().get(tag);
    if (!b) return [h('p', { class: 'empty' }, 'Nothing tagged with that yet.')];
    const out = b.projects.map(({ p, s }) => h('a', { class: 'list-row', href: `#/${s.slug}/${p.slug}` },
      h('div', { html: inline(p.title) + (p.subtitle ? `<br>${inline(p.subtitle)}` : '') }),
      h('div', {}, s.title)));
    if (b.media.length) out.push(h('div', { class: 'media-grid' }, b.media.map((m, i) => renderMedia(m, b.media, i))));
    return out;
  }

  /* ---------------- lightbox ---------------- */
  const lightbox = (() => {
    const box = $('#lightbox'), stage = $('#lb-stage'), cap = $('#lb-caption');
    let group = [], index = 0;
    const api = {
      isOpen: false,
      open(g, i) {
        group = g.filter((m) => m.type === 'image' || m.type === 'video');
        index = Math.max(0, group.indexOf(g[i]));
        box.hidden = false;
        requestAnimationFrame(() => box.classList.add('is-open'));
        api.isOpen = true;
        show();
      },
      close() {
        box.classList.remove('is-open');
        api.isOpen = false;
        setTimeout(() => { if (!api.isOpen) { box.hidden = true; stage.replaceChildren(); } }, 350);
      },
      go(d) { if (group.length) { index = mod(index + d, group.length); show(); } },
    };
    function show() {
      const m = group[index];
      stage.replaceChildren(m.type === 'image'
        ? h('img', { src: m.src, alt: m.alt || m.title || '' })
        : h('video', { src: m.src, controls: true, autoplay: true, playsinline: true }));
      cap.textContent = [m.title, m.credit].filter(Boolean).join(' — ');
      box.querySelectorAll('.lb-prev, .lb-next').forEach((b) => { b.hidden = group.length < 2; });
    }
    box.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-lb]')?.dataset.lb;
      if (a === 'close' || ev.target === box || ev.target === stage) api.close();
      else if (a === 'prev') api.go(-1);
      else if (a === 'next') api.go(1);
    });
    return api;
  })();
})();
