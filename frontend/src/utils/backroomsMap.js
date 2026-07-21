// Infinite procedural map for the Backrooms easter egg.
// Pure deterministic functions of integer cell coordinates — the world
// generates on the fly and is identical on every visit.

/**
 * Integer hash of (x, y, tag) -> [0, 1). Fast, deterministic.
 */
export function hash2(x, y, tag) {
  let h =
    (Math.imul(x, 374761393) ^
      Math.imul(y, 668265263) ^
      Math.imul(tag, 1442695041)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const CHUNK = 16;

// Door openings live on chunk borders and must agree on both sides of the
// shared edge, so they are hashed from the edge itself (the chunk index on
// the positive side of the border).
function verticalDoorCenter(cx, cy) {
  return 2 + Math.floor(hash2(cx, cy, 11) * 11); // opening center, cells 2..12
}

function horizontalDoorCenter(cx, cy) {
  return 2 + Math.floor(hash2(cx, cy, 22) * 11);
}

/**
 * Whether the integer cell (x, y) is solid wall.
 * Works for any coordinates — the map is infinite in all directions.
 */
export function isWallCell(x, y) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const lx = x - cx * CHUNK;
  const ly = y - cy * CHUNK;

  // Chunk borders with a 3-cell-wide door opening.
  if (lx === 0) {
    return Math.abs(ly - verticalDoorCenter(cx, cy)) > 1;
  }
  if (lx === CHUNK - 1) {
    return Math.abs(ly - verticalDoorCenter(cx + 1, cy)) > 1;
  }
  if (ly === 0) {
    return Math.abs(lx - horizontalDoorCenter(cx, cy)) > 1;
  }
  if (ly === CHUNK - 1) {
    return Math.abs(lx - horizontalDoorCenter(cx, cy + 1)) > 1;
  }

  // The spawn chunk is always clear.
  if (cx === 0 && cy === 0) {
    return false;
  }

  // Scattered pillars.
  if (hash2(x, y, 33) < 0.05) {
    return true;
  }

  // One wall stub per chunk (with a gap so it never seals a room).
  if (hash2(cx, cy, 44) < 0.45) {
    const horizontal = hash2(cx, cy, 45) < 0.5;
    const line = 3 + Math.floor(hash2(cx, cy, 46) * 10); // 3..12
    const start = 2 + Math.floor(hash2(cx, cy, 47) * 6); // 2..7
    const length = 5 + Math.floor(hash2(cx, cy, 48) * 4); // 5..8
    const gap = 1 + Math.floor(hash2(cx, cy, 49) * (length - 3));

    if (horizontal && ly === line && lx >= start && lx < start + length) {
      const rel = lx - start;
      return !(rel >= gap && rel < gap + 2);
    }
    if (!horizontal && lx === line && ly >= start && ly < start + length) {
      const rel = ly - start;
      return !(rel >= gap && rel < gap + 2);
    }
  }

  return false;
}

/**
 * Whether an axis-aligned bounding box (radius r around px/py) fits in open space.
 */
export function isOpen(px, py, r) {
  return (
    !isWallCell(Math.floor(px - r), Math.floor(py - r)) &&
    !isWallCell(Math.floor(px + r), Math.floor(py - r)) &&
    !isWallCell(Math.floor(px - r), Math.floor(py + r)) &&
    !isWallCell(Math.floor(px + r), Math.floor(py + r))
  );
}

/**
 * Whether the straight segment between two float points stays in open space.
 */
export function isSegmentOpen(x0, y0, x1, y1, r = 0.24) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(dist / 0.25);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isOpen(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return false;
  }
  return true;
}

const SQRT2 = Math.SQRT2;
// Diagonal moves are only allowed when both orthogonal neighbours are open,
// so the path never clips wall corners.
const NEIGHBORS_8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * How many wall cells surround (x, y) in its 3x3 neighbourhood (0..8).
 * Used as a cost penalty so routes prefer corridor centers over wall-hugging.
 */
export function wallProximity(x, y) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if ((dx !== 0 || dy !== 0) && isWallCell(x + dx, y + dy)) count++;
    }
  }
  return count;
}

