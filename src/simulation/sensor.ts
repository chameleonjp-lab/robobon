import { assertGameInteger } from './fixed-point';
import { directionVector, normalizeHeading, shortestHeadingDelta } from './motion';
import { squaredDistance, validateBounds } from './geometry';
import type { ArenaBounds } from './geometry';
import type { MotionBody } from './motion';

interface BoundaryRisk {
  xMin: boolean;
  xMax: boolean;
  yMin: boolean;
  yMax: boolean;
  any: boolean;
}

interface SensorReading {
  observerId: number;
  targetId: number;
  distanceSquared: bigint;
  withinRange: boolean;
  visible: boolean;
  bearing: number;
  relativeHeading: number;
}

function headingToPoint(observer: Pick<MotionBody, 'x' | 'y' | 'heading'>, target: Pick<MotionBody, 'x' | 'y'>): number {
  assertGameInteger(observer.x, 'observer.x');
  assertGameInteger(observer.y, 'observer.y');
  assertGameInteger(target.x, 'target.x');
  assertGameInteger(target.y, 'target.y');
  const dx = BigInt(target.x) - BigInt(observer.x);
  const dy = BigInt(target.y) - BigInt(observer.y);
  if (dx === 0n && dy === 0n) return normalizeHeading(observer.heading);

  let bestHeading = 0;
  let bestScore: bigint | null = null;
  let bestCrossMagnitude: bigint | null = null;
  for (let heading = 0; heading < 256; heading += 1) {
    const vector = directionVector(heading);
    const score = dx * BigInt(vector.x) + dy * BigInt(vector.y);
    const cross = dx * BigInt(vector.y) - dy * BigInt(vector.x);
    const crossMagnitude = cross < 0n ? -cross : cross;
    if (
      bestScore === null ||
      score > bestScore ||
      (score === bestScore && (bestCrossMagnitude === null || crossMagnitude < bestCrossMagnitude))
    ) {
      bestScore = score;
      bestCrossMagnitude = crossMagnitude;
      bestHeading = heading;
    }
  }
  return bestHeading;
}

function forecastBoundaryRisk(body: MotionBody, bounds: ArenaBounds, lookaheadTicks: number): BoundaryRisk {
  validateBounds(bounds);
  assertGameInteger(lookaheadTicks, 'lookaheadTicks');
  if (lookaheadTicks < 0) throw new RangeError('lookaheadTicks must be non-negative');

  const minX = BigInt(bounds.minX) + BigInt(body.radius);
  const maxX = BigInt(bounds.maxX) - BigInt(body.radius);
  const minY = BigInt(bounds.minY) + BigInt(body.radius);
  const maxY = BigInt(bounds.maxY) - BigInt(body.radius);
  const futureX = BigInt(body.x) + BigInt(body.vx) * BigInt(lookaheadTicks);
  const futureY = BigInt(body.y) + BigInt(body.vy) * BigInt(lookaheadTicks);
  const risk: BoundaryRisk = {
    xMin: futureX < minX,
    xMax: futureX > maxX,
    yMin: futureY < minY,
    yMax: futureY > maxY,
    any: false,
  };
  risk.any = risk.xMin || risk.xMax || risk.yMin || risk.yMax;
  return risk;
}

function readSensor(
  observer: MotionBody,
  target: MotionBody,
  sensorRange: number,
  blocked = false,
): SensorReading {
  assertGameInteger(sensorRange, 'sensorRange');
  if (sensorRange < 0) throw new RangeError('sensorRange must be non-negative');
  const distanceSquared = squaredDistance(observer, target);
  const withinRange = distanceSquared <= BigInt(sensorRange) * BigInt(sensorRange);
  const bearing = headingToPoint(observer, target);
  return {
    observerId: observer.id,
    targetId: target.id,
    distanceSquared,
    withinRange,
    visible: observer.active && target.active && withinRange && !blocked,
    bearing,
    relativeHeading: shortestHeadingDelta(observer.heading, bearing),
  };
}

export { forecastBoundaryRisk, headingToPoint, readSensor };
export type { BoundaryRisk, SensorReading };
