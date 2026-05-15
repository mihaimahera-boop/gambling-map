const map = L.map("map").setView([45.9432, 24.9668], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let restrictions = [];
let superbetLocations = [];
let analyzedLocations = [];
let importedCandidates = [];

let restrictionLayers = [];
let superbetLayers = [];
let analysisLayers = [];
let candidateLayers = [];
let importedCandidateLayers = [];
let polygonLayers = [];

let currentAnalysis = null;

function el(id) {
  return document.getElementById(id);
}

function getValue(id, fallback = "") {
  return el(id)?.value ?? fallback;
}

function getChecked(id, fallback = true) {
  const node = el(id);
  return node ? node.checked : fallback;
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugify(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSelectedCity() {
  return getValue("cityInput", "").trim();
}

function getAnalysisRadius() {
  return Number(getValue("analysisRadiusInput", 1000)) || 1000;
}

function getRiskDistance() {
  return Number(getValue("restrictionDistanceInput", 300)) || 300;
}

function getRiskMode() {
  return getValue("riskModeSelect", "mixed");
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "-";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
const HCL_FOLDER_URL = "https://drive.google.com/drive/folders/1ua5jW6i-fpQTd05G4WxMjWusekKwMIRa?usp=sharing";

function hclLink(hcl) {
  if (!hcl) return "";
  return `<a href="${HCL_FOLDER_URL}" target="_blank" class="hcl-link">${hcl}</a>`;
}

function getRestrictionColor(status) {
  if (status === "gambling_interzis") return "#dc2626";
  if (status === "sloturi_interzise") return "#f59e0b";
  if (status === "restrictii_locale") return "#facc15";
  if (status === "safe") return "#22c55e";
  return "#94a3b8";
}

function getRestrictionLabel(status) {
  if (status === "gambling_interzis") return "Gambling interzis";
  if (status === "sloturi_interzise") return "Sloturi interzise";
  if (status === "restrictii_locale") return "Restricții locale";
  if (status === "safe") return "Safe";
  return "Fără date HCL";
}

function shouldShowRestrictionStatus(status) {
  if (status === "gambling_interzis") return getChecked("filterGamblingInterzis", true);
  if (status === "sloturi_interzise") return getChecked("filterSloturiInterzise", true);
  if (status === "restrictii_locale") return getChecked("filterRestrictiiLocale", true);
  if (status === "safe") return getChecked("filterSafe", true);
  return true;
}

function matchesSelectedCity(item) {
  const selected = normalizeText(getSelectedCity());
  if (!selected) return true;

  const city = normalizeText(
    item.city ||
    item.name ||
    item.locality ||
    item.county ||
    item.judet ||
    ""
  );

  return city.includes(selected) || selected.includes(city);
}

function clearLayers(list) {
  list.forEach(layer => {
    try {
      map.removeLayer(layer);
    } catch {}
  });

  list.length = 0;
}

function getFeatureName(feature) {
  const p = feature.properties || {};

  return (
    p.name ||
    p.NAME ||
    p.locality ||
    p.city ||
    p.comuna ||
    p.uat ||
    p.UAT ||
    p.nume ||
    p.NUME ||
    ""
  );
}

function getFeatureCounty(feature) {
  const p = feature.properties || {};

  return (
    p.county ||
    p.judet ||
    p.JUDET ||
    p.county_name ||
    p.name_1 ||
    p.NAME_1 ||
    ""
  );
}

function findRestrictionForName(name, county = "") {
  const n = normalizeText(name);
  const c = normalizeText(county);

  if (!n) return null;

  const matches = restrictions.filter(r => {
    const city = normalizeText(r.city || r.name || "");
    const rCounty = normalizeText(r.county || r.judet || "");

    const cityMatch =
      city === n ||
      city.includes(n) ||
      n.includes(city);

    const countyMatch =
      !c ||
      !rCounty ||
      rCounty === c ||
      rCounty.includes(c) ||
      c.includes(rCounty);

    return cityMatch && countyMatch;
  });

  if (!matches.length) return null;

  const priority = {
    gambling_interzis: 4,
    sloturi_interzise: 3,
    restrictii_locale: 2,
    safe: 1,
    unknown: 0
  };

  return matches.sort((a, b) => {
    return (priority[b.status] || 0) - (priority[a.status] || 0);
  })[0];
}

function analyzeLocation(location) {
  const lat = Number(location.lat);
  const lng = Number(location.lng);

  const analysisRadius = getAnalysisRadius();
  const riskDistance = getRiskDistance();
  const riskMode = getRiskMode();

  let nearestRestriction = null;
  let nearestDistance = Infinity;
  const nearbyRestrictions = [];

  restrictions.forEach(restriction => {
    if (!restriction.lat || !restriction.lng) return;
    if (!shouldShowRestrictionStatus(restriction.status)) return;

    const d = distanceMeters(
      lat,
      lng,
      Number(restriction.lat),
      Number(restriction.lng)
    );

    if (d < nearestDistance) {
      nearestDistance = d;
      nearestRestriction = restriction;
    }

    if (d <= analysisRadius) {
      nearbyRestrictions.push({
        ...restriction,
        distance: d
      });
    }
  });

  let score = 0;

  if (Number.isFinite(nearestDistance)) {
    if (nearestDistance <= riskDistance) score += 100;
    else if (nearestDistance <= analysisRadius) score += 40;
  }

  score += nearbyRestrictions.length * 10;

  if (riskMode === "nearest") {
    score =
      nearestDistance <= riskDistance
        ? 100
        : nearestDistance <= analysisRadius
          ? 50
          : 0;
  }

  if (riskMode === "count") {
    score = nearbyRestrictions.length * 25;
  }

  score = Math.min(100, Math.round(score));

  let status = "ok";
  let color = "#16a34a";
  let text = "OK - zonă cu risc redus";

  if (score >= 80) {
    status = "danger";
    color = "#dc2626";
    text = "RISC RIDICAT";
  } else if (score >= 30) {
    status = "warning";
    color = "#f59e0b";
    text = "RISC MEDIU";
  }

  return {
    status,
    color,
    text,
    score,
    nearestRestriction,
    nearestDistance,
    nearbyRestrictions
  };
}

function updateRiskPanel(lat, lng, analysis) {
  currentAnalysis = { lat, lng, analysis };

  const nearbySuperbet = getNearbySuperbet(lat, lng);

  if (el("finalVerdict")) el("finalVerdict").textContent = analysis.text;
  if (el("riskScore")) el("riskScore").textContent = `${analysis.score} / 100`;
  if (el("nearestRestrictionDistance")) el("nearestRestrictionDistance").textContent = formatDistance(analysis.nearestDistance);
  if (el("restrictionsCount")) el("restrictionsCount").textContent = analysis.nearbyRestrictions.length;
  if (el("superbetCount")) el("superbetCount").textContent = nearbySuperbet.length;
  if (el("currentCoords")) el("currentCoords").textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  if (el("riskSummary")) {
    el("riskSummary").innerHTML = `
      <b>${analysis.text}</b><br>
      Scor risc: ${analysis.score} / 100
    `;
  }

  if (el("nearestRestrictionBox")) {
    if (analysis.nearestRestriction) {
      el("nearestRestrictionBox").innerHTML = `
        <strong>${analysis.nearestRestriction.city || "Restricție"}</strong><br>
        ${getRestrictionLabel(analysis.nearestRestriction.status)}<br>
        Distanță: ${formatDistance(analysis.nearestDistance)}<br>
        ${hclLink(analysis.nearestRestriction.hcl)}
      `;
    } else {
      el("nearestRestrictionBox").innerHTML = "Nu există restricții în baza de date.";
    }
  }

  if (el("nearbySuperbetList")) {
    el("nearbySuperbetList").innerHTML =
      nearbySuperbet.slice(0, 10).map(item => `
        <div class="card">
          <strong>${item.shopName || item.name || "Superbet"}</strong><br>
          ${item.city || ""}<br>
          Distanță: ${formatDistance(item.distance)}
        </div>
      `).join("") || `<div class="card">Nu există agenții Superbet în raza analizată.</div>`;
  }

  if (el("nearbyRestrictionsList")) {
    el("nearbyRestrictionsList").innerHTML =
      analysis.nearbyRestrictions
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10)
        .map(item => `
          <div class="card">
            <strong>${item.city || "Restricție"}</strong><br>
            ${getRestrictionLabel(item.status)}<br>
            Distanță: ${formatDistance(item.distance)}<br>
            ${hclLink(item.hcl)}
          </div>
        `).join("") || `<div class="card">Nu există restricții în raza analizată.</div>`;
  }

  if (el("analysisLog")) {
    el("analysisLog").innerHTML = `
      <div class="card">
        Ultima analiză: ${new Date().toLocaleString("ro-RO")}<br>
        Coordonate: ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
        Verdict: ${analysis.text}<br>
        Scor risc: ${analysis.score} / 100
      </div>
    `;
  }
}

function updateRiskPanelFromRestriction(restriction, name = "Localitate", county = "") {
  if (!restriction) return;

  const lat = Number(restriction.lat);
  const lng = Number(restriction.lng);

  if (el("finalVerdict")) {
    el("finalVerdict").textContent = getRestrictionLabel(restriction.status);
  }

  if (el("riskScore")) {
    const score =
      restriction.status === "gambling_interzis" ? 100 :
      restriction.status === "sloturi_interzise" ? 80 :
      restriction.status === "restrictii_locale" ? 50 :
      restriction.status === "safe" ? 0 :
      "-";

    el("riskScore").textContent = score === "-" ? "-" : `${score} / 100`;
  }

  if (el("nearestRestrictionDistance")) {
    el("nearestRestrictionDistance").textContent = "0 m";
  }

  if (el("restrictionsCount")) {
    el("restrictionsCount").textContent = "1";
  }

  if (el("superbetCount")) {
    el("superbetCount").textContent = "-";
  }

  if (el("currentCoords")) {
    el("currentCoords").textContent =
      lat && lng ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "-";
  }

  if (el("riskSummary")) {
    el("riskSummary").innerHTML = `
      <b style="color:${getRestrictionColor(restriction.status)}">
        ${getRestrictionLabel(restriction.status)}
      </b><br>
      ${name}<br>
      ${county || ""}
    `;
  }

  if (el("nearestRestrictionBox")) {
    el("nearestRestrictionBox").innerHTML = `
      <strong>${name}</strong><br>
      ${county || ""}<br>
      <b style="color:${getRestrictionColor(restriction.status)}">
        ${getRestrictionLabel(restriction.status)}
      </b><br>
      ${restriction.hcl || ""}
    `;
  }

  if (el("nearbyRestrictionsList")) {
    el("nearbyRestrictionsList").innerHTML = `
      <div class="card">
        <strong>${name}</strong><br>
        ${county || ""}<br>
        <b style="color:${getRestrictionColor(restriction.status)}">
          ${getRestrictionLabel(restriction.status)}
        </b><br>
        ${hclLink(restriction.hcl)}
      </div>
    `;
  }

  if (el("nearbySuperbetList")) {
    el("nearbySuperbetList").innerHTML =
      `<div class="card">Selectează o locație exactă pentru calcul agenții apropiate.</div>`;
  }

  if (el("analysisLog")) {
    el("analysisLog").innerHTML = `
      <div class="card">
        Click pe HCL: ${name}<br>
        Județ: ${county || "-"}<br>
        Status: ${getRestrictionLabel(restriction.status)}<br>
        HCL: ${hclLink(restriction.hcl) || "-"}
      </div>
    `;
  }

  if (lat && lng) {
    currentAnalysis = {
      lat,
      lng,
      analysis: analyzeLocation({ lat, lng })
    };
  }
}

async function loadAllPolygons() {
  clearLayers(polygonLayers);

  const selected = slugify(getSelectedCity());

  let files = [];

  try {
    const res = await fetch("/api/geojson-files");
    files = await res.json();
  } catch (err) {
    console.error("Nu pot încărca lista GeoJSON:", err);
    return;
  }

  let filteredFiles = files;

  if (selected) {
    filteredFiles = files.filter(file =>
      file.file.includes(selected)
    );
  }

  if (!filteredFiles.length) {
    console.log("Nu există GeoJSON pentru:", selected);
    return;
  }

  for (const item of filteredFiles) {
    try {
      const res = await fetch(item.url);
      const geojson = await res.json();

      const layer = L.geoJSON(geojson, {
        filter: feature => {
          const type = feature.geometry?.type;
          return type === "Polygon" || type === "MultiPolygon";
        },

        pointToLayer: () => null,

        style: feature => {
          const name = getFeatureName(feature);
          const county = getFeatureCounty(feature);

          const restriction = findRestrictionForName(name, county);

          const status = restriction ? restriction.status : "unknown";
          const color = getRestrictionColor(status);

          return {
            color,
            fillColor: color,
            fillOpacity: restriction ? 0.30 : 0.04,
            weight: restriction ? 1.6 : 0.6
          };
        },

        onEachFeature: (feature, layer) => {
          const name = getFeatureName(feature) || "Localitate";
          const county = getFeatureCounty(feature);

          const restriction = findRestrictionForName(name, county);

          if (restriction) {
            layer.bindPopup(`
              <b>${name}</b><br>
              ${county || ""}<br><br>
              <b style="color:${getRestrictionColor(restriction.status)}">
                ${getRestrictionLabel(restriction.status)}
              </b><br><br>
              ${
  restriction.hcl
    ? `<a href="https://drive.google.com/drive/folders/1ua5jW6i-fpQTd05G4WxMjWusekKwMIRa?usp=sharing" target="_blank" class="hcl-link">${restriction.hcl}</a>`
    : ""
}
            `);

            layer.on("click", () => {
              updateRiskPanelFromRestriction(restriction, name, county);
            });

          } else {
            layer.bindPopup(`
              <b>${name}</b><br>
              ${county || ""}<br><br>
              <b style="color:#64748b">Fără date HCL</b>
            `);

            layer.on("click", () => {
              if (el("finalVerdict")) el("finalVerdict").textContent = "Fără date HCL";
              if (el("riskScore")) el("riskScore").textContent = "-";
              if (el("nearestRestrictionDistance")) el("nearestRestrictionDistance").textContent = "-";
              if (el("restrictionsCount")) el("restrictionsCount").textContent = "0";
              if (el("superbetCount")) el("superbetCount").textContent = "-";
              if (el("currentCoords")) el("currentCoords").textContent = "-";

              if (el("nearestRestrictionBox")) {
                el("nearestRestrictionBox").innerHTML = `
                  <strong>${name}</strong><br>
                  ${county || ""}<br>
                  Fără date HCL
                `;
              }

              if (el("nearbyRestrictionsList")) {
                el("nearbyRestrictionsList").innerHTML =
                  `<div class="card">Nu există restricții HCL pentru această localitate.</div>`;
              }

              if (el("analysisLog")) {
                el("analysisLog").innerHTML = `
                  <div class="card">
                    Click pe localitate: ${name}<br>
                    Județ: ${county || "-"}<br>
                    Status: Fără date HCL
                  </div>
                `;
              }
            });
          }
        }
      }).addTo(map);

      polygonLayers.push(layer);

      console.log("Încărcat GeoJSON:", item.file);
    } catch (err) {
      console.error("Eroare GeoJSON:", item.file, err);
    }
  }

  if (polygonLayers.length && selected) {
    try {
      const group = L.featureGroup(polygonLayers);
      map.fitBounds(group.getBounds(), {
        padding: [20, 20]
      });
    } catch {}
  }
}

function drawRestrictions() {
  clearLayers(restrictionLayers);

  if (!getChecked("toggleRestrictions", true)) return;

  const showZones = getChecked("toggleRestrictionZones", false);
  const riskDistance = getRiskDistance();

  restrictions
    .filter(matchesSelectedCity)
    .filter(item => shouldShowRestrictionStatus(item.status))
    .forEach(item => {
      if (!item.lat || !item.lng) return;

      const lat = Number(item.lat);
      const lng = Number(item.lng);
      const color = getRestrictionColor(item.status);

      let layer;

      if (showZones) {
        layer = L.circle([lat, lng], {
          radius: riskDistance,
          color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 1.5
        });
      } else {
        layer = L.circleMarker([lat, lng], {
          radius: 6,
          fillColor: color,
          color: "#111827",
          weight: 1,
          fillOpacity: 0.95
        });
      }

      layer.bindPopup(`
        <b>${item.city || "Restricție"}</b><br>
        ${getRestrictionLabel(item.status)}<br>
        ${item.hcl || ""}
      `);

      layer.on("click", () => {
        updateRiskPanelFromRestriction(item, item.city || "Restricție", item.county || item.judet || "");
      });

      layer.addTo(map);
      restrictionLayers.push(layer);
    });
}

function drawSuperbetLocations() {
  clearLayers(superbetLayers);

  if (!getChecked("toggleSuperbet", true)) return;

  analyzedLocations
    .filter(item => matchesSelectedCity(item.location))
    .forEach(item => {
      const location = item.location;
      const analysis = item.analysis;

      if (!location.lat || !location.lng) return;

      const marker = L.circleMarker(
        [Number(location.lat), Number(location.lng)],
        {
          radius: 6,
          fillColor: analysis.color,
          color: "#111827",
          weight: 1.5,
          fillOpacity: 0.95
        }
      );

      marker.bindPopup(`
        <b>${location.shopName || location.name || "Superbet"}</b><br>
        ${location.city || ""}<br>
        ${location.agencyType || ""}<br>
        <hr>
        <b style="color:${analysis.color};">${analysis.text}</b><br>
        Scor risc: ${analysis.score} / 100<br>
        Cea mai apropiată restricție: ${formatDistance(analysis.nearestDistance)}
      `);

      marker.on("click", () => {
        updateRiskPanel(Number(location.lat), Number(location.lng), analysis);
      });

      marker.addTo(map);
      superbetLayers.push(marker);
    });
}

function getNearbySuperbet(lat, lng) {
  return superbetLocations
    .filter(item => item.lat && item.lng)
    .map(item => ({
      ...item,
      distance: distanceMeters(lat, lng, Number(item.lat), Number(item.lng))
    }))
    .filter(item => item.distance <= getAnalysisRadius())
    .sort((a, b) => a.distance - b.distance);
}

function analyzePoint(lat, lng) {
  clearLayers(analysisLayers);

  const analysis = analyzeLocation({ lat, lng });

  if (getChecked("toggleRiskCircle", true)) {
    const circle = L.circle([lat, lng], {
      radius: getAnalysisRadius(),
      color: analysis.color,
      fillColor: analysis.color,
      fillOpacity: 0.12,
      weight: 2
    }).addTo(map);

    analysisLayers.push(circle);
  }

  const marker = L.circleMarker([lat, lng], {
    radius: 12,
    fillColor: "#22c55e",
    color: "#064e3b",
    weight: 3,
    fillOpacity: 1
  }).addTo(map);

  marker.bindPopup(`
    <b>Locație analizată</b><br><br>
    <b style="color:${analysis.color};">${analysis.text}</b><br>
    Scor risc: ${analysis.score} / 100<br>
    Lat: ${lat.toFixed(6)}<br>
    Lng: ${lng.toFixed(6)}
  `).openPopup();

  analysisLayers.push(marker);

  updateRiskPanel(lat, lng, analysis);
}

async function searchAddress() {
  const city = getSelectedCity();
  const address = getValue("addressInput", "").trim();

  if (!address && !city) {
    alert("Introdu orașul sau adresa.");
    return;
  }

  const q = encodeURIComponent(`${address}, ${city}, România`);

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ro&q=${q}`
  );

  const data = await res.json();

  if (!data.length) {
    alert("Adresa nu a fost găsită.");
    return;
  }

  const lat = Number(data[0].lat);
  const lng = Number(data[0].lon);

  map.setView([lat, lng], 15);
  analyzePoint(lat, lng);
}

async function centerOnCity() {
  const city = getSelectedCity();

  if (!city) {
    alert("Introdu orașul / județul.");
    return;
  }

  const q = encodeURIComponent(`${city}, România`);

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ro&q=${q}`
  );

  const data = await res.json();

  if (!data.length) {
    alert("Orașul / județul nu a fost găsit.");
    return;
  }

  const lat = Number(data[0].lat);
  const lng = Number(data[0].lon);

  map.setView([lat, lng], 11);
  await loadAllPolygons();
}

function generateCandidateZones() {
  clearLayers(candidateLayers);

  if (!currentAnalysis) {
    alert("Alege mai întâi o locație pe hartă sau caută o adresă.");
    return;
  }

  const center = currentAnalysis;
  const radius = getAnalysisRadius();
  const step = 200;
  const candidates = [];

  const latStep = step / 111320;
  const lngStep = step / (111320 * Math.cos(center.lat * Math.PI / 180));

  for (
    let lat = center.lat - radius / 111320;
    lat <= center.lat + radius / 111320;
    lat += latStep
  ) {
    for (
      let lng = center.lng - radius / 111320;
      lng <= center.lng + radius / 111320;
      lng += lngStep
    ) {
      const d = distanceMeters(center.lat, center.lng, lat, lng);
      if (d > radius) continue;

      const analysis = analyzeLocation({ lat, lng });

      if (analysis.status === "ok") {
        candidates.push({
          lat,
          lng,
          distanceFromCenter: d,
          analysis
        });
      }
    }
  }

  candidates
    .sort((a, b) => a.distanceFromCenter - b.distanceFromCenter)
    .slice(0, 50)
    .forEach(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: 5,
        fillColor: "#22c55e",
        color: "#064e3b",
        weight: 1,
        fillOpacity: 0.9
      }).addTo(map);

      marker.bindPopup(`
        <b>Zonă candidată SAFE</b><br>
        Distanță față de punct: ${formatDistance(item.distanceFromCenter)}<br>
        Cea mai apropiată restricție: ${formatDistance(item.analysis.nearestDistance)}
      `);

      candidateLayers.push(marker);
    });

  if (el("candidateList")) {
    el("candidateList").innerHTML =
      candidates.slice(0, 10).map((item, index) => `
        <div class="card">
          <strong>${index + 1}. Zonă candidată SAFE</strong><br>
          Distanță: ${formatDistance(item.distanceFromCenter)}<br>
          Restricție apropiată: ${formatDistance(item.analysis.nearestDistance)}
        </div>
      `).join("") || `<div class="card">Nu există zone candidate.</div>`;
  }
}

