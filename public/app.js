const $ = id => document.getElementById(id);
let profiles = [], map;
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, data, csrf) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}
function show(html) { $('dialog-content').innerHTML = html; $('dialog').hidden = false; $('close-dialog').focus(); }
function close() { $('dialog').hidden = true; if (location.pathname !== '/') history.replaceState(null, '', '/'); }
$('close-dialog').onclick = close;
$('dialog').onclick = event => { if (event.target === $('dialog')) close(); };
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('dialog').hidden) close(); });
function projectTags(p) { return (p.projects || []).map(project => `<span class="tag p"><img src="/img/${project}.png" alt="" loading="lazy">${escapeHtml(project)}</span>`).join(''); }
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const avatar = (p, size) => `<span class="avatar av${size}"><i>${escapeHtml(initials(p.name))}</i>${p.gravatar ? `<img src="https://www.gravatar.com/avatar/${p.gravatar}?s=${size * 2}&d=blank" alt="" loading="lazy">` : ''}</span>`;
function card(p, i) { return `<article class="card" data-index="${i}" tabindex="0" role="button" aria-label="View ${escapeHtml(p.name)}"><div class="card-top">${avatar(p, 40)}<div><h3>${escapeHtml(p.name)} ↗</h3><div class="place">⌖ ${escapeHtml(p.place)} · approximate</div></div></div>${projectTags(p)}<span class="tag">${escapeHtml(p.status)}</span>${p.interests ? `<p>${escapeHtml(p.interests)}</p>` : ''}</article>`; }
function selected(p) { show(`<span class="label">// CONTRIBUTOR</span><div class="who">${avatar(p, 64)}<div><h2>${escapeHtml(p.name)}</h2><p class="muted">⌖ ${escapeHtml(p.place)} · approximate location</p></div></div>${projectTags(p)}<span class="tag">${escapeHtml(p.status)}</span><p>${escapeHtml(p.bio)}</p><p>${escapeHtml(p.interests)}</p>${p.website ? `<a href="${escapeHtml(p.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ''}`); }
function render() {
  const q = $('search').value.toLowerCase(), status = $('filter').value, project = $('project-filter').value;
  const bounds = viewOn && map ? map.getBounds() : null;
  const filtered = profiles.map((p, i) => ({p,i})).filter(({p}) => (!project || p.projects.includes(project)) && (!status || p.status === status) && (!tzOn || Math.abs(p.lng / 15 - myOffset()) < 1) && (!bounds || bounds.contains([p.lng, p.lat])) && [p.name,p.place,p.interests].join(' ').toLowerCase().includes(q));
  lastFiltered = filtered;
  if (tzOn) $('tz').textContent = `⧗ UTC${fmtOffset(myOffset())} · ${filtered.length} here now`;
  if (viewOn) $('view').textContent = `⌖ in view · ${filtered.length}`;
  const shown = filtered.slice(0, cardLimit);
  $('cards').innerHTML = shown.length ? shown.map(({p,i}) => card(p,i)).join('') : `<div class="empty"><strong>No contributors here yet.</strong><br>Be the first to put your city on the map.</div>`;
  if (filtered.length > shown.length) $('cards').insertAdjacentHTML('beforeend', `<button class="more" id="more">show ${Math.min(filtered.length - shown.length, cardLimit)} more of ${filtered.length} ↓</button>`);
  $('cards').querySelectorAll('.card').forEach(el => { const open = () => selected(profiles[Number(el.dataset.index)]); el.onclick = open; el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; });
  const source = map?.getSource('people');
  if (!source) return;
  source.setData({ type: 'FeatureCollection', features: filtered.map(({p,i}) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng,p.lat] }, properties: { index: i }
  })) });
}
let cardLimit = 60;
let viewOn = false;
let lastFiltered = [];
let fitTimer;
// Fly the globe to the matches once the user pauses typing.
function fitToMatches() {
  const q = $('search').value.trim();
  if (!map || q.length < 3 || !lastFiltered.length || lastFiltered.length > 300) return;
  const lngs = lastFiltered.map(({p}) => p.lng), lats = lastFiltered.map(({p}) => p.lat);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 6, duration: 900 });
}
$('view').onclick = () => { viewOn = false; $('view').hidden = true; render(); };
$('search').oninput = () => { cardLimit = 60; render(); clearTimeout(fitTimer); fitTimer = setTimeout(fitToMatches, 600); }; $('filter').onchange = () => { cardLimit = 60; render(); }; $('project-filter').onchange = () => { cardLimit = 60; render(); };
$('cards').addEventListener('click', e => { if (e.target.id === 'more') { cardLimit += 60; render(); } });
const myOffset = () => -new Date().getTimezoneOffset() / 60;
const fmtOffset = h => (h >= 0 ? '+' : '-') + Math.abs(Math.trunc(h)) + (h % 1 ? '30' : '');
let tzOn = false;
$('tz').onclick = () => {
  tzOn = !tzOn;
  $('tz').setAttribute('aria-pressed', String(tzOn));
  if (!tzOn) $('tz').textContent = "⧗ who's in my timezone";
  render();
};
async function load() { try { profiles = await api('/api/profiles'); $('count').textContent = profiles.length; render(); } catch { $('cards').textContent = 'Directory unavailable right now.'; } }
function initMap() {
  if (!window.maplibregl || !document.createElement('canvas').getContext('webgl2')) { $('map-overlay').hidden = false; return; }
  try {
    map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/dark', center: [5,18], zoom: 1.5, attributionControl: true });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.setProjection({ type: 'globe' });
      map.setPaintProperty('background', 'background-color', '#303137');
      map.setPaintProperty('water', 'fill-color', '#101c28');
      for (const layer of ['place_country_major', 'place_country_minor', 'place_city', 'place_city_large']) map.setPaintProperty(layer, 'text-color', '#b8b4a8');
      map.setSky({ 'sky-color': '#0a1017', 'horizon-color': '#1a2430', 'fog-color': '#0c1218', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.6 });
      map.addSource('people', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 55 });
      map.addLayer({ id: 'halo', type: 'circle', source: 'people', filter: ['!', ['has','point_count']], paint: { 'circle-color': '#ffc107', 'circle-opacity': 0.18, 'circle-radius': ['interpolate',['linear'],['zoom'],1,4,6,16], 'circle-blur': 0.5 } });
      map.addLayer({ id: 'cluster-halo', type: 'circle', source: 'people', filter: ['has','point_count'], paint: { 'circle-color': '#ffc107', 'circle-opacity': 0.15, 'circle-blur': 0.4, 'circle-radius': ['step',['get','point_count'],26,10,34,50,46] } });
      map.addLayer({ id: 'clusters', type: 'circle', source: 'people', filter: ['has','point_count'], paint: { 'circle-color': '#ffc107', 'circle-radius': ['step',['get','point_count'],16,10,21,50,28], 'circle-stroke-color': '#121212', 'circle-stroke-width': 3 } });
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'people', filter: ['has','point_count'], layout: { 'text-field':['get','point_count_abbreviated'], 'text-size': 12, 'text-font':['Noto Sans Bold'] }, paint: { 'text-color': '#121212' } });
      map.addLayer({ id: 'points', type: 'circle', source: 'people', filter: ['!', ['has','point_count']], paint: { 'circle-color':'#ffc107', 'circle-radius':6, 'circle-stroke-color':'#121212', 'circle-stroke-width':2 } });
      map.on('click','clusters', async e => { const feature = e.features[0]; const zoom = await map.getSource('people').getClusterExpansionZoom(feature.properties.cluster_id); viewOn = true; $('view').hidden = false; map.easeTo({ center: feature.geometry.coordinates, zoom }); });
      map.on('click','points', e => selected(profiles[e.features[0].properties.index]));
      map.on('mouseenter','points', () => map.getCanvas().style.cursor='pointer');
      map.on('mouseleave','points', () => map.getCanvas().style.cursor='');
      render();
    });
    map.on('moveend', e => {
      if (e.originalEvent) { viewOn = true; $('view').hidden = false; }
      if (viewOn) render();
    });
    map.on('error', () => { $('map-overlay').hidden = false; });
  } catch { $('map-overlay').hidden = false; }
}
$('request-form').onsubmit = async e => { e.preventDefault(); const msg = $('request-message'); msg.textContent = 'Checking...'; try { msg.textContent = (await api('/api/request', { email: $('email').value })).message; } catch (error) { msg.textContent = error.message; } };
const field = (label, key, value='', attrs='') => `<label>${label}<input name="${key}" value="${escapeHtml(value)}" ${attrs}></label>`;
async function edit() {
  let me;
  try { me = await api('/api/me'); } catch (e) { show(`<h2>Link expired</h2><p>${escapeHtml(e.message)}</p><a class="button" href="/#join">Request another link →</a>`); return; }
  const p = me.profile || {};
  show(`<span class="label">// YOUR SPACE</span><h2>Make it yours.</h2><p class="muted">Only share what you want others to see. Your email stays private.</p><form class="edit-form" id="edit-form">
  ${field('DISPLAY NAME','name',p.name,'required maxlength="80"')}
  ${field('CITY / REGION / COUNTRY (approximate only)','place',p.place,'required maxlength="100" placeholder="Vienna, Austria"')}
  <button type="button" id="find-place" class="quiet-link">⌕ Find this city →</button><div id="places" role="status"></div>
  <input type="hidden" name="lat" value="${escapeHtml(p.lat ?? '')}"><input type="hidden" name="lng" value="${escapeHtml(p.lng ?? '')}"><small>Choose a city from the results to place your approximate marker. Never enter an address.</small>
  <label>STATUS<select name="status">${['Just browsing','Open to meetups','Open to mentoring'].map(s => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
  ${field('INTERESTS (comma-separated)','interests',p.interests,'maxlength="120" placeholder="Blink, graphics, accessibility"')}
  <label>SHORT BIO<textarea name="bio" maxlength="400" rows="3">${escapeHtml(p.bio || '')}</textarea></label>
  ${field('WEBSITE (HTTPS ONLY)','website',p.website,'type="url" maxlength="200" placeholder="https://..."')}
  <label><input type="checkbox" name="published" ${p.published ? 'checked' : ''}> Publish my profile and approximate city on the map</label>
  <button class="button" type="submit">Save profile →</button><p id="edit-message" role="status"></p>
  <div class="row"><button class="danger" type="button" id="hide">Hide profile</button><button class="danger" type="button" id="delete">Delete profile permanently</button></div></form>`);
  const formElement = $('edit-form');
  const placeField = formElement.elements.place;
  placeField.addEventListener('input', () => { formElement.elements.lat.value = ''; formElement.elements.lng.value = ''; });
  function selectPlace(place) {
    placeField.value = place.label;
    formElement.elements.lat.value = place.lat;
    formElement.elements.lng.value = place.lng;
    $('places').textContent = `Selected: ${place.label} (approximate)`;
  }
  async function findPlace(autoSelect = false) {
    $('places').textContent = 'Searching...';
    const places = await api(`/api/places?q=${encodeURIComponent(placeField.value)}`);
    $('places').replaceChildren();
    if (!places.length) throw new Error('City not found. Try a nearby city.');
    const exact = places.find(place => place.label.toLowerCase() === placeField.value.trim().toLowerCase());
    if (autoSelect && (exact || places.length === 1)) { selectPlace(exact || places[0]); return; }
    for (const place of places) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'place-option'; button.textContent = place.label;
      button.onclick = () => selectPlace(place);
      $('places').append(button);
    }
    if (autoSelect) throw new Error('Choose your city from the suggestions before saving.');
  }
  $('find-place').onclick = () => findPlace().catch(error => { $('places').textContent = error.message; });
  $('edit-form').onsubmit = async e => {
    e.preventDefault();
    try {
      if (!formElement.elements.lat.value || !formElement.elements.lng.value) await findPlace(true);
      const form = new FormData(e.target), data = Object.fromEntries(form);
      data.published = form.has('published');
      $('edit-message').textContent = (await api('/api/profile', data, me.csrf)).message;
      await load();
    } catch (error) { $('edit-message').textContent = error.message; }
  };
  $('hide').onclick = async () => { try { $('edit-message').textContent = (await api('/api/hide',{},me.csrf)).message; await load(); } catch(e) { $('edit-message').textContent = e.message; } };
  $('delete').onclick = async () => { if (!confirm('Permanently delete your profile?')) return; try { $('edit-message').textContent = (await api('/api/delete',{},me.csrf)).message; await load(); } catch(e) { $('edit-message').textContent = e.message; } };
}
async function verify() {
  const value = new URLSearchParams(location.search).get('token');
  show(`<span class="label">// VERIFY</span><h2>One more step.</h2><p>Continue to your private profile editor. This link expires after 20 minutes.</p><button class="button" id="redeem">Continue →</button><p id="verify-message" role="status"></p>`);
  $('redeem').onclick = async () => { try { await api('/api/redeem',{token:value}); history.replaceState(null,'','/edit'); await edit(); } catch (e) { $('verify-message').textContent = e.message; } };
}
initMap(); load();
if (location.hostname === 'localhost') {
  $('request-form').insertAdjacentHTML('beforeend', '<p><a href="/magic-links">View local magic links →</a></p>');
}
if (location.pathname === '/verify') verify(); else if (location.pathname === '/edit') edit();
if (location.hostname === 'localhost') {
  const reload = new EventSource('/dev/reload');
  let disconnected = false;
  reload.onerror = () => { disconnected = true; };
  reload.onmessage = event => { if (event.data === 'reload' || disconnected) location.reload(); };
}
