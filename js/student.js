import {
  auth, db, isConfigured, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, getDocs, collection, writeBatch,
} from "./firebase.js";
import { POSITIONS } from "./constants.js";
import { $, esc, codeToEmail, initials, toast } from "./util.js";

const S = { user: null, voter: null, settings: null, cands: {}, sel: {}, busy: false };

if (!isConfigured) $("#cfgWarn").hidden = false;

const views = { login: $("#loginView"), portal: $("#portalView"), done: $("#doneView") };
function showView(v) {
  Object.entries(views).forEach(([k, el]) => (el.hidden = k !== v));
  $("#logoutBtn").hidden = v === "login";
  $("#submitBar").hidden = true;
}

/* ------------------------------ login ------------------------------ */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginErr");
  err.hidden = true;
  $("#loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, codeToEmail($("#code").value), $("#pw").value);
  } catch (ex) {
    err.hidden = false;
    err.textContent = ["auth/too-many-requests"].includes(ex.code)
      ? "Too many attempts. Please wait a few minutes and try again."
      : "Login failed. Check your Voter Code and password.";
  } finally {
    $("#loginBtn").disabled = false;
  }
});

const logout = () => signOut(auth);
$("#logoutBtn").onclick = logout;
$("#doneLogout").onclick = logout;

onAuthStateChanged(auth, async (user) => {
  S.user = user;
  if (!user) { S.voter = null; S.sel = {}; showView("login"); return; }
  try {
    await loadAll();
  } catch (ex) {
    console.error(ex);
    await signOut(auth);
    showView("login");
    const err = $("#loginErr");
    err.hidden = false;
    err.textContent = "Could not load the election. Check your connection and try again.";
  }
});

async function loadAll() {
  const [vs, ss] = await Promise.all([getDoc(doc(db, "voters", S.user.uid)), getDoc(doc(db, "settings", "election"))]);
  if (!vs.exists() || vs.data().active === false) {
    await signOut(auth);
    showView("login");
    const err = $("#loginErr");
    err.hidden = false;
    err.textContent = "This account is not registered as an active voter. Please see the election officer.";
    return;
  }
  S.voter = vs.data();
  S.settings = ss.exists() ? ss.data() : { status: "setup", positions: {} };
  if (S.settings.status === "open") {
    S.cands = {};
    const qs = await getDocs(collection(db, "candidates"));
    qs.docs.forEach((d) => (S.cands[d.id] = d.data().items || []));
  }
  renderPortal();
}

/* ------------------------------ portal ------------------------------ */
function cfg(id) {
  if (id !== "dining") return { seats: 1, max: 1 };
  const c = S.settings.positions?.dining || {};
  const seats = parseInt(c.seats, 10) || 2;
  return { seats, max: parseInt(c.maxSelect, 10) || seats };
}
const voted = (id) => !!S.voter?.voted?.[id];

function renderPortal() {
  showView("portal");
  $("#hello").textContent = "Welcome, " + S.voter.name;
  $("#whoMeta").textContent = [S.voter.form, S.voter.studentId && "ID " + S.voter.studentId].filter(Boolean).join(" · ");
  const st = S.settings.status;
  const badge = $("#statusBadge");
  badge.className = "badge " + (st === "open" ? "open" : st === "closed" ? "closed" : "setup");
  badge.textContent = st === "open" ? "Voting open" : st === "closed" ? "Voting closed" : "Not yet open";
  $("#votingArea").hidden = true;
  $("#resultsArea").hidden = true;
  const banner = $("#banner");
  banner.innerHTML = "";

  if (st === "setup") {
    banner.innerHTML = `<div class="alert info">Voting has not opened yet. Please come back when the election officer announces that voting is open.</div>`;
    return;
  }
  if (st === "closed") {
    const n = POSITIONS.filter((p) => voted(p.id)).length;
    banner.innerHTML = `<div class="alert info">Voting is closed. You voted in <b>${n}</b> of ${POSITIONS.length} positions.${S.settings.publishResults ? "" : " Results will be announced by the school."}</div>`;
    if (S.settings.publishResults) showPublishedResults();
    return;
  }
  // open
  $("#votingArea").hidden = false;
  const allDone = POSITIONS.every((p) => voted(p.id));
  if (allDone) { showDone(); return; }
  if (POSITIONS.some((p) => voted(p.id))) {
    banner.innerHTML = `<div class="alert warn">Some of your positions were already submitted (shown locked). Complete the remaining positions below.</div>`;
  }
  renderPositions();
}