function drawImportedCandidates() {
  clearLayers(importedCandidateLayers);

  importedCandidates.forEach(item => {
    if (!item.lat || !item.lng) return;

    const analysis = analyzeLocation(item);
    const color = analysis.color;

    const marker = L.circleMarker([Number(item.lat), Number(item.lng)], {
      radius: 7,
      fillColor: color,
      color: "#111827",
      weight: 1.5,
      fillOpacity: 0.95
    }).addTo(map);

    marker.bindPopup(`
      <b>${item.name || "Candidat importat"}</b><br>
      ${item.city || ""}<br>
      <hr>
      <b style="color:${color};">${analysis.text}</b><br>
      Scor risc: ${analysis.score} / 100<br>
      Restricție apropiată: ${formatDistance(analysis.nearestDistance)}
    `);

    marker.on("click", () => {
      updateRiskPanel(Number(item.lat), Number(item.lng), analysis);
    });

    importedCandidateLayers.push(marker);
  });

  if (el("importedCandidateList")) {
    el("importedCandidateList").innerHTML =
      importedCandidates.slice(0, 20).map(item => {
        const analysis = analyzeLocation(item);

        return `
          <div class="card">
            <strong>${item.name || "Candidat"}</strong><br>
            ${item.city || ""}<br>
            ${analysis.text}<br>
            Scor: ${analysis.score} / 100
          </div>
        `;
      }).join("") || `<div class="card">Nu există candidate importate.</div>`;
  }
}

