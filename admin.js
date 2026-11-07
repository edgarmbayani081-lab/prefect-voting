import {
  auth, db, firebaseConfig, isConfigured, initializeApp, getAuth,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, writeBatch,
  serverTimestamp, query, orderBy, limit,
} from "./firebase.js";
import { POSITIONS } from "./constants.js";
import { computeResults, fingerprint, positionConfig } from "./tally.js";
import { exportExcel, exportPDF } from "./reports.js";
import {
  $, $$, esc, toast, sleep, shortCode, loginPassword, parseExcel, normCode, codeToEmail, initials,
  parseStudentList, toCSV, download, resizeImage, fmtDate,
} from "./util.js";

if (!isConfigured) $("#cfgWarn").hidden = false;

const S = {
  user: null, settings: null, voters: [], cands: {}, ballots: null, final: null,
  creds: [], tab: "overview", loaded: false, candPos: POSITIONS[0].id, editing: null, photo: null, filter: "",
};
const settingsRef = doc(db, "settings", "election");
const status = () => S.settings?.status || "none";
const posTitle = (id) => POSITIONS.find((p) => p.id === id)?.title || id;

/* ============================== auth ============================== */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginErr");
  err.hidden = true;
  $("#loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#pw").value);
  } catch (ex) {
    err.hidden = false;
    err.textContent = "Login failed. Check the email and password.";
  } finally { $("#loginBtn").disabled = false; }
});
$("#logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  S.user = user;
  if (!user) { $("#loginView").hidden = false; $("#dash").hidden = true; $("#logoutBtn").hidden = true; $("#adminEmail").textContent = ""; return; }
  try {
    const a = await getDoc(doc(db, "admins", user.uid));
    if (!a.exists()) throw new Error("not-admin");
    $("#loginView").hidden = true; $("#dash").hidden = false; $("#logoutBtn").hidden = false;
    $("#adminEmail").textContent = user.email;
    await loadAll();
    showTab(S.tab);
  } catch (ex) {
    await signOut(auth);
    const err = $("#loginErr");
    err.hidden = false;
    err.textContent = ex.message === "not-admin" ? "This account is not an authorised administrator." : "Could not load the dashboard: " + (ex.code || ex.message);
  }
});

/* ============================== data ============================== */
async function loadAll() {
  const s = await getDoc(settingsRef);
  S.settings = s.exists() ? s.data() : null;
  const [vs, cs, fs] = await Promise.all([
    getDocs(collection(db, "voters")), getDocs(collection(db, "candidates")), getDoc(doc(db, "results", "final")),
  ]);
  S.voters = vs.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  S.cands = {};
  POSITIONS.forEach((p) => (S.cands[p.id] = []));
  cs.docs.forEach((d) => (S.cands[d.id] = d.data().items || []));
  S.final = fs.exists() ? fs.data() : null;
  S.loaded = true;
}
async function loadBallots() {
  const qs = await getDocs(collection(db, "ballots"));
  S.ballots = qs.docs.map((d) => d.data());
}
async function audit(action, details = {}) {
  try { await addDoc(collection(db, "audit"), { action, details, by: S.user.email, at: serverTimestamp() }); } catch (e) { console.warn("audit failed", e); }
}
const live = () => computeResults({ settings: S.settings, candidateSets: S.cands, ballots: S.ballots || [], voters: S.voters });
const activeVoters = () => S.voters.filter((v) => v.active !== false);

/* ============================== modal helpers ============================== */
function openModal(html) { $("#modalBox").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; }
function confirmDialog(title, bodyHtml, { typed = null, okLabel = "Confirm", bad = false } = {}) {
  return new Promise((resolve) => {
    openModal(`<h3>${esc(title)}</h3><div>${bodyHtml}</div>
      ${typed ? `<label>Type <b>${esc(typed)}</b> to continue</label><input type="text" id="cfTyped" autocomplete="off">` : ""}
      <div class="row" style="margin-top:16px"><button class="btn btn-out" id="cfNo">Cancel</button><span class="sp"></span>
      <button class="btn ${bad ? "btn-bad" : "btn-gold"}" id="cfYes" ${typed ? "disabled" : ""}>${esc(okLabel)}</button></div>`);
    if (typed) $("#cfTyped").oninput = (e) => ($("#cfYes").disabled = e.target.value.trim() !== typed);
    $("#cfNo").onclick = () => { closeModal(); resolve(false); };
    $("#cfYes").onclick = () => { closeModal(); resolve(true); };
  });
}

/* ============================== tabs ============================== */
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) showTab(b.dataset.tab);
});
function showTab(t) {
  S.tab = t;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  ["overview", "voters", "candidates", "settings", "results", "audit"].forEach((n) => ($("#tab-" + n).hidden = n !== t));
  ({ overview: renderOverview, voters: renderVoters, candidates: renderCandidates, settings: renderSettings, results: renderResults, audit: renderAudit })[t]();
}
const badge = () => {
  const st = status();
  return `<span class="badge ${st === "open" ? "open" : st === "closed" ? "closed" : "setup"}">${st === "none" ? "Not initialised" : st === "setup" ? "Setup (not open)" : st}</span>`;
};
const refreshBtn = `<button class="btn btn-out btn-sm" data-act="reload">&#8635; Reload data</button>`;
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-act=reload]")) { await loadAll(); S.ballots = null; showTab(S.tab); toast("Data reloaded", "ok"); }
});

