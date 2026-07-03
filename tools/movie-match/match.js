/* Movie Match — suggests movies similar to your favorites,
   filtered to the streaming services you have, via the TMDB API.
   The API key is supplied by the user and stored only in localStorage. */

(() => {
  "use strict";

  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p"; // + /w92 etc + poster_path
  const LS_KEY = "mm_tmdb_key";
  const LS_REGION = "mm_region";
  const LS_PROVIDERS = "mm_providers"; // JSON array of provider ids for current region

  // ---- state ----
  let apiKey = localStorage.getItem(LS_KEY) || "";
  let region = localStorage.getItem(LS_REGION) || "US";
  let selectedProviders = new Set(); // provider ids (numbers)
  const favorites = []; // { id, title, year }

  // ---- element helpers ----
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  // ---- TMDB fetch wrapper ----
  async function tmdb(path, params = {}) {
    const url = new URL(API + path);
    url.searchParams.set("api_key", apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url);
    if (!res.ok) {
      const msg = res.status === 401 ? "Invalid API key" : `TMDB error ${res.status}`;
      throw new Error(msg);
    }
    return res.json();
  }

  /* =====================================================================
     KEY SETUP
  ===================================================================== */
  function showSetup(message) {
    $("app-screen").hidden = true;
    $("setup-screen").hidden = false;
    if (message) setStatus($("key-status"), message, "err");
    $("key-input").value = "";
    $("key-input").focus();
  }

  async function tryKey(candidate) {
    const status = $("key-status");
    setStatus(status, "Checking key…", "busy");
    const prev = apiKey;
    apiKey = candidate;
    try {
      await tmdb("/authentication"); // validates the key
      localStorage.setItem(LS_KEY, candidate);
      setStatus(status, "Connected!", "ok");
      startApp();
    } catch (e) {
      apiKey = prev;
      setStatus(status, e.message + ". Double-check you copied the v3 auth key.", "err");
    }
  }

  $("key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("key-input").value.trim();
    if (v) tryKey(v);
  });

  /* =====================================================================
     APP BOOT
  ===================================================================== */
  async function startApp() {
    $("setup-screen").hidden = true;
    $("app-screen").hidden = false;
    await loadRegions();
    await loadProviders();
    renderFavorites();
    updateFindState();
  }

  $("change-key").addEventListener("click", () => {
    localStorage.removeItem(LS_KEY);
    apiKey = "";
    showSetup("");
  });

  // ---- regions ----
  async function loadRegions() {
    const sel = $("region-select");
    if (sel.dataset.loaded) return;
    let regions;
    try {
      const data = await tmdb("/watch/providers/regions");
      regions = data.results;
    } catch {
      regions = [{ iso_3166_1: "US", english_name: "United States" }];
    }
    regions.sort((a, b) => a.english_name.localeCompare(b.english_name));
    sel.innerHTML = "";
    for (const r of regions) {
      const o = el("option", null, r.english_name);
      o.value = r.iso_3166_1;
      sel.appendChild(o);
    }
    sel.value = region;
    sel.dataset.loaded = "1";
    sel.addEventListener("change", async () => {
      region = sel.value;
      localStorage.setItem(LS_REGION, region);
      selectedProviders.clear();
      await loadProviders();
      updateFindState();
    });
  }

  // ---- streaming providers for the region ----
  async function loadProviders() {
    const wrap = $("providers");
    wrap.innerHTML = "Loading services…";
    let results = [];
    try {
      const data = await tmdb("/watch/providers/movie", { watch_region: region });
      results = data.results || [];
    } catch (e) {
      wrap.textContent = "Couldn't load services: " + e.message;
      return;
    }
    // Show the most common services (lower display_priority = more prominent).
    results.sort((a, b) => {
      const pa = (a.display_priorities && a.display_priorities[region]) ?? a.display_priority ?? 999;
      const pb = (b.display_priorities && b.display_priorities[region]) ?? b.display_priority ?? 999;
      return pa - pb;
    });
    const top = results.slice(0, 24);

    // restore saved selection for this region
    const savedRaw = localStorage.getItem(LS_PROVIDERS + "_" + region);
    const saved = savedRaw ? new Set(JSON.parse(savedRaw)) : new Set();
    selectedProviders = new Set([...saved].filter((id) => top.some((p) => p.provider_id === id)));

    wrap.innerHTML = "";
    for (const p of top) {
      const chip = el("div", "mm-chip");
      if (selectedProviders.has(p.provider_id)) chip.classList.add("selected");
      if (p.logo_path) {
        const img = el("img");
        img.src = `${IMG}/w45${p.logo_path}`;
        img.alt = "";
        chip.appendChild(img);
      }
      chip.appendChild(el("span", null, p.provider_name));
      chip.addEventListener("click", () => {
        if (selectedProviders.has(p.provider_id)) {
          selectedProviders.delete(p.provider_id);
          chip.classList.remove("selected");
        } else {
          selectedProviders.add(p.provider_id);
          chip.classList.add("selected");
        }
        persistProviders();
        updateFindState();
      });
      wrap.appendChild(chip);
    }
  }

  function persistProviders() {
    localStorage.setItem(LS_PROVIDERS + "_" + region, JSON.stringify([...selectedProviders]));
  }

  /* =====================================================================
     FAVORITES SEARCH
  ===================================================================== */
  const searchInput = $("movie-search");
  const searchResults = $("search-results");
  let searchTimer = null;

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { hideResults(); return; }
    searchTimer = setTimeout(() => runSearch(q), 250);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".mm-search-wrap")) hideResults();
  });

  function hideResults() {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
  }

  async function runSearch(q) {
    let data;
    try {
      data = await tmdb("/search/movie", { query: q, include_adult: "false", page: "1" });
    } catch {
      return;
    }
    const items = (data.results || []).slice(0, 8);
    searchResults.innerHTML = "";
    if (!items.length) { hideResults(); return; }
    for (const m of items) {
      const row = el("div", "mm-result-item");
      const img = el("img");
      img.src = m.poster_path ? `${IMG}/w92${m.poster_path}` : "";
      img.alt = "";
      row.appendChild(img);
      const info = el("div");
      info.appendChild(el("div", "t", m.title));
      info.appendChild(el("div", "y", (m.release_date || "").slice(0, 4) || "—"));
      row.appendChild(info);
      row.addEventListener("click", () => addFavorite(m));
      searchResults.appendChild(row);
    }
    searchResults.hidden = false;
  }

  function addFavorite(m) {
    if (!favorites.some((f) => f.id === m.id)) {
      favorites.push({ id: m.id, title: m.title, year: (m.release_date || "").slice(0, 4) });
      renderFavorites();
      updateFindState();
    }
    searchInput.value = "";
    hideResults();
    searchInput.focus();
  }

  function renderFavorites() {
    const wrap = $("favorites");
    wrap.innerHTML = "";
    for (const f of favorites) {
      const chip = el("div", "mm-chip");
      chip.appendChild(el("span", null, f.year ? `${f.title} (${f.year})` : f.title));
      const x = el("button", null, "×");
      x.title = "Remove";
      x.addEventListener("click", () => {
        const i = favorites.findIndex((v) => v.id === f.id);
        if (i > -1) favorites.splice(i, 1);
        renderFavorites();
        updateFindState();
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
    }
  }

  /* =====================================================================
     FIND SUGGESTIONS
  ===================================================================== */
  function updateFindState() {
    const btn = $("find-btn");
    const hint = $("find-hint");
    const ready = favorites.length >= 1 && selectedProviders.size >= 1;
    btn.disabled = !ready;
    if (favorites.length < 1) hint.textContent = "Add at least one movie you love.";
    else if (selectedProviders.size < 1) hint.textContent = "Pick at least one streaming service.";
    else hint.textContent = "";
  }

  $("find-btn").addEventListener("click", findSuggestions);

  async function findSuggestions() {
    const status = $("results-status");
    const out = $("results");
    out.innerHTML = "";
    setStatus(status, "Finding movies similar to your favorites…", "busy");
    $("find-btn").disabled = true;

    const favIds = new Set(favorites.map((f) => f.id));
    const candidates = new Map(); // id -> { movie, score, sources:Set(title) }

    try {
      // 1. Gather recommendations from each favorite (pages 1-2).
      for (const fav of favorites) {
        for (const page of [1, 2]) {
          const data = await tmdb(`/movie/${fav.id}/recommendations`, { page: String(page) });
          for (const m of data.results || []) {
            if (favIds.has(m.id)) continue;
            let c = candidates.get(m.id);
            if (!c) { c = { movie: m, score: 0, sources: new Set() }; candidates.set(m.id, c); }
            c.score += 1;
            c.sources.add(fav.title);
          }
        }
      }

      if (!candidates.size) {
        setStatus(status, "TMDB had no recommendations for those titles. Try adding a few more.", "err");
        $("find-btn").disabled = false;
        return;
      }

      // 2. Rank: movies recommended by more of your favorites first, then popularity.
      const ranked = [...candidates.values()].sort((a, b) =>
        b.score - a.score || (b.movie.popularity || 0) - (a.movie.popularity || 0)
      ).slice(0, 50);

      // 3. Check streaming availability for each candidate, keep those on a selected service.
      setStatus(status, `Checking which of ${ranked.length} picks stream on your services…`, "busy");
      const matches = [];
      for (const cand of ranked) {
        const avail = await providersFor(cand.movie.id);
        const onMine = avail.filter((p) => selectedProviders.has(p.provider_id));
        if (onMine.length) matches.push({ ...cand, onMine });
        if (matches.length >= 24) break;
      }

      renderResults(matches);
      if (!matches.length) {
        setStatus(status,
          "None of the similar movies are currently streaming on your selected services. " +
          "Try selecting more services or different favorites.", "err");
      } else {
        setStatus(status, `${matches.length} movies you can watch right now:`, "ok");
      }
    } catch (e) {
      setStatus(status, "Something went wrong: " + e.message, "err");
    } finally {
      $("find-btn").disabled = false;
    }
  }

  async function providersFor(movieId) {
    try {
      const data = await tmdb(`/movie/${movieId}/watch/providers`);
      const r = (data.results || {})[region] || {};
      return r.flatrate || []; // subscription streaming only
    } catch {
      return [];
    }
  }

  function renderResults(matches) {
    const out = $("results");
    out.innerHTML = "";
    for (const m of matches) {
      const mv = m.movie;
      const card = el("div", "mm-card");

      const poster = el("img", "poster");
      poster.src = mv.poster_path ? `${IMG}/w342${mv.poster_path}` : "";
      poster.alt = mv.title;
      poster.loading = "lazy";
      card.appendChild(poster);

      const body = el("div", "body");
      body.appendChild(el("div", "title", mv.title));

      const year = (mv.release_date || "").slice(0, 4);
      const rating = mv.vote_average ? `★ ${mv.vote_average.toFixed(1)}` : "";
      const meta = el("div", "meta");
      meta.textContent = year || "";
      if (rating) {
        const r = el("span", "rating", "  " + rating);
        meta.appendChild(r);
      }
      body.appendChild(meta);

      const src = [...m.sources].slice(0, 2).join(", ");
      body.appendChild(el("div", "why", `Because you like ${src}`));

      const logos = el("div", "logos");
      for (const p of m.onMine) {
        if (!p.logo_path) continue;
        const img = el("img");
        img.src = `${IMG}/w45${p.logo_path}`;
        img.alt = p.provider_name;
        img.title = p.provider_name;
        logos.appendChild(img);
      }
      body.appendChild(logos);

      card.appendChild(body);
      out.appendChild(card);
    }
  }

  /* ---- small util ---- */
  function setStatus(node, msg, kind) {
    node.textContent = msg;
    node.className = "mm-status" + (kind ? " " + kind : "");
  }

  /* =====================================================================
     INIT
  ===================================================================== */
  if (apiKey) {
    // Validate the stored key on load; fall back to setup if it's stale.
    tmdb("/authentication").then(startApp).catch(() => showSetup("Your saved API key is no longer valid — please re-enter it."));
  } else {
    showSetup("");
  }
})();
