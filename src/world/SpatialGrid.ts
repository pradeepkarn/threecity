/**
 * Splits the world into square cells and remembers which items touch which cell.
 * "What's near this point?" then only checks a few cells instead of every item in the city.
 * (The city has tens of thousands of road pieces; checking all of them for every
 * terrain point would be far too slow.)
 */
export class SpatialGrid<T> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(ix: number, iz: number): number {
    return ix * 100003 + iz; // unique for any realistic city size
  }

  /** Adds an item covering the box from (minX, minZ) to (maxX, maxZ). */
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const x0 = Math.floor(minX / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const z0 = Math.floor(minZ / this.cellSize);
    const z1 = Math.floor(maxZ / this.cellSize);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(item);
      }
    }
  }

  /**
   * Fills `out` with items whose box touches the given box. An item may appear more
   * than once if it spans several cells; that's harmless for "nearest" style searches.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: T[]): T[] {
    out.length = 0;
    const x0 = Math.floor(minX / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const z0 = Math.floor(minZ / this.cellSize);
    const z1 = Math.floor(maxZ / this.cellSize);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const list = this.cells.get(this.key(ix, iz));
        if (list) for (const item of list) out.push(item);
      }
    }
    return out;
  }
}