/* ============================== overview ============================== */
function renderOverview() {
  const host = $("#tab-overview");
  if (!S.settings) {
    host.innerHTML = `<div class="card"><h3>Welcome, administrator</h3><p>The election has not been initialised yet.</p><button class="btn btn-gold" id="initBtn">Initialise election</button></div>`;
    $("#initBtn").onclick = async () => {
      try {
        await setDoc(settingsRef, { status: "setup", title: "Prefect Election", publishResults: false, positions: { dining: { seats: 3, maxSelect: 3 } }, createdAt: serverTimestamp() });
        await audit("initialise");
        await loadAll(); showTab("overview");
      } catch (ex) { toast("Could not initialise: " + (ex.code || ex.message), "error"); }
    };
    return;
  }
  const av = activeVoters();
  const votedAny = av.filter((v) => v.voted && Object.keys(v.voted).length).length;
  const turnout = av.length ? Math.round((votedAny / av.length) * 1000) / 10 : 0;
  const missing = POSITIONS.filter((p) => !(S.cands[p.id] || []).length);
  host.innerHTML = `
    <div class="row" style="margin-bottom:12px"><h2 style="margin:0;font-family:Georgia,serif;color:var(--navy)">${esc(S.settings.title || "Prefect Election")}</h2>${badge()}<span class="sp"></span>${refreshBtn}</div>
    <div class="grid g4">
      <div class="card stat"><div class="n">${av.length}</div><div class="l">Registered voters</div></div>
      <div class="card stat"><div class="n">${votedAny}</div><div class="l">Have voted</div></div>
      <div class="card stat"><div class="n">${turnout}%</div><div class="l">Turnout</div></div>
      <div class="card stat"><div class="n">${POSITIONS.length - missing.length}/${POSITIONS.length}</div><div class="l">Positions with candidates</div></div>
    </div>
    ${missing.length && status() === "setup" ? `<div class="alert warn">No candidates yet for: ${missing.map((p) => p.title).join(", ")}.</div>` : ""}
    <div class="card" style="margin-top:16px"><h3>Participation by position</h3>
      <p class="hint">Participation only (who has voted for each position). Candidate counts are in the Results tab.</p>
      <div class="chart">${POSITIONS.map((p) => {
        const n = av.filter((v) => v.voted?.[p.id]).length;
        const pct = av.length ? (n / av.length) * 100 : 0;
        return `<div class="crow"><span>${p.title}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="v">${n} / ${av.length}</span></div>`;
      }).join("")}</div></div>`;
}

/* ============================== voters ============================== */
// A second Firebase app instance, so creating student accounts does not sign the administrator out.
let registrarApp = null;
function registrarAuth() {
  if (!registrarApp) registrarApp = initializeApp(firebaseConfig, "registrar");
  return getAuth(registrarApp);
}

const madeCodes = new Set();
async function createVoter(info, voted = {}) {
  // Voter code = short name (E.MBAYANI); a number is added if two students would share the same code.
  const base = shortCode(info.name);
  const taken = new Set([...S.voters.map((v) => normCode(v.voterCode)), ...madeCodes]);
  let code = base, n = 1;
  while (taken.has(normCode(code))) code = base + ++n;
  const pw = loginPassword(info.form);             // lab login: the student types her class (e.g. F3)
  const ra = registrarAuth();
  let cred;
  for (;;) {
    try { cred = await createUserWithEmailAndPassword(ra, codeToEmail(code), pw); break; }
    catch (ex) {
      if (ex.code !== "auth/email-already-in-use" || n >= 300) throw ex;
      // The code belongs to an account whose voter record was deleted: reuse it if the class password matches.
      try { cred = await signInWithEmailAndPassword(ra, codeToEmail(code), pw); break; }
      catch { code = base + ++n; }
    }
  }
  madeCodes.add(normCode(code));
  const uid = cred.user.uid;
  await signOut(ra);
  await setDoc(doc(db, "voters", uid), {
    name: info.name, studentId: info.studentId, form: info.form || "", voterCode: code, active: true, voted, createdAt: serverTimestamp(),
  });
  return { uid, name: info.name, studentId: info.studentId, form: info.form || "", code, pw };
}

async function registerMany(list, onProgress) {
  const existing = new Set(activeVoters().map((v) => String(v.studentId).toLowerCase()));
  const made = [], skipped = [], failed = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    onProgress?.(i + 1, list.length);
    if (existing.has(s.studentId.toLowerCase())) { skipped.push(s); continue; }
    try {
      made.push(await createVoter(s));
      existing.add(s.studentId.toLowerCase());
    } catch (ex) { failed.push({ ...s, error: ex.code || ex.message }); if (ex.code === "auth/too-many-requests") break; }
    await sleep(120);
  }
  return { made, skipped, failed };
}

