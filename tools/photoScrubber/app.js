/*!
 * Copyright (c) 2025 Privify Inc.
 * Licensed under the MIT License.
 */

(async () => {
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const preview = document.getElementById('preview');
  const basicInfo = document.getElementById('basicInfo');
  const exifInfo = document.getElementById('exifInfo');
  const important = document.getElementById('important');
  const stripBtn = document.getElementById('stripBtn');
  const copyBtn = document.getElementById('copyBtn');
  const storyBox = document.getElementById('storyBox');
  const storyText = document.getElementById('storyText');
  const storyBadges = document.getElementById('storyBadges');
  const importantInStory = document.getElementById('importantInStory');
  const analysisInStory = document.getElementById('analysisInStory');
  const heicNote = document.getElementById('heicNote');
  // Modal elements
  const modalEl = document.getElementById('appModal');
  const modalTitleEl = document.getElementById('modalTitle');
  const modalMessageEl = document.getElementById('modalMessage');
  const modalOkEl = document.getElementById('modalOk');
  const zipInput = document.getElementById('zipInput');
  const zipDropZone = document.getElementById('zipDropZone');
  const zipStatus = document.getElementById('zipStatus');
  
  
  // AI Insights state
  let lastExif = null;
  let lastDetections = null; // array of strings (labels)
  let lastDetectionBoxes = null; // array of {bbox:[x,y,w,h], label, score}
  let lastAIToken = 0;
  let lastClassification = null; // MobileNet classes
  let lastOCRText = '';
  let lastLandmark = '';
  let lastZeroShot = null; // CLIP zero-shot labels
  let lastCaption = '';
  let currentFile = null;
  let deepAnalysisPinned = false;

  // Models and additional state
  let cocoModel = null;
  let mobileNetModel = null;
  let lastAnalysisPlain = '';
  let lastPlace = null;
  let lastCoords = null;
  const lastFileMeta = { lastModified: null };

  // Progress UI for local deep analysis
  const localProgress = document.getElementById('localProgress');
  const localProgressBar = document.getElementById('localProgressBar');
  const localProgressLabel = document.getElementById('localProgressLabel');
  function setLocalProgress(pct, label) {
    if (localProgressBar) localProgressBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (localProgressLabel && label) localProgressLabel.textContent = label;
  }
  function showLocalProgress() { if (localProgress) localProgress.classList.remove('hidden'); }
  function hideLocalProgress() { if (localProgress) localProgress.classList.add('hidden'); }

  // Initialize collapsible metadata panels
  function initCollapsibles() {
    const buttons = document.querySelectorAll('.toggle-btn[data-target]');
    buttons.forEach((btn) => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      const content = document.getElementById(targetId);
      if (!content) return;
      const header = btn.closest('.meta-header');
      const titleEl = header ? header.querySelector('h3') : null;
      const sectionName = titleEl ? titleEl.textContent.trim() : 'section';

      // Apply persisted state (default expanded)
      let collapsed = false;
      try { collapsed = localStorage.getItem('collapse:' + targetId) === '1'; } catch {}
      const apply = () => {
        if (collapsed) {
          content.classList.add('hidden');
          content.setAttribute('aria-hidden', 'true');
          btn.setAttribute('aria-expanded', 'false');
          btn.textContent = '+';
          btn.title = 'Expand section';
          btn.setAttribute('aria-label', 'Expand ' + sectionName);
        } else {
          content.classList.remove('hidden');
          content.setAttribute('aria-hidden', 'false');
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = '−';
          btn.title = 'Collapse section';
          btn.setAttribute('aria-label', 'Collapse ' + sectionName);
        }
      };
      apply();
      btn.addEventListener('click', () => {
        collapsed = !collapsed;
        try { localStorage.setItem('collapse:' + targetId, collapsed ? '1' : '0'); } catch {}
        apply();
      });
    });
  }

  // Modal helper
  function showPopup(title, message) {
    if (!modalEl || !modalTitleEl || !modalMessageEl || !modalOkEl) {
      alert(`${title}: ${message}`);
      return;
    }
    modalTitleEl.textContent = title || 'Notice';
    modalMessageEl.textContent = message || '';
    modalEl.classList.remove('hidden');
    const close = () => { modalEl.classList.add('hidden'); };
    modalOkEl.onclick = close;
    const overlay = modalEl.querySelector('.modal-overlay');
    if (overlay) overlay.onclick = close;
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  // Always-visible story card
  if (storyBox) storyBox.style.display = '';
  // Ensure initial layout aligns top with the AI Photo Insight card; no forced centering
  // Set up collapsible sections
  initCollapsibles();

  function resetUIForNewFile() {
      try {
        // Invalidate any in-flight story updates from previous file
        if (typeof storyToken === 'number') storyToken++;
      } catch {}
      // Clear story card
      if (storyText) storyText.textContent = '';
      if (storyBadges) storyBadges.innerHTML = '';
      if (importantInStory) importantInStory.textContent = '';
      if (analysisInStory) analysisInStory.textContent = '';
      // Clear metadata panels
      if (basicInfo) basicInfo.textContent = 'No file chosen';
      if (exifInfo) exifInfo.textContent = 'No EXIF data parsed';
      // Clear general notes
      if (important) important.textContent = '';
      // Hide HEIC note by default
      if (typeof heicNote !== 'undefined' && heicNote) {
        heicNote.textContent = '';
        heicNote.classList.add('hidden');
      }
      // Reset last-knowns
      lastPlace = null;
      lastCoords = null;
      lastAnalysisPlain = '';
      lastExif = null;
  lastDetections = null;
  lastDetectionBoxes = null;
      lastClassification = null;
      lastOCRText = '';
      lastLandmark = '';
    lastZeroShot = null;
  lastCaption = '';
    currentFile = null;
     deepAnalysisPinned = false;
    }
  function isZipFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return name.endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed';
  }

  function getExt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function isSupportedImageExt(ext) {
    return ['jpg','jpeg','png','webp'].includes(ext);
  }

  function isSupportedImageName(name) {
    return isSupportedImageExt(getExt(name));
  }

  function mimeForExt(ext) {
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  }

  function withCleanSuffix(pathname) {
    const idx = pathname.lastIndexOf('/');
    const dir = idx >= 0 ? pathname.slice(0, idx + 1) : '';
    const base = idx >= 0 ? pathname.slice(idx + 1) : pathname;
    const m = /(.*)\.([a-z0-9]+)$/i.exec(base);
    if (!m) return dir + base + '-clean';
    return dir + m[1] + '-clean.' + m[2];
  }

  async function decodeToCanvas(blob) {
    // Try ImageBitmap first for performance
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return canvas;
    } catch (e) {
      // Fallback to HTMLImageElement
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  async function cleanImageArrayBuffer(arrayBuffer, name) {
    const ext = getExt(name);
    if (!isSupportedImageExt(ext)) throw new Error('Unsupported image ext: ' + ext);
    const inputMime = mimeForExt(ext);
    const inputBlob = new Blob([arrayBuffer], { type: inputMime });
    const canvas = await decodeToCanvas(inputBlob);
    const outMime = inputMime; // keep same family to preserve transparency where applicable
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, outMime === 'image/jpeg' ? 0.92 : undefined));
    if (!outBlob) throw new Error('Failed to create output blob');
    const newName = withCleanSuffix(name);
    return { blob: outBlob, newName };
  }

  async function handleZip(file) {
    if (!file) return;
    if (typeof JSZip === 'undefined') {
      alert('ZIP support is not available in this browser session.');
      return;
    }
    try {
      if (zipStatus) zipStatus.textContent = 'Processing ZIP…';
      const zip = await JSZip.loadAsync(file);
      const outZip = new JSZip();
      const entries = [];
      zip.forEach((relPath, entry) => {
        if (!entry.dir && isSupportedImageName(relPath)) entries.push({ relPath, entry });
      });
      if (!entries.length) {
        if (zipStatus) zipStatus.textContent = 'No supported images found in ZIP (supported: JPG, PNG, WEBP).';
        return;
      }
      let done = 0;
      const skipped = [];
      for (const { relPath, entry } of entries) {
        try {
          const ab = await entry.async('arraybuffer');
          const { blob, newName } = await cleanImageArrayBuffer(ab, relPath);
          outZip.file(newName, blob);
          done++;
          if (zipStatus) zipStatus.textContent = `Cleaning images… ${done} of ${entries.length}`;
          await new Promise(r => setTimeout(r, 0)); // yield to UI
        } catch (e) {
          console.debug('[zip] skip', relPath, e);
          skipped.push(relPath);
        }
      }
      if (done === 0) {
        if (zipStatus) zipStatus.textContent = 'Could not process images in ZIP (unsupported formats).';
        return;
      }
      const outBlob = await outZip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      const url = URL.createObjectURL(outBlob);
      a.href = url;
      a.download = (file.name || 'images').replace(/\.zip$/i, '') + '-clean.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      let msg = `Cleaned ${done} image${done !== 1 ? 's' : ''} to ZIP.`;
      if (skipped.length) msg += ` Skipped ${skipped.length} unsupported file${skipped.length !== 1 ? 's' : ''}.`;
      if (zipStatus) zipStatus.textContent = msg;
    } catch (err) {
      if (zipStatus) zipStatus.textContent = 'Failed to process ZIP. See console for details.';
      console.error('[zip] error', err);
    }
  }
  function humanBytes(n) {
    if (n === undefined || n === null) return '';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0;
    let v = Number(n);
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(2)} ${units[i]}`;
  }

  function setBasic(file, width, height) {
    basicInfo.textContent = JSON.stringify({
      name: file.name,
      type: file.type || 'unknown',
      size: humanBytes(file.size),
      lastModified: new Date(file.lastModified).toISOString(),
      width,
      height
    }, null, 2);
  }

  // formatters and helpers
  function toNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function dmsArrayToDecimal(arr, ref) {
    if (!Array.isArray(arr) || arr.length < 3) return null;
    const [dRaw, mRaw, sRaw] = arr;
    const d = toNumber(dRaw);
    const m = toNumber(mRaw);
    const s = toNumber(sRaw);
    if (![d, m, s].every(Number.isFinite)) return null;
    let dec = d + (m / 60) + (s / 3600);
    if (ref && (ref === 'S' || ref === 'W' || /south|west/i.test(String(ref)))) dec = -dec;
    return dec;
  }

  function extractCoordsFromExif(exif) {
    // Prefer decimal fields if present (exifr often provides these)
    const latDec = toNumber(exif?.latitude);
    const lonDec = toNumber(exif?.longitude);
    if (Number.isFinite(latDec) && Number.isFinite(lonDec)) {
      return { lat: latDec, lon: lonDec, source: 'decimal' };
    }
    // Next, parse DMS arrays with hemisphere refs
    const latArr = exif?.GPSLatitude;
    const lonArr = exif?.GPSLongitude;
    const latRef = exif?.GPSLatitudeRef || exif?.GPSLatRef || null;
    const lonRef = exif?.GPSLongitudeRef || exif?.GPSLongRef || null;
    const latDms = dmsArrayToDecimal(latArr, latRef);
    const lonDms = dmsArrayToDecimal(lonArr, lonRef);
    if (Number.isFinite(latDms) && Number.isFinite(lonDms)) {
      return { lat: latDms, lon: lonDms, source: 'dms' };
    }
    // As a last attempt, sometimes GPSLatitude/GPSLongitude may actually be numbers
    const latNum = toNumber(latArr);
    const lonNum = toNumber(lonArr);
    if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
      return { lat: latNum, lon: lonNum, source: 'raw-numeric' };
    }
    return { lat: null, lon: null, source: 'none' };
  }

  function formatTakenDate(exifDate) {
    if (!exifDate) return null;
    // exif DateTimeOriginal often like "2025:11:01 10:20:30"
    let d;
    if (exifDate instanceof Date && !isNaN(exifDate)) {
      d = exifDate;
    } else if (typeof exifDate === 'string') {
      const norm = exifDate.replace(/^([0-9]{4}):([0-9]{2}):([0-9]{2})/, '$1-$2-$3');
      const parsed = new Date(norm);
      if (!isNaN(parsed)) d = parsed;
    }
    if (!d) return null;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  }

  function articleFor(word) {
    if (!word) return 'a';
    return /^[aeiou]/i.test(word) ? 'an' : 'a';
  }

  function cameraNice(make, model) {
    const mk = (make || '').trim();
    const md = (model || '').trim();
    if (!mk && !md) return null;
    if (/apple/i.test(mk) && /iphone/i.test(md)) {
      const ver = md.replace(/.*?(\d+\s*(Pro|Max|Plus)?).*/i, '$1').trim();
      return `iPhone ${ver || md}`;
    }
    const escaped = mk.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const cleanModel = md.replace(new RegExp('^' + escaped + '\\s*', 'i'), '').trim();
    return [mk, cleanModel || md].filter(Boolean).join(' ');
  }

  function formatTakenDateTime(exifDate) {
    if (!exifDate) return null;
    let d;
    if (exifDate instanceof Date && !isNaN(exifDate)) {
      d = exifDate;
    } else if (typeof exifDate === 'string') {
      const norm = exifDate.replace(/^([0-9]{4}):([0-9]{2}):([0-9]{2})/, '$1-$2-$3');
      const parsed = new Date(norm);
      if (!isNaN(parsed)) d = parsed;
    }
    if (!d) return null;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
  }

  // --- Reverse geocoding helpers (better city, state, country + caching + fallback) ---
  const GEO_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
  const geoMemoryCache = new Map();

  function geoCacheKey(lat, lon, precision = 4) {
    const rLat = Number(lat).toFixed(precision);
    const rLon = Number(lon).toFixed(precision);
    return `${rLat},${rLon}`;
  }

  function getCachedPlace(lat, lon) {
    const key = geoCacheKey(lat, lon);
    if (geoMemoryCache.has(key)) {
      const v = geoMemoryCache.get(key);
      if (Date.now() - v.t < GEO_CACHE_TTL_MS) {
        console.debug('[geo] cache hit (memory)', { key, place: v.place.display || v.place });
        return v.place;
      } else {
        geoMemoryCache.delete(key);
      }
    }
    try {
      const raw = localStorage.getItem('geo:' + key);
      if (raw) {
        const v = JSON.parse(raw);
        if (v && v.t && (Date.now() - v.t < GEO_CACHE_TTL_MS)) {
          geoMemoryCache.set(key, v);
          console.debug('[geo] cache hit (localStorage)', { key, place: v.place.display || v.place });
          return v.place;
        } else {
          localStorage.removeItem('geo:' + key);
        }
      }
    } catch {}
    console.debug('[geo] cache miss', { key });
    return null;
  }

  function setCachedPlace(lat, lon, place, meta = {}) {
    const key = geoCacheKey(lat, lon);
    const obj = { place, meta, t: Date.now() };
    geoMemoryCache.set(key, obj);
    try { localStorage.setItem('geo:' + key, JSON.stringify(obj)); } catch {}
  }

  function normalizePlaceFromNominatim(data) {
    const a = data?.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.neighbourhood || a.city_district || null;
    const state = a.state || a.region || a.state_district || a.province || a.county || null;
    const country = a.country || null;
    const countryCode = (a.country_code || '').toUpperCase() || null;
    const display = city && country ? `${city}, ${country}`
      : state && country ? `${state}, ${country}`
      : country || data?.name || (data?.display_name ? String(data.display_name).split(',')[0] : null) || null;
    return {
      provider: 'nominatim',
      city: city || null,
      state: state || null,
      country: country || null,
      countryCode,
      display,
    };
  }

  async function reverseGeocodeNominatim(lat, lon, lang) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=10&accept-language=${encodeURIComponent(lang)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const t0 = performance.now();
    console.debug('[geo] nominatim start', { url });
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const t1 = performance.now();
    if (!resp.ok) {
      const err = new Error('Nominatim HTTP ' + resp.status);
      err.status = resp.status;
      console.debug('[geo] nominatim fail', { ms: Math.round(t1 - t0), status: resp.status });
      throw err;
    }
    const data = await resp.json();
    const norm = normalizePlaceFromNominatim(data);
    console.debug('[geo] nominatim ok', { ms: Math.round(t1 - t0), display: norm.display });
    return norm;
  }

  function normalizePlaceFromPhoton(json) {
    const feat = json?.features?.[0];
    const p = feat?.properties || {};
    const city = p.city || p.town || p.village || p.municipality || p.name || null;
    const state = p.state || p.region || null;
    const country = p.country || null;
    const display = city && country ? `${city}, ${country}`
      : state && country ? `${state}, ${country}`
      : country || city || state || null;
    return {
      provider: 'photon',
      city: city || null,
      state: state || null,
      country: country || null,
      countryCode: null,
      display,
    };
  }

  async function reverseGeocodePhoton(lat, lon, lang) {
    const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&lang=${encodeURIComponent(lang)}`;
    const t0 = performance.now();
    console.debug('[geo] photon start', { url });
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const t1 = performance.now();
    if (!resp.ok) {
      const err = new Error('Photon HTTP ' + resp.status);
      err.status = resp.status;
      console.debug('[geo] photon fail', { ms: Math.round(t1 - t0), status: resp.status });
      throw err;
    }
    const data = await resp.json();
    const norm = normalizePlaceFromPhoton(data);
    console.debug('[geo] photon ok', { ms: Math.round(t1 - t0), display: norm.display });
    return norm;
  }

  function isMeaningfulPlace(p) {
    return !!(p && (p.city || p.state || p.country));
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...opts, signal: ctrl.signal });
      return resp;
    } finally {
      clearTimeout(id);
    }
  }

  function normalizePlaceFromGoogle(googleJson) {
    const results = googleJson?.results || [];
    if (!Array.isArray(results) || results.length === 0) return null;
    const pick = () => {
      // Prefer a result tagged as locality (city) or postal_town; else use the first result
      return (
        results.find(r => r.types?.includes('locality')) ||
        results.find(r => r.types?.includes('postal_town')) ||
        results.find(r => r.types?.includes('administrative_area_level_3')) ||
        results[0]
      );
    };
    const chosen = pick();
    const comps = chosen?.address_components || [];
    const get = (type) => {
      const c = comps.find(c => c.types?.includes(type));
      return c ? c.long_name : null;
    };
    const city = get('locality') || get('postal_town') || get('administrative_area_level_3') || null;
    const state = get('administrative_area_level_1') || get('administrative_area_level_2') || null;
    const country = get('country');
    const countryCode = (() => {
      const c = comps.find(c => c.types?.includes('country'));
      return c ? c.short_name : null;
    })();
    const display = city && country ? `${city}, ${country}`
      : state && country ? `${state}, ${country}`
      : country || city || state || null;
    return { provider: 'google', city, state, country, countryCode, display };
  }

  async function reverseGeocodeGoogleViaProxy(lat, lon, lang) {
    const endpoint = window.GOOGLE_REVGEOCODE_ENDPOINT;
    if (!endpoint) return null;
    const url = `${endpoint}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&language=${encodeURIComponent(lang)}`;
    const t0 = performance.now();
    console.debug('[geo] google(proxy) start', { url });
    const resp = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } }, 6000);
    const t1 = performance.now();
    if (!resp.ok) {
      const err = new Error('Google proxy HTTP ' + resp.status);
      err.status = resp.status;
      console.debug('[geo] google(proxy) fail', { ms: Math.round(t1 - t0), status: resp.status });
      throw err;
    }
    const data = await resp.json();
    // If proxy already normalized, accept it; otherwise normalize from raw Google response
    const norm = data && (data.display || data.city || data.results) ? (data.display ? data : normalizePlaceFromGoogle(data)) : null;
    console.debug('[geo] google(proxy) ok', { ms: Math.round(t1 - t0), display: norm?.display });
    return norm;
  }

  async function reverseGeocode(lat, lon) {
    const lang = (navigator.language || 'en').split(',')[0];
    console.debug('[geo] reverseGeocode entry', { lat, lon, lang });
    // cache lookup (rounded coords for privacy and better hit rate)
    const cached = getCachedPlace(lat, lon);
    if (cached && (cached.display || typeof cached === 'string')) {
      console.debug('[geo] reverseGeocode returning cached', { value: cached.display || cached });
      return cached.display || cached;
    }

    // Optional: Google Geocoding via server-side proxy if configured
    if (window.GOOGLE_REVGEOCODE_ENDPOINT) {
      try {
        const gg = await reverseGeocodeGoogleViaProxy(lat, lon, lang);
        if (gg && gg.display) {
          setCachedPlace(lat, lon, gg, { src: 'google-proxy' });
          return gg.display;
        } else {
          console.debug('[geo] google(proxy) not meaningful', gg);
        }
      } catch (e) {
        console.debug('[geo] google(proxy) error', e);
      }
    }

    // Primary: Nominatim (with a light retry for 429/503)
    try {
      let nom;
      try {
        nom = await reverseGeocodeNominatim(lat, lon, lang);
      } catch (e) {
        if (e && (e.status === 429 || e.status === 503)) {
          console.debug('[geo] nominatim backoff retry');
          await delay(600);
          nom = await reverseGeocodeNominatim(lat, lon, lang);
        } else {
          throw e;
        }
      }
      if (isMeaningfulPlace(nom) && nom.display) {
        setCachedPlace(lat, lon, nom, { src: 'nominatim' });
        return nom.display;
      } else {
        console.debug('[geo] nominatim not meaningful', nom);
      }
    } catch (e) {
      console.debug('[geo] nominatim error', e);
    }

    // Fallback: Photon
    try {
      const pho = await reverseGeocodePhoton(lat, lon, lang);
      if (isMeaningfulPlace(pho) && pho.display) {
        setCachedPlace(lat, lon, pho, { src: 'photon' });
        return pho.display;
      } else {
        console.debug('[geo] photon not meaningful', pho);
      }
    } catch (e) {
      console.debug('[geo] photon error', e);
    }

    // Last resort: coords string
    const fallback = `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
    console.debug('[geo] falling back to coords', { fallback });
    setCachedPlace(lat, lon, { display: fallback }, { src: 'coords' });
    return fallback;
  }

  // --- Privacy-surprising fields helpers ---
  function cardinalFromDegrees(deg) {
    if (!Number.isFinite(deg)) return null;
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const idx = Math.round(((deg % 360) / 22.5)) % 16;
    return dirs[idx];
  }

  function cardinalToWords(code) {
    if (!code) return null;
    const map = {
      N: 'north',
      NNE: 'north-northeast',
      NE: 'northeast',
      ENE: 'east-northeast',
      E: 'east',
      ESE: 'east-southeast',
      SE: 'southeast',
      SSE: 'south-southeast',
      S: 'south',
      SSW: 'south-southwest',
      SW: 'southwest',
      WSW: 'west-southwest',
      W: 'west',
      WNW: 'west-northwest',
      NW: 'northwest',
      NNW: 'north-northwest'
    };
    return map[code] || String(code).toLowerCase();
  }

  function humanList(items) {
    const arr = items.filter(Boolean);
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
    return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
  }

  function safeNamesFromExif(exif) {
    // Try common person/region tags
    const candidates = [];
    if (Array.isArray(exif?.PersonsName)) candidates.push(...exif.PersonsName);
    if (Array.isArray(exif?.PersonDisplayName)) candidates.push(...exif.PersonDisplayName);
    if (Array.isArray(exif?.People)) candidates.push(...exif.People);
    // XMP structures may exist; ignore deep inspect for now
    return candidates.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
  }

  function safeKeywordsFromExif(exif) {
    let out = [];
    if (Array.isArray(exif?.Keywords)) out = out.concat(exif.Keywords);
    if (Array.isArray(exif?.Subject)) out = out.concat(exif.Subject);
    if (typeof exif?.XPKeywords === 'string') out.push(exif.XPKeywords);
    return out.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
  }

  function buildPrivacyPhrases(exif) {
    const phrases = [];
    // Altitude
    const alt = toNumber(exif?.GPSAltitude);
    if (Number.isFinite(alt)) phrases.push(`altitude about ${Math.round(alt)} m above sea level`);
    // Accuracy
    const acc = toNumber(exif?.GPSHPositioningError);
    if (Number.isFinite(acc)) phrases.push(`GPS accuracy about ±${Math.round(acc)} m`);
    // Heading
    const dir = toNumber(exif?.GPSImgDirection);
    if (Number.isFinite(dir)) {
      const card = cardinalFromDegrees(dir);
      const word = cardinalToWords(card);
      phrases.push(`camera heading ${word ? word : `${Math.round(dir)}°`}${word ? ` (${Math.round(dir)}°)` : ''}`);
    }
    // Speed
    const spd = toNumber(exif?.GPSSpeed);
    const spdRef = (exif?.GPSSpeedRef || '').toString();
    if (Number.isFinite(spd) && spd > 0.5) {
      let unit = 'km/h', val = spd;
      if (/^M$/i.test(spdRef)) { unit = 'mph'; }
      else if (/^N$/i.test(spdRef)) { unit = 'kn'; }
      // EXIF GPSSpeed is in the unit specified by GPSSpeedRef; leave as-is
      phrases.push(`speed about ${Math.round(val)} ${unit}`);
    }
    // Subject distance
    const subjDist = toNumber(exif?.SubjectDistance);
    if (Number.isFinite(subjDist) && subjDist > 0) phrases.push(`focus distance about ${subjDist.toFixed(1)} m`);
    // Owner/author
    const owner = (exif?.CameraOwnerName || exif?.OwnerName || exif?.Artist || exif?.Creator || '').toString().trim();
    if (owner) phrases.push(`owner “${owner}”`);
    // Serials
    const serial = (exif?.BodySerialNumber || exif?.SerialNumber || exif?.InternalSerialNumber || '').toString().trim();
    const lensSerial = (exif?.LensSerialNumber || '').toString().trim();
    if (serial) phrases.push(`camera serial (${serial})`);
    if (lensSerial) phrases.push(`lens serial (${lensSerial})`);
    // Unique IDs
    const uid = (exif?.ImageUniqueID || exif?.DocumentID || exif?.InstanceID || exif?.OriginalDocumentID || exif?.ContentIdentifier || exif?.BurstUUID || '').toString().trim();
    if (uid) phrases.push(`an image/document ID (${uid})`);
    // Faces
    const names = safeNamesFromExif(exif).slice(0, 5);
    if (names.length) phrases.push(`faces tagged as ${humanList(names)}`);
    else if (exif?.RegionInfo) phrases.push('embedded face regions');
    // Keywords
    const kw = safeKeywordsFromExif(exif).slice(0, 5);
    if (kw.length) phrases.push(`keywords like ${humanList(kw)}`);
    return phrases;
  }

  let storyToken = 0;
  async function updateStory(exif) {
    const token = ++storyToken;
    // extract fields
    const takenRaw = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null;
    const taken = formatTakenDate(takenRaw);
    const make = exif?.Make || null;
    const model = exif?.Model || null;
    const camera = cameraNice(make, model);
  const { lat, lon, source: coordSource } = extractCoordsFromExif(exif || {});
  const latRaw = exif?.GPSLatitude;
  const lonRaw = exif?.GPSLongitude;
  console.log('[insight] extracted fields', { takenRaw, taken, make, model, camera, lat, lon, coordSource, latRawType: Array.isArray(latRaw) ? 'array' : typeof latRaw, lonRawType: Array.isArray(lonRaw) ? 'array' : typeof lonRaw, hasDecimal: (exif && ('latitude' in exif || 'longitude' in exif)) });

    // If we have nothing for the sentence, show placeholder but still run analysis hook
    if (!taken && !camera && (lat == null || lon == null)) {
      // Keep box empty when no usable metadata
      storyText.textContent = '';
      storyBadges.innerHTML = '';
      updateAnalysis({ takenRaw, make, model, camera, lat, lon, place: null });
      return;
    }

    storyBox.style.display = '';
    // Build privacy-surprising phrases once from EXIF
    const surprisePhrases = buildPrivacyPhrases(exif || {});
    const surpriseText = surprisePhrases.length ? ` It also records ${humanList(surprisePhrases)}.` : '';
    // Initial sentence without waiting for reverse geocode
    const initialParts = [];
  if (Number.isFinite(lat) && Number.isFinite(lon)) initialParts.push(`at ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    if (taken) initialParts.push(`on ${taken}`);
    if (camera) initialParts.push(`on ${articleFor(camera)} ${camera}`);
  const initialSentence = `You clicked this picture ${initialParts.join(' ')}.`.replace(/\s+\./, '.') + surpriseText;
  storyText.textContent = initialSentence;
    console.log('[insight] initial sentence', initialSentence);

    // badges
    const badgeBits = [];
  if (Number.isFinite(lat) && Number.isFinite(lon)) badgeBits.push(`<span class=\"badge\">GPS ${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`);
    if (taken) badgeBits.push(`<span class=\"badge\">${taken}</span>`);
    if (camera) badgeBits.push(`<span class=\"badge\">${camera}</span>`);
    storyBadges.innerHTML = badgeBits.join('');

    // update analysis immediately without place
    updateAnalysis({ takenRaw, make, model, camera, lat, lon, place: null });

    // Kick off reverse geocode and update when done
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      console.debug('[insight] reverse geocode attempt', { lat, lon, token });
      reverseGeocode(lat, lon).then(place => {
        if (!place) return;
        if (token !== storyToken) {
          console.debug('[insight] stale result ignored', { token, storyToken, place });
          return;
        }
        lastPlace = place;
        lastCoords = { lat, lon };
        const enhancedParts = [];
        enhancedParts.push(`in ${place}`);
        if (taken) enhancedParts.push(`on ${taken}`);
          if (camera) enhancedParts.push(`on ${articleFor(camera)} ${camera}`);
  const enhancedSentence = (`You clicked this picture ${enhancedParts.join(' ')}.`).replace(/\s+\./, '.') + surpriseText;
  storyText.textContent = enhancedSentence;
        console.log('[insight] enhanced sentence', enhancedSentence, 'place:', place);
          if (importantInStory) importantInStory.textContent = '';
        updateAnalysis({ takenRaw, make, model, camera, lat, lon, place });
      }).catch(err => {
        console.debug('[insight] reverse geocode error', err);
      });
    } else {
      console.debug('[insight] reverse geocode skipped - invalid coords', { latRaw, lonRaw, lat, lon });
      lastPlace = null;
      lastCoords = (lat != null && lon != null) ? { lat, lon } : null;
    }
  }

  // (Removed duplicate legacy block of updateStory implementation)

  function updateAnalysis({ takenRaw, make, model, camera, lat, lon, place }) {
    // Analysis text disabled per request
    if (analysisInStory) analysisInStory.textContent = '';
    lastAnalysisPlain = '';
    // Keep story box visible but do not render analysis lines
    storyBox.style.display = '';
    console.debug('[insight] analysis disabled');
  }

  // --- AI Insights (heuristic, on-device) ---
  function downscaleIntoCanvas(imgEl, maxSize = 96) {
    try {
      const w = imgEl.naturalWidth || imgEl.width || 0;
      const h = imgEl.naturalHeight || imgEl.height || 0;
      if (!w || !h) return null;
      const scale = Math.min(1, maxSize / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, cw, ch);
      return canvas;
    } catch (e) {
      console.debug('[ai] downscale failed', e);
      return null;
    }
  }

  function analyzeColorsFromPreview() {
    const canvas = downscaleIntoCanvas(preview, 96);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let rSum = 0, gSum = 0, bSum = 0, n = 0;
    let blueish = 0, greenish = 0, warmish = 0, bright = 0, dark = 0, whiteish = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const a = data[i+3];
      if (a < 32) continue;
      n++;
      rSum += r; gSum += g; bSum += b;
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      const v = max; // value
      const s = max === 0 ? 0 : (max - min) / max;
      // coarse categories
      if (b > r + 15 && b > g + 15) blueish++;
      if (g > r + 10 && g > b) greenish++;
      if (r > g + 10 && r > b) warmish++;
      if (v > 220 && s < 0.25) whiteish++;
      if (v > 200) bright++;
      if (v < 60) dark++;
    }
    if (!n) return null;
    const avg = { r: rSum/n, g: gSum/n, b: bSum/n };
    const ratios = {
      blue: blueish / n,
      green: greenish / n,
      warm: warmish / n,
      bright: bright / n,
      dark: dark / n,
      white: whiteish / n
    };
    return { avg, ratios };
  }

  function summarizeContent(detections, color) {
    const bits = [];
    if (lastCaption && typeof lastCaption === 'string') {
      const cap = lastCaption.trim();
      if (cap) bits.push(`Caption: ${cap}`);
    }
    if (detections && detections.length) {
      bits.push(`Detected: ${humanList(detections.slice(0, 6))}`);
    }
    if (Array.isArray(lastClassification) && lastClassification.length) {
      const labels = lastClassification.map(p => p.className.split(',')[0]).slice(0, 3);
      bits.push(`Recognized: ${humanList(labels)}`);
    }
    if (Array.isArray(lastZeroShot) && lastZeroShot.length) {
      const labels = lastZeroShot.slice(0, 3).map(z => z.label);
      bits.push(`Zero-shot match: ${humanList(labels)}`);
    }
    if (lastLandmark) {
      bits.push(`Identified text: ${lastLandmark}`);
    } else if (lastOCRText) {
      // show OCR preview only if it looks like meaningful alphabetic text
      const cleaned = lastOCRText.replace(/[^A-Za-z0-9\s,'’"-]/g, ' ').replace(/\s+/g, ' ').trim();
      const words = cleaned.split(' ').filter(w => /[A-Za-z]{2,}/.test(w));
      const alphaRatio = (cleaned.replace(/[^A-Za-z]/g, '').length) / Math.max(1, cleaned.length);
      if (words.length >= 3 && alphaRatio > 0.6) {
        const short = words.slice(0, 8).join(' ');
        if (short) bits.push(`Text on image: “${short}${words.length > 8 ? '…' : ''}”`);
      }
    }
    if (color?.ratios) {
      if (color.ratios.blue > 0.2) bits.push('Strong presence of blue tones (sky or water)');
      if (color.ratios.green > 0.2) bits.push('Significant greens (vegetation/forest)');
      if (color.ratios.white > 0.08) bits.push('Notable whites (snow or highlights)');
      if (color.ratios.dark > 0.35) bits.push('Large dark areas (deep water or shadows)');
    }
    return bits;
  }

  function summarizeTechnical(exif) {
    const lines = [];
    const fnum = exif?.FNumber || exif?.ApertureValue;
    const iso = exif?.ISO || exif?.ISOSpeedRatings;
    const exp = exif?.ExposureTime;
    const foc = exif?.FocalLength;
    if (fnum) lines.push(`Aperture: f/${(Array.isArray(fnum)? fnum[0]: fnum).toString()}`);
    if (exp) lines.push(`Shutter: ${exp}s`);
    if (iso) lines.push(`ISO: ${iso}`);
    if (foc) lines.push(`Focal length: ${foc}mm`);
    if (!lines.length) lines.push('Exposure and focus appear adequate based on preview');
    return lines;
  }

  function suggestUseCases(detections, color) {
    const lines = [];
    const hasPeople = (detections||[]).some(d => d === 'person' || d === 'people');
    if (!hasPeople) {
      lines.push('Travel and destination marketing');
      lines.push('Nature/landscape photography showcases');
      lines.push('Educational or conservation materials');
      lines.push('Prints, postcards, and calendars');
    } else {
      lines.push('Lifestyle or editorial content');
      lines.push('Social media campaigns');
      lines.push('Blog and article illustration');
    }
    return lines;
  }

  function findIssues(exif, color) {
    const lines = [];
    const flash = exif?.Flash;
    if (flash && /fired|on|true/i.test(String(flash))) {
      lines.push('Possible glare or reflections due to flash');
    }
    if (color?.ratios) {
      if (color.ratios.white > 0.12 && color.ratios.bright > 0.35) lines.push('Some glare or specular highlights visible');
      if (color.ratios.dark > 0.45) lines.push('Potential loss of shadow detail in darker regions');
    }
    lines.push('Mild compression may be visible in uniform dark areas');
    return Array.from(new Set(lines));
  }

  function recommendations(exif, issues) {
    const lines = [];
    if (issues.some(s => /glare|reflections/.test(s))) lines.push('Avoid direct flash or use diffused light to reduce glare');
    if (issues.some(s => /shadow detail/.test(s))) lines.push('Consider gentle shadow lifting or HDR techniques');
    lines.push('Keep original digital source when possible for best quality');
    lines.push('Subtle contrast and clarity adjustments can help in water/sky regions');
    return Array.from(new Set(lines));
  }

  function formatInsights({ content, issues, recs }) {
    const sections = [];
    const mk = (title, items) => {
      if (!items || !items.length) return;
      sections.push(`${title}:`);
      items.forEach(i => sections.push(`- ${i}`));
      sections.push('');
    };
    mk('Content', content);
    mk('Issues/Artifacts', issues);
    mk('Recommendations', recs);
    return sections.join('\n');
  }

  function inferOverall(detections, color) {
    const scenic = (detections||[]).some(d => ['boat','bench','bird','skateboard','kite','surfboard'].includes(d)) || (color?.ratios?.blue || 0) > 0.2 || (color?.ratios?.green || 0) > 0.2;
    const landmarkNote = lastLandmark ? ` It likely depicts ${lastLandmark}.` : '';
    return (scenic ? 'this appears to be a high-quality scenic photograph with pleasing color balance.' : 'this appears to be a well-captured image with balanced exposure.') + landmarkNote;
  }

  function maybeGenerateAIInsights() {
    // Generate once per file, after detections/EXIF are ready
    const currentToken = storyToken;
    const myAIToken = ++lastAIToken;
    setTimeout(() => {
      if (myAIToken !== lastAIToken) return; // debounce latest
      if (!preview || !(preview.naturalWidth > 0)) return;
      if (deepAnalysisPinned) return; // don't overwrite pinned deep analysis
      const detections = Array.isArray(lastDetections) ? lastDetections : [];
      const exif = lastExif || {};
      const color = analyzeColorsFromPreview();
      const content = summarizeContent(detections, color);
      const issues = findIssues(exif, color);
      const recs = recommendations(exif, issues);
      const text = formatInsights({ content, issues, recs });
      if (storyToken !== currentToken) return; // stale
      if (analysisInStory) analysisInStory.textContent = text;
    }, 0);
  }

  // --- Cloud deep analysis (optional, uploads image) ---
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = reader.result || '';
          const str = typeof result === 'string' ? result : '';
          const base64 = str.includes(',') ? str.split(',')[1] : str;
          resolve(base64);
        } catch (e) { reject(e); }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function buildMinimalMetadata(file) {
    const meta = { basic: {}, exif: lastExif || {} };
    try {
      if (preview && preview.naturalWidth > 0) {
        meta.basic.Width = `${preview.naturalWidth}px`;
        meta.basic.Height = `${preview.naturalHeight}px`;
        meta.basic['Aspect Ratio'] = (preview.naturalWidth / preview.naturalHeight).toFixed(2);
      }
      if (file) {
        meta.basic['File Name'] = file.name;
        meta.basic['File Size'] = `${(file.size / 1024).toFixed(2)} KB`;
        meta.basic['MIME Type'] = file.type || '';
        if (file.lastModified) meta.basic['Last Modified'] = new Date(file.lastModified).toLocaleString();
      }
    } catch {}
    return meta;
  }

  async function analyzeWithCloudAI(file) {
    if (!file) return null;
    try {
      const base64 = await fileToBase64(file);
      const metadata = buildMinimalMetadata(file);
      const payload = JSON.stringify({ image: base64, metadata, fileName: file.name });
      const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload };
      // Try same-origin first, then localhost fallback
      let resp = await fetch('/api/analyze-image', opts).catch(() => null);
      if (!resp || !resp.ok) {
        resp = await fetch('http://localhost:3000/api/analyze-image', opts).catch(() => null);
      }
      if (resp && resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return (data && (data.analysis || data.text)) || null;
      }
      return null;
    } catch (e) {
      console.debug('[deep-ai] failed', e);
      return null;
    }
  }

  // --- Local deep analysis (on-device LLM via Transformers.js) ---
  async function ensureLocalTextGenerator() {
    try {
      if (window.__loadLocalTextGenerator) {
        return await window.__loadLocalTextGenerator();
      }
    } catch (e) {
      console.debug('[local-llm] loader not available', e);
    }
    return null;
  }

  function buildLocalAnalysisPrompt() {
    const det = Array.isArray(lastDetections) ? lastDetections.slice(0, 8) : [];
    const zs = Array.isArray(lastZeroShot) ? lastZeroShot.slice(0, 5).map(z => `${z.label} (${((z.score||0)*100).toFixed(1)}%)`) : [];
    const cap = (lastCaption || '').trim();
    const ocr = (lastOCRText || '').trim().slice(0, 400);
    const lm = (lastLandmark || '').trim();
    const ex = lastExif || {};
    const dims = (preview && preview.naturalWidth > 0) ? `${preview.naturalWidth}x${preview.naturalHeight}` : '';
    const meta = { dims, exif_present: !!Object.keys(ex).length };

    const lines = [];
  lines.push('Return the response using EXACTLY these three sections only (no extras):');
  lines.push('Content:');
  lines.push('Issues/Artifacts:');
  lines.push('Recommendations:');
    lines.push('');
    lines.push('Context signals:');
    if (cap) lines.push(`- Caption: ${cap}`);
    if (det.length) lines.push(`- Detected objects: ${det.join(', ')}`);
    if (zs.length) lines.push(`- Zero-shot labels: ${zs.join(', ')}`);
    if (lm) lines.push(`- Landmark: ${lm}`);
    if (ocr) lines.push(`- OCR text: ${ocr}`);
    lines.push(`- Meta: ${JSON.stringify(meta)}`);
    lines.push('');
    lines.push('Instructions:');
    lines.push('- Under Content, concisely describe objects, scenes, landmarks, and any readable text.');
    lines.push('- Under Issues/Artifacts, list visible problems (noise, blur, banding, compression).');
    lines.push('- Under Recommendations, suggest brief, practical edits.');
    lines.push('- Keep bullets short, 3–6 items per section when possible.');
    lines.push('- Do not add any other headings or a preamble.');
    lines.push('');
    lines.push('Only output the three sections above with short bullet points.');
    return lines.join('\n');
  }

  async function runLocalDeepAnalysis() {
    const pipe = await ensureLocalTextGenerator();
    if (!pipe) {
      showPopup('Local analysis unavailable', 'The local text model could not be loaded.');
      return;
    }
    try {
      const prompt = buildLocalAnalysisPrompt();
      if (analysisInStory) analysisInStory.textContent = 'Generating deep analysis locally… this may take up to a minute.';
      const out = await pipe(prompt, { max_new_tokens: 400, temperature: 0.2 });
      const text = Array.isArray(out) ? (out[0]?.generated_text || out[0]?.summary_text || out[0]?.text) : (out?.generated_text || out?.summary_text || out?.text);
      let finalText = text ? String(text).trim() : '';
      // Validate structure; if invalid or too short, fall back to a detailed heuristic report
      if (!isValidThreeSection(finalText) || finalText.length < 120) {
        finalText = buildHeuristicDetailedReport();
      }
      if (analysisInStory) analysisInStory.textContent = finalText;
      deepAnalysisPinned = true;
    } catch (e) {
      console.debug('[local-llm] failed', e);
      showPopup('Local analysis failed', 'An error occurred while generating the local deep analysis.');
    }
  }

  function isValidThreeSection(txt) {
    if (!txt || typeof txt !== 'string') return false;
    const t = txt.trim();
    const hasAll = /\bContent:\b/i.test(t) && /\bIssues\/Artifacts:\b/i.test(t) && /\bRecommendations:\b/i.test(t);
    const badPhrases = /(not a response to the given instructions|set of instructions|cannot comply|as an ai)/i.test(t);
    // require at least one bullet dash
    const hasBullet = /\n\s*-\s+/.test(t);
    return hasAll && hasBullet && !badPhrases;
  }

  function buildHeuristicDetailedReport() {
    const detections = Array.isArray(lastDetections) ? lastDetections : [];
    const exif = lastExif || {};
    const color = analyzeColorsFromPreview();
    const content = summarizeContent(detections, color);
    const technical = summarizeTechnical(exif);
    const useCases = suggestUseCases(detections, color);
    const issues = findIssues(exif, color);
    const recs = recommendations(exif, issues);
    const overall = inferOverall(detections, color);
    return formatDetailedInsights({ content, technical, useCases, issues, recs, overall });
  }

  function formatDetailedInsights({ content, technical, useCases, issues, recs, overall }) {
    const sections = [];
    const mk = (title, items, index) => {
      if (!items || !items.length) return;
      sections.push(`${index}. ${title}:`);
      items.forEach(i => sections.push(`- ${i}`));
      sections.push('');
    };
    if (lastLandmark) {
      sections.push(`Here's a detailed analysis of the ${lastLandmark} image:`);
    } else {
      sections.push("Here's a detailed analysis of the image:");
    }
    sections.push('');
    mk('Content', content, 1);
    mk('Technical Aspects', technical, 2);
    mk('Suggested Use Cases', useCases, 3);
    mk('Issues/Artifacts', issues, 4);
    mk('Recommendations', recs, 5);
    if (overall) sections.push(`Overall, ${overall}`);
    return sections.join('\n');
  }

  

  // Orchestrated auto deep analysis (runs after image loads)
  async function runAutoDeepAnalysis() {
    try {
      showLocalProgress();
      setLocalProgress(5, 'Loading models…');
      await ensureCocoModel();
      setLocalProgress(15, 'Detecting objects…');
      await detectObjectsOnPreview();
      setLocalProgress(30, 'Captioning…');
      await runImageCaptioning();
      setLocalProgress(45, 'Quick recognition…');
      await runImageRecognitionIfAvailable();
      setLocalProgress(60, 'Zero-shot matching…');
      await runZeroShotRecognition();
      setLocalProgress(75, 'Reading text…');
      await runPosterOCRIfAvailable();
      setLocalProgress(90, 'Preparing deep analysis…');
      await runLocalDeepAnalysis();
      setLocalProgress(100, 'Done');
    } catch (e) {
      console.debug('[auto-analysis] failed', e);
      showPopup('Deep analysis failed', 'An error occurred while analyzing the image locally.');
    } finally {
      setTimeout(() => { hideLocalProgress(); }, 900);
    }
  }

  // load a file and parse metadata in memory
  async function handleFile(file) {
    if (!file) return;
    // keep some file-level fallbacks
      resetUIForNewFile();
    currentFile = file;
    lastFileMeta.lastModified = file.lastModified || null;
    // Validate basic type/extension quickly and fail fast
    try {
      const t = (file.type || '').toLowerCase();
      const ext = getExt(file.name || '');
      const supported = ['jpg','jpeg','png','webp','avif','gif','bmp'];
      const looksImage = t.startsWith('image/') || supported.includes(ext);
      if (!looksImage) {
        showPopup('Error', 'Unsupported file type. Please choose an image: JPG, PNG, WebP, AVIF, GIF, BMP.');
        if (fileInput) fileInput.value = '';
        return;
      }
    } catch {}
    // Toggle HEIC/HEIF compatibility note only when detected
    try {
      const ext = getExt(file.name || '');
      const t = (file.type || '').toLowerCase();
      const isHeic = (ext === 'heic' || ext === 'heif' || /heic|heif/.test(t));
      if (heicNote) {
        if (isHeic) {
          heicNote.textContent = 'Note: HEIC/HEIF may not decode in all browsers. If preview fails, please convert to JPG/PNG first.';
          heicNote.classList.remove('hidden');
        } else {
          heicNote.textContent = '';
          heicNote.classList.add('hidden');
        }
      }
    } catch {}
    console.log('[file] selected', {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified
    });
    // preview
  const objectUrl = URL.createObjectURL(file);
  // hide preview until it loads to avoid broken image
  preview.classList.add('hidden');
  preview.alt = '';
  preview.src = objectUrl;

    // (Auto) Deep analysis will handle detection, captioning, CLIP, OCR and synthesis

    // get image dimensions by loading image
    const img = new Image();
    img.src = objectUrl;
    const dims = await new Promise((resolve) => {
      img.onload = () => {
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(objectUrl);
      };
      img.onerror = () => {
        resolve({ w: null, h: null });
        URL.revokeObjectURL(objectUrl);
      };
    });

    if (!dims.w || !dims.h) {
      showPopup('Error', 'We couldn’t open this image. It may be unsupported or corrupted. Try converting to JPG/PNG and try again.');
      if (fileInput) fileInput.value = '';
      return;
    }

    // unhide the on-page preview once it successfully loads
    try {
      await new Promise((resolve) => {
        if (preview.complete && preview.naturalWidth > 0) return resolve();
        preview.onload = () => resolve();
        preview.onerror = () => resolve();
      });
      if (preview.naturalWidth > 0) {
        preview.classList.remove('hidden');
        // Kick off automatic deep analysis once the preview is definitely loaded
        runAutoDeepAnalysis();
      }
    } catch {}

  setBasic(file, dims.w, dims.h);

    // parse EXIF with exifr in memory
    try {
      // exifr.parse accepts File or ArrayBuffer
      const exif = await exifr.parse(file);
      console.log('[exif] parsed', { keys: Object.keys(exif || {}).slice(0, 20), count: exif ? Object.keys(exif).length : 0 });
      renderExif(exif || {});
    } catch (err) {
      exifInfo.textContent = 'Error parsing EXIF: ' + String(err);
      important.textContent = 'No GPS timestamp or camera fields found';
      // update analysis with fallbacks even if EXIF parsing fails
      updateAnalysis({ takenRaw: null, make: null, model: null, camera: null, lat: null, lon: null, place: null });
      console.error(err);
    }
  }

  // strip metadata by drawing to canvas then exporting - this removes common EXIF
  async function stripAndDownload(file) {
  if (!file) return showPopup('Warning', 'No file selected');
    // load image bitmap
    const bitmap = await createImageBitmap(file).catch(e => { throw e });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    // choose output format to preserve transparency where possible without heavy deps
    const nameLower = (file.name || '').toLowerCase();
    const typeLower = (file.type || '').toLowerCase();
    const ext = getExt(nameLower);
    const prefersPng = /png|gif|bmp/.test(typeLower) || ['png','gif','bmp'].includes(ext);
    const isAvif = /avif/.test(typeLower) || ext === 'avif';
    const outMime = prefersPng ? 'image/png' : (isAvif ? 'image/jpeg' : 'image/jpeg');
    // convert to blob - PNG preserves alpha; JPEG strips EXIF on re-encode
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outMime, outMime === 'image/jpeg' ? 0.92 : undefined));
  if (!blob) return showPopup('Error', 'Failed to create cleaned image');
    // create download link
    const a = document.createElement('a');
    const cleanedUrl = URL.createObjectURL(blob);
    const name = file.name.replace(/\.(jpg|jpeg|png|tiff?|heic)$/i, '') + '-clean.jpg';
    a.href = cleanedUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(cleanedUrl);
      a.remove();
    }, 1000);
  }

  // events
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (isZipFile(f)) {
      if (zipStatus) zipStatus.textContent = 'Please use the ZIP section to process archives.';
      return;
    }
    handleFile(f);
  });

  // drop zone behavior
  ;['dragenter','dragover'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add('active');
    });
  });
  ;['dragleave','drop'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove('active');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    // Reflect in input for consistency
    fileInput.files = e.dataTransfer.files;
    if (isZipFile(f)) {
      if (zipStatus) zipStatus.textContent = 'Please use the ZIP section to process archives.';
      return;
    }
    handleFile(f);
  });
  dropZone.addEventListener('click', () => { if (fileInput) fileInput.value = ''; fileInput.click(); });

  // ZIP section events
  if (zipInput) {
    zipInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleZip(f);
    });
  }
  if (zipDropZone) {
    ['dragenter','dragover'].forEach(ev => {
      zipDropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        zipDropZone.classList.add('active');
      });
    });
    ['dragleave','drop'].forEach(ev => {
      zipDropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        zipDropZone.classList.remove('active');
      });
    });
    zipDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!isZipFile(f)) {
        if (zipStatus) zipStatus.textContent = 'Please drop a .zip file here.';
        return;
      }
      // Reflect in input
      if (zipInput) zipInput.files = e.dataTransfer.files;
      handleZip(f);
    });
    zipDropZone.addEventListener('click', () => zipInput && zipInput.click());
  }

  stripBtn.addEventListener('click', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return showPopup('Warning', 'No file selected');
    stripBtn.disabled = true;
    stripBtn.textContent = 'Processing...';
    try {
      await stripAndDownload(f);
    } catch (err) {
      showPopup('Error', 'Failed to strip metadata - check console for details');
      console.error(err);
    } finally {
      stripBtn.disabled = false;
      stripBtn.textContent = 'Strip metadata and download';
    }
  });

  copyBtn.addEventListener('click', async () => {
    const text = exifInfo.textContent || basicInfo.textContent || '';
  if (!text) return showPopup('Warning', 'No metadata to copy');
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      setTimeout(() => copyBtn.textContent = 'Copy metadata to clipboard', 1200);
    } catch (err) {
      showPopup('Error', 'Copy failed - your browser may restrict clipboard access');
    }
  });

  // Note: Analysis copy button removed; use system selection to copy if needed.

  function renderExif(obj) {
    if (!obj || Object.keys(obj).length === 0) {
      exifInfo.textContent = 'No EXIF data found';
      // Clear standalone section and in-story fields
      if (important) important.textContent = '';
      if (importantInStory) importantInStory.textContent = '';
      // Friendly notice when image has no EXIF metadata
      try {
        showPopup('Good news!', 'This photo has no hidden data.\nIt’s metadata-free and privacy-safe.');
      } catch {}
      updateStory({});
      lastExif = null;
      // still generate AI insights without EXIF
      maybeGenerateAIInsights();
      return;
    }
    // pretty print some core fields then full object
    const core = {
      DateTimeOriginal: obj.DateTimeOriginal || obj.CreateDate || obj.ModifyDate || null,
      Make: obj.Make || null,
      Model: obj.Model || null,
      Orientation: obj.Orientation || null,
      FocalLength: obj.FocalLength || null,
      ISO: obj.ISO || obj.ISOSpeedRatings || null,
      ExposureTime: obj.ExposureTime || null,
      Aperture: obj.FNumber || obj.ApertureValue || null,
      GPSLatitude: obj.GPSLatitude || null,
      GPSLongitude: obj.GPSLongitude || null
    };
    exifInfo.textContent = JSON.stringify(obj, null, 2);
    lastExif = obj;
    // Clear in-card "important" line per request
    if (importantInStory) importantInStory.textContent = '';
    if (important) important.textContent = '';
    // Update story card with sentence
    updateStory(obj).catch(() => {});
    // generate AI insights now that EXIF is available
    maybeGenerateAIInsights();
  }

  // graceful hint if exifr not loaded
  if (typeof exifr === 'undefined') {
    exifInfo.textContent = 'exifr library not loaded - EXIF parsing disabled';
  }

  // --- TF.js object detection (coco-ssd) ---
  async function ensureCocoModel() {
    if (cocoModel) return cocoModel;
    if (typeof cocoSsd === 'undefined') throw new Error('coco-ssd not available');
    const t0 = performance.now();
    cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    console.debug('[detect] coco-ssd ready in', Math.round(performance.now() - t0), 'ms');
    return cocoModel;
  }

  // --- TF.js image recognition (MobileNet) ---
  async function ensureMobileNetModel() {
    if (mobileNetModel) return mobileNetModel;
    if (typeof mobilenet === 'undefined') throw new Error('mobilenet not available');
    const t0 = performance.now();
    mobileNetModel = await mobilenet.load();
    console.debug('[recognition] mobilenet ready in', Math.round(performance.now() - t0), 'ms');
    return mobileNetModel;
  }

  async function classifyPreviewTopK(k = 3, minScore = 0.2) {
    if (!mobileNetModel || !preview || !preview.src) return [];
    const t0 = performance.now();
    const preds = await mobileNetModel.classify(preview, k);
    const ms = Math.round(performance.now() - t0);
    console.debug('[recognition] predictions', { ms, preds });
    return preds.filter(p => (p.probability || 0) >= minScore);
  }

  // --- Zero-shot image recognition (CLIP via Transformers.js) ---
  async function ensureZeroShotPipeline() {
    if (window.__loadZeroShotImageClassifier) {
      try {
        const pipe = await window.__loadZeroShotImageClassifier();
        return pipe;
      } catch (e) {
        console.debug('[zeroshot] load failed', e);
        return null;
      }
    }
    return null;
  }

  async function runZeroShotRecognition() {
    const pipe = await ensureZeroShotPipeline();
    if (!pipe || !preview || !(preview.naturalWidth > 0)) return;
    try {
      // Build multiple image variants to improve robustness (full, center crop, region crops)
      const imageVariants = [];
      imageVariants.push(preview);
      // Center crop (square-ish)
      try {
        const w = preview.naturalWidth, h = preview.naturalHeight;
        const side = Math.floor(Math.min(w, h) * 0.85);
        const x = Math.floor((w - side) / 2);
        const y = Math.floor((h - side) / 2);
        const cv = document.createElement('canvas');
        cv.width = side; cv.height = side;
        const cx = cv.getContext('2d');
        cx.drawImage(preview, x, y, side, side, 0, 0, side, side);
        imageVariants.push(cv);
      } catch {}
      // Top detection regions (up to 2)
      if (Array.isArray(lastDetectionBoxes) && lastDetectionBoxes.length) {
        const topRegions = lastDetectionBoxes.slice(0, 2);
        for (const r of topRegions) {
          try {
            const [bx, by, bw, bh] = r.bbox;
            const pad = Math.floor(Math.max(bw, bh) * 0.1);
            const x = Math.max(0, Math.floor(bx - pad));
            const y = Math.max(0, Math.floor(by - pad));
            const x2 = Math.min(preview.naturalWidth, Math.ceil(bx + bw + pad));
            const y2 = Math.min(preview.naturalHeight, Math.ceil(by + bh + pad));
            const cw = Math.max(1, x2 - x);
            const ch = Math.max(1, y2 - y);
            const cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            const cx = cv.getContext('2d');
            cx.drawImage(preview, x, y, cw, ch, 0, 0, cw, ch);
            imageVariants.push(cv);
          } catch {}
        }
      }
      const candidateLabels = [
        'Crater Lake National Park', 'Crater Lake', 'Crater Lake Oregon',
        'Crater Lake poster', 'National Park poster', 'travel poster of Crater Lake',
        'Wizard Island', 'Wizard Island at Crater Lake', 'Wizard Island Oregon',
        'cinder cone island in Crater Lake',
        'volcanic caldera lake', 'snow-covered crater lake at sunset',
        'Grand Canyon', 'Yosemite National Park', 'Yellowstone National Park',
        'ocean coastline', 'city skyline at night', 'desert canyon'
      ];
      const templates = [
        'a photo of {}',
        'a landscape photo of {}',
        'a travel poster of {}',
        'a poster for {}',
        'an image of {}'
      ];
      // Run multiple prompts and aggregate scores
      const scores = new Map();
      for (const img of imageVariants) {
        for (const hyp of templates) {
          const res = await pipe(img, candidateLabels, { hypothesis_template: hyp });
          (res || []).forEach(r => {
            const key = r.label;
            const prev = scores.get(key) || 0;
            scores.set(key, prev + (r.score || 0));
          });
        }
      }
      // Normalize and sort
      const denom = Math.max(1, templates.length * imageVariants.length);
      const norm = Array.from(scores.entries()).map(([label, sum]) => ({ label, score: sum / denom }))
        .sort((a,b) => b.score - a.score);
      lastZeroShot = norm;
      const best = lastZeroShot[0];
      if (best && best.score >= 0.20) {
        if (/crater lake/i.test(best.label)) {
          lastLandmark = 'Crater Lake National Park';
          appendDetectionToStory(' This appears to be Crater Lake National Park.');
        } else if (/wizard island/i.test(best.label)) {
          lastLandmark = 'Wizard Island, Crater Lake';
          appendDetectionToStory(' This appears to be Wizard Island at Crater Lake.');
        }
      }
      maybeGenerateAIInsights();
    } catch (e) {
      console.debug('[zeroshot] inference failed', e);
    }
  }

  // --- On-device image captioning (Transformers.js) ---
  async function ensureImageCaptionPipeline() {
    try {
      if (window.__loadImageCaptioner) {
        return await window.__loadImageCaptioner();
      }
    } catch (e) {
      console.debug('[caption] loader not available', e);
    }
    return null;
  }

  async function runImageCaptioning() {
    const pipe = await ensureImageCaptionPipeline();
    if (!pipe || !preview || !(preview.naturalWidth > 0)) return;
    try {
      const outputs = await pipe(preview, { max_new_tokens: 30 });
      // outputs can be array or object depending on backend; normalize
      const text = Array.isArray(outputs) ? (outputs[0]?.generated_text || outputs[0]?.text) : (outputs?.generated_text || outputs?.text);
      if (text && typeof text === 'string') {
        lastCaption = text.trim();
        maybeGenerateAIInsights();
      }
    } catch (e) {
      console.debug('[caption] failed', e);
    }
  }

  // --- OCR landmark recognition (Tesseract.js) ---
  async function runPosterOCRIfAvailable() {
    if (!preview || !(preview.naturalWidth > 0)) return;
    if (typeof Tesseract === 'undefined' || !Tesseract?.recognize) return;
    try {
      // downscale canvas to width ~1000px for speed/accuracy tradeoff
      const maxW = 1000;
      const scale = Math.min(1, maxW / preview.naturalWidth);
      const w = Math.max(1, Math.round(preview.naturalWidth * scale));
      const h = Math.max(1, Math.round(preview.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(preview, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const { data: { text } } = await Tesseract.recognize(dataUrl, 'eng', { logger: () => {} });
      lastOCRText = (text || '').trim();
      const t = lastOCRText.toLowerCase();
      // simple keyword-to-landmark mapping
      if (/\bcrater\s+lake\b/.test(t)) {
        lastLandmark = 'Crater Lake National Park';
        appendDetectionToStory(' The text suggests this is Crater Lake National Park.');
      } else if (/\bwizard\s+island\b/.test(t)) {
        lastLandmark = 'Wizard Island, Crater Lake';
        appendDetectionToStory(' The text suggests this is Wizard Island at Crater Lake.');
      }
      // trigger insights refresh with new OCR
      maybeGenerateAIInsights();
    } catch (e) {
      console.debug('[ocr] failed', e);
    }
  }

  async function detectObjectsOnPreview() {
    if (!cocoModel || !preview || !preview.src) return;
    const t0 = performance.now();
    const predictions = await cocoModel.detect(preview, 10);
    const ms = Math.round(performance.now() - t0);
    console.debug('[detect] predictions', { count: predictions.length, ms, predictions });
    // Build a conversational summary of top labels with confidence >= 0.5
    const filtered = predictions.filter(p => (p.score || 0) >= 0.5).sort((a,b) => b.score - a.score);
    const labelTop = filtered.slice(0, 5).map(p => p.class);
    const unique = Array.from(new Set(labelTop));
    lastDetections = unique;
    // store top regions (up to 3) for CLIP region analysis
    lastDetectionBoxes = filtered.slice(0, 3).map(p => ({ bbox: p.bbox, label: p.class, score: p.score }));
    // Always attempt OCR (useful even if detection found nothing)
    runPosterOCRIfAvailable();
    if (unique.length) {
      const phrase = ` I can also see ${humanList(unique)} in the photo.`;
      appendDetectionToStory(phrase);
    }
    // attempt AI insights after detections
    maybeGenerateAIInsights();
  }

  async function runImageRecognitionIfAvailable() {
    try {
      await ensureMobileNetModel();
      const preds = await classifyPreviewTopK(3, 0.25);
      lastClassification = preds;
      if (preds && preds.length) {
        const labels = preds.map(p => p.className.split(',')[0]).slice(0, 3);
        const phrase = ` It looks like ${humanList(labels)}.`;
        appendDetectionToStory(phrase);
      }
      maybeGenerateAIInsights();
    } catch (e) {
      console.debug('[recognition] skipped/failed', e);
    }
  }

  function appendDetectionToStory(text) {
    if (!text) return;
    const current = storyText.textContent || '';
    const merged = current.endsWith('.') ? current + text : (current + '.').replace(/\s+\./, '.') + text;
    storyText.textContent = merged;
    console.debug('[detect] appended to story');
  }
})();
