export interface RidgeModel {
  featureNames: string[];
  mean: number[];
  std: number[];
  targets: string[];
  weights: number[][]; // [target][feature]
  intercept: number[];
  residualSigma: number[]; // training residual std per target
  lambda: number;
  trainedOn: string;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row[n]);
}

export function fitRidge(X: number[][], Y: number[][], featureNames: string[], targets: string[], lambda: number, trainedOn: string): RidgeModel {
  const n = X.length;
  const d = featureNames.length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));
  const G = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const z of Z) for (let i = 0; i < d; i++) for (let j = i; j < d; j++) G[i][j] += z[i] * z[j];
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < i; j++) G[i][j] = G[j][i];
    G[i][i] += lambda * n;
  }
  const weights: number[][] = [];
  const intercept: number[] = [];
  const residualSigma: number[] = [];
  for (let t = 0; t < targets.length; t++) {
    const ym = Y.reduce((s, y) => s + y[t], 0) / n;
    const rhs = new Array(d).fill(0);
    for (let r = 0; r < n; r++) for (let j = 0; j < d; j++) rhs[j] += Z[r][j] * (Y[r][t] - ym);
    const w = solve(G, rhs);
    weights.push(w);
    intercept.push(ym);
    let ss = 0;
    for (let r = 0; r < n; r++) {
      let p = ym;
      for (let j = 0; j < d; j++) p += w[j] * Z[r][j];
      ss += (Y[r][t] - p) ** 2;
    }
    residualSigma.push(Math.sqrt(ss / n));
  }
  return { featureNames, mean, std, targets, weights, intercept, residualSigma, lambda, trainedOn };
}

export function predictRidge(m: RidgeModel, x: number[]): number[] {
  return m.targets.map((_, t) => {
    let p = m.intercept[t];
    for (let j = 0; j < x.length; j++) p += m.weights[t][j] * ((x[j] - m.mean[j]) / m.std[j]);
    return p;
  });
}