// Small binary min-heap keyed by priority.
class MinHeap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(priority, value) {
    this.keys.push(priority);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      [this.keys[parent], this.keys[i]] = [this.keys[i], this.keys[parent]];
      [this.values[parent], this.values[i]] = [this.values[i], this.values[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.values[0];
    const lastKey = this.keys.pop();
    const lastValue = this.values.pop();
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.keys.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.keys.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === i) break;
        [this.keys[smallest], this.keys[i]] = [this.keys[i], this.keys[smallest]];
        [this.values[smallest], this.values[i]] = [this.values[i], this.values[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Exploration pathfinder: uniform-cost search (8 directions) from the
 * player's cell to unvisited cells, with a wall-proximity penalty so the
 * route keeps its distance from walls.
 *
 * Collects up to FRONTIER_CANDIDATES frontier cells (open && !visited) and
 * picks the one FARTHEST from `scoreFrom` (usually the spawn point), so the
 * route keeps pushing farther and farther into newly generated rooms.
 *
 * @returns {Array<{x: number, y: number}>} grid waypoints excluding the start cell
 */
export function findExplorationPath(startX, startY, isVisited, scoreFrom, maxExpand = 4000) {
  const startKey = `${startX},${startY}`;
  const cameFrom = new Map([[startKey, null]]);
  const costSoFar = new Map([[startKey, 0]]);
  const heap = new MinHeap();
  heap.push(0, [startX, startY]);
  const frontier = [];
  const proxCache = new Map();
  const proximityOf = (x, y) => {
    const key = `${x},${y}`;
    let value = proxCache.get(key);
    if (value === undefined) {
      value = wallProximity(x, y);
      proxCache.set(key, value);
    }
    return value;
  };

  while (heap.size > 0 && cameFrom.size <= maxExpand) {
    const [x, y] = heap.pop();
    const key = `${x},${y}`;
    const baseCost = costSoFar.get(key);

    if ((x !== startX || y !== startY) && !isVisited(x, y)) {
      // Candidate goal: farthest-from-spawn among all unvisited cells found.
      frontier.push({ x, y });
      // Fall through: keep expanding through unvisited cells so we can plan
      // long routes that cross several rooms into unexplored territory.
    }

    for (const [dx, dy, stepCost] of NEIGHBORS_8) {
      const nx = x + dx;
      const ny = y + dy;
      const nKey = `${nx},${ny}`;
      if (cameFrom.has(nKey) || isWallCell(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        // no corner cutting through walls on diagonals
        if (isWallCell(x + dx, y) || isWallCell(x, y + dy)) continue;
      }
      // Wall-proximity penalty keeps the route away from walls.
      const moveCost = stepCost + proximityOf(nx, ny) * 0.45;
      cameFrom.set(nKey, { x, y });
      costSoFar.set(nKey, baseCost + moveCost);
      heap.push(baseCost + moveCost, [nx, ny]);
    }
  }

  if (frontier.length === 0) {
    return [];
  }

  // Farthest-from-scoreFrom frontier wins -> always deeper into new rooms.
  const anchorX = scoreFrom?.x ?? startX;
  const anchorY = scoreFrom?.y ?? startY;
  let goal = frontier[0];
  let bestDist = -1;
  for (const cell of frontier) {
    const dist = (cell.x - anchorX) ** 2 + (cell.y - anchorY) ** 2;
    if (dist > bestDist) {
      bestDist = dist;
      goal = cell;
    }
  }

  const path = [];
  let cursor = { x: goal.x, y: goal.y };
  while (cursor) {
    path.push({ x: cursor.x, y: cursor.y });
    cursor = cameFrom.get(`${cursor.x},${cursor.y}`);
  }
  path.reverse();
  // Drop the start cell itself.
  if (path.length > 0 && path[0].x === startX && path[0].y === startY) {
    path.shift();
  }
  return path;
}

/**
 * String-pulling: collapse a grid path into a few long straight/diagonal
 * segments that stay in open space. Returns float waypoints (cell centers).
 */
export function smoothPath(gridPath, startX, startY, r = 0.24) {
  const pts = gridPath.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  const out = [];
  let anchorX = startX;
  let anchorY = startY;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !isSegmentOpen(anchorX, anchorY, pts[j].x, pts[j].y, r)) {
      j--;
    }
    out.push(pts[j]);
    anchorX = pts[j].x;
    anchorY = pts[j].y;
    i = j + 1;
  }
  return out;
}
