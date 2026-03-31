/**
 * mullstat — Hypergeometric Distribution Math
 *
 * All arithmetic uses log-space to avoid factorial overflow on large N.
 *
 * The hypergeometric distribution models drawing without replacement:
 *   P(X = k) = C(K, k) × C(N−K, n−k) / C(N, n)
 * where:
 *   N = population size  (e.g. 99 for Commander)
 *   K = successes in population  (e.g. land count)
 *   n = draws  (e.g. 7 for opening hand)
 *   k = successes observed
 */

// ─── Log-space helpers ────────────────────────────────────────────────────────

/**
 * Log-Gamma using the Lanczos approximation.
 * Accurate for positive real x.
 * @param {number} x
 * @returns {number}
 */
function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Log of the binomial coefficient C(n, k).
 * Returns -Infinity for invalid k.
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
function logBinom(n, k) {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// ─── Core Distribution ────────────────────────────────────────────────────────

/**
 * Hypergeometric PMF: P(X = k) — probability of drawing exactly k successes.
 *
 * @param {number} k  successes wanted (0..n)
 * @param {number} N  population size
 * @param {number} K  successes in population
 * @param {number} n  sample size (draws)
 * @returns {number}  probability [0, 1]
 */
export function hypgeomPMF(k, N, K, n) {
  const kMin = Math.max(0, n - (N - K));
  const kMax = Math.min(n, K);
  if (k < kMin || k > kMax) return 0;
  const logP = logBinom(K, k) + logBinom(N - K, n - k) - logBinom(N, n);
  return Math.exp(logP);
}

/**
 * Hypergeometric CDF: P(X ≤ k) — probability of at most k successes.
 *
 * @param {number} k
 * @param {number} N
 * @param {number} K
 * @param {number} n
 * @returns {number}
 */
export function hypgeomCDF(k, N, K, n) {
  const kMin = Math.max(0, n - (N - K));
  let sum = 0;
  for (let i = kMin; i <= Math.min(k, K, n); i++) {
    sum += hypgeomPMF(i, N, K, n);
  }
  return Math.min(1, sum); // clamp floating-point drift
}

/**
 * P(X ≥ minK) — probability of drawing at least minK successes.
 *
 * @param {number} minK  minimum successes required
 * @param {number} N
 * @param {number} K
 * @param {number} n
 * @returns {number}
 */
export function hypgeomAtLeast(minK, N, K, n) {
  if (minK <= 0) return 1;
  return 1 - hypgeomCDF(minK - 1, N, K, n);
}

/**
 * Expected value: n × K / N
 *
 * @param {number} N
 * @param {number} K
 * @param {number} n
 * @returns {number}
 */
export function expectedValue(N, K, n) {
  return N > 0 ? (n * K) / N : 0;
}

/**
 * Inverse solver: minimum draws to achieve P(X ≥ 1) ≥ p.
 * Returns Infinity when K = 0 (impossible).
 *
 * @param {number} N  population size
 * @param {number} K  successes in population
 * @param {number} p  target probability [0, 1]
 * @returns {number}
 */
export function drawsNeeded(N, K, p) {
  if (K <= 0) return Infinity;
  if (p <= 0) return 0;
  if (p >= 1) return N - K + 1;
  for (let n = 1; n <= N; n++) {
    if (hypgeomAtLeast(1, N, K, n) >= p) return n;
  }
  return Infinity;
}
