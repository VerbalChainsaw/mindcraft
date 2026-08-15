[codeplan · campaign70-mining-zero-progress · IN · mode: full · confidence: high · candidates: V1 live receipt / extracted-helper local-only, V2 action delta / new-module instance-state, V3 durable receipt / map-indexed external-store · lean: V3 · baseline: V3]

# Decision boundary

Campaign 60 proved that `action:mineSearchTunnel` can return several truthful
failure codes without moving, excavating, or collecting, while `nextMinerStep`
only stops one named code. Campaign 70 requires the miner to avoid repeating an
unchanged method after a structured zero-physical-progress result, including
across work-order reload.

## Calibrated quality axes

Repository guidance makes physical evidence, truthful staged contracts,
durable work-order state, smallest shared ownership, bounded campaigns, and
real-Paper compatibility the governing qualities. Existing reducers are pure,
work-order state is normalized and frozen, action evidence is structured, and
focused tests call `next*Step` / `advanceWorkOrder` directly.

Rubric frozen: axes [Evidence truth, Ownership contract, Campaign methodology, Compatibility, Testability, Blast radius, Restart durability] · weights [3,3,3,2,2,2,1] · denominator = Σ(weights) × 5 · denominator-policy [uniform-N/A-only] · baseline-algo [lowest-effort gate-passer with no score of 1 on any quality axis]

freeze: axes=Evidence truth,Ownership contract,Campaign methodology,Compatibility,Testability,Blast radius,Restart durability weights=3,3,3,2,2,2,1 denom=ΣW×5 baseline=lowest-effort-gate-passer

## Variants and gates

- V1 `extracted-helper local-only`: add a mining-owned progress receipt and let
  the miner reducer consume the live result. G: pass. It solves live
  convergence with the smallest surface, but reload loses the nested receipt.
- V2 `new-module instance-state`: have ActionManager compute a generic
  position/inventory delta for every action and combine it with skill output.
  G: fail (functional truth). A body/inventory delta cannot observe a block
  excavated and then retreated from, so it can falsely call world mutation zero.
- V3 `map-indexed external-store`: add the mining-owned progress receipt,
  normalize its bounded method identity into work-order evidence during
  settlement, and let the pure miner reducer consume the live or persisted
  receipt. G: pass. This preserves the ownership split and survives reload
  without a parallel movement or mining mechanism.

Mechanism divergence: V1 keeps state in the live result; V2 moves observation
to a cross-action manager/module boundary; V3 persists a bounded receipt in the
existing work-order store. These differ in module boundary and state location.

## Scoring (1–5)

| Axis | W | V1 | V3 |
|---|---:|---:|---:|
| Evidence truth | 3 | 5 | 5 |
| Ownership contract | 3 | 5 | 5 |
| Campaign methodology | 3 | 5 | 5 |
| Compatibility | 2 | 5 | 5 |
| Testability | 2 | 5 | 5 |
| Blast radius | 2 | 5 | 4 |
| Restart durability | 1 | 1 | 5 |
| Effort | - | low | medium |
| Weighted total | - | 76/80 | 78/80 |
| Normalized | - | 0.9500 | 0.9750 |

Arithmetic verified mechanically with the frozen weights: V1 =
15+15+15+10+10+10+1 = 76; V3 = 15+15+15+10+10+8+5 = 78;
denominator = 80. Restart durability is a quality axis, so V1's score of 1
disqualifies it from the baseline guard despite its lower effort; V3 is the
lowest-effort gate-passer without a quality-axis score of 1.

[codeplan · campaign70-mining-zero-progress · OUT · mode: full · pick: V3 · confidence: high · beatBaseline: baseline-wins · scores: V1 0.9500, V3 0.9750 · reason: the mining-owned receipt remains truthful and survives work-order reload through the existing normalized store · mechanism-check: passed · corrected: none]
