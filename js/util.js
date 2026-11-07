import { EMAIL_DOMAIN } from "./constants.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function toast(msg, type = "info") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === "error" ? 7000 : 4000);
}

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
function rand(n) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPHA[x % ALPHA.length]).join("");
}
export const genPassword = () => rand(8);
export const genVoterCode = () => "MGA-" + rand(5);
export const normCode = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
export const codeToEmail = (c) => normCode(c) + "@" + EMAIL_DOMAIN;

export function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// ---- CSV ----
export function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t" || c === ";") { row.push(cur.trim()); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur.trim()); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

// Accepts "name, studentId, form" with or without a header row.
export function parseStudentList(text) {
  let rows = parseCSV(text);
  if (rows.length && /name/i.test(rows[0][0] || "") ) rows = rows.slice(1);
  return rows
    .map((r) => ({ name: (r[0] || "").trim(), studentId: (r[1] || "").trim(), form: (r[2] || "").trim() }))
    .filter((r) => r.name && r.studentId);
}

export function toCSV(rows) {
  const q = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}

export function download(filename, content, mime = "text/csv") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Centre-crop to a square and compress, so the photo can live inside a Firestore document
// (Firebase Storage needs the paid Blaze plan, so photos are stored as small JPEG data URLs).
export async function resizeImage(file, size = 220) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file is not a readable image."));
      i.src = url;
    });
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.78);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
    return d ? d.toLocaleString() : "";
  } catch { return ""; }
}

// ---- Short voter codes (E.MBAYANI) and class-based passwords (F3-4827) ----
export function shortCode(name) {
  const clean = (s) => s.replace(/[^A-Za-z]/g, "").toUpperCase();
  const parts = String(name || "").split(/\s+/).filter((p) => clean(p));
  if (!parts.length) return "VOTER";
  if (parts.length === 1) return clean(parts[0]);
  // Marksheets often write SURNAME Firstname: if some words are ALL CAPS and others are not, the CAPS word is the surname.
  const isUp = (s) => s.length > 1 && s === s.toUpperCase();
  const ups = parts.filter(isUp), others = parts.filter((p) => !isUp(p));
  let sur, first;
  if (ups.length && others.length) { sur = ups.join(""); first = others[0]; }
  else { sur = parts[parts.length - 1]; first = parts[0]; }
  return clean(first)[0] + "." + clean(sur);
}

export function formCode(form) {
  const f = String(form || "").trim();
  const m = f.match(/form\s*(\d+)\s*([A-Za-z]*)/i) || f.match(/^f\s*(\d+)\s*([A-Za-z]*)$/i) || f.match(/^(\d+)\s*([A-Za-z]*)$/);
  if (m) return ("F" + m[1] + (m[2] || "")).toUpperCase();
  return f.replace(/\s+/g, "").toUpperCase().slice(0, 8) || "MGA";
}

// Supervised-lab login: the student types her short name and her class. Firebase needs a 6+ character
// password, so the class is padded with a fixed prefix. Anyone can work this out, so only use it where voting is supervised.
export const loginPassword = (form) => "MGA-" + formCode(form);

// Class + 4 random digits, e.g. F3-4827. Firebase needs at least 6 characters, so the class alone cannot be a password.
export function genClassPassword(form) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return formCode(form) + "-" + String(a[0] % 10000).padStart(4, "0");
}

// ---- Excel marksheets (.xlsx/.xls) via SheetJS, which admin.html already loads ----
export function parseExcel(arrayBuffer) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("Excel library did not load (check internet connection).");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const out = [];
  const skip = /^(total|average|mean|position|pos|rank|grade|subject|key|signature)\b/i;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
    if (!rows.length) continue;
    const isNameCell = (c) => /name|student|candidate|pupil|learner|girl/i.test(String(c));
    let h = rows.slice(0, 20).findIndex((r) => r.some(isNameCell));
    let nameCol = -1, idCol = -1, formCol = -1;
    if (h >= 0) {
      const head = rows[h].map((c) => String(c).trim());
      nameCol = head.findIndex((c) => /^(full\s*|student'?s?\s*|candidate'?s?\s*|pupil'?s?\s*)?names?$/i.test(c));
      if (nameCol < 0) nameCol = head.findIndex((c) => /name/i.test(c));
      if (nameCol < 0) nameCol = head.findIndex(isNameCell);
      idCol = head.findIndex((c) => /(adm|reg|\bid\b|student\s*(no|number)|exam\s*(no|number)|index)/i.test(c));
      formCol = head.findIndex((c) => /(form|class|grade|stream)/i.test(c));
    } else {
      // No heading found: use the column that holds the most word-like text (full names).
      const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
      let best = -1, bestScore = 0;
      for (let c = 0; c < width; c++) {
        const score = rows.slice(0, 50).filter((r) => /^[A-Za-z][A-Za-z'.\- ]+\s+[A-Za-z][A-Za-z'.\- ]+$/.test(String(r[c] ?? "").trim())).length;
        if (score > bestScore) { best = c; bestScore = score; }
      }
      nameCol = best;
      h = -1;
    }
    if (nameCol < 0) continue;
    const sheetForm = /form|^f\s*\d|class/i.test(sheetName) ? sheetName : "";
    for (const r of rows.slice(h + 1)) {
      const name = String(r[nameCol] ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
      if (!/[A-Za-z]{2}/.test(name) || skip.test(name)) continue;
      const form = String((formCol >= 0 ? r[formCol] : "") || sheetForm).replace(/,/g, " ").trim();
      let id = String(idCol >= 0 ? r[idCol] ?? "" : "").replace(/,/g, " ").trim();
      if (!id) id = name.toLowerCase();               // no ID column: the name is used to spot duplicates
      out.push({ name, studentId: id, form });
    }
  }
  return out;
}
