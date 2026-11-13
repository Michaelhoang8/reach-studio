import test from "node:test";
import assert from "node:assert/strict";
import {
  example,
  trap,
  analyze,
  validate,
  forward,
  mobility,
} from "../core.js";
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
test("forward kinematics and analytic two-link Jacobian agree", () => {
  const links = [{ length: 3 }, { length: 4 }],
    points = forward(links, [90, -90]);
  near(points[2].x, 4);
  near(points[2].y, 3);
  const j = mobility(points);
  near(j.columns[0][0], -3);
  near(j.columns[0][1], 4);
  near(j.columns[1][0], 0);
  near(j.columns[1][1], 4);
  near(j.areaFactor, 12);
  near(j.singularValues[0] ** 2 + j.singularValues[1] ** 2, 41);
  near(j.singularValues[0] * j.singularValues[1], 12);
  const straight = mobility(forward(links, [0, 0]));
  assert.equal(straight.condition, null);
  near(straight.singularValues[1], 0);
});
test("default target is reached and all recorded sweeps obey rigid lengths and joint limits", () => {
  const m = example(),
    copy = structuredClone(m),
    r = analyze(m);
  assert.deepEqual(m, copy);
  assert.equal(r.runs[r.best].status, "reached");
  for (const run of r.runs) {
    let error = Infinity;
    for (const s of run.snapshots) {
      assert.ok(s.error <= error + 1e-8);
      error = s.error;
      s.angles.forEach((a, i) =>
        assert.ok(a >= m.links[i].min && a <= m.links[i].max),
      );
      s.points
        .slice(1)
        .forEach((p, i) =>
          near(
            Math.hypot(p.x - s.points[i].x, p.y - s.points[i].y),
            m.links[i].length,
          ),
        );
    }
  }
});
test("a straight inward target reveals a plateau while alternate poses reach it", () => {
  const r = analyze(trap());
  assert.equal(r.runs[0].status, "plateau");
  near(r.runs[0].snapshots.at(-1).error, 100);
  assert.equal(r.radialReach.outside, false);
  assert.equal(r.runs[r.best].status, "reached");
});
test("radial impossibility is a bound, joint-limit plateaus are not infeasibility proofs", () => {
  const m = trap();
  m.target = { x: 300, y: 0 };
  let r = analyze(m);
  assert.equal(r.radialReach.outside, true);
  near(r.radialReach.errorLowerBound, 100);
  near(r.runs[0].snapshots.at(-1).error, 100);
  m.links[1].length = 20;
  m.target = { x: 0, y: 0 };
  r = analyze(m);
  near(r.radialReach.inner, 80);
  near(r.radialReach.errorLowerBound, 80);
  m.links = m.links.map((l) => ({ ...l, min: 0, max: 0 }));
  m.target = { x: 80, y: 20 };
  r = analyze(m);
  assert.equal(r.radialReach.outside, false);
  assert.ok(r.runs.every((x) => x.status === "plateau"));
});
test("300 random chains have monotone descent and Jacobians matching finite differences", () => {
  let seed = 71;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 300; trial++) {
    const count = 2 + Math.floor(rand() * 7),
      links = Array.from({ length: count }, () => {
        const min = -180 * rand(),
          max = 180 * rand();
        return {
          length: 5 + 95 * rand(),
          min,
          max,
          angle: min + (max - min) * rand(),
        };
      });
    const m = {
      ...example(),
      links,
      target: { x: 600 * rand() - 300, y: 600 * rand() - 300 },
      iterations: 40,
    };
    const r = analyze(m);
    for (const run of r.runs) {
      for (const u of run.updates) {
        assert.ok(u.errorAfter <= u.errorBefore + 1e-8);
        assert.ok(u.to >= links[u.joint].min && u.to <= links[u.joint].max);
      }
      let last = Infinity;
      for (const s of run.snapshots) {
        assert.ok(s.error <= last + 1e-8);
        last = s.error;
      }
    }
    const q = links.map((l) => l.angle),
      j = mobility(forward(links, q));
    for (let i = 0; i < count; i++) {
      const hi = [...q],
        lo = [...q],
        eps = 1e-6;
      hi[i] += (eps * 180) / Math.PI;
      lo[i] -= (eps * 180) / Math.PI;
      const a = forward(links, hi).at(-1),
        b = forward(links, lo).at(-1);
      near((a.x - b.x) / (2 * eps), j.columns[i][0], 1e-6);
      near((a.y - b.y) / (2 * eps), j.columns[i][1], 1e-6);
    }
  }
});
test("equivalent angle choices respect wide intervals and iteration limits stay explicit", () => {
  const m = example();
  m.iterations = 1;
  m.tolerance = 0.0001;
  const r = analyze(m);
  assert.ok(r.runs.some((x) => x.status === "iteration limit"));
  assert.ok(r.runs.every((x) => x.snapshots.length <= 2));
  for (const patch of [
    { links: [] },
    {
      links: [
        { length: 100, angle: 181, min: -180, max: 180 },
        { length: 20, angle: 0, min: 0, max: 0 },
      ],
    },
    { target: { x: NaN, y: 0 } },
    { target: { x: 801, y: 0 } },
    { iterations: 1.5 },
    { tolerance: 0 },
  ])
    assert.throws(() => validate({ ...m, ...patch }));
});
