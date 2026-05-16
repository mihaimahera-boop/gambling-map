const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const INPUT_FILE = path.join(__dirname, "..", "imports", "Centralizare Cristina.csv");

const RESTRICTIONS_OUTPUT = path.join(
  __dirname,
  "..",
  "data",
  "gambling-restrictions.json"
);

const SUPERBET_OUTPUT = path.join(
  __dirname,
  "..",
  "data",
  "superbet-locations.json"
);

const restrictions = [];
const superbetLocations = [];

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") {
      return String(row[name]).trim();
    }
  }
  return "";
}

function toNumber(value) {
  if (value === null || value === undefined) return null;

  const nr = Number(
    String(value)
      .replace(",", ".")
      .trim()
  );

  return Number.isFinite(nr) ? nr : null;
}

function normalizeStatus(status) {
  const text = String(status || "").toLowerCase().trim();

  if (text.includes("safe")) {
    return "safe";
  }

  if (text.includes("slot")) {
    return "sloturi_interzise";
  }

  if (
    text.includes("to be banned") ||
    text.includes("banned") ||
    text.includes("closed") ||
    text.includes("inchis") ||
    text.includes("interzis")
  ) {
    return "gambling_interzis";
  }

  if (
    text.includes("local") ||
    text.includes("restrict")
  ) {
    return "restrictii_locale";
  }

  return "unknown";
}

fs.createReadStream(INPUT_FILE)
  .pipe(csv())
  .on("data", row => {
    const city = pick(row, ["ORAS", "oras", "Oraș", "Oras", "city", "City"]);
    const lat = toNumber(pick(row, ["lat", "LAT", "Lat", "latitude", "Latitude"]));
    const lng = toNumber(pick(row, ["lng", "LNG", "Lng", "lon", "Lon", "longitude", "Longitude"]));

    const rawStatus = pick(row, [
      "Status HCL",
      "Status ...tie Emisa",
      "Status autorizatie emisa",
      "Status",
      "status"
    ]);

    const status = normalizeStatus(rawStatus);

    const hcl = pick(row, [
      "HCL",
      "hcl",
      "Nr HCL",
      "Nr. HCL",
      "Hotarare",
      "Hotărâre"
    ]);

    const hclLink = pick(row, [
      "link",
      "Link",
      "LINK",
      "hclLink",
      "HCL Link",
      "Link HCL",
      "URL",
      "url"
    ]);

    const annex = pick(row, ["Anexa", "Anexă", "annex"]);
    const localTax = pick(row, ["Taxa", "Taxă", "localTax"]);
    const notes = pick(row, ["Observatii", "Observații", "notes"]);

    const shopName = pick(row, ["SHOP NAME", "Shop Name", "shopName"]);
    const agencyType = pick(row, ["TIP AGENTIE", "Tip agentie", "agencyType"]);
    const shopStatus = pick(row, ["Status SHOP", "Status shop", "shopStatus"]);
    const machines = pick(row, ["Nr. Aparate", "Nr Aparate", "machines"]);
    const usableArea = pick(row, ["Suprafata utila", "Suprafața utilă", "usableArea"]);

    if (city && lat !== null && lng !== null && hcl) {
      restrictions.push({
        city,
        lat,
        lng,
        status,
        hcl,
        hclLink,
        annex,
        localTax,
        notes
      });
    }

    if (shopName && lat !== null && lng !== null) {
      superbetLocations.push({
        shopName,
        city,
        lat,
        lng,
        agencyType,
        shopStatus,
        machines,
        usableArea,
        hcl,
        hclLink,
        notes
      });
    }
  })
  .on("end", () => {
    fs.writeFileSync(
      RESTRICTIONS_OUTPUT,
      JSON.stringify(restrictions, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      SUPERBET_OUTPUT,
      JSON.stringify(superbetLocations, null, 2),
      "utf8"
    );

    console.log("Import terminat");
    console.log("Restricții:", restrictions.length);
    console.log("Agenții:", superbetLocations.length);
  });