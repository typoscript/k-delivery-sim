// Lane counts and one-way streets for the road graph (build-suwon-map.mjs).

const LANE_M = 3.2;
const SHOULDER_M = 1.4;

/**
 * Carriageway width (m): from the OSM `lanes` tag when present (lanes x 3.2m + shoulders, never more than 30% wider
 * than the class width so a road does not grow into the real buildings beside it); a one-way arterial without a lane
 * count is one half of a dual carriageway, so it is narrower than the two-way class width.
 */
export function roadWidthOf(cls, oneway, lanes) {
  let w = cls.width;
  if (lanes > 0) w = Math.min(Math.max(lanes * LANE_M + SHOULDER_M, 5.6), Math.min(22, cls.width * 1.3));
  else if (oneway && cls.major) w = Math.max(7.2, cls.width * 0.7);
  return Math.round(w * 10) / 10;
}

/** Strongly connected components of the driving graph (iterative Tarjan); returns comp id per node index */
export function drivingComponents(nodeCount, edges) {
  const out = Array.from({ length: nodeCount }, () => []);
  for (const e of edges) {
    out[e.a].push(e.b);
    if (!e.oneway) out[e.b].push(e.a);
  }
  const index = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const comp = new Int32Array(nodeCount).fill(-1);
  const stack = [];
  let next = 0;
  let comps = 0;
  for (let s = 0; s < nodeCount; s++) {
    if (index[s] !== -1 || out[s].length === 0) continue;
    const work = [[s, 0]];
    index[s] = low[s] = next++;
    stack.push(s);
    onStack[s] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] < out[v].length) {
        const w = out[v][top[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const u = work[work.length - 1][0];
        low[u] = Math.min(low[u], low[v]);
      }
      if (low[v] === index[v]) {
        let w;
        do {
          w = stack.pop();
          onStack[w] = 0;
          comp[w] = comps;
        } while (w !== v);
        comps++;
      }
    }
  }
  return comp;
}

/**
 * Turns one-way edges back into two-way ones until every junction can reach every other legally (a car or the
 * navigator never ends up somewhere it cannot drive out of). Returns how many edges were relaxed.
 */
export function relaxOneWays(edges) {
  let nodeCount = 0;
  for (const e of edges) nodeCount = Math.max(nodeCount, e.a + 1, e.b + 1);
  let relaxed = 0;
  for (let round = 0; round < 1000; round++) {
    const comp = drivingComponents(nodeCount, edges);
    const size = new Map();
    for (let i = 0; i < nodeCount; i++) if (comp[i] >= 0) size.set(comp[i], (size.get(comp[i]) ?? 0) + 1);
    if (size.size <= 1) break;
    let main = -1;
    let best = -1;
    for (const [c, n] of size) if (n > best) (best = n), (main = c);
    let changed = 0;
    for (const e of edges) {
      if (e.oneway && (comp[e.a] !== main || comp[e.b] !== main)) {
        e.oneway = false;
        changed++;
      }
    }
    relaxed += changed;
    if (changed === 0) break;
  }
  return relaxed;
}