function renderPositions() {
  const host = $("#positions");
  host.innerHTML = POSITIONS.map((p, i) => {
    const { max, seats } = cfg(p.id);
    const items = S.cands[p.id] || [];
    const meta = p.id === "dining" ? `${seats} position${seats > 1 ? "s" : ""} available &middot; choose up to ${max}` : "Choose one candidate";
    let body;
    if (voted(p.id)) {
      body = `<div class="lockbox">&#10003; Your vote for this position has been recorded.</div>`;
    } else if (!items.length) {
      body = `<div class="alert warn">No candidates have been registered for this position.</div>`;
    } else {
      const cur = S.sel[p.id] || { ids: [], abstain: false };
      body = `<div class="cands">${items.map((c) => {
        const on = cur.ids.includes(c.id);
        return `<div class="cand ${on ? "sel" : ""}">
          ${c.photo ? `<img class="photo" src="${esc(c.photo)}" alt="${esc(c.name)}">` : `<div class="photo">${esc(initials(c.name))}</div>`}
          <h4>${esc(c.name)}</h4>
          <div class="manifesto" id="m-${esc(c.id)}">${esc(c.manifesto || "No manifesto provided.")}</div>
          <button class="more" data-more="${esc(c.id)}">Read full manifesto</button>
          <button class="btn ${on ? "btn-gold" : "btn-navy"}" data-pos="${p.id}" data-cand="${esc(c.id)}">${on ? "&#10003; Selected (tap to undo)" : "Vote for " + esc(c.name.split(" ")[0])}</button>
        </div>`;
      }).join("")}</div>
      <div class="abstain"><button class="btn btn-out btn-sm" data-abstain="${p.id}">${cur.abstain ? "&#10003; Abstaining (tap to undo)" : "Abstain for this position"}</button></div>`;
    }
    return `<section class="pos"><div class="pos-head"><h2>${i + 1}. ${p.title}</h2><span class="meta">${meta}</span></div>${body}</section>`;
  }).join("");

  host.querySelectorAll("[data-cand]").forEach((b) => (b.onclick = () => toggle(b.dataset.pos, b.dataset.cand)));
  host.querySelectorAll("[data-abstain]").forEach((b) => (b.onclick = () => toggleAbstain(b.dataset.abstain)));
  host.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => {
    const m = document.getElementById("m-" + b.dataset.more);
    const open = m.classList.toggle("open");
    b.textContent = open ? "Show less" : "Read full manifesto";
  }));
  updateProgress();
}

function toggle(pos, id) {
  const { max } = cfg(pos);
  const cur = (S.sel[pos] = S.sel[pos] || { ids: [], abstain: false });
  cur.abstain = false;
  if (cur.ids.includes(id)) cur.ids = cur.ids.filter((x) => x !== id);
  else if (max === 1) cur.ids = [id];
  else if (cur.ids.length < max) cur.ids.push(id);
  else toast(`You can choose at most ${max} candidates for this position.`, "error");
  keepScroll(renderPositions);
}
function toggleAbstain(pos) {
  const cur = (S.sel[pos] = S.sel[pos] || { ids: [], abstain: false });
  cur.abstain = !cur.abstain;
  if (cur.abstain) cur.ids = [];
  keepScroll(renderPositions);
}
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

const chosen = (id) => { const s = S.sel[id]; return !!s && (s.abstain || s.ids.length > 0); };

function updateProgress() {
  const total = POSITIONS.length;
  const done = POSITIONS.filter((p) => voted(p.id)).length;
  const pending = POSITIONS.filter((p) => !voted(p.id) && chosen(p.id)).length;
  const left = POSITIONS.filter((p) => !voted(p.id) && !chosen(p.id));
  $("#progText").textContent = `${done + pending} of ${total} positions completed`;
  $("#pDone").style.width = (done / total) * 100 + "%";
  $("#pSel").style.width = (pending / total) * 100 + "%";
  $("#outstanding").textContent = left.length ? "Still to choose: " + left.map((p) => p.title).join(", ") : "All positions chosen — press Review & Submit.";
  $("#submitBar").hidden = false;
  $("#barText").textContent = left.length ? `${left.length} position${left.length > 1 ? "s" : ""} outstanding` : "Ready to submit";
  $("#reviewBtn").disabled = left.length > 0;
}