function importCandidatesCsv() {
  const input = el("candidateCsvInput");
  const file = input?.files?.[0];

  if (!file) {
    alert("Alege un fișier CSV.");
    return;
  }

  const reader = new FileReader();

  reader.onload = e => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(Boolean);

    const header = lines.shift().split(",").map(h => normalizeText(h));

    const nameIndex = header.findIndex(h => h.includes("name") || h.includes("nume"));
    const cityIndex = header.findIndex(h => h.includes("city") || h.includes("oras") || h.includes("judet"));
    const latIndex = header.findIndex(h => h === "lat" || h.includes("latitudine"));
    const lngIndex = header.findIndex(h => h === "lng" || h === "lon" || h.includes("longitudine"));

    importedCandidates = lines.map(line => {
      const cols = line.split(",").map(v => v.replace(/^"|"$/g, "").trim());

      return {
        name: nameIndex >= 0 ? cols[nameIndex] : "Candidat",
        city: cityIndex >= 0 ? cols[cityIndex] : "",
        lat: latIndex >= 0 ? Number(cols[latIndex]) : null,
        lng: lngIndex >= 0 ? Number(cols[lngIndex]) : null
      };
    }).filter(item => item.lat && item.lng);

    drawImportedCandidates();

    alert(`Au fost importate ${importedCandidates.length} locații candidate.`);
  };

  reader.readAsText(file);
}

