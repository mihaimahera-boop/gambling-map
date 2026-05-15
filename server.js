const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const csv = require("csv-parser");

const app = express();
const PORT = 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLIC_DATA_DIR = path.join(PUBLIC_DIR, "data");

const RESTRICTIONS_FILE = path.join(DATA_DIR, "gambling-restrictions.json");
const SUPERBET_FILE = path.join(DATA_DIR, "superbet-locations.json");

app.use(express.static(PUBLIC_DIR));
app.use(express.json({ limit: "50mb" }));

const upload = multer({
  dest: path.join(ROOT_DIR, "uploads")
});

function ensureFolders() {
  if (!fs.existsSync(path.join(ROOT_DIR, "uploads"))) {
    fs.mkdirSync(path.join(ROOT_DIR, "uploads"));
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }

  if (!fs.existsSync(PUBLIC_DATA_DIR)) {
    fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  }
}

ensureFolders();

function readJsonSafe(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;

    const raw = fs.readFileSync(filePath, "utf8");

    if (!raw.trim()) return fallback;

    return JSON.parse(raw);
  } catch (err) {
    console.log("Eroare citire JSON:", filePath);
    console.log(err.message);
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function geocode(query) {
  return null;
}

function normalizeStatus(status) {
  const text = normalizeText(status);

  if (text.includes("gambling") && text.includes("interzis")) {
    return "gambling_interzis";
  }

  if (text.includes("slot")) {
    return "sloturi_interzise";
  }

  if (text.includes("restrict")) {
    return "restrictii_locale";
  }

  if (text.includes("safe")) {
    return "safe";
  }

  return status || "unknown";
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Server funcțional",
    port: PORT
  });
});

app.get("/api/restrictions", (req, res) => {
  const data = readJsonSafe(RESTRICTIONS_FILE, []);

  res.json(data);
});

app.get("/api/superbet-locations", (req, res) => {
  const data = readJsonSafe(SUPERBET_FILE, []);

  res.json(data);
});

app.get("/api/geojson-files", (req, res) => {
  try {
    if (!fs.existsSync(PUBLIC_DATA_DIR)) {
      return res.json([]);
    }

    const files = fs
      .readdirSync(PUBLIC_DATA_DIR)
      .filter(file => file.toLowerCase().endsWith(".geojson"))
      .map(file => ({
        file,
        slug: file.replace(".geojson", ""),
        url: `/data/${file}`,
        sizeKb: Math.round(
          fs.statSync(path.join(PUBLIC_DATA_DIR, file)).size / 1024
        )
      }))
      .sort((a, b) => a.file.localeCompare(b.file));

    res.json(files);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/api/geojson/:slug", (req, res) => {
  try {
    const slug = slugify(req.params.slug);

    const possibleFiles = [
      `${slug}.geojson`,
      `${slug}-orase.geojson`,
      `${slug}-localitati.geojson`,
      `${slug}-judete.geojson`
    ];

    for (const file of possibleFiles) {
      const fullPath = path.join(PUBLIC_DATA_DIR, file);

      if (fs.existsSync(fullPath)) {
        return res.sendFile(fullPath);
      }
    }

    res.status(404).json({
      error: "Fișier GeoJSON negăsit",
      slug
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.post("/api/upload-csv", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Nu ai încărcat niciun fișier."
    });
  }

  const rows = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", row => rows.push(row))
    .on("end", async () => {
      try {
        const results = [];

        for (const row of rows) {
          let lat = Number(row.lat || row.latitude);
          let lng = Number(row.lng || row.lon || row.longitude);

          if (!lat || !lng) {
            const geo = await geocode(
              `${row.city || row.name || ""}, ${row.county || ""}, România`
            );

            await sleep(1100);

            if (!geo) continue;

            lat = geo.lat;
            lng = geo.lng;
          }

          results.push({
            city: row.city || row.name || "",
            county: row.county || "",
            lat,
            lng,
            status: normalizeStatus(row.status || row.tip || ""),
            title: row.title || "",
            hcl: row.hcl || row.HCL || "",
            details: row.details || row.detalii || "",
            source: row.source || row.sursa || ""
          });
        }

        writeJsonSafe(RESTRICTIONS_FILE, results);

        fs.unlinkSync(req.file.path);

        res.json({
          success: true,
          imported: results.length
        });
      } catch (err) {
        console.log("EROARE IMPORT RESTRICȚII:");
        console.log(err);

        res.status(500).json({
          error: err.message
        });
      }
    });
});

app.post("/api/upload-superbet-csv", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Nu ai încărcat niciun fișier."
    });
  }

  const rows = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", row => rows.push(row))
    .on("end", async () => {
      try {
        const results = [];

        for (const row of rows) {
          let lat = Number(row.lat || row.latitude);
          let lng = Number(row.lng || row.lon || row.longitude);

          if (!lat || !lng) {
            const geo = await geocode(
              row.address
                ? `${row.address}, ${row.city}, ${row.county}, România`
                : `${row.city}, ${row.county}, România`
            );

            await sleep(1100);

            if (!geo) continue;

            lat = geo.lat;
            lng = geo.lng;
          }

          results.push({
            name: row.name || row.shopName || "Superbet",
            shopName: row.shopName || row.name || "Superbet",
            code: row.code || row.cod || "",
            city: row.city || "",
            county: row.county || "",
            address: row.address || "",
            agencyType: row.agencyType || row.type || "",
            lat,
            lng
          });
        }

        writeJsonSafe(SUPERBET_FILE, results);

        fs.unlinkSync(req.file.path);

        res.json({
          success: true,
          imported: results.length
        });
      } catch (err) {
        console.log("EROARE SUPERBET:");
        console.log(err);

        res.status(500).json({
          error: err.message
        });
      }
    });
});

app.listen(PORT, () => {
  console.log(`Server pornit: http://localhost:${PORT}`);
});