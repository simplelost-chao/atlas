/**
 * Entity-resolution name normalization.
 *
 * Lowercases, strips all non-alphanumeric characters (including spaces and
 * punctuation), and keeps CJK ideographs. Two names that normalize to the same
 * key are treated as the same entity — prevents the supply-chain graph from
 * fragmenting (e.g. "InP" / "Indium Phosphide" / " inp ").
 *
 * Ported from the IndustryAnalysis Python reference implementation
 * (industry_analysis.graph.models.normalize), kept behaviourally identical so
 * both codebases share one entity-resolution contract.
 */
export function normalize(name: string): string {
  // Keep 0-9, a-z (after lowercasing), and CJK Unified Ideographs (U+4E00–U+9FFF).
  return name.toLowerCase().replace(/[^0-9a-z一-鿿]/g, "");
}
