# Benchmark results — optimiser vs nearest-feasible baseline (simulation)
Generated 2026-10-09T19:09:13+05:30 by `backend/benchmark_report.py` on graph: REAL MAP GEOMETRY (928 nodes, 1773 directed edges).

30 seeded random incident sets (5-9 incidents each) x 2 road conditions; initial simulated fleet (5 available) and beds (10); 150 edges in flood zones.

Better/worse = lexicographic (served HIGH, MEDIUM, LOW, then lower priority-weighted chain cost). Weighted cost is only comparable when the same incidents are served.

| Condition | Runs | Opt better | Tie | Opt worse | HIGH served (opt / base) | All served (opt / base) | Mean HIGH response s (opt / base) | Mean weighted cost (opt / base) |
|---|---|---|---|---|---|---|---|---|
| open roads — vs FIFO greedy | 30 | 29 | 1 | 0 | 76 / 54 | 150 / 150 | 292.2 / 411.8 | 6774.4 / 6966.4 |
| flood zones closed — vs FIFO greedy | 30 | 28 | 2 | 0 | 70 / 54 | 149 / 149 | 330.4 / 475.8 | 9393.1 / 9647.8 |
| overall — vs FIFO greedy | 60 | 57 | 3 | 0 | 146 / 108 | 299 / 299 | 311.6 / 444.4 | 8083.8 / 8307.1 |
| open roads — vs priority-first greedy | 30 | 27 | 3 | 0 | 76 / 76 | 150 / 150 | 291.6 / 297.3 | 6774.4 / 7457.9 |
| flood zones closed — vs priority-first greedy | 30 | 23 | 7 | 0 | 70 / 70 | 149 / 149 | 330.4 / 323.6 | 9393.1 / 10004.2 |
| overall — vs priority-first greedy | 60 | 50 | 10 | 0 | 146 / 146 | 299 / 299 | 311.0 / 310.4 | 8083.8 / 8731.0 |

Caveats: travel times are length / assumed free-flow speed; fleet, beds and incidents are simulated; the optimiser maximises priority-ordered coverage first, so it may serve *different* incidents than the baseline (weighted cost then is not a like-for-like comparison). No claim is made about real response times or outcomes.

Compute time for all runs: 0.72 s.

## Per-run results

