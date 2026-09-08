/**
 * Authoritative simulation contract used by the R01 battle executor.
 *
 * Persisted programs carry this value so that a replay is never silently
 * evaluated with a different set of rules.
 */
export const CURRENT_SIMULATION_VERSION = 'r01-1' as const;

export type SimulationVersion = typeof CURRENT_SIMULATION_VERSION;
