import { db, doc, getDoc, isConfigured } from "./firebase.js";

const badge = document.getElementById("statusBadge");
const text = document.getElementById("statusText");

function show(cls, label, msg) {
  badge.className = "badge " + cls;
  badge.textContent = label;
  text.textContent = msg || "";
}

(async () => {
  if (!isConfigured) {
    document.getElementById("cfgWarn").hidden = false;
    show("muted", "Not connected", "");
    return;
  }
  try {
    const snap = await getDoc(doc(db, "settings", "election"));
    if (!snap.exists()) return show("setup", "Not yet set up", "The election has not been prepared yet.");
    const s = snap.data();
    if (s.status === "open") show("open", "Voting is OPEN", "Log in with your Voter Code to cast your votes.");
    else if (s.status === "closed") show("closed", "Voting is CLOSED", s.publishResults ? "Voting has ended. Results are available after login." : "Voting has ended. Results will be announced by the school.");
    else show("setup", "Voting not yet open", "The election is being prepared. Please check back soon.");
  } catch (e) {
    console.error(e);
    show("muted", "Status unavailable", "Could not read the election status. Check your internet connection.");
  }
})();
