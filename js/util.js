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
