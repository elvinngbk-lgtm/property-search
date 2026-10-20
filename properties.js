/* Loads the property list from the Google Sheet (live) and cleans it.
   Falls back to snapshot.csv in this repo if the sheet can't be reached. */
(() => {
// Paste the Google Sheet ID here (the long code in the sheet's URL between /d/ and /edit).
const SHEET_ID = "1pr64jacCCnNZEOdJgV9uROQHZa5FEtlSpX0_4tan28s";

const SHEET_CSV = id => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&t=${Date.now()}`;

/* RFC 4180 CSV parser: handles quotes, commas and line breaks inside cells. */
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

/* ---- Area: "Neighbourhood, Area[, KL]" -> {region, area, hood} ---- */
const AREA_FIX = {
  "Cheras (Batu 9)": ["Cheras", "Batu 9"], "Kajang/Bangi": ["Kajang", "Bangi"],
  "Wangsa Maju/Setapak, KL": ["Setapak", "Wangsa Maju"], "PJ (SS1)": ["Petaling Jaya", "SS1"],
  "Selayang Baru": ["Selayang", "Selayang Baru"], "Setia Alam, Klang": ["Shah Alam", "Setia Alam"],
  "Setia Alam, Shah Alam": ["Shah Alam", "Setia Alam"], "Taman Connaught, Cheras, KL": ["Cheras", "Taman Connaught"],
  "Bandar Sri Damansara": ["Damansara", "Bandar Sri Damansara"], "Damansara, KL": ["Damansara", ""],
  "Damansara, PJ": ["Damansara", ""], "Selangor": ["Selangor (other)", ""],
};
const CITY_SUFFIX = new Set(["KL", "PJ", "Selangor"]);
const KL_AREAS = new Set(["Kuala Lumpur", "Damansara", "Bandar Sri Damansara"]);
const OTHER_STATES = {Penang: "Penang", Seremban: "Negeri Sembilan", Putrajaya: "Putrajaya"};
const titleCase = s => s.replace(/\s+/g, " ").replace(/\b([a-z])/g, m => m.toUpperCase());

function splitArea(raw) {
  raw = raw.replace(/\s+/g, " ").trim();
  let area, hood;
  if (AREA_FIX[raw]) [area, hood] = AREA_FIX[raw];
  else {
    let parts = raw.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length > 1 && CITY_SUFFIX.has(parts[parts.length - 1])) parts = parts.slice(0, -1);
    [area, hood] = parts.length >= 2 ? [parts[parts.length - 1], parts[0]] : [parts[0] || "Unknown", ""];
  }
  if (area === "PJ") area = "Petaling Jaya";
  area = titleCase(area);
  const region = OTHER_STATES[area] || (/(^|, )KL($|,)/.test(raw) || KL_AREAS.has(area) ? "Kuala Lumpur" : "Selangor");
  return {region, area, hood};
}

function inferType(name, type) {
  const n = name.toLowerCase();
  if (/town\s*house/i.test(type)) return "Townhouse";
  if (/service|residen|suites/.test(n)) return "Serviced Residence";
  if (/condo|kondo/.test(n)) return "Condominium";
  return "Apartment";
}

/* ---- Notes: leading tags "3BR | 2BA | 1CP | 950sqft | free text | ..." ---- */
const SQFT_RE = /(\d[\d,]{2,4})\s*(?:sq\.?\s*f(?:ee)?t\.?|sqft|sqf|sf|square\s*feet)\b/i;
const BED_RE = /\b(\d)\s*(?:r\b|rooms?\b|bed\s*rooms?\b|bedrooms?\b|bed\b)/i;
const BATH_RE = /\b(\d)\s*(?:b\b|bath\s*rooms?\b|bathrooms?\b|bath\b)/i;
const NOISE_RE = /(?:[✅🔥⁠*~=]|▶️?)+|^[\s.:\-]+|[\s.:\-]+$/gu;
const HEADINGS = new Set(["details", "detail", "propertydetails", "unitdetails", "detailsoftheproperty", "features"]);

function parseNotes(notes) {
  const info = {beds: null, baths: null, parking: null, sqft: null};
  const rest = [];
  for (const p of notes.split("|").map(s => s.trim())) {
    const m = !rest.length && p.match(/^(\d+)(BR|BA|CP|sqft)$/);
    if (m) info[{BR: "beds", BA: "baths", CP: "parking", sqft: "sqft"}[m[2]]] = +m[1];
    else rest.push(p);
  }
  const text = rest.join(" ");
  // "733BR" is a size typo, not 733 bedrooms.
  if (info.beds > 6) { if (!info.sqft && info.beds >= 300 && info.beds <= 4000) info.sqft = info.beds; info.beds = null; }
  if (!info.sqft) { const m = text.match(SQFT_RE); if (m) info.sqft = +m[1].replace(/,/g, ""); }
  if (info.sqft && (info.sqft < 300 || info.sqft > 4000)) info.sqft = null;
  const compact = text.match(/\b(\d)\s*r\s*(\d)\s*b\b/i); // "3r2b"
  if (!info.beds) { const m = compact || text.match(BED_RE); if (m && +m[1] >= 1 && +m[1] <= 6) info.beds = +m[1]; }
  if (!info.baths) {
    if (compact) info.baths = +compact[2];
    else { const m = text.match(BATH_RE); if (m && +m[1] >= 1 && +m[1] <= 5) info.baths = +m[1]; }
  }
  const low = text.toLowerCase();
  info.bumi = /non[\s-]?bumi/.test(low) ? "Non-Bumi" : /\bbumi\b/.test(low) ? "Bumi lot" : "";
  info.corner = low.includes("corner");
  info.walkup = /walk[\s-]?up/.test(low);
  info.titleHint = low.includes("strata") ? "Strata" : low.includes("master title") ? "Master" : "";
  const seen = new Set();
  info.lines = [];
  for (let p of rest) {
    p = p.replace(NOISE_RE, "").trim();
    const key = p.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key.length < 3 || seen.has(key) || HEADINGS.has(key)) continue;
    if (/^\d[\d,]*\s*(?:sq\.?\s*f(?:ee)?t\.?|sqft|sqf|sf|square\s*feet)$/i.test(p)) continue;
    seen.add(key); info.lines.push(p);
  }
  return info;
}

const num = v => { const n = Number(String(v || "").replace(/[^\d.]/g, "")); return n > 0 ? Math.round(n) : null; };

function clean(rows) {
  const out = [], skipped = [];
  rows.forEach((r, i) => {
    let name = (r["property name"] || "").replace(/\s+/g, " ").trim();
    const pmin = num(r["price min"]), pmax = num(r["price max"]) || pmin, bank = num(r["bank value"]);
    // One bad row (no name / no price) is skipped instead of breaking the whole site.
    if (!name || !pmin) { if (name || pmin) skipped.push(name || `row ${i + 2}`); return; }
    let address = "";
    if (name.includes(",")) { const k = name.indexOf(","); address = name.slice(k + 1).trim(); name = name.slice(0, k).trim(); }
    const {region, area, hood} = splitArea(r["area"] || "");
    const info = parseNotes(r["notes"] || "");
    const rawTitle = titleCase((r["title"] || "").toLowerCase());
    const title = rawTitle || info.titleHint;
    const cash = bank ? bank - pmin : null;
    const photo = (r["photo url"] || "").trim();
    out.push({
      id: out.length + 1, name, region, area, hood,
      type: inferType(name, r["type"] || ""),
      title, titleInferred: !!(title && !rawTitle),
      tenure: titleCase((r["tenure"] || "").toLowerCase()),
      pmin, pmax, bank, cash,
      cashPct: cash == null ? null : Math.round(cash / pmin * 1000) / 10,
      psf: info.sqft ? Math.round(pmin / info.sqft) : null,
      beds: info.beds, baths: info.baths, parking: info.parking, sqft: info.sqft,
      bumi: info.bumi, corner: info.corner, walkup: info.walkup,
      notes: (address ? [address] : []).concat(info.lines),
      photo: photo.startsWith("https://") ? photo : "",
      // Spreads this far out are usually a typo or auction price; flag for checking.
      verify: cash != null && (cash < 0 || cash > pmin || pmax > 2 * pmin),
    });
  });
  return {properties: out, skipped};
}

async function fetchText(url) {
  const res = await fetch(url, {cache: "no-store"});
  if (!res.ok) throw new Error(res.status);
  const t = await res.text();
  if (/^\s*</.test(t)) throw new Error("not CSV (sheet not shared?)");
  return t;
}

window.loadProperties = async () => {
  let text, source = "live";
  try {
    if (!SHEET_ID) throw new Error("no sheet");
    text = await fetchText(SHEET_CSV(SHEET_ID));
  } catch (e) {
    console.warn("Google Sheet unavailable, using snapshot:", e.message);
    text = await fetchText("snapshot.csv");
    source = "snapshot";
  }
  return {...clean(parseCSV(text)), source, loaded: new Date()};
};
})();