function exportImportedCandidatesCsv() {
  const rows = [
    ["name", "city", "lat", "lng", "verdict", "score", "nearestRestrictionDistance"]
  ];

  importedCandidates.forEach(item => {
    const analysis = analyzeLocation(item);

    rows.push([
      item.name || "",
      item.city || "",
      item.lat,
      item.lng,
      analysis.text,
      analysis.score,
      Math.round(analysis.nearestDistance || 0)
    ]);
  });

  downloadCsv(rows, "candidate-importate-analizate.csv");
}

function clearImportedCandidates() {
  importedCandidates = [];
  clearLayers(importedCandidateLayers);

  if (el("importedCandidateList")) {
    el("importedCandidateList").innerHTML =
      `<div class="card">Nu există candidate importate.</div>`;
  }
}

function downloadCsv(rows, filename) {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = [
    ["shopName", "city", "lat", "lng", "verdict", "score", "nearestRestrictionDistance"]
  ];

  analyzedLocations.forEach(item => {
    rows.push([
      item.location.shopName || item.location.name || "",
      item.location.city || "",
      item.location.lat || "",
      item.location.lng || "",
      item.analysis.text,
      item.analysis.score,
      Math.round(item.analysis.nearestDistance || 0)
    ]);
  });

  downloadCsv(rows, "superbet-analiza-risc.csv");
}

