import { addGameIntegers, assertGameInteger } from './fixed-point';
import { clampBodyToArena } from './geometry';
import type { ArenaBounds, CircleBody } from './geometry';

const HEADING_COUNT = 256;
const DIRECTION_COMPONENT_SCALE = 1_000;

/**
 * Author-time generated literal. This table is deliberately not generated at
 * runtime, so V8 and JavaScriptCore use the same integer directions.
 */
const DIRECTION_TABLE = [
  [1000, 0],
  [1000, 25],
  [999, 49],
  [997, 74],
  [995, 98],
  [992, 122],
  [989, 147],
  [985, 171],
  [981, 195],
  [976, 219],
  [970, 243],
  [964, 267],
  [957, 290],
  [950, 314],
  [942, 337],
  [933, 360],
  [924, 383],
  [914, 405],
  [904, 428],
  [893, 450],
  [882, 471],
  [870, 493],
  [858, 514],
  [845, 535],
  [831, 556],
  [818, 576],
  [803, 596],
  [788, 615],
  [773, 634],
  [757, 653],
  [741, 672],
  [724, 690],
  [707, 707],
  [690, 724],
  [672, 741],
  [653, 757],
  [634, 773],
  [615, 788],
  [596, 803],
  [576, 818],
  [556, 831],
  [535, 845],
  [514, 858],
  [493, 870],
  [471, 882],
  [450, 893],
  [428, 904],
  [405, 914],
  [383, 924],
  [360, 933],
  [337, 942],
  [314, 950],
  [290, 957],
  [267, 964],
  [243, 970],
  [219, 976],
  [195, 981],
  [171, 985],
  [147, 989],
  [122, 992],
  [98, 995],
  [74, 997],
  [49, 999],
  [25, 1000],
  [0, 1000],
  [-25, 1000],
  [-49, 999],
  [-74, 997],
  [-98, 995],
  [-122, 992],
  [-147, 989],
  [-171, 985],
  [-195, 981],
  [-219, 976],
  [-243, 970],
  [-267, 964],
  [-290, 957],
  [-314, 950],
  [-337, 942],
  [-360, 933],
  [-383, 924],
  [-405, 914],
  [-428, 904],
  [-450, 893],
  [-471, 882],
  [-493, 870],
  [-514, 858],
  [-535, 845],
  [-556, 831],
  [-576, 818],
  [-596, 803],
  [-615, 788],
  [-634, 773],
  [-653, 757],
  [-672, 741],
  [-690, 724],
  [-707, 707],
  [-724, 690],
  [-741, 672],
  [-757, 653],
  [-773, 634],
  [-788, 615],
  [-803, 596],
  [-818, 576],
  [-831, 556],
  [-845, 535],
  [-858, 514],
  [-870, 493],
  [-882, 471],
  [-893, 450],
  [-904, 428],
  [-914, 405],
  [-924, 383],
  [-933, 360],
  [-942, 337],
  [-950, 314],
  [-957, 290],
  [-964, 267],
  [-970, 243],
  [-976, 219],
  [-981, 195],
  [-985, 171],
  [-989, 147],
  [-992, 122],
  [-995, 98],
  [-997, 74],
  [-999, 49],
  [-1000, 25],
  [-1000, 0],
  [-1000, -25],
  [-999, -49],
  [-997, -74],
  [-995, -98],
  [-992, -122],
  [-989, -147],
  [-985, -171],
  [-981, -195],
  [-976, -219],
  [-970, -243],
  [-964, -267],
  [-957, -290],
  [-950, -314],
  [-942, -337],
  [-933, -360],
  [-924, -383],
  [-914, -405],
  [-904, -428],
  [-893, -450],
  [-882, -471],
  [-870, -493],
  [-858, -514],
  [-845, -535],
  [-831, -556],
  [-818, -576],
  [-803, -596],
  [-788, -615],
  [-773, -634],
  [-757, -653],
  [-741, -672],
  [-724, -690],
  [-707, -707],
  [-690, -724],
  [-672, -741],
  [-653, -757],
  [-634, -773],
  [-615, -788],
  [-596, -803],
  [-576, -818],
  [-556, -831],
  [-535, -845],
  [-514, -858],
  [-493, -870],
  [-471, -882],
  [-450, -893],
  [-428, -904],
  [-405, -914],
  [-383, -924],
  [-360, -933],
  [-337, -942],
  [-314, -950],
  [-290, -957],
  [-267, -964],
  [-243, -970],
  [-219, -976],
  [-195, -981],
  [-171, -985],
  [-147, -989],
  [-122, -992],
  [-98, -995],
  [-74, -997],
  [-49, -999],
  [-25, -1000],
  [0, -1000],
  [25, -1000],
  [49, -999],
  [74, -997],
  [98, -995],
  [122, -992],
  [147, -989],
  [171, -985],
  [195, -981],
  [219, -976],
  [243, -970],
  [267, -964],
  [290, -957],
  [314, -950],
  [337, -942],
  [360, -933],
  [383, -924],
  [405, -914],
  [428, -904],
  [450, -893],
  [471, -882],
  [493, -870],
  [514, -858],
  [535, -845],
  [556, -831],
  [576, -818],
  [596, -803],
  [615, -788],
  [634, -773],
  [653, -757],
  [672, -741],
  [690, -724],
  [707, -707],
  [724, -690],
  [741, -672],
  [757, -653],
  [773, -634],
  [788, -615],
  [803, -596],
  [818, -576],
  [831, -556],
  [845, -535],
  [858, -514],
  [870, -493],
  [882, -471],
  [893, -450],
  [904, -428],
  [914, -405],
  [924, -383],
  [933, -360],
  [942, -337],
  [950, -314],
  [957, -290],
  [964, -267],
  [970, -243],
  [976, -219],
  [981, -195],
  [985, -171],
  [989, -147],
  [992, -122],
  [995, -98],
  [997, -74],
  [999, -49],
  [1000, -25],
] as const;

