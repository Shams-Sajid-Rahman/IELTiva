/** The published IELTS rule: the mean of the four skill bands, to the nearest half band. 6.25 becomes 6.5, 6.125 becomes 6.0. */
export function overallBand(scores: readonly number[]) {
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(mean * 2) / 2;
}

/** The whole-number band descriptions from the official IELTS scale, as message keys. A half band sits between two of them. */
export function bandUserKeys(band: number) {
  // Band 0 means the test wasn't attempted, so 0.5 is described by the first real level.
  if (band === 0.5) return { lower: 1 };
  const lower = Math.floor(band);
  return band === lower ? { lower } : { lower, upper: lower + 1 };
}
