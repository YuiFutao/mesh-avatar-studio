/** @param {ReturnType<import('./rig.js').createRig>} engine
 * @param {import('../rig/types').Rig} rig */
export function createPhysics(engine, rig) {
  const { applyHead, applyBody, TASSELS, tasselAnchor } = engine;
  const STRANDS = (rig.strands ?? []).map(strand => {
    if (strand.nodes.length === 4) return strand;
    const nodes = Array.from({ length: 4 }, (_, i) => {
      const f = i / 3 * (strand.nodes.length - 1);
      const k = Math.min(strand.nodes.length - 2, Math.floor(f));
      const t = f - k;
      return [0, 1].map(axis => strand.nodes[k][axis] + (strand.nodes[k + 1][axis] - strand.nodes[k][axis]) * t);
    });
    return { ...strand, nodes };
  });
  // Secondary motion: spring chains for hair strands, spring-mass points for the buns
  // and 2-segment verlet chains for tassels.


  // Strand chain tuning: stiffness per node (root .. tip), how much of the parent's lag each
  // node inherits (this is what makes a swing travel down the strand), and damping.
  const STRAND_K = [0, 300, 200, 140], STRAND_COUPLE = 0.9, STRAND_DAMP = 7;

  // Overall hair feel, tuned against measured runs (see README). Once motions made the head
  // move ~4x faster, the chains whipped and neighbouring strands split apart by up to 16px,
  // which smeared the hair between them.
  //   stiff / damp / couple: scale the chain springs, damping and the root-to-tip lag
  //   reach:   soft limit of the tip offset, as a share of each strand's `max`
  //   bind:    smoothing passes across the fringe strands (more = moves more as one sheet)
  const HAIR_TUNE = { stiff: 1.7, damp: 1.6, couple: 0.85, reach: 0.9, bind: 4 };
  const FRINGE = Math.min(6, STRANDS.filter(s => s.name.startsWith('bang')).length);

  // Tassel pendulum: swing frequency (Hz), damping ratio, how much head tilt it counters,
  // how strongly knot acceleration pushes it, gentle wind (rad), limit (rad), accel smoothing (1/s)
  const TASSEL_TUNE = { freq: 0.7, zeta: 0.22, hang: 0.85, inertia: 0.32, wind: 0.03, max: 0.55, smooth: 6 };
  const rotV = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];   // STRANDS[0..5] are the fringe, 6 and 7 the side locks
  const softLimit = (v, m) => { const l = Math.hypot(v[0], v[1]); if (l < 1e-6) return v; const k = m * Math.tanh(l / m) / l; return [v[0] * k, v[1] * k]; };

  const HAIR = Object.fromEntries(Object.entries(rig.buns ?? {}).map(([key, area]) => [key, { at: [area.cx, area.cy], k: 260, c: 11, hang: 3, max: 4 }]));

  const clampLen = (v, m) => { const l = Math.hypot(v[0], v[1]); if (l > m) { v[0] *= m / l; v[1] *= m / l; } };

  class Physics {
    constructor() {
      this.gain = 1;          // "sway gain"
      this.out = { gain: 1, bunL: [0, 0], bunR: [0, 0], rollRegions: [], rigidRegions: [] };
      this.hair = {};
      for (const k of Object.keys(HAIR)) {
        this.hair[k] = { p: null, v: [0, 0] };
        this.out[k] = [0, 0];
      }
      this.strands = STRANDS.map(() => ({ p: null, v: [[0, 0], [0, 0], [0, 0], [0, 0]] }));
      this.out.strands = STRANDS.map(() => [[0, 0], [0, 0], [0, 0], [0, 0]]);
      this.chains = TASSELS.map(t => {
        const dx = t.tip[0] - t.pivot[0], dy = t.tip[1] - t.pivot[1], L = Math.hypot(dx, dy);
        const dir = [dx / L, dy / L];
        return { t, dir, L1: L * t.split, L2: L * (1 - t.split), pts: /** @type {number[][] | null} */ (null), prev: null, phi: [0, 0], anchor: [0, 0] };
      });
      this.time = 0;
      // One shared clock: two enabled ears still produce only one gesture per interval.
      this.twitchEars = this.chains.filter(ch => ch.t.twitch && ch.t.pendulum?.mode === 'upright');
      this.twitch = null;
      if (this.twitchEars.length) this.scheduleTwitch(0);
      this.rollRegions = (rig.head.rollRegions ?? []).map(region => region.swing
        ? { angle: null, velocity: 0, anchor: null, anchorVelocity: 0, acceleration: 0 } : null);
      this.out.rollRegions = this.rollRegions.map(() => 0);
      this.rigidRegions = (rig.head.rigidRegions ?? []).map(region => region.sway
        ? { angle: null, velocity: 0, anchor: null, anchorVelocity: [0, 0], acceleration: [0, 0] } : null);
      this.out.rigidRegions = this.rigidRegions.map(() => 0);
    }

    hairAnchor(at, P) {
      const p = [at[0], at[1]];
      applyHead(p, 1, P);
      applyBody(p, at[1], P);
      return p;
    }

    scheduleTwitch(time) {
      const ear = this.twitchEars[Math.floor(Math.random() * this.twitchEars.length)];
      const [min, max] = ear.t.twitch.interval;
      this.twitch = { time, next: time + min + Math.random() * (max - min), ear, active: null, start: 0 };
    }

    stepTwitch(dt) {
      const state = this.twitch;
      if (!state) return;
      // Pauses do not queue gestures or leave a partially rotated ear behind.
      if (dt <= 0 || dt > .25) { state.active = null; return; }
      state.time += dt;
      if (state.time >= state.next) {
        const ear = state.ear, start = state.next;
        this.scheduleTwitch(start);
        this.twitch.time = state.time;
        this.twitch.active = ear;
        this.twitch.start = start;
      }
      if (this.twitch.time - this.twitch.start >= .53) this.twitch.active = null;
    }

    triggerTwitch() {
      if (!this.twitch) return;
      const { ear, time } = this.twitch;
      this.scheduleTwitch(time);
      this.twitch.active = ear;
      this.twitch.start = time;
    }

    twitchAngle(ch) {
      const state = this.twitch;
      if (!state || state.active !== ch) return 0;
      const age = state.time - state.start;
      const pulse = (t, strength) => t >= 0 && t < .22 ? strength * Math.sin(Math.PI * t / .22) ** 2 : 0;
      return ch.t.twitch.angle * (pulse(age, 1) + pulse(age - .31, .72));
    }

    uprightStep(ch, P, dt) {
      const cfg = ch.t.pendulum, A = tasselAnchor(ch.t, P, this.out, [0, 0]);
      const reference = engine.attachmentAngle(ch.t, P), duration = Math.min(Math.max(dt, 0), 0.1);
      if (!ch.upright || dt <= 0 || dt > 0.25) ch.upright = { th: [reference, reference], w: [0, 0], pos: [...A], vel: [0, 0], acc: [0, 0] };
      const st = ch.upright, length = ch.L1 + ch.L2;
      const nrm = rotV([-ch.dir[1], ch.dir[0]], reference);
      if (duration > 0 && dt <= 0.25) {
        for (let axis = 0; axis < 2; axis++) {
          const velocity = (A[axis] - st.pos[axis]) / duration;
          const acceleration = Math.max(-length * 10, Math.min(length * 10, (velocity - st.vel[axis]) / duration));
          st.acc[axis] += (acceleration - st.acc[axis]) * (1 - Math.exp(-duration * 8));
          st.vel[axis] = velocity;
        }
        const push = -(st.acc[0] * nrm[0] + st.acc[1] * nrm[1]) / length * cfg.inertia;
        const w1 = 2 * Math.PI * cfg.frequency, w2 = w1 * 1.35, steps = Math.max(1, Math.ceil(duration * 240)), h = duration / steps;
        for (let i = 0; i < steps; i++) {
          const a1 = w1 * w1 * (reference - st.th[0]) - 2 * cfg.damping * w1 * st.w[0] + push;
          st.w[0] += a1 * h; st.th[0] += st.w[0] * h;
          const a2 = w2 * w2 * (st.th[0] - st.th[1]) - 2 * cfg.damping * w2 * st.w[1] + push * .4 + a1 * .35;
          st.w[1] += a2 * h; st.th[1] += st.w[1] * h;
          for (const [j, center, cap] of [[0, reference, cfg.maxAngle], [1, st.th[0], cfg.maxBend]]) {
            const offset = st.th[j] - center;
            if (Math.abs(offset) > cap) { st.th[j] = center + Math.sign(offset) * cap; if (st.w[j] * offset > 0) st.w[j] = 0; }
          }
        }
      }
      st.pos = [...A];
      const cap = (value, limit) => Math.max(-limit, Math.min(limit, value));
      // Rotate both joints together; the existing spring still provides the only bend.
      const first = reference + cap((st.th[0] - reference + this.twitchAngle(ch)) * this.gain, cfg.maxAngle);
      const second = first + cap((st.th[1] - st.th[0]) * this.gain, cfg.maxBend);
      ch.phi = [first, second];
      const d1 = rotV(ch.dir, first), d2 = rotV(ch.dir, second);
      const p1 = [A[0] + d1[0] * ch.L1, A[1] + d1[1] * ch.L1];
      ch.pts = [[...A], p1, [p1[0] + d2[0] * ch.L2, p1[1] + d2[1] * ch.L2]];
      ch.anchor = A;
    }

    step(P, dt, elapsed = dt) {
      this.stepTwitch(elapsed);
      const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = Math.min(dt, 0.05) / sub;
      const roll = -P.angleZ / 30 * rig.head.maxRoll - P.bodyAngleZ / 10 * rig.body.maxRoll;
      const g = this.gain;

      // A whole long lock hangs from its attachment, rather than relying on
      // small, independently capped vertex offsets to cancel head rotation.
      this.rollRegions.forEach((state, i) => {
        if (!state) return;
        const cfg = rig.head.rollRegions[i].swing;
        const anchor = this.hairAnchor(cfg.pivot, P), duration = Math.min(dt, 0.05);
        const target = roll * (1 - cfg.gravity);
        if (state.angle === null) state.angle = target;
        if (duration > 0) {
          const velocity = state.anchor ? (anchor[0] - state.anchor[0]) / duration : 0;
          const acceleration = state.anchor ? (velocity - state.anchorVelocity) / duration : 0;
          const limit = cfg.length * 8;
          state.acceleration += (Math.max(-limit, Math.min(limit, acceleration)) - state.acceleration) * (1 - Math.exp(-duration * 12));
          state.anchorVelocity = velocity;
          const omega = 2 * Math.PI * cfg.frequency;
          for (let j = 0; j < sub; j++) {
            state.velocity += (omega * omega * (target - state.angle)
              - 2 * cfg.damping * omega * state.velocity - state.acceleration / cfg.length * 0.35) * h;
            state.angle += state.velocity * h;
            const offset = state.angle - roll;
            if (Math.abs(offset) > cfg.maxAngle) {
              state.angle = roll + Math.sign(offset) * cfg.maxAngle;
              if (state.velocity * offset > 0) state.velocity = 0;
            }
          }
        }
        if (duration > 0 || !state.anchor) state.anchor = anchor;
        this.out.rollRegions[i] = Math.max(-cfg.maxAngle, Math.min(cfg.maxAngle, state.angle - roll)) * g;
      });

      STRANDS.forEach((cfg, si) => {
        const st = this.strands[si], out = this.out.strands[si];
        const target = cfg.nodes.map(n => this.hairAnchor(n, P));
        if (!st.p) st.p = target.map(t => [...t]);
        const phase = si * 1.7;
        for (let i = 0; i < sub; i++) {
          const t = this.time + i * h;
          for (let j = 1; j < 4; j++) {
            // hanging hair stays vertical when the head rolls (grows with distance from the root)
            const hang = Math.hypot(cfg.nodes[j][0] - cfg.nodes[0][0], cfg.nodes[j][1] - cfg.nodes[0][1]);
            // mostly one shared breeze, with a little per-strand flutter
            const wind = (Math.sin(t * 1.3) * 0.5 + Math.sin(t * 3.1) * 0.3 + Math.sin(t * 4.7 + phase) * 0.2) * cfg.max * 0.1 * j / 3;
            const parent = [st.p[j - 1][0] - target[j - 1][0], st.p[j - 1][1] - target[j - 1][1]];
            const tx = target[j][0] + parent[0] * STRAND_COUPLE * HAIR_TUNE.couple - Math.sin(roll) * hang * 0.12 + wind;
            const ty = target[j][1] + parent[1] * STRAND_COUPLE * HAIR_TUNE.couple;
            const k = STRAND_K[j] * cfg.k * HAIR_TUNE.stiff / Math.max(0.35, g), c = STRAND_DAMP * HAIR_TUNE.damp * Math.sqrt(HAIR_TUNE.stiff) / Math.max(0.5, Math.sqrt(g));
            const v = st.v[j], q = st.p[j];
            v[0] += (k * (tx - q[0]) - c * v[0]) * h;
            v[1] += (k * (ty - q[1]) - c * v[1]) * h;
            q[0] += v[0] * h; q[1] += v[1] * h;
          }
          st.p[0] = [...target[0]];
        }
        for (let j = 0; j < 4; j++) {
          const o = [st.p[j][0] - target[j][0], st.p[j][1] - target[j][1]];
          out[j] = softLimit(o, Math.max(0.5, cfg.max * HAIR_TUNE.reach * Math.max(1, g) * j / 3));
        }
      });

      for (const [k, cfg] of Object.entries(HAIR)) {
        const s = this.hair[k];
        const a = this.hairAnchor(cfg.at, P);
        // hanging hair keeps pointing down when the head rolls; plus a light breeze
        const wind = Math.sin(this.time * 1.3 + cfg.at[0] * 0.01) * 0.6 + Math.sin(this.time * 2.9 + cfg.at[1] * 0.02) * 0.4;
        const tx = a[0] - Math.sin(roll) * cfg.hang + wind * cfg.max * 0.12;
        const ty = a[1];
        if (!s.p) s.p = [tx, ty];
        const k2 = cfg.k / Math.max(0.35, g), c2 = cfg.c / Math.max(0.5, Math.sqrt(g));
        for (let i = 0; i < sub; i++) {
          s.v[0] += (k2 * (tx - s.p[0]) - c2 * s.v[0]) * h;
          s.v[1] += (k2 * (ty - s.p[1]) - c2 * s.v[1]) * h;
          s.p[0] += s.v[0] * h; s.p[1] += s.v[1] * h;
        }
        const o = [s.p[0] - a[0], s.p[1] - a[1]];
        clampLen(o, cfg.max * Math.max(1, g));
        this.out[k] = o;
      }
      this.out.gain = 1;

      // pull each fringe strand towards the average of its neighbours so the fringe moves
      // as one sheet with a little variation, instead of strands splitting apart
      const O = this.out.strands;
      for (let pass = 0; pass < HAIR_TUNE.bind; pass++) for (let j = 1; j < 4; j++) {
        const snap = O.slice(0, FRINGE).map(o => [...o[j]]);
        for (let i = 0; i < FRINGE; i++) {
          const l = snap[Math.max(0, i - 1)], r = snap[Math.min(FRINGE - 1, i + 1)];
          for (const a of [0, 1]) O[i][j][a] = snap[i][a] * 0.5 + (l[a] + r[a]) * 0.25;
        }
      }

      // Tassels: a two-joint angular pendulum. The old verlet chain was pulled back to its
      // drawn shape every substep, which made it buzz (~10 direction changes/s, 1deg swing).
      // Here each joint is a slow damped spring (~0.7 Hz) driven by the smoothed acceleration
      // of the knot, so it swings in long arcs and lags behind the head like the hair does.
      // Pointed ears keep their shape. Only a bounded rotation about the scalp
      // attachment lags behind head rotation and translation; no idle wind.
      this.rigidRegions.forEach((state, i) => {
        if (!state) return;
        const region = rig.head.rigidRegions[i], cfg = region.sway;
        const frame = engine.rigidFrame(i, P, this.out);
        const duration = Math.min(Math.max(dt, 0), 0.1);
        if (state.angle === null || dt <= 0 || dt > 0.25) {
          state.angle = frame.angle; state.velocity = 0;
          state.anchor = frame.anchor; state.anchorVelocity = [0, 0]; state.acceleration = [0, 0];
          this.out.rigidRegions[i] = 0;
          return;
        }
        const dx = cfg.tip[0] - region.anchor[0], dy = cfg.tip[1] - region.anchor[1];
        const length = Math.hypot(dx, dy), tangent = rotV([-dy / length, dx / length], frame.angle);
        for (let axis = 0; axis < 2; axis++) {
          const velocity = (frame.anchor[axis] - state.anchor[axis]) / duration;
          const acceleration = (velocity - state.anchorVelocity[axis]) / duration;
          const limit = length * 10;
          state.acceleration[axis] += (Math.max(-limit, Math.min(limit, acceleration)) - state.acceleration[axis]) * (1 - Math.exp(-duration * 12));
          state.anchorVelocity[axis] = velocity;
        }
        state.anchor = frame.anchor;
        const push = -(state.acceleration[0] * tangent[0] + state.acceleration[1] * tangent[1]) / length * cfg.inertia;
        const omega = 2 * Math.PI * cfg.frequency, steps = Math.max(1, Math.ceil(duration * 240)), step = duration / steps;
        for (let j = 0; j < steps; j++) {
          state.velocity += (omega * omega * (frame.angle - state.angle) - 2 * cfg.damping * omega * state.velocity + push) * step;
          state.angle += state.velocity * step;
          const offset = state.angle - frame.angle;
          if (Math.abs(offset) > cfg.maxAngle) {
            state.angle = frame.angle + Math.sign(offset) * cfg.maxAngle;
            if (state.velocity * offset > 0) state.velocity = 0;
          }
        }
        this.out.rigidRegions[i] = Math.max(-cfg.maxAngle, Math.min(cfg.maxAngle, (state.angle - frame.angle) * cfg.lag * g));
      });

      for (const ch of this.chains) {
        if (ch.t.pendulum?.mode === 'upright') { this.uprightStep(ch, P, dt); continue; }
        const A = tasselAnchor(ch.t, P, this.out, [0, 0]);
        if (!ch.st) ch.st = { th: [0, 0], w: [0, 0], pos: [...A], vel: [0, 0], acc: [0, 0] };
        const st = ch.st, T = TASSEL_TUNE;
        // knot velocity / acceleration, low-passed so spring overshoot of the head doesn't jitter it
        const vel = [(A[0] - st.pos[0]) / Math.max(dt, 1e-3), (A[1] - st.pos[1]) / Math.max(dt, 1e-3)];
        const kf = 1 - Math.exp(-dt * T.smooth);
        const acc = [(vel[0] - st.vel[0]) / Math.max(dt, 1e-3), (vel[1] - st.vel[1]) / Math.max(dt, 1e-3)];
        st.acc = [st.acc[0] + (acc[0] - st.acc[0]) * kf, st.acc[1] + (acc[1] - st.acc[1]) * kf];
        st.vel = [st.vel[0] + (vel[0] - st.vel[0]) * kf, st.vel[1] + (vel[1] - st.vel[1]) * kf];
        st.pos = [...A];
        // perpendicular to the hanging direction: pushes the pendulum sideways
        const nrm = [-ch.dir[1], ch.dir[0]];
        const push = -(st.acc[0] * nrm[0] + st.acc[1] * nrm[1]) / (ch.L1 + ch.L2) * T.inertia;
        const wind = (Math.sin(this.time * 0.9 + ch.t.pivot[0]) * 0.6 + Math.sin(this.time * 0.37 + ch.t.pivot[1]) * 0.4) * T.wind;
        const target = -roll * T.hang + wind;          // keeps hanging down when the head tilts
        const w1 = 2 * Math.PI * T.freq / Math.sqrt(Math.max(0.4, g)), w2 = w1 * 1.35;
        for (let i = 0; i < sub; i++) {
          const a1 = -w1 * w1 * (st.th[0] - target) - 2 * T.zeta * w1 * st.w[0] + push;
          st.w[0] += a1 * h; st.th[0] += st.w[0] * h;
          // the lower half follows the upper one with its own lag (a soft whip at the tip)
          const a2 = -w2 * w2 * (st.th[1] - st.th[0]) - 2 * T.zeta * w2 * st.w[1] + push * 0.4 + a1 * 0.5;
          st.w[1] += a2 * h; st.th[1] += st.w[1] * h;
        }
        st.th[0] = Math.max(-T.max, Math.min(T.max, st.th[0]));
        st.th[1] = Math.max(-T.max * 1.4, Math.min(T.max * 1.4, st.th[1]));
        ch.phi = [st.th[0], st.th[1]];
        // joint positions for skinning and the debug overlay
        const d1 = rotV(ch.dir, st.th[0]), d2 = rotV(ch.dir, st.th[1]);
        const p1 = [A[0] + d1[0] * ch.L1, A[1] + d1[1] * ch.L1];
        ch.pts = [[...A], p1, [p1[0] + d2[0] * ch.L2, p1[1] + d2[1] * ch.L2]];
        ch.anchor = A;
      }
      this.time += dt;
      return this.out;
    }
  }

  return { Physics };
}