interface MotionBody extends CircleBody {
  heading: number;
  speed: number;
}

interface DirectionVector {
  x: number;
  y: number;
}

function normalizeHeading(heading: number): number {
  assertGameInteger(heading, 'heading');
  return ((heading % HEADING_COUNT) + HEADING_COUNT) % HEADING_COUNT;
}

function directionVector(heading: number): DirectionVector {
  const [x, y] = DIRECTION_TABLE[normalizeHeading(heading)];
  return { x, y };
}

function shortestHeadingDelta(from: number, to: number): number {
  const delta = (normalizeHeading(to) - normalizeHeading(from) + HEADING_COUNT / 2) % HEADING_COUNT - HEADING_COUNT / 2;
  return delta === HEADING_COUNT / 2 ? -HEADING_COUNT / 2 : delta;
}

function turnHeading(from: number, to: number, maxTurnUnits: number): number {
  assertGameInteger(maxTurnUnits, 'maxTurnUnits');
  if (maxTurnUnits < 0) throw new RangeError('maxTurnUnits must be non-negative');
  const current = normalizeHeading(from);
  const delta = shortestHeadingDelta(current, to);
  if (Math.abs(delta) <= maxTurnUnits) return normalizeHeading(to);
  return normalizeHeading(current + Math.sign(delta) * maxTurnUnits);
}

function scaleDirectionComponent(distance: number, component: number): number {
  assertGameInteger(distance, 'distance');
  assertGameInteger(component, 'direction component');
  const product = BigInt(distance) * BigInt(component);
  const sign = product < 0n ? -1n : 1n;
  const absolute = product < 0n ? -product : product;
  const rounded = ((absolute + BigInt(DIRECTION_COMPONENT_SCALE / 2)) / BigInt(DIRECTION_COMPONENT_SCALE)) * sign;
  return assertGameInteger(Number(rounded), 'scaled direction component');
}

function velocityForHeading(heading: number, speed: number): DirectionVector {
  assertGameInteger(speed, 'speed');
  if (speed < 0) throw new RangeError('speed must be non-negative');
  const vector = directionVector(heading);
  return {
    x: scaleDirectionComponent(speed, vector.x),
    y: scaleDirectionComponent(speed, vector.y),
  };
}

function setHeadingVelocity(body: MotionBody, heading: number, speed = body.speed): MotionBody {
  assertMotionBody(body);
  assertGameInteger(speed, 'speed');
  if (speed < 0) throw new RangeError('speed must be non-negative');
  const velocity = velocityForHeading(heading, speed);
  return { ...body, heading: normalizeHeading(heading), speed, vx: velocity.x, vy: velocity.y };
}

function stepBody(body: MotionBody, bounds: ArenaBounds): MotionBody {
  assertMotionBody(body);
  const moved: MotionBody = {
    ...body,
    x: addGameIntegers(body.x, body.vx, 'next x'),
    y: addGameIntegers(body.y, body.vy, 'next y'),
  };
  return clampBodyToArena(moved, bounds) as MotionBody;
}

function assertMotionBody(body: MotionBody): void {
  assertGameInteger(body.heading, 'body.heading');
  assertGameInteger(body.speed, 'body.speed');
  if (body.speed < 0) throw new RangeError('body.speed must be non-negative');
  normalizeHeading(body.heading);
}

export {
  DIRECTION_COMPONENT_SCALE,
  DIRECTION_TABLE,
  HEADING_COUNT,
  directionVector,
  normalizeHeading,
  scaleDirectionComponent,
  setHeadingVelocity,
  shortestHeadingDelta,
  stepBody,
  turnHeading,
  velocityForHeading,
};
export type { DirectionVector, MotionBody };
