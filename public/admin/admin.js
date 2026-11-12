/* Admin UI. Vanilla JS, no build step. */
(() => {
  'use strict';
  const app = document.getElementById('app');

  const S = {
    site: null, sections: [], media: [], limits: {},
    view: 'sections', sectionId: null, openProjects: new Set(),
    dirty: false, saving: false,
    filter: { q: '', type: '', tag: '' },
  };

  /* ---------------- helpers ---------------- */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const uid = () => Math.random().toString(16).slice(2, 14);
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const parseTags = (s) => [...new Set(String(s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const mediaById = (id) => S.media.find((m) => m.id === id);
  const src = (m) => `/uploads/${m.file}`;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portfolio-admin' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(json.error || res.statusText); e.status = res.status; throw e; }
    return json;
  }

  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  function markDirty() {
    S.dirty = true;
    const st = document.getElementById('status');
    if (st) { st.textContent = 'Unsaved changes'; st.className = 'status dirty'; }
    const b = document.getElementById('save');
    if (b) b.disabled = false;
  }

  // Bind an input to obj[key]. Changes mark the structure dirty without re-rendering.
  function field(label, obj, key, opts = {}) {
    const { type = 'text', textarea = false, placeholder = '', full = false, onchange, transform, silent } = opts;
    const val = Array.isArray(obj[key]) ? obj[key].join(', ') : obj[key] ?? '';
    const input = textarea
      ? h('textarea', { placeholder, value: val })
      : h('input', { type, placeholder, value: val });
    input.addEventListener('input', () => {
      obj[key] = transform ? transform(input.value) : input.value;
      if (!silent) markDirty();
      onchange?.(input.value);
    });
    return h('label', { class: full ? 'full' : null }, h('span', {}, label), input);
  }
  function checkbox(label, obj, key, onchange, silent) {
    const input = h('input', { type: 'checkbox', checked: obj[key] });
    input.addEventListener('change', () => { obj[key] = input.checked; if (!silent) markDirty(); onchange?.(); });
    return h('label', { class: 'check' }, input, h('span', {}, label));
  }
  function select(label, obj, key, options, onchange) {
    const sel = h('select', {}, options.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = obj[key];
    sel.addEventListener('change', () => { obj[key] = sel.value; markDirty(); onchange?.(); });
    return h('label', {}, h('span', {}, label), sel);
  }
  // Editable list of {a, b} pairs (fields, links, footer links)
  function pairRows(list, a, b, pa, pb, addLabel) {
    const box = h('div', { class: 'rows' });
    const draw = () => {
      box.replaceChildren(
        ...list.map((item, i) => {
          const ia = h('input', { placeholder: pa, value: item[a] || '' });
          const ib = h('input', { placeholder: pb, value: item[b] || '' });
          ia.addEventListener('input', () => { item[a] = ia.value; markDirty(); });
          ib.addEventListener('input', () => { item[b] = ib.value; markDirty(); });
          return h('div', { class: 'row' }, ia, ib, h('span', {},
            h('button', { class: 'icon', title: 'Up', onclick: () => { move(list, i, -1); markDirty(); draw(); } }, '↑'),
            h('button', { class: 'icon', title: 'Remove', onclick: () => { list.splice(i, 1); markDirty(); draw(); } }, '×')));
        }),
        h('div', {}, h('button', { class: 'btn small', onclick: () => { list.push({ [a]: '', [b]: '' }); markDirty(); draw(); } }, addLabel)),
      );
    };
    draw();
    return box;
  }

  function thumbPic(m) {
    if (!m) return h('div', { class: 'pic' }, 'missing');
    if (m.type === 'image') return h('div', { class: 'pic' }, h('img', { src: src(m), loading: 'lazy', alt: '' }));
    if (m.type === 'video') return h('div', { class: 'pic' }, h('video', { src: src(m) + '#t=0.5', muted: true, preload: 'metadata' }));
    return h('div', { class: 'pic' }, m.type === 'audio' ? '♪ audio' : 'pdf');
  }

  /* ---------------- boot / auth ---------------- */
  async function boot() {
    try {
      const data = await api('GET', '/api/admin/content');
      Object.assign(S, { site: data.site, sections: data.sections, media: data.media, limits: data.limits });
      if (!S.sectionId && S.sections[0]) S.sectionId = S.sections[0].id;
      render();
    } catch (e) {
      if (e.status === 401) renderLogin(); else app.textContent = 'Error: ' + e.message;
    }
  }

  function renderLogin() {
    const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const err = h('div', { class: 'err' });
    const form = h('form', { class: 'login' }, h('h1', {}, 'Admin'), pw, h('button', { class: 'btn primary', type: 'submit' }, 'Log in'), err);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await api('POST', '/api/login', { password: pw.value }); boot(); } catch (e) { err.textContent = e.message; }
    });
    app.replaceChildren(form);
    pw.focus();
  }

  async function save() {
    if (S.saving) return;
    S.saving = true;
    try {
      const res = await api('PUT', '/api/admin/structure', { site: S.site, sections: S.sections });
      S.site = res.site; S.sections = res.sections;
      S.dirty = false;
      render();
      toast('Saved');
    } catch (e) {
      if (e.status === 401) { toast('Session expired — log in again (your edits are still on this page).'); }
      else toast('Save failed: ' + e.message);
    } finally { S.saving = false; }
  }

  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); if (S.dirty) save(); }
  });
  addEventListener('beforeunload', (ev) => { if (S.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  /* ---------------- layout ---------------- */
  function render() {
    const scroll = scrollY;
    const tab = (id, label) => h('button', { class: S.view === id ? 'on' : '', onclick: () => { S.view = id; render(); } }, label);
    const top = h('div', { class: 'top' },
      h('span', { class: 'brand' }, S.site.title || 'Portfolio'),
      h('div', { class: 'tabs' }, tab('sections', 'Sections'), tab('media', `Media (${S.media.length})`), tab('site', 'Site')),
      h('span', { class: 'spacer' }),
      h('span', { id: 'status', class: 'status' + (S.dirty ? ' dirty' : '') }, S.dirty ? 'Unsaved changes' : 'All changes saved'),
      h('button', { id: 'save', class: 'btn primary', disabled: !S.dirty, onclick: save }, 'Save'),
      h('a', { class: 'btn', href: '/', target: '_blank' }, 'View site'),
      h('button', { class: 'btn', onclick: async () => { await api('POST', '/api/logout'); renderLogin(); } }, 'Log out'),
    );
    const body = S.view === 'media' ? viewMedia() : S.view === 'site' ? viewSite() : viewSections();
    app.replaceChildren(top, h('div', { class: 'wrap' }, body));
    scrollTo(0, scroll);
  }

  /* ---------------- sections ---------------- */
  function viewSections() {
    const current = S.sections.find((s) => s.id === S.sectionId);
    const list = h('ul', {}, S.sections.map((s, i) => h('li', { class: s.id === S.sectionId ? 'on' : '' },
      h('button', { class: 'name', onclick: () => { S.sectionId = s.id; render(); } },
        s.title || '(untitled)', s.hidden ? h('span', { class: 'meta' }, 'hidden') : null,
        s.kind !== 'projects' ? h('span', { class: 'meta' }, s.kind) : null),
      h('button', { class: 'icon', title: 'Move up', onclick: () => { move(S.sections, i, -1); markDirty(); render(); } }, '↑'),
      h('button', { class: 'icon', title: 'Move down', onclick: () => { move(S.sections, i, 1); markDirty(); render(); } }, '↓'),
    )));
    const side = h('div', { class: 'side' }, list,
      h('button', { class: 'btn', onclick: () => {
        const s = { id: uid(), title: 'New section', slug: '', kind: 'projects', url: '', hidden: false, projects: [] };
        S.sections.push(s); S.sectionId = s.id; markDirty(); render();
      } }, '+ Add section'),
      h('p', { class: 'hint' }, 'Order here is the order of the looping menu. The colophon (Site tab) is added at the end.'));
    return h('div', { class: 'cols' }, side, current ? sectionEditor(current) : h('p', { class: 'hint' }, 'Add a section to get started.'));
  }

  function sectionEditor(s) {
    const kindHelp = {
      projects: 'A window with a list of projects.',
      tags: 'A window listing every tag in use (auto-generated).',
      link: 'Opens an external link instead of a window.',
      label: 'Text only — shows in the menu but does nothing.',
    };
    const help = h('p', { class: 'hint' }, kindHelp[s.kind]);
    const urlField = s.kind === 'link' ? field('URL', s, 'url', { placeholder: 'https://…' }) : null;
    const top = h('div', { class: 'grid' },
      field('Menu title', s, 'title', { onchange: (v) => { const li = document.querySelector('.side li.on .name'); if (li) li.firstChild.textContent = v || '(untitled)'; } }),
      field('URL slug', s, 'slug', { placeholder: slugify(s.title) }),
      select('Type', s, 'kind', [['projects', 'Projects'], ['tags', 'Tag index'], ['link', 'External link'], ['label', 'Label only']], render),
      urlField,
      h('div', { class: 'full' }, help, checkbox('Hide from menu', s, 'hidden')),
    );

    const out = [h('h2', {}, s.title || '(untitled)'), top];
    if (s.kind === 'projects') {
      out.push(h('h3', {}, `Projects (${s.projects.length})`));
      s.projects.forEach((p, i) => out.push(projectCard(s, p, i)));
      out.push(h('button', { class: 'btn', onclick: () => {
        const p = { id: uid(), title: 'New project', subtitle: '', body: '', fields: [], links: [], tags: [], media: [], layout: 'stack', collapsed: false, draft: true };
        s.projects.push(p); S.openProjects.add(p.id); markDirty(); render();
      } }, '+ Add project'));
    }
    out.push(h('h3', {}, 'Danger zone'), h('button', { class: 'btn danger', onclick: () => {
      if (!confirm(`Delete the section "${s.title}" and its projects? (Media files stay in the library.)`)) return;
      S.sections = S.sections.filter((x) => x !== s); S.sectionId = S.sections[0]?.id; markDirty(); render();
    } }, 'Delete section'));
    return h('div', {}, out);
  }

  function projectCard(section, p, i) {
    const open = S.openProjects.has(p.id);
    const head = h('div', { class: 'card-head', onclick: (ev) => {
      if (ev.target.closest('button')) return;
      open ? S.openProjects.delete(p.id) : S.openProjects.add(p.id); render();
    } },
      h('span', {}, open ? '▾' : '▸'),
      h('span', { class: 't' }, p.title || '(untitled)', p.subtitle ? h('em', {}, p.subtitle.replace(/\*/g, '')) : null),
      p.draft ? h('span', { class: 'badge' }, 'draft') : null,
      p.media.length ? h('span', { class: 'badge' }, `${p.media.length} media`) : null,
      h('button', { class: 'icon', title: 'Move up', onclick: () => { move(section.projects, i, -1); markDirty(); render(); } }, '↑'),
      h('button', { class: 'icon', title: 'Move down', onclick: () => { move(section.projects, i, 1); markDirty(); render(); } }, '↓'),
      h('button', { class: 'icon', title: 'Delete project', onclick: () => {
        if (confirm(`Delete "${p.title}"?`)) { section.projects.splice(i, 1); markDirty(); render(); }
      } }, '×'),
    );
    const card = h('div', { class: 'card' }, head);
    if (!open) return card;

    const body = h('div', { class: 'card-body' },
      h('div', { class: 'grid' },
        field('Title', p, 'title'),
        field('Subtitle (*italic* allowed)', p, 'subtitle'),
        field('Tags (comma separated)', p, 'tags', { transform: parseTags, placeholder: 'print, events' }),
        field('Anchor slug', p, 'slug', { placeholder: slugify(p.title) }),
        field('Description', p, 'body', { textarea: true, full: true, placeholder: 'Blank line = new paragraph. **bold**, *italic*, [link text](https://…), bare URLs and emails auto-link.' }),
      ),
      h('div', {}, h('label', {}, h('span', {}, 'Details (e.g. Client, Year, Medium, Dimensions, Role)')), pairRows(p.fields, 'label', 'value', 'Label', 'Value', '+ Add detail')),
      h('div', {}, h('label', {}, h('span', {}, 'Links')), pairRows(p.links, 'label', 'url', 'Label', 'https://…', '+ Add link')),
      h('div', {}, h('label', {}, h('span', {}, 'Media')), mediaStrip(p)),
      h('div', { class: 'grid' },
        select('Media layout', p, 'layout', [['stack', 'Stacked'], ['grid', 'Two-column grid'], ['wide', 'Full bleed']]),
        h('div', {}, checkbox('Collapsed — show first image with (More…)', p, 'collapsed'), checkbox('Draft — hidden from the site', p, 'draft', render)),
      ),
    );
    card.append(body);
    return card;
  }

  function mediaStrip(p) {
    const box = h('div', { class: 'strip' });
    p.media.forEach((id, i) => {
      const m = mediaById(id);
      box.append(h('div', { class: 'thumb' }, thumbPic(m),
        h('div', { class: 'cap', title: m?.title }, m ? m.title || m.original : 'missing'),
        h('div', { class: 'tools' },
          h('button', { class: 'icon', title: 'Earlier', onclick: () => { move(p.media, i, -1); markDirty(); render(); } }, '←'),
          m ? h('button', { class: 'icon', title: 'Edit media', onclick: () => editMedia(m) }, 'edit') : null,
          h('button', { class: 'icon', title: 'Later', onclick: () => { move(p.media, i, 1); markDirty(); render(); } }, '→'),
          h('button', { class: 'icon', title: 'Detach', onclick: () => { p.media.splice(i, 1); markDirty(); render(); } }, '×'))));
    });
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true, accept: acceptList() });
    fileInput.addEventListener('change', async () => {
      const added = await uploadFiles([...fileInput.files], p.tags.join(','));
      if (added.length) { p.media.push(...added.map((m) => m.id)); markDirty(); render(); }
    });
    box.append(h('div', { style: 'display:grid;gap:6px;align-content:start' },
      h('button', { class: 'btn small', onclick: () => pickMedia(p) }, '+ From library'),
      h('button', { class: 'btn small', onclick: () => fileInput.click() }, '+ Upload'),
      fileInput));
    return box;
  }

  function acceptList() {
    return Object.values(S.limits.types || {}).flat().join(',');
  }

  /* ---------------- media ---------------- */
  function uploadFiles(files, tags = '') {
    if (!files.length) return Promise.resolve([]);
    const max = (S.limits.maxUploadMb || 1024) * 1024 * 1024;
    const tooBig = files.filter((f) => f.size > max);
    if (tooBig.length) { toast(`Too large: ${tooBig.map((f) => f.name).join(', ')}`); files = files.filter((f) => f.size <= max); }
    const fd = new FormData();
    fd.append('tags', tags);
    files.forEach((f) => fd.append('files', f));

    const bar = h('div');
    const overlay = h('div', { class: 'modal-bg' }, h('div', { class: 'modal', style: 'max-width:420px' },
      h('p', {}, `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`), h('div', { class: 'progress' }, bar)));
    document.body.append(overlay);

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/media');
      xhr.setRequestHeader('X-Requested-With', 'portfolio-admin');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.style.width = `${(e.loaded / e.total) * 100}%`; };
      xhr.onload = () => {
        overlay.remove();
        let json = []; try { json = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status !== 200) { toast('Upload failed: ' + (json.error || xhr.statusText)); return resolve([]); }
        S.media.unshift(...json);
        toast(`Uploaded ${json.length}`);
        resolve(json);
      };
      xhr.onerror = () => { overlay.remove(); toast('Upload failed'); resolve([]); };
      xhr.send(fd);
    });
  }

  function allMediaTags() {
    return [...new Set(S.media.flatMap((m) => m.tags))].sort();
  }

  function filteredMedia(f) {
    const q = f.q.toLowerCase();
    return S.media.filter((m) => (!f.type || m.type === f.type)
      && (!f.tag || m.tags.includes(f.tag))
      && (!q || [m.title, m.caption, m.original, m.credit, m.tags.join(' ')].join(' ').toLowerCase().includes(q)));
  }

  function filterBar(f, redraw) {
    const q = h('input', { placeholder: 'Search…', value: f.q });
    q.addEventListener('input', () => { f.q = q.value; redraw(); });
    const type = h('select', {}, [['', 'All types'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['document', 'PDF']].map(([v, t]) => h('option', { value: v }, t)));
    type.value = f.type;
    type.addEventListener('change', () => { f.type = type.value; redraw(); });
    const tag = h('select', {}, h('option', { value: '' }, 'All tags'), allMediaTags().map((t) => h('option', { value: t }, t)));
    tag.value = f.tag;
    tag.addEventListener('change', () => { f.tag = tag.value; redraw(); });
    return h('div', { class: 'filters' }, q, type, tag);
  }

  function usedIn(id) {
    const out = [];
    S.sections.forEach((s) => s.projects.forEach((p) => { if (p.media.includes(id)) out.push(`${s.title} → ${p.title}`); }));
    return out;
  }

  function viewMedia() {
    const tagsInput = h('input', { placeholder: 'Tags for this upload (optional, comma separated)' });
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true, accept: acceptList() });
    const doUpload = async (files) => { if (await uploadFiles(files, tagsInput.value).then((a) => a.length)) render(); };
    fileInput.addEventListener('change', () => doUpload([...fileInput.files]));
    const drop = h('div', { class: 'drop' },
      h('div', {}, 'Drop images, video, audio or PDFs here'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Choose files'),
      h('div', { style: 'width:100%;max-width:420px' }, tagsInput),
      h('div', { class: 'hint' }, `Max ${S.limits.maxUploadMb} MB per file.`),
      fileInput);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); doUpload([...e.dataTransfer.files]); });

    const grid = h('div', { class: 'media-lib' });
    const draw = () => {
      const list = filteredMedia(S.filter);
      grid.replaceChildren(...(list.length ? list.map((m) => h('div', { class: 'thumb', onclick: () => editMedia(m) },
        thumbPic(m),
        h('div', { class: 'cap' }, m.title || m.original, h('small', {}, [m.type, fmtSize(m.size), usedIn(m.id).length ? `used ${usedIn(m.id).length}×` : 'unused'].join(' · ')),
          m.tags.length ? h('small', {}, m.tags.map((t) => '#' + t).join(' ')) : null)))
        : [h('p', { class: 'hint' }, 'No media matches.')]));
    };
    draw();
    return h('div', {}, drop, filterBar(S.filter, draw), grid);
  }

  function modal(title, content, actions) {
    const bg = h('div', { class: 'modal-bg' });
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    bg.append(h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon', onclick: close }, 'Close')),
      content, actions ? actions(close) : null));
    document.body.append(bg);
    return close;
  }

  function editMedia(m) {
    const draft = { ...m, tags: [...m.tags] };
    let preview;
    if (m.type === 'image') preview = h('img', { src: src(m), alt: '' });
    else if (m.type === 'video') preview = h('video', { src: src(m), controls: true });
    else if (m.type === 'audio') preview = h('audio', { src: src(m), controls: true });
    else preview = h('a', { href: src(m), target: '_blank' }, 'Open PDF');

    const tagHints = h('datalist', { id: 'taglist' }, allMediaTags().map((t) => h('option', { value: t })));
    const used = usedIn(m.id);
    const form = h('div', { class: 'grid' },
      field('Title', draft, 'title', { silent: true }),
      field('Credit / photographer', draft, 'credit', { silent: true }),
      field('Tags (comma separated)', draft, 'tags', { transform: parseTags, silent: true }),
      field('Alt text (describes the image for screen readers)', draft, 'alt', { full: true, silent: true }),
      field('Caption', draft, 'caption', { textarea: true, full: true, silent: true }),
      m.type === 'video' ? checkbox('Autoplay silently on loop (GIF-style, no controls)', draft, 'autoplay', null, true) : null,
    );
    const content = h('div', { class: 'split' },
      h('div', {}, h('div', { class: 'preview' }, preview),
        h('p', { class: 'hint' }, `${m.original} · ${fmtSize(m.size)} · uploaded ${new Date(m.uploaded).toLocaleDateString()}`),
        h('p', { class: 'hint' }, used.length ? `Used in: ${used.join('; ')}` : 'Not used in any project yet.'),
        h('p', { class: 'hint' }, 'Direct link: ', h('a', { href: src(m), target: '_blank' }, src(m)))),
      h('div', {}, form, tagHints));
    modal('Edit media', content, (close) => h('div', { class: 'foot-actions' },
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm(`Delete "${m.title || m.original}" permanently?${used.length ? ' It will be removed from ' + used.length + ' project(s).' : ''}`)) return;
        await api('DELETE', `/api/admin/media/${m.id}`);
        S.media = S.media.filter((x) => x.id !== m.id);
        S.sections.forEach((s) => s.projects.forEach((p) => { p.media = p.media.filter((x) => x !== m.id); }));
        close(); render(); toast('Deleted');
      } }, 'Delete file'),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          const saved = await api('PUT', `/api/admin/media/${m.id}`, draft);
          Object.assign(m, saved);
          close(); render(); toast('Media saved');
        } catch (e) { toast('Save failed: ' + e.message); }
      } }, 'Save media')));
    const tagInput = form.querySelectorAll('input')[2];
    if (tagInput) tagInput.setAttribute('list', 'taglist');
  }

  function pickMedia(p) {
    const f = { q: '', type: '', tag: '' };
    const chosen = new Set();
    const grid = h('div', { class: 'media-lib' });
    const draw = () => {
      const list = filteredMedia(f).filter((m) => !p.media.includes(m.id));
      grid.replaceChildren(...(list.length ? list.map((m) => {
        const el = h('div', { class: 'thumb pick' + (chosen.has(m.id) ? ' sel' : '') }, thumbPic(m), h('div', { class: 'cap' }, m.title || m.original));
        el.addEventListener('click', () => { chosen.has(m.id) ? chosen.delete(m.id) : chosen.add(m.id); el.classList.toggle('sel'); });
        return el;
      }) : [h('p', { class: 'hint' }, 'Nothing to add — upload something in the Media tab or use “+ Upload”.')]));
    };
    draw();
    modal(`Add media to “${p.title}”`, h('div', {}, filterBar(f, draw), grid), (close) => h('div', { class: 'foot-actions' },
      h('span'),
      h('button', { class: 'btn primary', onclick: () => {
        // keep library order
        S.media.forEach((m) => { if (chosen.has(m.id)) p.media.push(m.id); });
        markDirty(); close(); render();
      } }, 'Add selected')));
  }

  /* ---------------- site ---------------- */
  function viewSite() {
    const s = S.site;
    s.theme = s.theme || {};
    return h('div', { style: 'max-width:760px' },
      h('h2', {}, 'Site'),
      h('div', { class: 'grid' },
        field('Site title (browser tab)', s, 'title'),
        field('Colophon (last line of the menu)', s, 'colophon', { placeholder: '© Name — ’26' }),
        field('Description (search engines / link previews)', s, 'description', { full: true }),
        field('“Last updated” text (bottom left)', s, 'updated'),
        h('div', {}, h('label', {}, h('span', {}, ' ')), checkbox('Update the date automatically on save', s, 'autoUpdated')),
      ),
      h('h3', {}, 'Footer links'),
      h('p', { class: 'hint' }, 'Spread across the bottom of the page. Use mailto:you@example.com for email.'),
      pairRows(s.footer, 'label', 'url', 'Label', 'https://… or mailto:…', '+ Add link'),
      h('h3', {}, 'Look'),
      h('div', { class: 'grid' },
        field('Background colour', s.theme, 'background', { placeholder: '#ffffff' }),
        field('Text colour', s.theme, 'text', { placeholder: '#222222' }),
        field('Font stack (CSS font-family)', s.theme, 'font', { full: true, placeholder: '"Helvetica Neue", Helvetica, Arial, sans-serif' }),
      ),
    );
  }

  boot();
})();
