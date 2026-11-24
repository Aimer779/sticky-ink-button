export const DEFAULT_CONFIG = Object.freeze({
  strandCount: 7,
  breakDistance: 175,
  elasticity: 1.0,
  glossiness: 1.0,
  customCursor: true,
});

const RIM_COUNT = 64;
const NODES_PER_STRAND = 8;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function wrapUnit(s) {
  let r = s % 1;
  if (r < 0) r += 1;
  return r;
}

function arcDelta(a, b) {
  let d = wrapUnit(a) - wrapUnit(b);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export class StickyInkPhysics {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    this.width = options.width || 1080;
    this.height = options.height || 640;

    this.pill = {
      cx: this.width * 0.5,
      cy: this.height * 0.5,
      width: 236,
      height: 68,
      radius: 34,
      halfStraight: 84,
      perimeter: 2 * (2 * 84) + 2 * Math.PI * 34,
    };

    this.pointer = {
      x: this.pill.cx,
      y: this.pill.cy,
      prevX: this.pill.cx,
      prevY: this.pill.cy,
      vx: 0,
      vy: 0,
      speed: 0,
      insideStage: false,
      active: false,
      isDown: false,
    };

    this.isStuck = false;
    this.wasNearPill = false;
    this.cursorStain = 0;
    this.pressScale = 1;
    this.pressVel = 0;

    this.rimNodes = [];
    this.strands = [];
    this.droplets = [];
    this.spikes = [];
    this.cursorBlobs = [];
    this._nextStrandId = 1;

    this._initRim();
    this._initCursorBlobs();
  }

  _initRim() {
    this.rimNodes = [];
    for (let i = 0; i < RIM_COUNT; i++) {
      const s = i / RIM_COUNT;
      const pt = this.pointAtPerimeter(s);
      this.rimNodes.push({
        s,
        bx: pt.x,
        by: pt.y,
        nx: pt.nx,
        ny: pt.ny,
        disp: 0,
        vel: 0,
      });
    }
  }

  _initCursorBlobs() {
    this.cursorBlobs = [];
    const offsets = [
      { ox: 0, oy: 3, r: 5.8, k: 520, d: 36 },
      { ox: -2, oy: 7, r: 4.8, k: 480, d: 34 },
      { ox: 3, oy: 7, r: 4.5, k: 480, d: 34 },
      { ox: 0, oy: 1, r: 4.0, k: 600, d: 40 },
    ];
    for (const o of offsets) {
      this.cursorBlobs.push({
        x: this.pointer.x + o.ox,
        y: this.pointer.y + o.oy,
        vx: 0,
        vy: 0,
        ox: o.ox,
        oy: o.oy,
        baseR: o.r,
        k: o.k,
        d: o.d,
      });
    }
  }

  resize(width, height) {
    if (width <= 0 || height <= 0) return;
    const dx = width * 0.5 - this.pill.cx;
    const dy = height * 0.5 - this.pill.cy;
    this.width = width;
    this.height = height;
    this.pill.cx = width * 0.5;
    this.pill.cy = height * 0.5;

    for (const node of this.rimNodes) {
      const pt = this.pointAtPerimeter(node.s);
      node.bx = pt.x;
      node.by = pt.y;
      node.nx = pt.nx;
      node.ny = pt.ny;
    }

    for (const strand of this.strands) {
      for (const n of strand.nodes) {
        n.x += dx;
        n.y += dy;
        n.ox += dx;
        n.oy += dy;
      }
    }
    for (const drop of this.droplets) {
      drop.x += dx;
      drop.y += dy;
    }
    for (const blob of this.cursorBlobs) {
      blob.x += dx;
      blob.y += dy;
    }
  }

  /**
   * Returns exact signed distance and nearest perimeter point + normalized arc s in [0, 1).
   * Perimeter parametrization:
   *   0: top straight (left -> right)
   *   1: right semicircle (top -> bottom)
   *   2: bottom straight (right -> left)
   *   3: left semicircle (bottom -> top)
   */
  pillSDF(x, y) {
    const { cx, cy, halfStraight: hs, radius: r, perimeter } = this.pill;
    const lx = x - cx;
    const ly = y - cy;
    const clx = clamp(lx, -hs, hs);
    const dx = lx - clx;
    const dy = ly;
    const len = Math.hypot(dx, dy);

    let nx = 0;
    let ny = -1;
    let dist = 0;
    let bx = cx + clx;
    let by = cy;

    if (len > 1e-6) {
      nx = dx / len;
      ny = dy / len;
      dist = len - r;
      bx = cx + clx + nx * r;
      by = cy + ny * r;
    } else {
      // Directly on the medial axis segment; project vertically to top or bottom rim
      dist = -r;
      nx = 0;
      ny = ly >= 0 ? 1 : -1;
      bx = cx + clx;
      by = cy + ny * r;
    }

    const arcLenTop = 2 * hs;
    const arcLenSide = Math.PI * r;
    let arcPos = 0;

    if (lx > hs) {
      // Right semicircle: angle from -PI/2 (top) to +PI/2 (bottom)
      const angle = Math.atan2(ny, nx);
      arcPos = arcLenTop + (angle + Math.PI * 0.5) * r;
    } else if (lx < -hs) {
      // Left semicircle: angle from +PI/2 (bottom) through PI/-PI to -PI/2 (top)
      let angle = Math.atan2(ny, nx);
      if (angle < 0) angle += Math.PI * 2;
      arcPos = arcLenTop * 2 + arcLenSide + (angle - Math.PI * 0.5) * r;
    } else if (ny <= 0) {
      // Top straight
      arcPos = lx + hs;
    } else {
      // Bottom straight
      arcPos = arcLenTop + arcLenSide + (hs - lx);
    }

    return {
      dist,
      bx,
      by,
      nx,
      ny,
      s: wrapUnit(arcPos / perimeter),
    };
  }

  pointAtPerimeter(sRaw) {
    const { cx, cy, halfStraight: hs, radius: r, perimeter } = this.pill;
    const s = wrapUnit(sRaw);
    const d = s * perimeter;
    const topLen = 2 * hs;
    const sideLen = Math.PI * r;

    if (d < topLen) {
      return {
        x: cx - hs + d,
        y: cy - r,
        nx: 0,
        ny: -1,
      };
    }
    if (d < topLen + sideLen) {
      const a = -Math.PI * 0.5 + (d - topLen) / r;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      return {
        x: cx + hs + nx * r,
        y: cy + ny * r,
        nx,
        ny,
      };
    }
    if (d < topLen * 2 + sideLen) {
      const u = d - (topLen + sideLen);
      return {
        x: cx + hs - u,
        y: cy + r,
        nx: 0,
        ny: 1,
      };
    }
    const u = d - (topLen * 2 + sideLen);
    const a = Math.PI * 0.5 + u / r;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    return {
      x: cx - hs + nx * r,
      y: cy + ny * r,
      nx,
      ny,
    };
  }

  getRimPoint(sRaw) {
    const s = wrapUnit(sRaw);
    const fIdx = s * RIM_COUNT;
    const i0 = Math.floor(fIdx) % RIM_COUNT;
    const i1 = (i0 + 1) % RIM_COUNT;
    const t = fIdx - Math.floor(fIdx);
    const n0 = this.rimNodes[i0];
    const n1 = this.rimNodes[i1];
    const disp = n0.disp * (1 - t) + n1.disp * t;
    const pt = this.pointAtPerimeter(s);
    return {
      x: pt.x + pt.nx * disp,
      y: pt.y + pt.ny * disp,
      nx: pt.nx,
      ny: pt.ny,
    };
  }

  getDeformedRimPoints() {
    const { cx, cy } = this.pill;
    const sc = this.pressScale;
    const pts = new Array(RIM_COUNT);
    for (let i = 0; i < RIM_COUNT; i++) {
      const n = this.rimNodes[i];
      const rx = n.bx + n.nx * n.disp;
      const ry = n.by + n.ny * n.disp;
      pts[i] = {
        x: cx + (rx - cx) * sc,
        y: cy + (ry - cy) * sc,
      };
    }
    return pts;
  }

  setPointer(x, y, insideStage = true) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.pointer.active) {
      this.pointer.prevX = x;
      this.pointer.prevY = y;
      for (const blob of this.cursorBlobs) {
        blob.x = x + blob.ox;
        blob.y = y + blob.oy;
        blob.vx = 0;
        blob.vy = 0;
      }
    }
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.insideStage = insideStage;
    this.pointer.active = insideStage;
  }

  setPointerDown(isDown) {
    this.pointer.isDown = Boolean(isDown);
  }

  leaveStage() {
    this.pointer.insideStage = false;
    this.pointer.active = false;
    this.pointer.isDown = false;
    for (const s of this.strands) {
      if (s.state === 'attached') {
        this._snapStrand(s);
      }
    }
    this.isStuck = false;
    this.wasNearPill = false;
  }

  triggerClickPulse() {
    this.pressScale = 0.962;
    this.pressVel = 0.36;
    for (let i = 0; i < RIM_COUNT; i++) {
      this.rimNodes[i].vel += (i % 2 === 0 ? 1 : -1) * 18;
    }
  }

  _createStrand(anchorS, role, spreadBias = 0) {
    const rim = this.getRimPoint(anchorS);
    const px = this.pointer.x;
    const py = this.pointer.y;
    const isPrimary = role === 'primary';
    const cursorOffsetX = rand(-11, 11);
    const cursorOffsetY = rand(-6, 15);
    const tx = px + cursorOffsetX;
    const ty = py + cursorOffsetY;

    const nodes = [];
    for (let i = 0; i < NODES_PER_STRAND; i++) {
      const t = i / (NODES_PER_STRAND - 1);
      const x = rim.x + (tx - rim.x) * t;
      const y = rim.y + (ty - rim.y) * t;
      nodes.push({ x, y, ox: x, oy: y });
    }

    const baseWidth = isPrimary ? rand(5.2, 7.6) : rand(2.0, 3.8);
    const breakLimit =
      this.config.breakDistance *
      (isPrimary ? rand(0.96, 1.18) : rand(0.76, 1.03));

    return {
      id: this._nextStrandId++,
      anchorS: wrapUnit(anchorS),
      role,
      baseWidth,
      breakLimit,
      cursorOffsetX,
      cursorOffsetY,
      curveBias: spreadBias || rand(-1, 1),
      state: 'attached',
      retractT: 0,
      retractDuration: rand(0.13, 0.21),
      stretchRatio: 0,
      nodes,
    };
  }

  _spawnInitialCluster(centerS) {
    const targetCount = clamp(Math.round(this.config.strandCount), 4, 11);
    const attached = this.strands.filter((s) => s.state === 'attached');
    const needed = targetCount - attached.length;
    if (needed <= 0) return;

    const halfArc = 0.085;
    for (let i = 0; i < needed; i++) {
      const frac = needed === 1 ? 0 : i / (needed - 1) - 0.5;
      const s = wrapUnit(centerS + frac * halfArc * 2 + rand(-0.008, 0.008));
      const role = i === 1 || i === needed - 2 || (needed >= 7 && i === Math.floor(needed / 2))
        ? 'primary'
        : 'fine';
      const strand = this._createStrand(s, role, frac * 2.1);
      this.strands.push(strand);
    }
  }

  _maybeSpawnSweepStrand(centerS) {
    const attached = this.strands.filter((s) => s.state === 'attached');
    const maxAllowed = clamp(Math.round(this.config.strandCount) + 2, 5, 13);
    if (attached.length >= maxAllowed) return;

    const candidateS = wrapUnit(centerS + rand(-0.032, 0.032));
    let nearestArc = 1;
    for (const s of attached) {
      const d = Math.abs(arcDelta(s.anchorS, candidateS));
      if (d < nearestArc) nearestArc = d;
    }

    if (nearestArc > 0.028 || attached.length < 3) {
      const role = attached.filter((s) => s.role === 'primary').length < 2 ? 'primary' : 'fine';
      this.strands.push(this._createStrand(candidateS, role, rand(-1.2, 1.2)));
    }
  }

  _snapStrand(strand) {
    if (strand.state !== 'attached') return;
    strand.state = 'retracting';
    strand.retractT = 0;

    // Spawn 1-3 droplets around pinch point (nodes 4..6)
    const count = strand.role === 'primary' ? 2 + (Math.random() < 0.55 ? 1 : 0) : (Math.random() < 0.72 ? 1 : 2);
    const idxMid = Math.floor(NODES_PER_STRAND * 0.62);
    const pinch = strand.nodes[idxMid];
    const prev = strand.nodes[idxMid - 1];
    const dirX = pinch.x - prev.x;
    const dirY = pinch.y - prev.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / dirLen;
    const uy = dirY / dirLen;

    for (let i = 0; i < count; i++) {
      const scatter = rand(-0.65, 0.65);
      const cosA = Math.cos(scatter);
      const sinA = Math.sin(scatter);
      const vxDir = ux * cosA - uy * sinA;
      const vyDir = ux * sinA + uy * cosA;
      const spd = rand(110, 310) + Math.min(this.pointer.speed * 0.35, 190);
      const radius = strand.role === 'primary' ? rand(3.0, 5.6) : rand(1.9, 3.9);
      const life = rand(0.28, 0.54);
      this.droplets.push({
        x: pinch.x + rand(-3, 3),
        y: pinch.y + rand(-3, 3),
        vx: vxDir * spd,
        vy: vyDir * spd,
        radius,
        maxRadius: radius,
        age: 0,
        life,
      });
    }

    // Give free tip a slight curl kick as it releases
    const tip = strand.nodes[NODES_PER_STRAND - 1];
    const perpX = -uy;
    const perpY = ux;
    const kick = (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 3.8);
    tip.ox = tip.x - perpX * kick;
    tip.oy = tip.y - perpY * kick;
  }

  _applyRimImpact(anchorS, strength) {
    const idxCenter = Math.round(wrapUnit(anchorS) * RIM_COUNT) % RIM_COUNT;
    const s = clamp(strength, 0.4, 1.5);
    for (let offset = -3; offset <= 3; offset++) {
      const idx = (idxCenter + offset + RIM_COUNT) % RIM_COUNT;
      if (offset === 0) {
        this.rimNodes[idx].vel -= 340 * s;
      } else if (Math.abs(offset) === 1) {
        this.rimNodes[idx].vel += 215 * s;
      } else if (Math.abs(offset) === 2) {
        this.rimNodes[idx].vel += 110 * s;
      } else {
        this.rimNodes[idx].vel -= 65 * s;
      }
    }

    // Spawn 1-2 brief rounded splash lobes to accent recoil
    const pt = this.pointAtPerimeter(anchorS);
    const baseAng = Math.atan2(pt.ny, pt.nx);
    const spikeCount = s > 0.9 ? 2 : 1;
    for (let i = 0; i < spikeCount; i++) {
      const angOffset = (i - (spikeCount - 1) * 0.5) * rand(0.28, 0.45);
      const ang = baseAng + angOffset;
      this.spikes.push({
        x: pt.x,
        y: pt.y,
        dx: Math.cos(ang),
        dy: Math.sin(ang),
        length: rand(7, 13) * s,
        width: rand(2.8, 4.4),
        age: 0,
        life: rand(0.14, 0.20),
      });
    }
  }

  step(rawDt) {
    const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0.016, 0.001, 0.025);
    const elasticity = clamp(this.config.elasticity, 0.4, 2.2);

    // 1. Pointer kinematics
    if (this.pointer.active) {
      const vx = (this.pointer.x - this.pointer.prevX) / dt;
      const vy = (this.pointer.y - this.pointer.prevY) / dt;
      this.pointer.vx = this.pointer.vx * 0.55 + vx * 0.45;
      this.pointer.vy = this.pointer.vy * 0.55 + vy * 0.45;
      this.pointer.speed = Math.hypot(this.pointer.vx, this.pointer.vy);
    } else {
      this.pointer.vx *= 0.85;
      this.pointer.vy *= 0.85;
      this.pointer.speed = Math.hypot(this.pointer.vx, this.pointer.vy);
    }
    this.pointer.prevX = this.pointer.x;
    this.pointer.prevY = this.pointer.y;

    // 2. Click press spring
    const pressForce = (1 - this.pressScale) * 280 - this.pressVel * 19;
    this.pressVel += pressForce * dt;
    this.pressScale = clamp(this.pressScale + this.pressVel * dt, 0.9, 1.05);

    // 3. Stickiness & strand spawning state
    const sdf = this.pillSDF(this.pointer.x, this.pointer.y);
    const nearPill = this.pointer.active && sdf.dist <= 8;

    if (nearPill) {
      this.isStuck = true;
      this.wasNearPill = true;
    }

    if (this.isStuck && this.pointer.active) {
      const pullDist = sdf.dist;
      const withinAttachRange = pullDist > -6 && pullDist < this.config.breakDistance * 0.92;
      if (withinAttachRange) {
        if (this.wasNearPill && this.strands.filter((s) => s.state === 'attached').length === 0) {
          this._spawnInitialCluster(sdf.s);
        } else {
          this._maybeSpawnSweepStrand(sdf.s);
        }
      }
    }

    // 4. Update strands (Verlet + constraints + snap)
    const drag = Math.pow(0.88, dt * 60);
    const gravity = 280;

    for (let i = this.strands.length - 1; i >= 0; i--) {
      const strand = this.strands[i];
      const rimPt = this.getRimPoint(strand.anchorS);
      const nodes = strand.nodes;

      // Pin anchor node to deformed rim
      nodes[0].x = rimPt.x;
      nodes[0].y = rimPt.y;
      nodes[0].ox = rimPt.x;
      nodes[0].oy = rimPt.y;

      if (strand.state === 'attached') {
        const tx = this.pointer.x + strand.cursorOffsetX;
        const ty = this.pointer.y + strand.cursorOffsetY;
        const chordDx = tx - rimPt.x;
        const chordDy = ty - rimPt.y;
        const chord = Math.hypot(chordDx, chordDy);
        strand.stretchRatio = clamp(chord / Math.max(strand.breakLimit, 1), 0, 1.5);

        // Pin cursor end
        const last = nodes[NODES_PER_STRAND - 1];
        last.x = tx;
        last.y = ty;
        last.ox = tx;
        last.oy = ty;

        // Lateral normal for viscous separation bow / catenary curve
        const invChord = chord > 1e-4 ? 1 / chord : 0;
        const perpX = -chordDy * invChord;
        const perpY = chordDx * invChord;

        for (let j = 1; j < NODES_PER_STRAND - 1; j++) {
          const n = nodes[j];
          const vx = clamp(n.x - n.ox, -24, 24) * drag;
          const vy = clamp(n.y - n.oy, -24, 24) * drag;
          n.ox = n.x;
          n.oy = n.y;
          const midFactor = Math.sin((j / (NODES_PER_STRAND - 1)) * Math.PI);
          const bowForce = strand.curveBias * 34 * midFactor * (1 - strand.stretchRatio * 0.45);
          n.x += vx + perpX * bowForce * dt * dt * 60;
          n.y += vy + (gravity * dt * dt) + perpY * bowForce * dt * dt * 60;
        }

        // Constraint relaxation: slight slack at moderate stretch for curving viscous filaments
        const slackFactor = 1.07 - clamp(strand.stretchRatio, 0, 1) * 0.09;
        const targetSegLen = Math.max(4, (chord * slackFactor) / (NODES_PER_STRAND - 1));
        for (let iter = 0; iter < 5; iter++) {
          nodes[0].x = rimPt.x;
          nodes[0].y = rimPt.y;
          last.x = tx;
          last.y = ty;
          for (let j = 0; j < NODES_PER_STRAND - 1; j++) {
            const a = nodes[j];
            const b = nodes[j + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1e-4;
            const diff = (d - targetSegLen) / d;
            if (j === 0) {
              b.x -= dx * diff;
              b.y -= dy * diff;
            } else if (j + 1 === NODES_PER_STRAND - 1) {
              a.x += dx * diff;
              a.y += dy * diff;
            } else {
              a.x += dx * diff * 0.5;
              a.y += dy * diff * 0.5;
              b.x -= dx * diff * 0.5;
              b.y -= dy * diff * 0.5;
            }
          }
        }

        // Prevent interior nodes from overshooting past anchor or cursor
        const maxSpan = Math.max(chord * 1.12, 20);
        for (let j = 1; j < NODES_PER_STRAND - 1; j++) {
          const n = nodes[j];
          const dx = n.x - rimPt.x;
          const dy = n.y - rimPt.y;
          const d = Math.hypot(dx, dy);
          if (d > maxSpan) {
            const scale = maxSpan / d;
            n.x = rimPt.x + dx * scale;
            n.y = rimPt.y + dy * scale;
          }
          n.ox = n.x - clamp(n.x - n.ox, -20, 20);
          n.oy = n.y - clamp(n.y - n.oy, -20, 20);
        }

        // Apply outward rim pull around anchor
        const pullMag = clamp(chord * 0.95 * (strand.role === 'primary' ? 1.2 : 0.72), 0, 180);
        const anchorIdx = Math.round(strand.anchorS * RIM_COUNT) % RIM_COUNT;
        const pullDot = chordDx * rimPt.nx + chordDy * rimPt.ny;
        const dirSign = pullDot >= -12 ? 1 : 0.35;
        for (let off = -3; off <= 3; off++) {
          const w = Math.exp(-(off * off) / 3.2);
          const idx = (anchorIdx + off + RIM_COUNT) % RIM_COUNT;
          this.rimNodes[idx].vel += pullMag * dirSign * w * dt * 7.5;
        }

        // Check break condition (distance + speed stress or severe opposite-side wrap)
        const speedStress = Math.min(this.pointer.speed * 0.04, 42);
        const crossBodyPenalty = pullDot < -28 ? 35 : 0;
        if (chord + speedStress + crossBodyPenalty > strand.breakLimit || !this.pointer.active) {
          this._snapStrand(strand);
        }
      } else {
        // Retracting strand: bounded damped spring retraction back to rimPt (never flings across pill)
        strand.retractT += dt / strand.retractDuration;
        const t = clamp(strand.retractT, 0, 1);
        const pullRate = 1 - Math.exp(-(14 + t * 24) * dt);

        for (let j = 1; j < NODES_PER_STRAND; j++) {
          const n = nodes[j];
          const target = nodes[j - 1];
          const nx = n.x + (target.x - n.x) * pullRate;
          const ny = n.y + (target.y - n.y) * pullRate;
          // Keep node distance from rimPt monotonically shrinking
          const prevDist = Math.hypot(n.x - rimPt.x, n.y - rimPt.y);
          const nextDist = Math.hypot(nx - rimPt.x, ny - rimPt.y);
          const capDist = Math.max(0, prevDist * (1 - t * 0.35));
          if (nextDist > capDist && nextDist > 1e-4) {
            const s = capDist / nextDist;
            n.x = rimPt.x + (nx - rimPt.x) * s;
            n.y = rimPt.y + (ny - rimPt.y) * s;
          } else {
            n.x = nx;
            n.y = ny;
          }
          n.ox = n.x;
          n.oy = n.y;
        }

        if (strand.retractT >= 1) {
          const strength = strand.role === 'primary' ? 1.0 : 0.6;
          this._applyRimImpact(strand.anchorS, strength);
          this.strands.splice(i, 1);
        }
      }
    }

    // 5. Attached count & cursor ink stain decay
    let attachedCount = 0;
    for (const s of this.strands) {
      if (s.state === 'attached') attachedCount++;
    }

    if (attachedCount === 0 && sdf.dist > 14) {
      this.isStuck = false;
      this.wasNearPill = false;
    }

    const targetStain =
      this.pointer.active && (nearPill || attachedCount > 0)
        ? clamp(0.45 + attachedCount * 0.14, 0, 1)
        : 0;
    const stainRate = targetStain > this.cursorStain ? 18 : 24;
    this.cursorStain += (targetStain - this.cursorStain) * Math.min(1, dt * stainRate);

    // 6. Elastic Rim Ring integration (spring-damper + circular neighbor coupling)
    const stiffness = 230 * elasticity;
    const coupling = 175 * elasticity;
    const rimDamping = 9.5;
    const nextAcc = new Float64Array(RIM_COUNT);

    for (let i = 0; i < RIM_COUNT; i++) {
      const prev = this.rimNodes[(i - 1 + RIM_COUNT) % RIM_COUNT];
      const curr = this.rimNodes[i];
      const next = this.rimNodes[(i + 1) % RIM_COUNT];
      const neighborForce = (prev.disp + next.disp - 2 * curr.disp) * coupling;
      nextAcc[i] = -stiffness * curr.disp + neighborForce - rimDamping * curr.vel;
    }

    for (let i = 0; i < RIM_COUNT; i++) {
      const n = this.rimNodes[i];
      n.vel += nextAcc[i] * dt;
      n.disp = clamp(n.disp + n.vel * dt, -14, 24);
    }

    // 7. Update droplets
    const dropDrag = Math.pow(0.935, dt * 60);
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.droplets.splice(i, 1);
        continue;
      }
      d.vx *= dropDrag;
      d.vy = d.vy * dropDrag + 260 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const lifeRatio = 1 - d.age / d.life;
      d.radius = d.maxRadius * Math.pow(lifeRatio, 0.55);
    }

    // 8. Update splash spikes
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const sp = this.spikes[i];
      sp.age += dt;
      if (sp.age >= sp.life) {
        this.spikes.splice(i, 1);
      }
    }

    // 9. Update cursor goo blobs
    for (const blob of this.cursorBlobs) {
      const tx = this.pointer.x + blob.ox;
      const ty = this.pointer.y + blob.oy;
      const ax = (tx - blob.x) * blob.k - blob.vx * blob.d;
      const ay = (ty - blob.y) * blob.k - blob.vy * blob.d;
      blob.vx += ax * dt;
      blob.vy += ay * dt;
      blob.x += blob.vx * dt;
      blob.y += blob.vy * dt;
    }
  }
}
