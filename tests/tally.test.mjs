import assert from "node:assert/strict";
import { computeResults, decideWinners, fingerprint } from "../js/tally.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

const C = (pos, ...names) => names.map((nm, i) => ({ id: `${pos}_${i + 1}`, name: nm }));
const cands = {
  head: C("head", "Alice", "Beth", "Cara"),
  vice: C("vice", "Dina", "Eve"),
  dining: C("dining", "F1", "F2", "F3", "F4"),
};
const settings = { positions: { dining: { seats: 2, maxSelect: 2 } } };
const mkVoters = (k, votedPos = ["head"]) => Array.from({ length: k }, () => ({ active: true, voted: Object.fromEntries(votedPos.map((p) => [p, true])) }));
const pos = (r, id) => r.positions.find((p) => p.id === id);

t("counts votes, percentages and the winner from real ballots", () => {
  const ballots = [
    ...Array(5).fill({ votes: { head: ["head_1"] } }),
    ...Array(3).fill({ votes: { head: ["head_2"] } }),
    { votes: { head: ["head_3"] } },
    { votes: { head: [] } },
  ];
  const r = computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(10) });
  const h = pos(r, "head");
  assert.deepEqual(h.candidates.map((c) => [c.name, c.votes]), [["Alice", 5], ["Beth", 3], ["Cara", 1]]);
  assert.equal(h.validVotes, 9);
  assert.equal(h.abstentions, 1);
  assert.equal(h.candidates[0].pct, 55.56);
  assert.equal(h.status, "decided");
  assert.equal(h.winners[0].name, "Alice");
  assert.equal(h.integrityWarning, false);
  assert.equal(r.totals.turnoutPct, 100);
});

t("detects a tie for first place and names no winner", () => {
  const ballots = [{ votes: { head: ["head_1"] } }, { votes: { head: ["head_2"] } }, { votes: { head: ["head_3"] } }];
  const h = pos(computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(3) }), "head");
  assert.equal(h.status, "tie");
  assert.equal(h.winners.length, 0);
  assert.equal(h.tied.length, 3);
});

t("multi-seat position: clear top two", () => {
  const v = (...ids) => ({ votes: { dining: ids } });
  const ballots = [v("dining_1", "dining_2"), v("dining_1", "dining_3"), v("dining_1", "dining_2"), v("dining_4")];
  const d = pos(computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(4, ["dining"]) }), "dining");
  assert.equal(d.status, "decided");
  assert.deepEqual(d.winners.map((w) => w.name), ["F1", "F2"]);
  assert.equal(d.validVotes, 7);
});

t("multi-seat position: tie at the cut-off is flagged", () => {
  const v = (...ids) => ({ votes: { dining: ids } });
  const ballots = [v("dining_1", "dining_2"), v("dining_1", "dining_3"), v("dining_1")];
  const d = pos(computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(3, ["dining"]) }), "dining");
  assert.equal(d.status, "tie");
  assert.deepEqual(d.winners.map((w) => w.name), ["F1"]);
  assert.deepEqual(d.tied.map((w) => w.name).sort(), ["F2", "F3"]);
  assert.equal(d.slots, 1);
});

t("fewer voted-for candidates than seats: all of them win, zero-vote candidates do not", () => {
  const ballots = [{ votes: { dining: ["dining_1"] } }];
  const d = pos(computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(1, ["dining"]) }), "dining");
  assert.deepEqual(d.winners.map((w) => w.name), ["F1"]);
  assert.equal(d.status, "decided");
});

t("invalid ballots are excluded: duplicates, unknown ids, over-selection, wrong position, bad type", () => {
  const ballots = [
    { votes: { dining: ["dining_1", "dining_1"] } },
    { votes: { dining: ["dining_1", "dining_2", "dining_3"] } },
    { votes: { dining: ["nope"] } },
    { votes: { dining: ["head_1"] } },
    { votes: { dining: "dining_1" } },
    { votes: { dining: ["dining_4"] } },
  ];
  const d = pos(computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(6, ["dining"]) }), "dining");
  assert.equal(d.invalid, 5);
  assert.equal(d.validVotes, 1);
  assert.equal(d.candidates.find((c) => c.id === "dining_4").votes, 1);
});

t("single-seat positions reject more than one choice", () => {
  const ballots = [{ votes: { head: ["head_1", "head_2"] } }];
  const h = pos(computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(1) }), "head");
  assert.equal(h.invalid, 1);
  assert.equal(h.validVotes, 0);
  assert.equal(h.status, "no-votes");
});

t("flags more ballots than voters marked as voted (stuffing / double-batch detector)", () => {
  const ballots = Array(4).fill({ votes: { head: ["head_1"] } });
  const r = computeResults({ settings, candidateSets: cands, ballots, voters: mkVoters(3) });
  assert.equal(pos(r, "head").integrityWarning, true);
  assert.ok(r.totals.issues.length >= 2);
});

t("turnout ignores inactive (reissued/deactivated) voter records", () => {
  const voters = [
    { active: true, voted: { head: true } },
    { active: false, voted: { head: true } },
    { active: true, voted: {} },
    { active: true, voted: {} },
  ];
  const r = computeResults({ settings, candidateSets: cands, ballots: [{ votes: { head: ["head_1"] } }], voters });
  assert.equal(r.totals.eligible, 3);
  assert.equal(r.totals.votedAny, 1);
  assert.equal(r.totals.turnoutPct, 33.33);
  assert.equal(pos(r, "head").integrityWarning, false);
});

t("no ballots at all gives zero everywhere (no demo numbers)", () => {
  const r = computeResults({ settings, candidateSets: cands, ballots: [], voters: mkVoters(0, []) });
  assert.equal(r.totals.ballots, 0);
  assert.equal(r.totals.turnoutPct, 0);
  r.positions.forEach((p) => { assert.equal(p.validVotes, 0); assert.equal(p.winners.length, 0); });
});

t("decideWinners edge: single candidate with votes", () => {
  assert.equal(decideWinners([{ id: "a", votes: 2 }], 1).status, "decided");
});

t("fingerprint changes when any count changes", () => {
  const a = computeResults({ settings, candidateSets: cands, ballots: [{ votes: { head: ["head_1"] } }], voters: mkVoters(1) });
  const b = computeResults({ settings, candidateSets: cands, ballots: [{ votes: { head: ["head_2"] } }], voters: mkVoters(1) });
  assert.notEqual(fingerprint(a), fingerprint(b));
});

console.log(`\n${n} tests passed`);
