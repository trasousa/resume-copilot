// GitHub-style contribution-graph heatmap: 53 columns (weeks) x 7 rows
// (days), 5 color tiers by daily activity count, trailing 365 days.
// `data` is the raw {date, count}[] from GET /applications/activity-heatmap
// -- sparse (only days with activity present); zero-filled here for every
// day in the window so the grid always has a full 365-day shape.

export function renderActivityGraph(container, data) {
  const byDate = new Map(data.map((d) => [d.date, d.count]));
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: byDate.get(iso) || 0 });
  }
  // Pad to start on a Sunday so columns align to real calendar weeks,
  // matching GitHub's own convention.
  const firstDow = new Date(days[0].date).getDay();
  for (let i = 0; i < firstDow; i++) days.unshift({ date: null, count: 0 });

  const tier = (count) => (count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4);

  container.innerHTML = `<div class="activity-graph">${days
    .map(
      (d) =>
        `<span class="activity-cell tier-${tier(d.count)}" ${d.date ? `title="${d.count} ${d.count === 1 ? "activity" : "activities"} on ${d.date}"` : ""}></span>`
    )
    .join("")}</div>`;
}
