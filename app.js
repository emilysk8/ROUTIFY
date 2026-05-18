(function () {
  "use strict";

  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const PHOTON = "https://photon.komoot.io/api/";
  const OSRM_FOOT = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
  const OSRM_TABLE = "https://routing.openstreetmap.de/routed-foot/table/v1/foot";
  const OSRM_FOOT_FALLBACK = "https://router.project-osrm.org/route/v1/foot";
  const WALK_SPEED_KMH = 5;
  const NEARBY_SEARCH_KM = 3;
  const NEARBY_MAX_WALK_MIN = 25;

  const NEARBY_CATEGORIES = [
    {
      icon: "☕",
      type: "food",
      fallback: "Coffee",
      attempts: [
        { q: "starbucks" },
        { q: "coffee", osmTag: "amenity:cafe" },
        { q: "dunkin" },
        { q: "cafe", osmTag: "amenity:cafe" },
      ],
    },
    {
      icon: "🍽",
      type: "food",
      fallback: "Restaurant",
      attempts: [
        { q: "restaurant", osmTag: "amenity:restaurant" },
        { q: "mcdonalds" },
        { q: "chipotle" },
        { q: "food", osmTag: "amenity:fast_food" },
      ],
    },
    {
      icon: "🛒",
      type: "shop",
      fallback: "Grocery",
      attempts: [
        { q: "walmart" },
        { q: "target" },
        { q: "kroger" },
        { q: "grocery", osmTag: "shop:supermarket" },
        { q: "cvs" },
      ],
    },
    {
      icon: "🌳",
      type: "park",
      fallback: "Park",
      attempts: [
        { q: "playground", osmTag: "leisure:playground" },
        { q: "trail", osmTag: "leisure:nature_reserve" },
        { q: "dog park" },
      ],
    },
    {
      icon: "🚉",
      type: "transit",
      fallback: "Transit",
      attempts: [
        { q: "bus stop", osmTag: "highway:bus_stop" },
        { q: "train station", osmTag: "railway:station" },
      ],
    },
  ];

  const FRIENDS = [
    { id: "alex", name: "Alex", initial: "A", color: "#5eead4", destLabel: "Central Station" },
    { id: "sam", name: "Sam", initial: "S", color: "#fbbf24", destLabel: "City Park" },
    { id: "jordan", name: "Jordan", initial: "J", color: "#c084fc", destLabel: "Market Square" },
  ];

  let map;
  let userPosition = null;
  let userMarker = null;
  let destMarker = null;
  let routeLayer = null;
  const friendMarkers = {};
  const friendRouteLayers = {};

  const statusEl = document.getElementById("status");
  const destInput = document.getElementById("destination-input");
  const routeBtn = document.getElementById("route-btn");
  const recenterBtn = document.getElementById("recenter-btn");
  const locationRetryBtn = document.getElementById("location-retry-btn");
  const nearbyWrapEl = document.getElementById("nearby-wrap");
  const nearbyChipsEl = document.getElementById("nearby-chips");
  const friendsListEl = document.getElementById("friends-list");

  let locationFailed = false;
  let friendsLoaded = false;
  let nearbyPlaces = [];

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = "status" + (type ? " " + type : "");
  }

  function createUserIcon() {
    return L.divIcon({
      className: "user-marker",
      html: '<div class="user-pulse"></div><div class="user-dot"></div>',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function createFriendIcon(color) {
    return L.divIcon({
      className: "friend-marker",
      html: `<div class="friend-dot" style="background:${color}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function createDestIcon() {
    return L.divIcon({
      className: "dest-marker",
      html: '<div class="dest-pin"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
  }

  function offsetLatLng(lat, lng, dLat, dLng) {
    return [lat + dLat, lng + dLng];
  }

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
    }).setView([40.7128, -74.006], 14);

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    setTimeout(function () {
      map.invalidateSize();
    }, 100);
  }

  function updateUserMarker(lat, lng) {
    if (userMarker) {
      userMarker.setLatLng([lat, lng]);
    } else {
      userMarker = L.marker([lat, lng], { icon: createUserIcon(), zIndexOffset: 1000 }).addTo(map);
    }
  }

  function geolocationErrorMessage(err) {
    if (!err || typeof err.code !== "number") {
      return "Could not get your location.";
    }
    switch (err.code) {
      case 1:
        return "Location blocked. Allow location for this site in browser settings, then tap Try again.";
      case 2:
        return "Location unavailable. Check that Location Services are on (Mac: System Settings → Privacy).";
      case 3:
        return "Location timed out. Move near a window or tap Try again.";
      default:
        return "Could not get your location.";
    }
  }

  function showLocationRetry(show) {
    locationRetryBtn.hidden = !show;
  }

  function applyUserPosition(lat, lng, message, isRealGps) {
    userPosition = { lat: lat, lng: lng };
    locationFailed = !isRealGps;
    updateUserMarker(lat, lng);
    map.setView([lat, lng], 16);
    setStatus(message, isRealGps ? "success" : "error");
    showLocationRetry(!isRealGps);
    routeBtn.disabled = !destInput.value.trim();
    if (!friendsLoaded || isRealGps) {
      friendsLoaded = true;
      setupFriends();
    }
    loadNearbySuggestions();
  }

  function useFallbackLocation(reason) {
    applyUserPosition(
      40.7128,
      -74.006,
      reason + " Showing demo map (NYC). Routes still work from here.",
      false
    );
  }

  function onLocationSuccess(pos) {
    applyUserPosition(
      pos.coords.latitude,
      pos.coords.longitude,
      "Location found. Enter a destination.",
      true
    );
    startWatchingPosition();
  }

  function onLocationError(err, triedLowAccuracy) {
    if (!triedLowAccuracy && err && err.code === 3) {
      requestLocation(false);
      return;
    }
    useFallbackLocation(geolocationErrorMessage(err));
  }

  function startWatchingPosition() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      function (pos) {
        userPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        updateUserMarker(userPosition.lat, userPosition.lng);
        loadNearbySuggestions();
      },
      function () {},
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
    );
  }

  function requestLocation(highAccuracy) {
    if (!navigator.geolocation) {
      useFallbackLocation("Geolocation not supported in this browser.");
      return;
    }

    if (!window.isSecureContext) {
      useFallbackLocation(
        "Location only works on https:// or http://localhost. Open http://localhost:8765 on this computer (not your Wi‑Fi IP)."
      );
      return;
    }

    setStatus(highAccuracy ? "Finding your location…" : "Trying again (lower accuracy)…");
    showLocationRetry(false);

    navigator.geolocation.getCurrentPosition(
      onLocationSuccess,
      function (err) {
        onLocationError(err, !highAccuracy);
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 20000 : 30000,
        maximumAge: highAccuracy ? 0 : 120000,
      }
    );
  }

  function locateUser() {
    requestLocation(true);
  }

  function distanceKm(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function pickNearestResult(results, origin) {
    if (!results.length) return null;
    if (!origin || results.length === 1) return results[0];
    return results.reduce(function (best, item) {
      const d = distanceKm(origin, { lat: item.lat, lng: item.lng });
      const bestD = distanceKm(origin, { lat: best.lat, lng: best.lng });
      return d < bestD ? item : best;
    });
  }

  async function geocodePhoton(query) {
    const params = new URLSearchParams({ q: query, limit: "8", lang: "en" });
    if (userPosition) {
      params.set("lat", String(userPosition.lat));
      params.set("lon", String(userPosition.lng));
    }
    const res = await fetch(`${PHOTON}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.features || !data.features.length) return [];
    return data.features.map(function (f) {
      const p = f.properties || {};
      const parts = [p.name, p.street, p.city, p.state].filter(Boolean);
      return {
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        name: parts.length ? parts.join(", ") : query,
      };
    });
  }

  async function geocodeNominatim(query, useViewbox) {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      limit: "8",
      addressdetails: "0",
    });
    if (useViewbox && userPosition) {
      const pad = 0.35;
      const left = userPosition.lng - pad;
      const right = userPosition.lng + pad;
      const top = userPosition.lat + pad;
      const bottom = userPosition.lat - pad;
      params.set("viewbox", `${left},${top},${right},${bottom}`);
    }
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Search busy — wait a few seconds and try again.");
      throw new Error("Address search failed (" + res.status + ").");
    }
    const data = await res.json();
    return data.map(function (item) {
      return {
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        name: item.display_name,
      };
    });
  }

  async function geocode(query) {
    const origin = userPosition ? { lat: userPosition.lat, lng: userPosition.lng } : null;
    let results = [];

    try {
      results = await geocodePhoton(query);
    } catch {
      results = [];
    }

    if (!results.length) {
      results = await geocodeNominatim(query, true);
    }
    if (!results.length) {
      results = await geocodeNominatim(query, false);
    }

    const best = pickNearestResult(results, origin);
    if (!best) {
      throw new Error(
        'No place found for "' +
          query +
          '". Try a full address, or name + city (e.g. "Union Station, Chicago").'
      );
    }
    return best;
  }

  function walkingMinutesFromMeters(meters) {
    const hours = meters / 1000 / WALK_SPEED_KMH;
    return Math.max(1, Math.ceil(hours * 60));
  }

  async function fetchOsrmRoute(baseUrl, from, to) {
    const url =
      baseUrl +
      "/" +
      from.lng +
      "," +
      from.lat +
      ";" +
      to.lng +
      "," +
      to.lat +
      "?overview=full&geometries=geojson";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Routing service unavailable");
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes || !data.routes.length) {
      throw new Error("No walking route found");
    }
    return data.routes[0];
  }

  async function fetchFootRoute(from, to) {
    let route;
    let useApiDuration = false;

    try {
      route = await fetchOsrmRoute(OSRM_FOOT, from, to);
      useApiDuration = true;
    } catch {
      route = await fetchOsrmRoute(OSRM_FOOT_FALLBACK, from, to);
      useApiDuration = false;
    }

    const coords = route.geometry.coordinates.map(function (c) {
      return [c[1], c[0]];
    });
    const walkFromDistance = walkingMinutesFromMeters(route.distance);
    const apiMinutes = Math.round(route.duration / 60);
    const minutes = useApiDuration ? apiMinutes : walkFromDistance;
    const km = (route.distance / 1000).toFixed(1);
    return { coords, minutes, km };
  }

  function drawRoute(coords, color, weight, dashArray, layerRef) {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }
    layerRef.current = L.polyline(coords, {
      color: color,
      weight: weight,
      opacity: 0.9,
      dashArray: dashArray || null,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    return layerRef.current;
  }

  async function routeToDestination(dest) {
    if (!userPosition) {
      setStatus("Waiting for your location…", "error");
      return;
    }

    routeBtn.disabled = true;
    setStatus("Calculating walking route…");

    try {
      const route = await fetchFootRoute(userPosition, dest);

      if (destMarker) map.removeLayer(destMarker);
      destMarker = L.marker([dest.lat, dest.lng], { icon: createDestIcon() }).addTo(map);

      const layerRef = { current: routeLayer };
      routeLayer = drawRoute(route.coords, "#7ED957", 5, null, layerRef);

      const bounds = L.latLngBounds(route.coords);
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });

      const shortName = dest.name.length > 48 ? dest.name.slice(0, 45) + "…" : dest.name;
      setStatus(`~${route.minutes} min walk · ${route.km} km → ${shortName}`, "success");
    } catch (err) {
      setStatus(err.message || "Could not plan route.", "error");
    } finally {
      routeBtn.disabled = false;
    }
  }

  async function planRoute() {
    const query = destInput.value.trim();
    if (!query) {
      setStatus("Type a destination first.", "error");
      return;
    }

    routeBtn.disabled = true;
    setStatus("Searching address…");

    try {
      const dest = await geocode(query);
      destInput.value = dest.name.split(",")[0];
      await routeToDestination(dest);
    } catch (err) {
      setStatus(err.message || "Could not plan route.", "error");
      routeBtn.disabled = false;
    }
  }

  function photonFeatureToPlace(f, fallbackName, distKm) {
    const p = f.properties || {};
    const name = p.name || fallbackName;
    const parts = [p.name, p.street, p.city].filter(Boolean);
    return {
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      name: parts.length ? parts.join(", ") : name,
      shortName: name,
      distKm: distKm,
      walkLabel: "",
      walkSeconds: null,
    };
  }

  function estimateWalkMinFromKm(distKm) {
    const roadKm = distKm * 1.35;
    return Math.max(1, Math.ceil((roadKm / WALK_SPEED_KMH) * 60));
  }

  async function attachWalkingTimes(places) {
    if (!places.length || !userPosition) return places;

    const coordStr =
      userPosition.lng +
      "," +
      userPosition.lat +
      ";" +
      places.map(function (p) {
        return p.lng + "," + p.lat;
      }).join(";");
    const destIndices = places.map(function (_, i) {
      return i + 1;
    }).join(";");
    const url =
      OSRM_TABLE +
      "/" +
      coordStr +
      "?sources=0&destinations=" +
      destIndices +
      "&annotations=duration";

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("table failed");
      const data = await res.json();
      if (data.code !== "Ok" || !data.durations || !data.durations[0]) {
        throw new Error("no durations");
      }
      const durations = data.durations[0];
      return places.map(function (place, i) {
        const sec = durations[i];
        if (sec == null || sec === 0) {
          const est = estimateWalkMinFromKm(place.distKm);
          return {
            ...place,
            walkSeconds: est * 60,
            walkLabel: "~" + est + " min",
          };
        }
        const walkMin = Math.max(1, Math.ceil(sec / 60));
        return {
          ...place,
          walkSeconds: sec,
          walkLabel: "~" + walkMin + " min walk",
        };
      });
    } catch {
      return places.map(function (place) {
        const est = estimateWalkMinFromKm(place.distKm);
        return {
          ...place,
          walkSeconds: est * 60,
          walkLabel: "~" + est + " min",
        };
      });
    }
  }

  function isMislabeledResidentialPark(name) {
    if (!name) return true;
    const n = name.toLowerCase();
    return (
      /\bparks at\b/.test(n) ||
      /\bapartments?\b/.test(n) ||
      /\bcondos?\b/.test(n) ||
      /\bresidences?\b/.test(n) ||
      /\bhoa\b/.test(n) ||
      /\bcommunity\b/.test(n) ||
      /\bsubdivision\b/.test(n) ||
      /\bvillage at\b/.test(n) ||
      /\bplace park\b/.test(n)
    );
  }

  function isAcceptableNearby(feature, cat) {
    const p = feature.properties || {};
    const name = (p.name || "").trim();
    if (!name || name === cat.fallback) return false;

    if (cat.type === "park") {
      if (isMislabeledResidentialPark(name)) return false;
      if (p.osm_key === "leisure" && p.osm_value === "park") return false;
      if (p.osm_key === "leisure") {
        return ["playground", "nature_reserve", "garden", "dog_park", "track"].includes(p.osm_value);
      }
      return /\btrail|playground|nature|garden|preserve\b/i.test(name);
    }

    if (cat.type === "food") {
      return (
        p.osm_key === "amenity" ||
        /\b(cafe|coffee|restaurant|grill|kitchen|pizza|burger|taco|diner|bistro)\b/i.test(name)
      );
    }

    if (cat.type === "shop") {
      return p.osm_key === "shop" || p.osm_key === "amenity" || /\b(store|market|mart|pharmacy|shop)\b/i.test(name);
    }

    if (cat.type === "transit") {
      return p.osm_key === "highway" || p.osm_key === "railway" || p.osm_key === "public_transport";
    }

    return true;
  }

  function sortFeaturesByDistance(features, origin) {
    return features
      .map(function (f) {
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];
        return { feature: f, dist: distanceKm(origin, { lat: lat, lng: lng }) };
      })
      .sort(function (a, b) {
        return a.dist - b.dist;
      });
  }

  async function fetchNearbyAttempt(attempt, cat) {
    const params = new URLSearchParams({ q: attempt.q, limit: "15", lang: "en" });
    params.set("lat", String(userPosition.lat));
    params.set("lon", String(userPosition.lng));
    if (attempt.osmTag) params.set("osm_tag", attempt.osmTag);

    const res = await fetch(`${PHOTON}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.features || !data.features.length) return [];

    const origin = { lat: userPosition.lat, lng: userPosition.lng };
    const ranked = sortFeaturesByDistance(data.features, origin);
    const found = [];

    for (let i = 0; i < ranked.length; i++) {
      const item = ranked[i];
      if (item.dist > NEARBY_SEARCH_KM) break;
      if (!isAcceptableNearby(item.feature, cat)) continue;
      found.push(photonFeatureToPlace(item.feature, cat.fallback, item.dist));
      if (found.length >= 2) break;
    }
    return found;
  }

  async function fetchNearbyForCategory(cat) {
    try {
      for (let i = 0; i < cat.attempts.length; i++) {
        const places = await fetchNearbyAttempt(cat.attempts[i], cat);
        if (places.length) {
          return { ...places[0], icon: cat.icon, categoryType: cat.type };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function renderNearbyChips() {
    nearbyWrapEl.hidden = false;
    if (!nearbyPlaces.length) {
      nearbyChipsEl.innerHTML =
        '<p class="nearby-empty">No walkable places within ~' +
        NEARBY_MAX_WALK_MIN +
        " min. Try typing a destination above.</p>";
      return;
    }
    nearbyChipsEl.innerHTML = nearbyPlaces
      .map(function (place, index) {
        return (
          '<button type="button" class="nearby-chip" data-index="' +
          index +
          '" role="listitem">' +
          '<span class="nearby-chip-icon" aria-hidden="true">' +
          place.icon +
          "</span>" +
          '<span class="nearby-chip-text">' +
          '<span class="nearby-chip-name">' +
          escapeHtml(place.shortName) +
          "</span>" +
          '<span class="nearby-chip-dist">' +
          escapeHtml(place.walkLabel || "") +
          "</span>" +
          "</span>" +
          "</button>"
        );
      })
      .join("");

    nearbyChipsEl.querySelectorAll(".nearby-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const place = nearbyPlaces[parseInt(btn.getAttribute("data-index"), 10)];
        if (!place) return;
        destInput.value = place.shortName;
        routeBtn.disabled = false;
        routeToDestination(place);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async function loadNearbySuggestions() {
    if (!userPosition || !nearbyWrapEl) return;

    nearbyWrapEl.hidden = false;
    nearbyChipsEl.innerHTML = '<p class="nearby-loading">Loading nearby places…</p>';

    const settled = await Promise.allSettled(
      NEARBY_CATEGORIES.map(fetchNearbyForCategory)
    );
    const seen = new Set();
    let candidates = [];

    settled.forEach(function (result) {
      if (result.status !== "fulfilled" || !result.value) return;
      const place = result.value;
      const key = place.lat.toFixed(5) + "," + place.lng.toFixed(5);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(place);
    });

    candidates = await attachWalkingTimes(candidates);

    const maxWalkSec = NEARBY_MAX_WALK_MIN * 60;
    candidates = candidates
      .filter(function (p) {
        return p.walkSeconds != null && p.walkSeconds <= maxWalkSec;
      })
      .sort(function (a, b) {
        return a.walkSeconds - b.walkSeconds;
      });

    const typeCount = {};
    nearbyPlaces = [];
    for (let i = 0; i < candidates.length && nearbyPlaces.length < 6; i++) {
      const place = candidates[i];
      const t = place.categoryType || "other";
      typeCount[t] = (typeCount[t] || 0) + 1;
      if (typeCount[t] > 2) continue;
      nearbyPlaces.push(place);
    }
    renderNearbyChips();
  }

  function renderFriendsList(meta) {
    friendsListEl.innerHTML = FRIENDS.map(function (f, i) {
      const m = meta[i] || {};
      return (
        '<li class="friend-card">' +
        '<div class="friend-avatar" style="background:' +
        f.color +
        '">' +
        f.initial +
        "</div>" +
        '<div class="friend-info">' +
        '<p class="friend-name">' +
        f.name +
        "</p>" +
        '<p class="friend-meta">' +
        (m.label || "Heading to " + f.destLabel) +
        "</p>" +
        "</div>" +
        '<span class="friend-badge walking">' +
        (m.eta ? "~" + m.eta + " min" : "Walking") +
        "</span>" +
        "</li>"
      );
    }).join("");
  }

  async function setupFriends() {
    if (!userPosition) return;

    const offsets = [
      { dLat: 0.004, dLng: 0.003 },
      { dLat: -0.003, dLng: 0.005 },
      { dLat: 0.002, dLng: -0.004 },
    ];

    const destOffsets = [
      { dLat: 0.012, dLng: 0.008 },
      { dLat: -0.01, dLng: 0.011 },
      { dLat: 0.009, dLng: -0.009 },
    ];

    const meta = [];

    for (let i = 0; i < FRIENDS.length; i++) {
      const friend = FRIENDS[i];
      const start = offsetLatLng(
        userPosition.lat,
        userPosition.lng,
        offsets[i].dLat,
        offsets[i].dLng
      );
      const end = offsetLatLng(
        userPosition.lat,
        userPosition.lng,
        destOffsets[i].dLat,
        destOffsets[i].dLng
      );

      if (friendMarkers[friend.id]) {
        map.removeLayer(friendMarkers[friend.id]);
      }
      friendMarkers[friend.id] = L.marker(start, {
        icon: createFriendIcon(friend.color),
        zIndexOffset: 500,
      }).addTo(map);

      try {
        const from = { lat: start[0], lng: start[1] };
        const to = { lat: end[0], lng: end[1] };
        const route = await fetchFootRoute(from, to);
        const layerRef = { current: friendRouteLayers[friend.id] };
        drawRoute(route.coords, friend.color, 4, "8, 10", layerRef);
        friendRouteLayers[friend.id] = layerRef.current;

        meta.push({
          label: "Walking to " + friend.destLabel,
          eta: route.minutes,
        });
      } catch {
        const fallback = [start, end];
        const layerRef = { current: friendRouteLayers[friend.id] };
        drawRoute(fallback, friend.color, 4, "8, 10", layerRef);
        friendRouteLayers[friend.id] = layerRef.current;
        meta.push({ label: "Walking to " + friend.destLabel, eta: null });
      }
    }

    renderFriendsList(meta);
  }

  function recenter() {
    if (userPosition) {
      map.setView([userPosition.lat, userPosition.lng], map.getZoom() < 15 ? 16 : map.getZoom());
    }
  }

  function init() {
    initMap();
    renderFriendsList([]);
    locateUser();

    routeBtn.addEventListener("click", planRoute);
    destInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") planRoute();
    });
    destInput.addEventListener("input", function () {
      routeBtn.disabled = !destInput.value.trim() || !userPosition;
    });
    recenterBtn.addEventListener("click", recenter);
    locationRetryBtn.addEventListener("click", function () {
      friendsLoaded = false;
      locateUser();
    });

    window.addEventListener("resize", function () {
      map.invalidateSize();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
