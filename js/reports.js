// Client-side Excel (SheetJS) and PDF (jsPDF + autoTable) reports. Libraries are loaded from free CDNs in admin.html.
// report = { title, statusLabel, generatedAt: Date, results: computeResults(...) output }
import { download } from "./util.js";

const stamp = (d) => d.toISOString().slice(0, 16).replace(/[:T]/g, "-");

function outcome(p) {
  if (p.status === "no-votes") return "No valid votes";
  if (p.status === "tie") return `TIE for ${p.slots} seat(s): ${p.tied.map((t) => t.name).join(" / ")}`;
  return "Winner" + (p.winners.length > 1 ? "s" : "") + ": " + p.winners.map((w) => w.name).join(", ");
}

export function exportExcel(report) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("Excel library did not load (check internet connection).");
  const { results: r } = report;
  const wb = XLSX.utils.book_new();

  const summary = [
    ["MARANATHA GIRLS ACADEMY"],
    ["ONLINE PREFECT ELECTION SYSTEM"],
    [report.title],
    ["Report status", report.statusLabel],
    ["Generated", report.generatedAt.toLocaleString()],
    [],
    ["Registered (active) voters", r.totals.eligible],
    ["Voters who voted", r.totals.votedAny],
    ["Turnout %", r.totals.turnoutPct],
    ["Ballots counted", r.totals.ballots],
    [],
    ["Integrity notes"],
    ...(r.totals.issues.length ? r.totals.issues.map((i) => [i]) : [["None"]]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const rows = [["Position", "Candidate", "Votes", "Percentage of valid votes", "Result"]];
  r.positions.forEach((p) => {
    p.candidates.forEach((c) => {
      const win = p.winners.some((w) => w.id === c.id);
      const tied = p.tied.some((t) => t.id === c.id);
      rows.push([p.title, c.name, c.votes, c.pct, win ? "WINNER" : tied ? "TIED" : ""]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Results");

  const tot = [["Position", "Seats", "Valid votes", "Abstentions", "Invalid", "Ballots with this position", "Voters marked voted", "Outcome"]];
  r.positions.forEach((p) => tot.push([p.title, p.seats, p.validVotes, p.abstentions, p.invalid, p.ballotsCast, p.votersVoted, outcome(p)]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tot), "Position totals");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`prefect-election-${report.statusLabel.toLowerCase().replace(/\W+/g, "-")}-${stamp(report.generatedAt)}.xlsx`,
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export function exportPDF(report) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error("PDF library did not load (check internet connection).");
  const { results: r } = report;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const navy = [11, 31, 75], gold = [201, 162, 39];
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(...navy); doc.rect(0, 0, W, 86, "F");
  doc.setFillColor(...gold); doc.rect(0, 86, W, 4, "F");
  doc.setTextColor(255); doc.setFont("times", "bold"); doc.setFontSize(20);
  doc.text("MARANATHA GIRLS ACADEMY", W / 2, 36, { align: "center" });
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text("ONLINE PREFECT ELECTION SYSTEM", W / 2, 54, { align: "center" });
  doc.setFontSize(10);
  doc.text(`${report.title}  |  ${report.statusLabel}  |  ${report.generatedAt.toLocaleString()}`, W / 2, 72, { align: "center" });

  doc.setTextColor(20, 33, 61);
  doc.autoTable({
    startY: 106, theme: "grid", headStyles: { fillColor: navy },
    head: [["Registered voters", "Voted", "Turnout", "Ballots counted"]],
    body: [[r.totals.eligible, r.totals.votedAny, r.totals.turnoutPct + "%", r.totals.ballots]],
  });

  r.positions.forEach((p) => {
    const y = doc.lastAutoTable.finalY + 18;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...navy);
    if (y > 740) doc.addPage();
    doc.text(`${p.title}${p.seats > 1 ? `  (${p.seats} seats)` : ""}`, 40, y > 740 ? 50 : y);
    doc.autoTable({
      startY: (y > 740 ? 50 : y) + 6, theme: "striped", headStyles: { fillColor: navy }, styles: { fontSize: 9 },
      head: [["Candidate", "Votes", "%", "Result"]],
      body: p.candidates.length
        ? p.candidates.map((c) => [c.name, c.votes, c.pct + "%", p.winners.some((w) => w.id === c.id) ? "WINNER" : p.tied.some((t) => t.id === c.id) ? "TIED" : ""])
        : [["(no candidates)", "", "", ""]],
      foot: [[`Valid votes: ${p.validVotes}   Abstentions: ${p.abstentions}   Invalid: ${p.invalid}`, "", "", outcome(p)]],
      footStyles: { fillColor: [238, 241, 250], textColor: navy, fontSize: 8 },
    });
  });

  if (r.totals.issues.length) {
    let y = doc.lastAutoTable.finalY + 20;
    if (y > 740) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(192, 57, 43);
    doc.text("Integrity notes", 40, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(doc.splitTextToSize(r.totals.issues.join("\n"), W - 80), 40, y + 14);
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Page ${i} of ${n}  -  Counts computed from recorded ballots in Firestore`, W / 2, 822, { align: "center" });
  }
  doc.save(`prefect-election-${report.statusLabel.toLowerCase().replace(/\W+/g, "-")}-${stamp(report.generatedAt)}.pdf`);
}