| Seed | Condition | Incidents | Served H/M/L opt | H/M/L FIFO greedy | H/M/L priority greedy | Weighted opt | Weighted FIFO | Weighted priority |
|---|---|---|---|---|---|---|---|---|
| 1 | open roads | 6 | 1/4/0 | 1/3/1 | 1/4/0 | 6511.0 | 5999.0 | 6511.0 |
| 2 | open roads | 5 | 2/0/3 | 2/0/3 | 2/0/3 | 5567.6 | 6428.7 | 5719.4 |
| 3 | open roads | 6 | 5/0/0 | 4/0/1 | 5/0/0 | 9369.3 | 9500.1 | 12137.4 |
| 4 | open roads | 6 | 1/3/1 | 0/3/2 | 1/3/1 | 6105.8 | 5990.3 | 6162.8 |
| 5 | open roads | 9 | 2/3/0 | 1/3/1 | 2/3/0 | 5010.7 | 7078.5 | 7691.7 |
| 6 | open roads | 9 | 4/1/0 | 1/1/3 | 4/1/0 | 8029.9 | 4289.3 | 8029.9 |
| 7 | open roads | 7 | 2/1/2 | 2/0/3 | 2/1/2 | 5625.1 | 6928.0 | 6057.2 |
| 8 | open roads | 6 | 2/2/1 | 2/1/2 | 2/2/1 | 5539.0 | 6783.6 | 6120.8 |
| 9 | open roads | 8 | 5/0/0 | 4/0/1 | 5/0/0 | 7467.6 | 12231.4 | 7625.7 |
| 10 | open roads | 9 | 2/3/0 | 2/2/1 | 2/3/0 | 7689.4 | 7764.7 | 8158.4 |
| 11 | open roads | 8 | 5/0/0 | 4/1/0 | 5/0/0 | 9945.0 | 8546.3 | 10800.3 |
| 12 | open roads | 8 | 0/5/0 | 0/4/1 | 0/5/0 | 4870.8 | 4342.3 | 5164.8 |
| 13 | open roads | 7 | 0/2/3 | 0/2/3 | 0/2/3 | 2885.8 | 4984.5 | 3457.7 |
| 14 | open roads | 5 | 4/1/0 | 4/1/0 | 4/1/0 | 7510.9 | 7708.0 | 8104.0 |
| 15 | open roads | 6 | 3/0/2 | 2/0/3 | 3/0/2 | 7868.0 | 8246.0 | 8101.3 |
| 16 | open roads | 7 | 2/3/0 | 2/2/1 | 2/3/0 | 5546.8 | 10610.1 | 7054.4 |
| 17 | open roads | 9 | 5/0/0 | 2/2/1 | 5/0/0 | 8649.9 | 8384.1 | 8649.9 |
| 18 | open roads | 6 | 2/2/1 | 1/2/2 | 2/2/1 | 4498.2 | 5137.7 | 5096.5 |
| 19 | open roads | 5 | 2/1/2 | 2/1/2 | 2/1/2 | 8505.9 | 10052.6 | 9172.8 |
| 20 | open roads | 6 | 0/4/1 | 0/4/1 | 0/4/1 | 5358.2 | 5358.2 | 5419.4 |
| 21 | open roads | 6 | 2/2/1 | 2/2/1 | 2/2/1 | 6057.2 | 8001.5 | 7705.8 |
| 22 | open roads | 6 | 0/1/4 | 0/1/4 | 0/1/4 | 3112.5 | 4554.6 | 4272.8 |
| 23 | open roads | 7 | 3/2/0 | 2/2/1 | 3/2/0 | 7041.7 | 6112.0 | 7749.7 |
| 24 | open roads | 8 | 5/0/0 | 2/0/3 | 5/0/0 | 9309.6 | 3539.2 | 10483.5 |
| 25 | open roads | 8 | 4/1/0 | 2/2/1 | 4/1/0 | 10608.0 | 6353.3 | 12628.5 |
| 26 | open roads | 6 | 3/2/0 | 3/2/0 | 3/2/0 | 6193.4 | 6705.2 | 6705.2 |
| 27 | open roads | 8 | 1/3/1 | 1/2/2 | 1/3/1 | 6416.3 | 6201.4 | 6494.2 |
| 28 | open roads | 5 | 2/1/2 | 2/1/2 | 2/1/2 | 5364.3 | 5447.7 | 5447.7 |
| 29 | open roads | 9 | 4/1/0 | 2/1/2 | 4/1/0 | 7191.2 | 6985.5 | 7584.2 |
| 30 | open roads | 9 | 3/2/0 | 2/2/1 | 3/2/0 | 9382.6 | 8727.1 | 9430.8 |
| 1 | flood zones closed | 6 | 1/3/1 | 1/3/1 | 1/3/1 | 7737.6 | 7737.6 | 7992.7 |
| 2 | flood zones closed | 5 | 2/0/3 | 2/0/3 | 2/0/3 | 7605.8 | 8628.5 | 7757.6 |
| 3 | flood zones closed | 6 | 5/0/0 | 4/0/1 | 5/0/0 | 14365.5 | 14231.7 | 16901.1 |
| 4 | flood zones closed | 6 | 1/2/2 | 1/2/2 | 1/2/2 | 9294.7 | 10968.9 | 9294.7 |
| 5 | flood zones closed | 9 | 2/3/0 | 1/2/2 | 2/3/0 | 7860.3 | 8114.6 | 9014.9 |
| 6 | flood zones closed | 9 | 4/1/0 | 1/1/3 | 4/1/0 | 11049.7 | 6403.9 | 11049.7 |
| 7 | flood zones closed | 7 | 2/1/2 | 2/0/3 | 2/1/2 | 8890.2 | 10041.6 | 9277.0 |
| 8 | flood zones closed | 6 | 2/1/2 | 2/1/2 | 2/1/2 | 5806.7 | 6438.1 | 5806.7 |
| 9 | flood zones closed | 8 | 4/1/0 | 4/0/1 | 4/1/0 | 11569.3 | 14911.9 | 11792.8 |
| 10 | flood zones closed | 9 | 2/3/0 | 2/2/1 | 2/3/0 | 11605.9 | 11788.2 | 12070.9 |
| 11 | flood zones closed | 8 | 3/2/0 | 3/1/1 | 3/2/0 | 8376.2 | 9672.4 | 10764.2 |
| 12 | flood zones closed | 8 | 0/5/0 | 0/4/1 | 0/5/0 | 6977.6 | 6077.2 | 6977.6 |
| 13 | flood zones closed | 7 | 0/2/3 | 0/2/3 | 0/2/3 | 3777.4 | 6698.5 | 5207.1 |
| 14 | flood zones closed | 5 | 4/1/0 | 4/1/0 | 4/1/0 | 9529.5 | 10659.3 | 10247.8 |
| 15 | flood zones closed | 6 | 3/0/2 | 2/0/3 | 3/0/2 | 8834.5 | 9039.2 | 9777.0 |
| 16 | flood zones closed | 7 | 2/3/0 | 2/2/1 | 2/3/0 | 9426.7 | 12410.9 | 10791.7 |
| 17 | flood zones closed | 9 | 5/0/0 | 3/2/0 | 5/0/0 | 11686.5 | 10754.6 | 11686.5 |
| 18 | flood zones closed | 6 | 2/2/1 | 1/2/2 | 2/2/1 | 6039.7 | 5238.0 | 7064.2 |
| 19 | flood zones closed | 5 | 2/1/2 | 2/1/2 | 2/1/2 | 13735.8 | 15819.8 | 14490.5 |
| 20 | flood zones closed | 6 | 0/3/2 | 0/3/2 | 0/3/2 | 6774.5 | 6904.5 | 6904.5 |
| 21 | flood zones closed | 6 | 1/1/2 | 1/1/2 | 1/1/2 | 5631.0 | 5631.0 | 5631.0 |
| 22 | flood zones closed | 6 | 0/1/4 | 0/1/4 | 0/1/4 | 5990.2 | 6800.8 | 6449.4 |
| 23 | flood zones closed | 7 | 2/2/1 | 2/2/1 | 2/2/1 | 9323.1 | 14123.0 | 10306.5 |
| 24 | flood zones closed | 8 | 5/0/0 | 2/0/3 | 5/0/0 | 9552.0 | 4170.7 | 10243.5 |
| 25 | flood zones closed | 8 | 4/1/0 | 3/1/1 | 4/1/0 | 20827.8 | 16839.1 | 22015.7 |
| 26 | flood zones closed | 6 | 2/3/0 | 2/3/0 | 2/3/0 | 9653.6 | 9789.0 | 9789.0 |
| 27 | flood zones closed | 8 | 1/3/1 | 1/2/2 | 1/3/1 | 9643.5 | 9190.9 | 10337.5 |
| 28 | flood zones closed | 5 | 2/1/2 | 2/1/2 | 2/1/2 | 5518.7 | 5748.5 | 5748.5 |
| 29 | flood zones closed | 9 | 4/1/0 | 2/1/2 | 4/1/0 | 10511.2 | 10368.1 | 10511.2 |
| 30 | flood zones closed | 9 | 3/2/0 | 2/2/1 | 3/2/0 | 14198.9 | 14234.4 | 14223.1 |
