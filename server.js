const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const csv = require("csv-parser");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const IMPORTS_DIR = path.join(ROOT_DIR, "imports");
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");

const RESTRICTIONS_FILE = path.join(DATA_DIR, "gambling-restrictions.json");
const SUPERBET_FILE = path.join(DATA_DIR, "superbet-locations.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMPORTS_DIR)) fs.mkdirSync(IMPORTS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({ dest: UPLOADS_DIR });

function readJsonSafe(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error("Eroare citire JSON:", filePath, err.message);
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function toNumber(value) {
  if (value === null || value === undefined) return null;

  const text = String(value)
    .replace(",", ".")
    .replace(/[^\d.-]/g, "")
    .trim();

  if (!text) return null;

  const nr = Number(text);
  return Number.isFinite(nr) ? nr : null;
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeStatus(status) {
  const text = normalizeText(status);

  if (
    text.includes("to be banned") ||
    text.includes("banned") ||
    text.includes("interzis") ||
    text.includes("interzise") ||
    text.includes("gambling interzis")
  ) {
    if (text.includes("slot")) {
      return "sloturi_interzise";
    }

    return "gambling_interzis";
  }

  if (
    text.includes("restrictii locale") ||
    text.includes("restrictii") ||
    text.includes("hcl")
  ) {
    return "restrictii_locale";
  }

  if (
    text.includes("safe") ||
    text.includes("ok") ||
    text.includes("permis")
  ) {
    return "safe";
  }

  return "unknown";
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }

  return "";
}

function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", row => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function parseCristinaRows(rows) {
  const restrictions = [];
  const superbetLocations = [];

  rows.forEach(row => {
    const city = pick(row, [
      "ORAS",
      "Oras",
      "oras",
      "Oraș",
      "Localitate",
      "LOCALITATE",
      "city",
      "City"
    ]);

    const county = pick(row, [
      "JUDET",
      "Judet",
      "judet",
      "Județ",
      "county",
      "County"
    ]);

    const shopName = pick(row, [
      "SHOP NAME",
      "Shop Name",
      "shopName",
      "Nume agentie",
      "Nume agenție",
      "Agentie",
      "Agenție"
    ]);

    const lat = toNumber(pick(row, [
      "lat",
      "Lat",
      "LAT",
      "Latitude",
      "latitude",
      "Latitudine"
    ]));

    const lng = toNumber(pick(row, [
      "lng",
      "Lng",
      "LNG",
      "lon",
      "Lon",
      "LON",
      "Longitude",
      "longitude",
      "Longitudine"
    ]));

    const statusRaw = pick(row, [
      "Status Oras",
      "Status oraș",
      "Status shop",
      "STATUS",
      "Status",
      "status"
    ]);

    const hcl = pick(row, [
      "HCL",
      "Hcl",
      "hcl",
      "Hotarare",
      "Hotărâre",
      "hotarare"
    ]);

    const details = pick(row, [
      "Observatii",
      "Observații",
      "observatii",
      "Details",
      "details"
    ]);

    const source = pick(row, [
  "link",
  "Link",
  "LINK",
  "source",
  "Source",
  "SOURCE",
  "URL",
  "Url",
  "url",
  "HCL LINK",
  "HCL Link",
  "Hcl Link",
  "Link HCL",
  "LINK HCL",
  "link hcl",
  "HCL URL",
  "Url HCL",
  "URL HCL",
  "Document",
  "DOCUMENT",
  "Google Drive",
  "Drive",
  "Link document",
  "LINK DOCUMENT"
]);

    const status = normalizeStatus(statusRaw);

    if (city || lat || lng || hcl || status !== "unknown") {
      restrictions.push({
        city,
        name: city,
        county,
        judet: county,
        lat,
        lng,
        status,
        title: shopName,
        hcl,
        details,
        source
      });
    }

    if (shopName || lat || lng) {
      superbetLocations.push({
        shopName,
        name: shopName,
        city,
        county,
        judet: county,
        lat,
        lng,
        agencyType: pick(row, [
          "TIP",
          "Tip",
          "type",
          "Agency Type",
          "agencyType"
        ])
      });
    }
  });

  return {
    restrictions: restrictions.filter(item => item.city || item.lat || item.lng),
    superbetLocations: superbetLocations.filter(item => item.shopName || item.lat || item.lng)
  };
}

app.get("/api/restrictions", (req, res) => {
  res.json(readJsonSafe(RESTRICTIONS_FILE, []));
});

app.get("/api/superbet-locations", (req, res) => {
  res.json(readJsonSafe(SUPERBET_FILE, []));
});

app.get("/api/geojson-files", (req, res) => {
  const publicDataDir = path.join(PUBLIC_DIR, "data");

  if (!fs.existsSync(publicDataDir)) {
    return res.json([]);
  }

  const files = fs
    .readdirSync(publicDataDir)
    .filter(file => file.toLowerCase().endsWith(".geojson"))
    .map(file => ({
      file,
      url: `/data/${file}`
    }));

  res.json(files);
});

app.post("/api/upload-cristina-csv", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "Nu a fost încărcat niciun fișier."
      });
    }

    const rows = await parseCsvFile(req.file.path);
    const parsed = parseCristinaRows(rows);

    writeJsonSafe(RESTRICTIONS_FILE, parsed.restrictions);
    writeJsonSafe(SUPERBET_FILE, parsed.superbetLocations);

    fs.unlinkSync(req.file.path);

    res.json({
      ok: true,
      restrictions: parsed.restrictions.length,
      superbetLocations: parsed.superbetLocations.length
    });
  } catch (err) {
    console.error("Eroare import Cristina CSV:", err);

    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.post("/api/upload-superbet-csv", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "Nu a fost încărcat niciun fișier."
      });
    }

    const rows = await parseCsvFile(req.file.path);
    const parsed = parseCristinaRows(rows);

    writeJsonSafe(SUPERBET_FILE, parsed.superbetLocations);

    fs.unlinkSync(req.file.path);

    res.json({
      ok: true,
      superbetLocations: parsed.superbetLocations.length
    });
  } catch (err) {
    console.error("Eroare import Superbet CSV:", err);

    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server pornit pe http://localhost:${PORT}`);
});