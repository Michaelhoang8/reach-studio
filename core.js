const rad = Math.PI / 180;
const number = (x, a, b) =>
  typeof x === "number" && Number.isFinite(x) && x >= a && x <= b;
export function example() {
  return {
    format: "reach-studio-v1",
    links: [
      { length: 100, angle: 25, min: -150, max: 150 },
      { length: 80, angle: -40, min: -140, max: 140 },
      { length: 60, angle: 30, min: -120, max: 120 },
    ],
    target: { x: 120, y: 125 },
    tolerance: 0.05,
    iterations: 200,
  };
}
export function trap() {
  return {
    format: "reach-studio-v1",
    links: [
      { length: 100, angle: 0, min: -180, max: 180 },
      { length: 100, angle: 0, min: -180, max: 180 },
    ],
    target: { x: 100, y: 0 },
    tolerance: 0.01,
    iterations: 200,
  };
}
export function validate(raw) {
  if (
    !raw ||
    raw.format !== "reach-studio-v1" ||
    !Array.isArray(raw.links) ||
    raw.links.length < 2 ||
    raw.links.length > 8
  )
    throw Error("A study needs 2–8 links.");
  const links = raw.links.map((l, i) => {
    if (
      !l ||
      !number(l.length, 5, 100) ||
      !number(l.min, -180, 180) ||
      !number(l.max, l.min, 180) ||
      !number(l.angle, l.min, l.max)
    )
      throw Error(
        "Link " +
          (i + 1) +
          ": length must be 5–100, and its starting angle must lie within limits from −180° to 180°.",
      );
    return { length: l.length, angle: l.angle, min: l.min, max: l.max };
  });
  if (
    !raw.target ||
    !number(raw.target.x, -800, 800) ||
    !number(raw.target.y, -800, 800)
  )
    throw Error("Target coordinates must each be between −800 and 800.");
  if (!number(raw.tolerance, 0.0001, 5))
    throw Error("Tolerance must be between 0.0001 and 5 length units.");
  if (!Number.isInteger(raw.iterations) || !number(raw.iterations, 1, 500))
    throw Error("Use 1–500 sweeps.");
  return {
    format: raw.format,
    links,
    target: { x: raw.target.x, y: raw.target.y },
    tolerance: raw.tolerance,
    iterations: raw.iterations,
  };
}
export function forward(links, angles) {
  let angle = 0;
  const points = [{ x: 0, y: 0 }];
  for (let i = 0; i < links.length; i++) {
    angle += angles[i] * rad;
    const p = points.at(-1);
    points.push({
      x: p.x + links[i].length * Math.cos(angle),
      y: p.y + links[i].length * Math.sin(angle),
    });
  }
  return points;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function mobility(points) {
  const tip = points.at(-1),
    columns = points.slice(0, -1).map((p) => [-(tip.y - p.y), tip.x - p.x]);
  let xx = 0,
    xy = 0,
    yy = 0,
    det = 0;
  for (const [x, y] of columns) {
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  // Cauchy–Binet avoids cancellation near a singular straight arm.
  for (let i = 0; i < columns.length; i++)
    for (let j = i + 1; j < columns.length; j++)
      det +=
        (columns[i][0] * columns[j][1] - columns[i][1] * columns[j][0]) ** 2;
  const major2 = (xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2,
    minor2 = major2 > 0 ? det / major2 : 0;
  const major = Math.sqrt(major2),
    minor = Math.sqrt(Math.max(0, minor2));
  return {
    columns,
    gram: [
      [xx, xy],
      [xy, yy],
    ],
    singularValues: [major, minor],
    orientationRadians: 0.5 * Math.atan2(2 * xy, xx - yy),
    condition: minor <= major * 1e-12 ? null : major / minor,
    areaFactor: Math.sqrt(det),
  };
}
export function solve(model, start) {
  const angles = [...start],
    snapshots = [],
    updates = [];
  const snapshot = (iteration) => {
    const points = forward(model.links, angles);
    return {
      iteration,
      angles: [...angles],
      points,
      error: distance(points.at(-1), model.target),
      mobility: mobility(points),
    };
  };
  snapshots.push(snapshot(0));
  let status = "iteration limit",
    flat = 0;
  if (snapshots[0].error <= model.tolerance)
    return { start: [...start], status: "reached", snapshots, updates };
  for (let iteration = 1; iteration <= model.iterations; iteration++) {
    for (let joint = angles.length - 1; joint >= 0; joint--) {
      const points = forward(model.links, angles),
        pivot = points[joint],
        tip = points.at(-1),
        vx = tip.x - pivot.x,
        vy = tip.y - pivot.y,
        tx = model.target.x - pivot.x,
        ty = model.target.y - pivot.y;
      if (Math.hypot(vx, vy) < 1e-12 || Math.hypot(tx, ty) < 1e-12) continue;
      const delta = Math.atan2(vx * ty - vy * tx, vx * tx + vy * ty) / rad,
        old = angles[joint],
        link = model.links[joint];
      let chosen = old,
        best = distance(tip, model.target);
      const before = best;
      // Check equivalent optima and both endpoints of the closed joint interval.
      const candidates = [
        link.min,
        link.max,
        ...[-1, 0, 1].map((k) =>
          Math.max(link.min, Math.min(link.max, old + delta + 360 * k)),
        ),
      ];
      for (const candidate of candidates) {
        const theta = (candidate - old) * rad,
          c = Math.cos(theta),
          s = Math.sin(theta),
          endpoint = {
            x: pivot.x + c * vx - s * vy,
            y: pivot.y + s * vx + c * vy,
          };
        const error = distance(endpoint, model.target);
        if (error < best - 1e-12) {
          best = error;
          chosen = candidate;
        }
      }
      angles[joint] = chosen;
      if (chosen !== old)
        updates.push({
          iteration,
          joint,
          from: old,
          to: chosen,
          boundary: chosen === link.min || chosen === link.max,
          errorBefore: before,
          errorAfter: best,
        });
    }
    const next = snapshot(iteration),
      previous = snapshots.at(-1);
    snapshots.push(next);
    if (next.error <= model.tolerance) {
      status = "reached";
      break;
    }
    if (previous.error - next.error <= 1e-10) flat++;
    else flat = 0;
    if (flat === 10) {
      status = "plateau";
      break;
    }
  }
  return { start: [...start], status, snapshots, updates };
}
export function analyze(raw) {
  const model = validate(raw),
    starts = [
      ["Your pose", model.links.map((l) => l.angle)],
      ["Midpoints", model.links.map((l) => (l.min + l.max) / 2)],
      [
        "Alternating",
        model.links.map(
          (l, i) => l.min + (l.max - l.min) * (i % 2 ? 0.75 : 0.25),
        ),
      ],
      [
        "Reverse alternating",
        model.links.map(
          (l, i) => l.min + (l.max - l.min) * (i % 2 ? 0.25 : 0.75),
        ),
      ],
    ];
  const runs = starts.map(([name, start]) => ({
    name,
    ...solve(model, start),
  }));
  let best = 0;
  for (let i = 1; i < runs.length; i++)
    if (runs[i].snapshots.at(-1).error < runs[best].snapshots.at(-1).error)
      best = i;
  const outer = model.links.reduce((s, l) => s + l.length, 0),
    inner = Math.max(
      0,
      2 * Math.max(...model.links.map((l) => l.length)) - outer,
    ),
    radius = Math.hypot(model.target.x, model.target.y);
  return {
    format: "reach-studio-evidence-v1",
    model,
    runs,
    best,
    radialReach: {
      inner,
      outer,
      radius,
      outside: radius < inner - 1e-10 || radius > outer + 1e-10,
      errorLowerBound: Math.max(0, inner - radius, radius - outer),
    },
  };
}