function renderVoters() {
  const host = $("#tab-voters");
  const canAdd = ["setup", "open"].includes(status());
  const f = S.filter.toLowerCase();
  const rows = S.voters.filter((v) => !f || [v.name, v.studentId, v.form, v.voterCode].some((x) => String(x || "").toLowerCase().includes(f)));
  host.innerHTML = `
    ${!canAdd ? `<div class="alert warn">Voters can only be registered while the election is in Setup or Open state.</div>` : ""}
    <div class="grid g2">
      <div class="card"><h3>Register one student</h3>
        <label>Full name</label><input type="text" id="vName">
        <label>Student ID / admission number</label><input type="text" id="vId">
        <label>Form / class (optional)</label><input type="text" id="vForm">
        <button class="btn btn-navy" id="vAdd" style="margin-top:14px" ${canAdd ? "" : "disabled"}>Register &amp; create login</button>
      </div>
      <div class="card"><h3>Import from Excel</h3>
        <p class="hint">Choose your Excel marksheet (.xlsx / .xls). The names are taken straight from the sheet: it looks for a column headed <b>Name</b> (and optionally Admission No. and Class / Form). Every sheet in the file is read, so one sheet per class works. Students already registered are skipped.</p>
        <input type="file" id="vFile" accept=".xlsx,.xls,.csv" ${canAdd ? "" : "disabled"}>
        <div id="vProg" class="hint"></div>
      </div>
    </div>
    <div id="credBox"></div>
    <div class="card" style="margin-top:16px">
      <div class="row"><h3 style="margin:0">Registered voters (${S.voters.length})</h3><span class="sp"></span>
        ${status() === "setup" && S.voters.length ? `<button class="btn btn-out btn-sm" id="vDelAll" style="color:var(--bad,#c0392b)">Delete ALL voters</button>` : ""}
        <input type="text" id="vSearch" placeholder="Search name, ID, code…" value="${esc(S.filter)}" style="max-width:260px"></div>
      <div class="tbl-wrap" style="margin-top:10px"><table>
        <thead><tr><th>Name</th><th>Student ID</th><th>Form</th><th>Login name</th><th class="num">Voted</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.slice(0, 300).map((v) => `<tr>
          <td>${esc(v.name)}</td><td>${esc(v.studentId)}</td><td>${esc(v.form)}</td><td class="mono">${esc(v.voterCode)}</td>
          <td class="num">${Object.keys(v.voted || {}).length}/${POSITIONS.length}</td>
          <td>${v.active === false ? '<span class="badge muted">inactive</span>' : '<span class="badge open">active</span>'}</td>
          <td style="white-space:nowrap">${v.active === false ? "" : `<button class="btn btn-out btn-sm" data-reissue="${v.uid}" ${canAdd ? "" : "disabled"}>New credentials</button>
            <button class="btn btn-out btn-sm" data-deact="${v.uid}">Deactivate</button>`}
            ${status() === "setup" ? `<button class="btn btn-out btn-sm" data-del="${v.uid}" style="color:var(--bad,#c0392b)">Delete</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="hint">No voters yet.</td></tr>`}</tbody>
      </table></div>
      ${rows.length > 300 ? `<p class="hint">Showing the first 300 of ${rows.length}. Use search.</p>` : ""}
    </div>`;
  renderCreds();

  $("#vSearch").oninput = (e) => { S.filter = e.target.value; const pos = e.target.selectionStart; renderVoters(); const i = $("#vSearch"); i.focus(); i.setSelectionRange(pos, pos); };
  $("#vAdd").onclick = async () => {
    const info = { name: $("#vName").value.trim(), studentId: $("#vId").value.trim(), form: $("#vForm").value.trim() };
    if (!info.name || !info.studentId) return toast("Name and Student ID are required.", "error");
    $("#vAdd").disabled = true;
    try {
      const r = await registerMany([info]);
      if (r.skipped.length) toast("That Student ID is already registered.", "error");
      else if (r.failed.length) toast("Failed: " + r.failed[0].error, "error");
      else { S.creds = r.made; await audit("register-voter", { count: 1 }); toast("Student registered. Print or save the login now.", "ok"); }
      await loadAll(); renderVoters();
    } finally { $("#vAdd").disabled = false; }
  };
  $("#vFile").onchange = async (e) => {
    const f0 = e.target.files[0];
    if (!f0) return;
    let list;
    try {
      list = /\.xlsx?$/i.test(f0.name) ? parseExcel(await f0.arrayBuffer()) : parseStudentList(await f0.text());
    } catch (ex) { e.target.value = ""; return toast("Could not read the file: " + ex.message, "error"); }
    if (!list.length) { e.target.value = ""; return toast("No students found. Check that the sheet has a column headed Name.", "error"); }
    const sample = list.slice(0, 5).map((s) => esc(s.name) + (s.form ? ` (${esc(s.form)})` : "")).join(", ");
    if (!(await confirmDialog("Import students", `<p>Found <b>${list.length}</b> student(s) in <b>${esc(f0.name)}</b>, for example: ${sample}${list.length > 5 ? "…" : ""}.</p><p>Create their logins now?</p>`, { okLabel: "Import" }))) { e.target.value = ""; return; }
    $("#vFile").disabled = true;
    const r = await registerMany(list, (i, n) => ($("#vProg").textContent = `Creating accounts… ${i} / ${n}`));
    S.creds = r.made;
    await audit("import-voters", { created: r.made.length, skipped: r.skipped.length, failed: r.failed.length });
    await loadAll(); renderVoters();
    toast(`Created ${r.made.length}, skipped ${r.skipped.length}, failed ${r.failed.length}.`, r.failed.length ? "error" : "ok");
    if (r.failed.length) alert("Some rows failed:\n" + r.failed.map((f) => `${f.name} (${f.studentId}): ${f.error}`).join("\n"));
  };
  host.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const v = S.voters.find((x) => x.uid === b.dataset.del);
    if (!(await confirmDialog("Delete voter", `<p>Permanently delete <b>${esc(v.name)}</b> (${esc(v.voterCode)})? This cannot be undone.</p>`, { bad: true, okLabel: "Delete" }))) return;
    try {
      await deleteDoc(doc(db, "voters", v.uid));
      madeCodes.delete(normCode(v.voterCode));
      await audit("delete-voter", { studentId: v.studentId });
      await loadAll(); renderVoters(); toast("Voter deleted.", "ok");
    } catch (ex) { toast("Failed: " + (ex.code || ex.message), "error"); }
  }));
  if ($("#vDelAll")) $("#vDelAll").onclick = async () => {
    if (!(await confirmDialog("Delete ALL voters?", `<p>This permanently removes all <b>${S.voters.length}</b> registered voters so you can import a fresh list. Candidates are not affected.</p>`, { typed: "DELETE", bad: true, okLabel: "Delete all voters" }))) return;
    try {
      for (let i = 0; i < S.voters.length; i += 400) {
        const b = writeBatch(db);
        S.voters.slice(i, i + 400).forEach((v) => b.delete(doc(db, "voters", v.uid)));
        await b.commit();
      }
      madeCodes.clear(); S.creds = [];
      await audit("delete-all-voters", { count: S.voters.length });
      await loadAll(); renderVoters(); toast("All voters deleted.", "ok");
    } catch (ex) { toast("Failed: " + (ex.code || ex.message), "error"); }
  };
  host.querySelectorAll("[data-deact]").forEach((b) => (b.onclick = async () => {
    const v = S.voters.find((x) => x.uid === b.dataset.deact);
    if (!(await confirmDialog("Deactivate voter", `<p>Deactivate <b>${esc(v.name)}</b>? She will no longer be able to log in or vote. Votes already cast remain counted.</p>`, { bad: true, okLabel: "Deactivate" }))) return;
    try { await updateDoc(doc(db, "voters", v.uid), { active: false }); await audit("deactivate-voter", { studentId: v.studentId }); await loadAll(); renderVoters(); }
    catch (ex) { toast("Failed: " + (ex.code || ex.message), "error"); }
  }));
  host.querySelectorAll("[data-reissue]").forEach((b) => (b.onclick = async () => {
    const v = S.voters.find((x) => x.uid === b.dataset.reissue);
    if (!(await confirmDialog("Issue new credentials", `<p>Create a new login name for <b>${esc(v.name)}</b>? The old login stops working. Positions she has already voted for stay locked.</p>`, { okLabel: "Issue new login" }))) return;
    try {
      const c = await createVoter({ name: v.name, studentId: v.studentId, form: v.form }, { ...(v.voted || {}) });
      await updateDoc(doc(db, "voters", v.uid), { active: false });
      await audit("reissue-credentials", { studentId: v.studentId });
      S.creds = [c]; await loadAll(); renderVoters();
    } catch (ex) { toast("Failed: " + (ex.code || ex.message), "error"); }
  }));
}

function renderCreds() {
  const box = $("#credBox");
  if (!box) return;
  if (!S.creds.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="card" style="margin-top:16px;border-top:5px solid var(--gold)"><h3>New voter credentials (${S.creds.length})</h3>
    <div class="alert warn"><b>Voting is in the lab:</b> each student logs in with her name (shown below) and her class. Print this list for the teacher supervising.</div>
    <div class="row"><button class="btn btn-navy btn-sm" id="credCsv">Download CSV</button><button class="btn btn-gold btn-sm" id="credPrint">Print login list</button><button class="btn btn-out btn-sm" id="credClear">I have saved them – hide</button></div>
    <div class="tbl-wrap" style="margin-top:10px;max-height:260px;overflow:auto"><table><thead><tr><th>Name</th><th>ID</th><th>Form</th><th>Name to type</th><th>Class to type</th></tr></thead>
    <tbody>${S.creds.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.studentId)}</td><td>${esc(c.form)}</td><td class="mono">${esc(c.code)}</td><td class="mono">${esc(c.form || "MGA")}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#credCsv").onclick = () => download("student-logins.csv", toCSV([["Name", "StudentID", "Form", "LoginName"], ...S.creds.map((c) => [c.name, c.studentId, c.form, c.code])]));
  $("#credClear").onclick = () => { S.creds = []; renderCreds(); };
  $("#credPrint").onclick = () => {
    const url = location.href.replace(/admin\.html.*$/, "student.html");
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups to print the login list.", "error");
    w.document.write(`<html><head><title>Student logins</title><style>
      body{font-family:Arial,sans-serif;margin:12px}.s{display:inline-block;width:46%;margin:1.5%;padding:12px;border:2px solid #0b1f4b;border-radius:10px;vertical-align:top;page-break-inside:avoid}
      h4{margin:0;color:#0b1f4b}.g{color:#9a7b12;font-size:11px;letter-spacing:.1em}.c{font:bold 18px Consolas,monospace;letter-spacing:.06em}small{color:#555}</style></head><body>` +
      S.creds.map((c) => `<div class="s"><h4>MARANATHA GIRLS ACADEMY</h4><div class="g">PREFECT ELECTION – LOGIN</div><p><b>${esc(c.name)}</b><br><small>${esc(c.form)} · ID ${esc(c.studentId)}</small></p>
      <p>Name to type<br><span class="c">${esc(c.code)}</span></p><p>Class to type<br><span class="c">${esc(c.form)}</span></p><small>Vote at: ${esc(url)}<br>Vote only under supervision. Votes are final.</small></div>`).join("") +
      `</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  };
}

/* ============================== candidates ============================== */
function renderCandidates() {
  const host = $("#tab-candidates");
  const editable = status() === "setup";
  const items = S.cands[S.candPos] || [];
  const ed = S.editing ? items.find((c) => c.id === S.editing) : null;
  host.innerHTML = `
    ${!editable ? `<div class="alert warn">Candidates are locked because the election is ${esc(status())}. They can be changed only in Setup state.</div>` : ""}
    <div class="row" style="margin-bottom:12px"><label style="margin:0">Position</label>
      <select id="cPos" style="max-width:300px">${POSITIONS.map((p) => `<option value="${p.id}" ${p.id === S.candPos ? "selected" : ""}>${p.title} (${(S.cands[p.id] || []).length})</option>`).join("")}</select></div>
    <div class="grid g2">
      <div class="card"><h3>${ed ? "Edit candidate" : "Add candidate"} – ${posTitle(S.candPos)}</h3>
        <label>Full name</label><input type="text" id="cName" value="${esc(ed?.name || "")}" maxlength="80">
        <label>Manifesto</label><textarea id="cMan" maxlength="900">${esc(ed?.manifesto || "")}</textarea>
        <label>Photograph (JPG/PNG – auto-resized)</label><input type="file" id="cPhoto" accept="image/*">
        <div class="row" style="margin-top:8px"><img id="cPrev" class="thumb" style="width:72px;height:72px;${S.photo || ed?.photo ? "" : "display:none"}" src="${esc(S.photo || ed?.photo || "")}" alt=""></div>
        <div class="row" style="margin-top:14px"><button class="btn btn-navy" id="cSave" ${editable ? "" : "disabled"}>${ed ? "Save changes" : "Add candidate"}</button>
        ${ed ? `<button class="btn btn-out" id="cCancel">Cancel edit</button>` : ""}</div>
      </div>
      <div class="card"><h3>Candidates for ${posTitle(S.candPos)}</h3>
        ${items.length ? `<div class="tbl-wrap"><table><tbody>${items.map((c) => `<tr>
          <td>${c.photo ? `<img class="thumb" src="${esc(c.photo)}" alt="">` : `<div class="thumb" style="background:var(--navy2);color:#fff;display:grid;place-items:center;font-size:14px">${esc(initials(c.name))}</div>`}</td>
          <td><b>${esc(c.name)}</b><div class="hint">${esc((c.manifesto || "").slice(0, 80))}${(c.manifesto || "").length > 80 ? "…" : ""}</div></td>
          <td style="white-space:nowrap"><button class="btn btn-out btn-sm" data-edit="${esc(c.id)}" ${editable ? "" : "disabled"}>Edit</button>
          <button class="btn btn-out btn-sm" data-del="${esc(c.id)}" ${editable ? "" : "disabled"}>Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">No candidates yet.</p>`}
      </div>
    </div>`;
  $("#cPos").onchange = (e) => { S.candPos = e.target.value; S.editing = null; S.photo = null; renderCandidates(); };
  $("#cPhoto").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { S.photo = await resizeImage(f); const p = $("#cPrev"); p.src = S.photo; p.style.display = ""; }
    catch (ex) { toast(ex.message, "error"); }
  };
  $("#cSave").onclick = async () => {
    const name = $("#cName").value.trim();
    if (!name) return toast("Candidate name is required.", "error");
    const list = [...(S.cands[S.candPos] || [])];
    const rec = { id: ed ? ed.id : S.candPos + "_" + Math.random().toString(36).slice(2, 8), name, manifesto: $("#cMan").value.trim(), photo: S.photo || ed?.photo || "" };
    const idx = list.findIndex((c) => c.id === rec.id);
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    try {
      await setDoc(doc(db, "candidates", S.candPos), { positionId: S.candPos, items: list });
      S.cands[S.candPos] = list; S.editing = null; S.photo = null;
      await audit(ed ? "edit-candidate" : "add-candidate", { position: S.candPos, name });
      toast("Saved.", "ok"); renderCandidates();
    } catch (ex) { toast("Could not save: " + (ex.code || ex.message), "error"); }
  };
  $("#cCancel")?.addEventListener("click", () => { S.editing = null; S.photo = null; renderCandidates(); });
  host.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { S.editing = b.dataset.edit; S.photo = null; renderCandidates(); }));
  host.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const c = items.find((x) => x.id === b.dataset.del);
    if (!(await confirmDialog("Remove candidate", `<p>Remove <b>${esc(c.name)}</b> from ${posTitle(S.candPos)}?</p>`, { bad: true, okLabel: "Remove" }))) return;
    const list = items.filter((x) => x.id !== c.id);
    try {
      if (list.length) await setDoc(doc(db, "candidates", S.candPos), { positionId: S.candPos, items: list });
      else await deleteDoc(doc(db, "candidates", S.candPos));
      S.cands[S.candPos] = list; await audit("remove-candidate", { position: S.candPos, name: c.name }); renderCandidates();
    } catch (ex) { toast("Could not remove: " + (ex.code || ex.message), "error"); }
  }));
}

/* ============================== election settings ============================== */
function renderSettings() {
  const host = $("#tab-settings");
  if (!S.settings) { host.innerHTML = `<div class="alert info">Initialise the election from the Overview tab first.</div>`; return; }
  const st = status();
  const d = positionConfig(S.settings, "dining");
  const locked = st !== "setup";
  host.innerHTML = `
    <div class="row" style="margin-bottom:12px"><h3 style="margin:0;font-family:Georgia,serif;color:var(--navy)">Election status:</h3>${badge()}<span class="sp"></span>${refreshBtn}</div>
    <div class="grid g2">
      <div class="card"><h3>Settings</h3>
        <label>Election title</label><input type="text" id="sTitle" value="${esc(S.settings.title || "")}" ${locked ? "disabled" : ""}>
        <label>Dining Prefects – positions available</label><input type="number" min="1" max="20" id="sSeats" value="${d.seats}" ${locked ? "disabled" : ""}>
        <label>Dining Prefects – maximum choices per voter</label><input type="number" min="1" max="20" id="sMax" value="${d.maxSelect}" ${locked ? "disabled" : ""}>
        <label style="display:flex;gap:10px;align-items:center;font-weight:500"><input type="checkbox" id="sPub" ${S.settings.publishResults ? "checked" : ""} style="width:20px;height:20px"> Let students see the official results after the election closes</label>
        <button class="btn btn-navy" id="sSave" style="margin-top:14px">Save settings</button>
        ${locked ? `<p class="hint">Title and Dining settings are locked once the election has been opened.</p>` : ""}
      </div>
      <div class="card"><h3>Election controls</h3>
        ${st === "setup" ? `<p>Check voters and candidates first. Once opened, candidates and Dining settings are locked.</p><button class="btn btn-gold" id="bOpen">Open the election</button>` : ""}
        ${st === "open" ? `<p>Voting is in progress. Students cannot see results.</p><button class="btn btn-bad" id="bClose">Close the election</button>` : ""}
        ${st === "closed" ? `<p>The election is closed. Results are final.</p><button class="btn btn-out" id="bFinal">Recompute &amp; publish official results</button>
          <hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><p class="hint"><b>Test elections only:</b> wipes every ballot and every “has voted” flag, deletes published results, and returns to Setup.</p><button class="btn btn-bad btn-sm" id="bReset">Reset election data</button>` : ""}
      </div>
    </div>`;
  $("#sSave").onclick = async () => {
    const seats = Math.max(1, parseInt($("#sSeats").value, 10) || 1), max = Math.max(1, parseInt($("#sMax").value, 10) || 1);
    const upd = { publishResults: $("#sPub").checked };
    if (!locked) { upd.title = $("#sTitle").value.trim() || "Prefect Election"; upd.positions = { dining: { seats, maxSelect: max } }; }
    try { await updateDoc(settingsRef, upd); await audit("save-settings", { seats, max, publish: upd.publishResults }); await loadAll(); renderSettings(); toast("Settings saved.", "ok"); }
    catch (ex) { toast("Could not save: " + (ex.code || ex.message), "error"); }
  };
  $("#bOpen")?.addEventListener("click", openElection);
  $("#bClose")?.addEventListener("click", closeElection);
  $("#bFinal")?.addEventListener("click", async () => { try { await finalize(); toast("Official results published.", "ok"); } catch (ex) { toast("Failed: " + (ex.code || ex.message), "error"); } });
  $("#bReset")?.addEventListener("click", resetElection);
}

async function openElection() {
  const av = activeVoters();
  const missing = POSITIONS.filter((p) => !(S.cands[p.id] || []).length);
  const warn = [
    !av.length && "No voters are registered.",
    missing.length && "No candidates for: " + missing.map((p) => p.title).join(", ") + ".",
  ].filter(Boolean);
  if (!av.length) return toast("Register at least one voter first.", "error");
  const body = `<p>${av.length} registered voter(s). After opening, candidates and Dining settings are locked.</p>${warn.length ? `<div class="alert warn">${warn.join("<br>")}</div>` : ""}`;
  if (!(await confirmDialog("Open the election?", body, { okLabel: "Open voting" }))) return;
  try {
    await updateDoc(settingsRef, { status: "open", openedAt: serverTimestamp() });
    await audit("open-election", { voters: av.length });
    await loadAll(); renderSettings(); toast("Election is OPEN.", "ok");
  } catch (ex) { toast("Could not open: " + (ex.code || ex.message), "error"); }
}

async function closeElection() {
  if (!(await confirmDialog("Close the election?", `<p>Students will no longer be able to vote. This <b>cannot be undone</b>. Votes will be counted and the official results created automatically.</p>`, { typed: "CLOSE", bad: true, okLabel: "Close election" }))) return;
  try {
    await updateDoc(settingsRef, { status: "closed", closedAt: serverTimestamp() });
    await audit("close-election");
    S.settings.status = "closed";
    await finalize();
    await loadAll(); renderSettings();
    toast("Election closed and results finalised.", "ok");
  } catch (ex) { toast("Failed: " + (ex.code || ex.message), "error"); }
}

// Counting runs in the administrator's browser against the real ballots in Firestore (no Cloud Functions on Spark).
async function finalize() {
  await loadAll();
  await loadBallots();
  const r = live();
  await setDoc(doc(db, "results", "final"), {
    computedAt: serverTimestamp(), title: S.settings.title || "", totals: r.totals, fingerprint: fingerprint(r),
    positions: r.positions.map((p) => ({
      id: p.id, title: p.title, seats: p.seats, status: p.status, validVotes: p.validVotes, abstentions: p.abstentions,
      invalid: p.invalid, ballotsCast: p.ballotsCast, votersVoted: p.votersVoted, slots: p.slots,
      candidates: p.candidates, winners: p.winners, tied: p.tied,
    })),
  });
  await audit("finalise-results", { ballots: r.totals.ballots, voted: r.totals.votedAny, issues: r.totals.issues.length });
  await loadAll();
}

async function resetElection() {
  if (!(await confirmDialog("Reset ALL election data?", `<p>This permanently deletes <b>every ballot</b>, clears every voter's “has voted” status and removes the published results. Use only after a <b>test election</b>.</p>`, { typed: "RESET", bad: true, okLabel: "Delete data & reset" }))) return;
  try {
    await updateDoc(settingsRef, { status: "setup", openedAt: null, closedAt: null });
    await audit("reset-election", { voters: S.voters.length });
    const bs = await getDocs(collection(db, "ballots"));
    for (let i = 0; i < bs.docs.length; i += 400) {
      const b = writeBatch(db);
      bs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    const withVotes = S.voters.filter((v) => v.voted && Object.keys(v.voted).length);
    for (let i = 0; i < withVotes.length; i += 400) {
      const b = writeBatch(db);
      withVotes.slice(i, i + 400).forEach((v) => b.update(doc(db, "voters", v.uid), { voted: {} }));
      await b.commit();
    }
    try { await deleteDoc(doc(db, "results", "final")); } catch { /* may not exist */ }
    S.ballots = null;
    await loadAll(); renderSettings(); toast("Election reset to Setup.", "ok");
  } catch (ex) { toast("Reset failed: " + (ex.code || ex.message), "error"); }
}

/* ============================== results ============================== */
async function renderResults() {
  const host = $("#tab-results");
  if (!S.settings) { host.innerHTML = `<div class="alert info">Initialise the election first.</div>`; return; }
  if (S.ballots === null) {
    host.innerHTML = `<div class="card">Counting recorded ballots…</div>`;
    try { await loadBallots(); } catch (ex) { host.innerHTML = `<div class="alert bad">Could not read ballots: ${esc(ex.code || ex.message)}</div>`; return; }
  }
  const r = live();
  const final = status() === "closed";
  const match = S.final ? S.final.fingerprint === fingerprint(r) : null;
  const t = r.totals;
  host.innerHTML = `
    <div class="alert ${final ? "ok" : "warn"}">${final ? "<b>FINAL RESULTS</b> – voting is closed." : `<b>PROVISIONAL RESULTS</b> – voting is ${status() === "open" ? "still open" : "not open"}. Visible to administrators only.`}</div>
    ${t.issues.length ? `<div class="alert bad"><b>Integrity notes</b><br>${t.issues.map(esc).join("<br>")}</div>` : ""}
    ${S.final && match === false ? `<div class="alert bad">The published results snapshot differs from a fresh recount of the ballots. Use “Recompute &amp; publish” in the Election tab after investigating.</div>` : ""}
    ${S.final && match ? `<div class="alert ok">Published snapshot matches a fresh recount of all ballots.</div>` : ""}
    <div class="row" style="margin-bottom:12px"><button class="btn btn-out btn-sm" id="rReload">&#8635; Recount now</button><span class="sp"></span>
      <button class="btn btn-navy btn-sm" id="rPrint">Print results</button><button class="btn btn-navy btn-sm" id="rPdf">Download PDF</button><button class="btn btn-gold btn-sm" id="rXls">Download Excel</button></div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card stat"><div class="n">${t.eligible}</div><div class="l">Registered voters</div></div>
      <div class="card stat"><div class="n">${t.votedAny}</div><div class="l">Voters who voted</div></div>
      <div class="card stat"><div class="n">${t.turnoutPct}%</div><div class="l">Voter turnout</div></div>
      <div class="card stat"><div class="n">${t.ballots}</div><div class="l">Ballots counted</div></div>
    </div>
    ${r.positions.map((p) => {
      const max = Math.max(1, ...p.candidates.map((c) => c.votes));
      return `<div class="card res-card"><div class="row"><h3 style="margin:0">${p.title}${p.seats > 1 ? ` <span class="hint">(${p.seats} seats)</span>` : ""}</h3><span class="sp"></span>
        ${p.status === "tie" ? `<span class="chip tie">TIE</span>` : p.status === "no-votes" ? `<span class="chip" style="background:#e8ecf6">No votes</span>` : ""}</div>
        <div class="res-meta"><span>Valid votes: <b>${p.validVotes}</b></span><span>Abstentions: <b>${p.abstentions}</b></span><span>Invalid: <b>${p.invalid}</b></span><span>Voters who voted here: <b>${p.votersVoted}</b></span></div>
        <div class="chart">${p.candidates.map((c) => {
          const win = p.winners.some((w) => w.id === c.id), tie = p.tied.some((x) => x.id === c.id);
          const bike = final && !win && !tie && p.status !== "no-votes" ? "\u{1F6B2} " : "";
          return `<div class="crow ${win ? "win" : ""}"><span>${bike}${esc(c.name)}${win ? `<span class="chip win">${final ? "WINNER" : "LEADING"}</span>` : ""}${tie ? `<span class="chip tie">TIED</span>` : ""}</span>
            <div class="track"><div class="fill" style="width:${(c.votes / max) * 100}%"></div></div><span class="v"><b>${c.votes}</b> · ${c.pct}%</span></div>`;
        }).join("") || `<p class="hint">No candidates.</p>`}</div>
        ${p.status === "tie" ? `<div class="alert warn">Tie for ${p.slots} seat${p.slots > 1 ? "s" : ""} between: ${p.tied.map((c) => esc(c.name)).join(", ")}. ${p.winners.length ? "Already elected: " + p.winners.map((c) => esc(c.name)).join(", ") + "." : ""} The school must decide how to resolve it (for example, a run-off).</div>` : ""}
      </div>`;
    }).join("")}`;
  $("#rReload").onclick = async () => { S.ballots = null; renderResults(); };
  const report = () => ({ title: S.settings.title || "Prefect Election", statusLabel: final ? "FINAL" : "PROVISIONAL", generatedAt: new Date(), results: r });
  $("#rPrint").onclick = () => printResults(report());
  $("#rPdf").onclick = () => { try { exportPDF(report()); } catch (ex) { toast(ex.message, "error"); } };
  $("#rXls").onclick = () => { try { exportExcel(report()); } catch (ex) { toast(ex.message, "error"); } };
}

/* ============================== audit ============================== */
async function renderAudit() {
  const host = $("#tab-audit");
  host.innerHTML = `<div class="card">Loading…</div>`;
  try {
    const qs = await getDocs(query(collection(db, "audit"), orderBy("at", "desc"), limit(150)));
    host.innerHTML = `<div class="card"><h3>Audit log</h3><p class="hint">Append-only record of administrator actions (it cannot be edited or deleted through the app or the rules).</p>
      <div class="tbl-wrap"><table><thead><tr><th>When</th><th>Administrator</th><th>Action</th><th>Details</th></tr></thead><tbody>
      ${qs.docs.map((d) => { const a = d.data(); return `<tr><td>${esc(fmtDate(a.at))}</td><td>${esc(a.by)}</td><td><b>${esc(a.action)}</b></td><td class="hint">${esc(JSON.stringify(a.details || {}))}</td></tr>`; }).join("") || `<tr><td colspan="4" class="hint">Nothing yet.</td></tr>`}
      </tbody></table></div></div>`;
  } catch (ex) { host.innerHTML = `<div class="alert bad">Could not load audit log: ${esc(ex.code || ex.message)}</div>`; }
}

/* ============================== print results ============================== */
function printResults(rep) {
  const r = rep.results;
  const logo = new URL("logo.png", location.href).href;
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print the results.", "error");
  const outcome = (p) => p.status === "no-votes" ? "No valid votes"
    : p.status === "tie" ? `TIE for ${p.slots} seat(s): ${p.tied.map((t) => esc(t.name)).join(" / ")}`
    : "Winner" + (p.winners.length > 1 ? "s" : "") + ": " + p.winners.map((x) => esc(x.name)).join(", ");
  w.document.write(`<html><head><title>Prefect election results</title><style>
    body{font-family:Arial,sans-serif;margin:24px;color:#14213d}
    .hd{text-align:center;border-bottom:4px solid #c9a227;padding-bottom:10px;margin-bottom:14px}
    .hd img{height:90px}.hd h1{margin:6px 0 0;font:bold 22px Georgia,serif;color:#0b1f4b}.hd p{margin:2px 0}
    .tot{display:flex;gap:10px;margin:12px 0}.tot div{flex:1;border:1px solid #0b1f4b;border-radius:8px;padding:8px;text-align:center}.tot b{display:block;font-size:20px}
    .p{page-break-inside:avoid;margin:14px 0}.p h3{margin:0 0 4px;color:#0b1f4b;font-size:15px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #bbb;padding:4px 8px;text-align:left}th{background:#eef1fa}
    td.n,th.n{text-align:right;width:80px}tr.w td{font-weight:bold;background:#fff7d6}.o{font-size:13px;margin-top:4px}
    .sig{display:flex;gap:30px;margin-top:40px;page-break-inside:avoid}.sig div{flex:1;border-top:1px solid #000;padding-top:4px;font-size:12px}
    </style></head><body>
    <div class="hd"><img src="${logo}" alt=""><h1>MARANATHA GIRLS ACADEMY</h1><p>ONLINE PREFECT ELECTION SYSTEM</p>
    <p><b>${esc(rep.title)}</b> &middot; ${esc(rep.statusLabel)} RESULTS &middot; ${esc(rep.generatedAt.toLocaleString())}</p></div>
    <div class="tot"><div><b>${r.totals.eligible}</b>Registered voters</div><div><b>${r.totals.votedAny}</b>Voted</div><div><b>${r.totals.turnoutPct}%</b>Turnout</div><div><b>${r.totals.ballots}</b>Ballots counted</div></div>
    ${r.positions.map((p) => `<div class="p"><h3>${esc(p.title)}${p.seats > 1 ? ` (${p.seats} seats)` : ""}</h3>
      <table><thead><tr><th>Candidate</th><th class="n">Votes</th><th class="n">%</th></tr></thead><tbody>
      ${p.candidates.map((c) => `<tr class="${p.winners.some((x) => x.id === c.id) ? "w" : ""}"><td>${rep.statusLabel === "FINAL" && p.status !== "no-votes" && !p.winners.some((x) => x.id === c.id) && !p.tied.some((x) => x.id === c.id) ? "\u{1F6B2} " : ""}${esc(c.name)}${p.winners.some((x) => x.id === c.id) ? " &#9733;" : ""}</td><td class="n">${c.votes}</td><td class="n">${c.pct}%</td></tr>`).join("") || `<tr><td colspan="3">No candidates</td></tr>`}
      </tbody></table><div class="o"><b>${outcome(p)}</b> &nbsp; <small>Valid: ${p.validVotes} &middot; Abstentions: ${p.abstentions} &middot; Invalid: ${p.invalid}</small></div></div>`).join("")}
    ${r.totals.issues.length ? `<p style="color:#c0392b"><b>Integrity notes:</b> ${r.totals.issues.map(esc).join(" ")}</p>` : ""}
    <div class="sig"><div>Election officer</div><div>Headteacher</div><div>Date</div></div>
    </body></html>`);
  w.document.close(); w.focus();
  w.onload = () => w.print();
  setTimeout(() => { try { w.print(); } catch { /* already printed */ } }, 1200);
}
