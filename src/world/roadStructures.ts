/**
 * Bridges and underpasses (지하차도) of the road graph (OSM bridge / tunnel tags, kept by the map pipeline). The world
 * is drawn at one ground level, so they are not modelled in 3D; they change the riding instead: bridges freeze
 * first on winter nights (black ice), underpasses stay dry in rain and snow, and the phone map marks both.
 * A coarse grid keeps `structureAt` cheap enough for every physics frame.
 */
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

export type RoadStructure = 'bridge' | 'tunnel';

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidth: number;
  kind: RoadStructure;
}

const CELL_M = 50;

export class RoadStructureIndex {
  private readonly grid = new Map<string, Segment[]>();
  public readonly bridgeCount: number;
  public readonly tunnelCount: number;

  constructor(nodes: readonly OsmGraphNode[], edges: readonly OsmGraphEdge[]) {
    let bridges = 0;
    let tunnels = 0;
    for (const e of edges) {
      const kind: RoadStructure | null = e.bridge ? 'bridge' : e.tunnel ? 'tunnel' : null;
      if (!kind) continue;
      if (kind === 'bridge') bridges++;
      else tunnels++;
      const a = nodes[e.a];
      const b = nodes[e.b];
      const seg: Segment = { ax: a.x, az: a.z, bx: b.x, bz: b.z, halfWidth: e.width / 2 + 0.5, kind };
      // register in every cell the segment's padded bounding box touches
      const pad = seg.halfWidth;
      for (
        let cx = Math.floor((Math.min(a.x, b.x) - pad) / CELL_M);
        cx <= Math.floor((Math.max(a.x, b.x) + pad) / CELL_M);
        cx++
      ) {
        for (
          let cz = Math.floor((Math.min(a.z, b.z) - pad) / CELL_M);
          cz <= Math.floor((Math.max(a.z, b.z) + pad) / CELL_M);
          cz++
        ) {
          const key = `${cx},${cz}`;
          const list = this.grid.get(key);
          if (list) list.push(seg);
          else this.grid.set(key, [seg]);
        }
      }
    }
    this.bridgeCount = bridges;
    this.tunnelCount = tunnels;
  }

  /** The bridge / underpass under (x, z), or null on an ordinary road (or off the road) */
  public structureAt(x: number, z: number): RoadStructure | null {
    const list = this.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`);
    if (!list) return null;
    for (const s of list) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
      const px = s.ax + dx * t - x;
      const pz = s.az + dz * t - z;
      if (px * px + pz * pz <= s.halfWidth * s.halfWidth) return s.kind;
    }
    return null;
  }
}