/* ------------------------------ review & submit ------------------------------ */
$("#reviewBtn").onclick = () => {
  const rows = POSITIONS.filter((p) => !voted(p.id)).map((p) => {
    const s = S.sel[p.id];
    const names = s.abstain ? "<i>Abstain</i>" : s.ids.map((id) => esc(S.cands[p.id].find((c) => c.id === id)?.name || "?")).join(", ");
    return `<div class="review-row"><b>${p.title}</b><span>${names}</span></div>`;
  });
  $("#reviewList").innerHTML = rows.join("");
  $("#sure").checked = false;
  $("#submitBtn").disabled = true;
  $("#submitErr").hidden = true;
  $("#modal").hidden = false;
};
$("#sure").onchange = () => ($("#submitBtn").disabled = !$("#sure").checked || S.busy);
$("#backBtn").onclick = () => ($("#modal").hidden = true);

$("#submitBtn").onclick = async () => {
  if (S.busy) return; // guards against double taps; the real duplicate protection is in firestore.rules
  S.busy = true;
  $("#submitBtn").disabled = true;
  $("#submitBtn").textContent = "Submitting…";
  const err = $("#submitErr");
  err.hidden = true;
  try {
    const votes = {};
    POSITIONS.filter((p) => !voted(p.id)).forEach((p) => {
      const s = S.sel[p.id];
      votes[p.id] = s.abstain ? [] : [...s.ids];
    });
    const batch = writeBatch(db);
    // The ballot carries NO voter identity. The voter's own record only gets a "has voted" flag.
    batch.set(doc(collection(db, "ballots")), { votes });
    const flags = {};
    Object.keys(votes).forEach((id) => (flags["voted." + id] = true));
    batch.update(doc(db, "voters", S.user.uid), flags);
    await batch.commit();
    S.sel = {};
    $("#modal").hidden = true;
    await loadAll();
    toast("Your votes were recorded.", "ok");
  } catch (ex) {
    console.error(ex);
    err.hidden = false;
    err.textContent = ex.code === "permission-denied"
      ? "Your ballot was refused. Voting may have closed, or some positions were already voted. Reload the page to see your current status."
      : "Could not submit. Check your connection and try again. Nothing was recorded.";
  } finally {
    S.busy = false;
    $("#submitBtn").textContent = "Submit my votes";
    $("#submitBtn").disabled = !$("#sure").checked;
  }
};

function showDone() {
  showView("done");
  $("#receipt").textContent = (S.user.uid.slice(0, 4) + "-" + Date.now().toString(36)).toUpperCase();
}

/* ------------------------------ published results (only after close) ------------------------------ */
async function showPublishedResults() {
  const host = $("#resultsArea");
  host.hidden = false;
  host.innerHTML = `<div class="card">Loading results…</div>`;
  try {
    const snap = await getDoc(doc(db, "results", "final"));
    if (!snap.exists()) { host.innerHTML = `<div class="alert info">Results have not been published yet.</div>`; return; }
    const r = snap.data();
    host.innerHTML = `<h2 style="font-family:Georgia,serif;color:var(--navy)">Official results</h2>` + r.positions.map((p) => `
      <div class="card res-card"><h3>${esc(p.title)}</h3>
      ${p.status === "tie" ? `<div class="alert warn">Tie &mdash; the school will announce how it is resolved.</div>` : ""}
      <div class="chart">${p.candidates.map((c) => `<div class="crow ${p.winners.some((w) => w.id === c.id) ? "win" : ""}"><span>${esc(c.name)}</span><div class="track"><div class="fill" style="width:${c.pct}%"></div></div><span class="v">${c.pct}%</span></div>`).join("")}</div>
      <div class="hint">Winner${p.winners.length > 1 ? "s" : ""}: ${p.winners.length ? p.winners.map((w) => esc(w.name)).join(", ") : "—"}</div></div>`).join("");
  } catch (ex) {
    host.innerHTML = `<div class="alert info">Results are not available.</div>`;
  }
}
