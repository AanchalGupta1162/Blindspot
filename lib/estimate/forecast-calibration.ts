import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
export const ForecastCalibrationSchema = z.object({
  version: z.literal('forecast-v3'), generatedAt: z.string(), coverageTarget: z.number().gt(0).lt(1),
  calibrationScenarios: z.number().int().positive(), calibrationSeeds: z.array(z.number().int()),
  boundC: z.number().nonnegative(), horizonMin: z.literal(90),
  heldOut: z.object({scenarios:z.number().int().nonnegative(),covered:z.number().int().nonnegative(),seeds:z.array(z.number().int())}),
  note: z.string(),
});
export type ForecastCalibration = z.infer<typeof ForecastCalibrationSchema>;
/** Finite-sample upper residual quantile; scenario scores use max error across their checkpoints. */
export function upperResidualBound(scores: number[], target = .9) {
  if (!scores.length || scores.some(x=>!Number.isFinite(x)) || !(target>0&&target<1)) throw new Error('Invalid calibration scores');
  const sorted=[...scores].sort((a,b)=>a-b);
  const rank=Math.ceil((scores.length+1)*target);
  if(rank>scores.length) throw new Error('Too few independent scenarios for the requested quantile');
  return Math.max(0,sorted[rank-1]);
}
export function loadForecastCalibration(): ForecastCalibration | null {
  const file='data/models/forecast-calibration.json';
  if(!existsSync(file)) return null;
  return ForecastCalibrationSchema.parse(JSON.parse(readFileSync(file,'utf8')));
}
