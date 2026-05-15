const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const INPUT_FILE = path.join(__dirname, "..", "imports", "Centralizare Cristina.csv");
const RESTRICTIONS_OUTPUT = path.join(__dirname, "..", "data", "gambling-restrictions.json");
const SUPERBET_OUTPUT = path.join(__dirname, "..", "data", "superbet-locations.json");

const restrictions = [];
const superbetLocations = [];

function normalizeStatus(status) {
  const text = String(status || "").toLowerCase().trim();

  if (text.includes("to be banned") && text.includes("slot")) return "sloturi_interzise";
  if (text.includes("to be banned")) return "gambling_interzis";
  if (text.includes("safe")) return "safe";

  return "unknown";
}

function toNumber(value) {
  if (!value) return null;

  const number = Number(String(value).replace(",", ".").trim());
  return Number.isFinite(number) ? number : null;
}

fs.createReadStream(INPUT_FILE)
  .pipe(csv())
  .on("data", row => {
    const city = row["ORAS"] || row["Oras"] || row["oras"] || "";

    const lat = toNumber(row["lat"] || row["lat "] || row["LAT"] || row["Lat"]);
    const lng = toNumber(row["lng"] || row["lng "] || row["LNG"] || row["Lng"]);

    const status = normalizeStatus(row["Status Oras"]);

    const hcl = row["HCL"] || "";
    const annex = row["Anexa"] || "";
    const localTax = row["Taxa locala"] || "";
    const notes = row["Observatii"] || "";

    const shopName = row["SHOP NAME"] || "";
    const agencyType = row["TIP AGENTIE"] || "";
    const shopStatus = row["Status shop"] || "";
    const machines = row["Nr. Aparate"] || "";
    const usableArea = row["Suprafata utila"] || "";

    if (city && status !== "safe" && status !== "unknown") {
      restrictions.push({
        city,
        lat,
        lng,
        status,
        hcl,
        annex,
        localTax,
        notes
      });
    }

    if (shopName) {
      superbetLocations.push({
        shopName,
        agencyType,
        city,
        shopStatus,
        machines,
        usableArea,
        lat,
        lng
      });
    }
  })
  .on("end", () => {
    fs.writeFileSync(RESTRICTIONS_OUTPUT, JSON.stringify(restrictions, null, 2));
    fs.writeFileSync(SUPERBET_OUTPUT, JSON.stringify(superbetLocations, null, 2));

    console.log("Import terminat");
    console.log(`Restricții: ${restrictions.length}`);
    console.log(`Agenții: ${superbetLocations.length}`);
  });