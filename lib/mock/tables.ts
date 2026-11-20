/**
 * MOCK INSURER tables shared by the seed simulator (scripts/seed/sim.ts) and the live mock
 * insurer (lib/mock/insurer.ts), so live claims are adjudicated exactly like the seeded history.
 * SEAL's agents and rule engine never import lib/mock.
 */

/** Codes the insurer treats as laboratory lines. */
export const LAB_CODES: readonly string[] = ["83036", "83037", "82947", "82950", "82951", "84681", "83525", "84206", "86337", "86341", "80061", "83721", "84478", "82465", "83718", "82043", "82570", "82565", "84443", "82607", "82306", "82652", "80053", "80048", "80076", "85025", "82728", "83540", "86140", "85651", "81001", "86803", "87340"];

/**
 * Which diagnoses make a routine lab plausible — the mock insurer's hidden "test fits diagnosis"
 * check. ASSUMPTION: built from common clinical indications, not from a published table.
 */
export const LAB_DX_FIT: Record<string, string[]> = {
  "85025": ["D5*", "D6*", "R50*", "R53*", "R10*", "R19*", "K*", "N18*", "E1*", "Z00*", "Z01.81*", "C*", "O*"],
  "80053": ["E*", "N*", "K*", "I1*", "R*", "Z00*", "Z79*", "C*"],
  "80048": ["E*", "N*", "I1*", "R*", "Z00*"],
  "84443": ["E0*", "R53*", "R00*", "R63*", "E78*", "I48*", "Z00*", "E10*", "F3*"],
  "80061": ["E78*", "E1*", "I1*", "I2*", "I6*", "Z00*", "Z13.22*", "Z82.49"],
  "82607": ["D51*", "D53*", "E11*", "G6*", "R53*", "R20*", "K90*", "F0*"],
  "85651": ["M0*", "M3*", "M45*", "M46*", "M54*", "M25*", "M79*", "R50*", "R10*", "D6*"],
  "86140": ["M0*", "M3*", "M45*", "M46*", "M54*", "M25*", "M79*", "R50*", "R10*", "K5*", "N39*"],
  "82728": ["D50*", "D5*", "D6*", "R53*", "K90*", "N18*", "Z00*", "O*"],
  "83540": ["D50*", "D5*", "D6*", "R53*", "K90*", "N18*"],
  "81001": ["N*", "R3*", "R10*", "E1*", "Z00*", "R50*", "O*"],
  "82565": ["E1*", "I1*", "N*", "Z00*", "R*", "E78*"],
};
