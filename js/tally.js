// Pure counting logic (no Firebase, no DOM) so it can be unit-tested in Node.
// Every number comes from the ballots / voter records passed in. There are no built-in figures.
import { POSITIONS } from "./constants.js";

const toInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function positionConfig(settings, id) {
  if (id !== "dining") return { seats: 1, maxSelect: 1 };
  const c = settings?.positions?.dining || {};
  const seats = toInt(c.seats, 2);
  return { seats, maxSelect: toInt(c.maxSelect, seats) };
}

// list: [{id,name,votes}] sorted descending by votes.
export function decideWinners(list, seats) {
  const withVotes = list.filter((c) => c.votes > 0);
  if (!withVotes.length) return { status: "no-votes", winners: [], tied: [], slots: 0 };
  if (withVotes.length <= seats) return { status: "decided", winners: withVotes, tied: [], slots: 0 };
  const cutoff = withVotes[seats - 1].votes;
  const above = withVotes.filter((c) => c.votes > cutoff);
  const equal = withVotes.filter((c) => c.votes === cutoff);
  const slots = seats - above.length;
  if (equal.length <= slots) return { status: "decided", winners: [...above, ...equal], tied: [], slots: 0 };
  return { status: "tie", winners: above, tied: equal, slots };
}

export function computeResults({ settings, candidateSets, ballots, voters }) {
  const activeVoters = (voters || []).filter((v) => v.active !== false);
  const votedAny = activeVoters.filter((v) => v.voted && Object.keys(v.voted).length > 0).length;
  const issues = [];

  const positions = POSITIONS.map((p) => {
    const { seats, maxSelect } = positionConfig(settings, p.id);
    const cands = (candidateSets?.[p.id] || []).map((c) => ({ id: c.id, name: c.name, votes: 0 }));
    const byId = new Map(cands.map((c) => [c.id, c]));
    let ballotsCast = 0, abstentions = 0, invalid = 0;

    for (const b of ballots || []) {
      const v = b?.votes?.[p.id];
      if (v === undefined) continue;
      ballotsCast++;
      if (!Array.isArray(v)) { invalid++; continue; }
      if (v.length === 0) { abstentions++; continue; }
      const unique = new Set(v);
      const ok = unique.size === v.length && v.length <= maxSelect && v.every((id) => typeof id === "string" && byId.has(id));
      if (!ok) { invalid++; continue; }
      v.forEach((id) => { byId.get(id).votes++; });
    }

    const validVotes = cands.reduce((s, c) => s + c.votes, 0);
    const validBallots = ballotsCast - abstentions - invalid;
    cands.forEach((c) => { c.pct = validVotes ? Math.round((c.votes / validVotes) * 10000) / 100 : 0; });
    cands.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    const votersVoted = activeVoters.filter((v) => v.voted && v.voted[p.id]).length;
    const decision = decideWinners(cands, seats);
    const integrityWarning = ballotsCast > votersVoted;
    if (integrityWarning) issues.push(`${p.title}: ${ballotsCast} ballots were counted but only ${votersVoted} voters are marked as having voted.`);
    if (invalid) issues.push(`${p.title}: ${invalid} ballot(s) were invalid and excluded from the count.`);

    return {
      id: p.id, title: p.title, seats, maxSelect,
      candidates: cands, validVotes, validBallots, abstentions, invalid, ballotsCast, votersVoted,
      status: decision.status, winners: decision.winners, tied: decision.tied, slots: decision.slots,
      integrityWarning,
    };
  });

  const ballotsTotal = (ballots || []).length;
  if (ballotsTotal > votedAny) issues.push(`${ballotsTotal} ballots exist but only ${votedAny} voters are marked as having voted.`);

  return {
    positions,
    totals: {
      eligible: activeVoters.length,
      votedAny,
      turnoutPct: activeVoters.length ? Math.round((votedAny / activeVoters.length) * 10000) / 100 : 0,
      ballots: ballotsTotal,
      issues,
    },
  };
}

// Compact string used to compare the published snapshot with a fresh recount.
export function fingerprint(r) {
  return r.positions
    .map((p) => p.id + ":" + p.candidates.map((c) => c.id + "=" + c.votes).sort().join(",") + `|a${p.abstentions}i${p.invalid}`)
    .join(";");
}
