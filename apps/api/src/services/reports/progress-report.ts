import type { StudentAnalytics } from "../analytics/student.service.js";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const title = (skill: string) => `${skill[0]}${skill.slice(1).toLowerCase()}`;

/**
 * A progress report the student can keep. It holds only recorded results, and says what's missing rather than filling it in.
 * It's a single file with no scripts or outside references, so it can't load or run anything when opened.
 */
export function renderProgressReport(data: StudentAnalytics, name: string) {
  const rows = data.skills
    .map((row) => `<tr><td>${escapeHtml(title(row.skill))}</td><td>${row.sectionsCompleted}</td><td>${row.maxScore ? `${row.rawScore ?? 0} / ${row.maxScore} (${row.accuracy}%)` : "Not automatically marked"}</td><td>${row.minutes}</td></tr>`)
    .join("");
  const bands = data.target.bySkill.filter((row) => row.band !== null);
  const bandRows = bands.map((row) => `<tr><td>${escapeHtml(title(row.skill))}</td><td>${row.band?.toFixed(1)}</td><td>${row.kind === "REVIEWED" ? "Instructor reviewed" : "Estimated"}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IELTiva progress report</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#101d3a;line-height:1.5}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{text-align:left;border-bottom:1px solid #d8deea;padding:.5rem}.note{color:#51607f;font-size:.9rem}</style>
</head><body>
<h1>Progress report</h1>
<p>${escapeHtml(name || "Student")}, last ${data.days} days. Made on ${new Date().toISOString().slice(0, 10)}.</p>
<p class="note">This is a practice summary from IELTiva, an independent preparation platform. It is not an official IELTS result.</p>
<h2>Overview</h2>
<ul>
<li>Tests finished: ${data.overview.attemptsFinished}</li>
<li>Mock tests: ${data.overview.mockTests}</li>
<li>Active days: ${data.overview.activeDays}</li>
<li>Study time: ${data.overview.minutes} minutes</li>
<li>Longest streak: ${data.overview.longestStreak} days</li>
</ul>
<h2>Raw scores by skill</h2>
<table><thead><tr><th>Skill</th><th>Sections</th><th>Marked answers</th><th>Minutes</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Bands</h2>
${bands.length ? `<table><thead><tr><th>Skill</th><th>Band</th><th>Kind</th></tr></thead><tbody>${bandRows}</tbody></table>` : `<p>No band scores are available for this period, so none are shown.</p>`}
<h2>Writing and Speaking</h2>
<ul>
<li>Writing submitted: ${data.production.writing.submissions}</li>
<li>Speaking recordings: ${data.production.speaking.recordings}</li>
</ul>
</body></html>`;
}