function refreshAll() {
  analyzedLocations = superbetLocations.map(location => ({
    location,
    analysis: analyzeLocation(location)
  }));

  drawRestrictions();
  drawSuperbetLocations();
  drawImportedCandidates();

  setTimeout(() => map.invalidateSize(), 100);
}

async function loadRestrictions() {
  try {
    const res = await fetch("/api/restrictions");
    restrictions = await res.json();
  } catch (err) {
    console.error("Nu pot încărca restricțiile:", err);
    restrictions = [];
  }
}

async function loadSuperbetLocations() {
  try {
    const res = await fetch("/api/superbet-locations");
    superbetLocations = await res.json();
  } catch (err) {
    console.error("Nu pot încărca agențiile Superbet:", err);
    superbetLocations = [];
  }
}

async function init() {
  await loadRestrictions();
  await loadSuperbetLocations();

  refreshAll();
  await loadAllPolygons();

  el("searchAddressBtn")?.addEventListener("click", searchAddress);
  el("centerCityBtn")?.addEventListener("click", centerOnCity);

  el("analyzeBtn")?.addEventListener("click", () => {
    if (!currentAnalysis) {
      alert("Alege mai întâi o locație pe hartă.");
      return;
    }

    analyzePoint(currentAnalysis.lat, currentAnalysis.lng);
  });

  el("generateCandidatesBtn")?.addEventListener("click", generateCandidateZones);

  el("exportCsvBtn")?.addEventListener("click", exportCsv);

  el("importCandidatesBtn")?.addEventListener("click", importCandidatesCsv);
  el("exportImportedCandidatesBtn")?.addEventListener("click", exportImportedCandidatesCsv);
  el("clearImportedCandidatesBtn")?.addEventListener("click", clearImportedCandidates);

  [
    "cityInput",
    "analysisRadiusInput",
    "restrictionDistanceInput",
    "riskModeSelect",
    "toggleRestrictions",
    "toggleSuperbet",
    "toggleRiskCircle",
    "toggleRestrictionZones",
    "filterGamblingInterzis",
    "filterSloturiInterzise",
    "filterRestrictiiLocale",
    "filterSafe"
  ].forEach(id => {
    const node = el(id);
    if (!node) return;

    node.addEventListener("change", async () => {
      refreshAll();
      await loadAllPolygons();
    });

    node.addEventListener("input", async () => {
      refreshAll();
      await loadAllPolygons();
    });
  });

  map.on("click", e => {
    analyzePoint(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => map.invalidateSize(), 300);
}

init();