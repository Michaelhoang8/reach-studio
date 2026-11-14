import { example, trap, validate } from "./core.js";
const $ = (id) => document.getElementById(id),
  worker = new Worker("./worker.js", { type: "module" });
let result = null,
  request = 0,
  ready = false,
  selected = 0,
  step = 0,
  timer = null,
  viewTransform = null;
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play solver replay");
}
function enable(value) {
  ready = value;
  $("use-pose").disabled = !value;
  for (const id of ["save", "evidence", "csv", "svg", "play", "step", "end"])
    $(id).disabled = !value;
  document.querySelector(".canvas-panel").classList.toggle("stale", !value);
}
function dirty() {
  request++;
  stop();
  enable(false);
  $("status").textContent = "Draft edited. Solve to apply the new arm.";
  $("error").textContent = "";
}
function field(id, label, value, min, max) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  Object.assign(input, {
    id,
    type: "number",
    value,
    min,
    max,
    step: "any",
    required: true,
  });
  input.oninput = dirty;
  wrap.append(input);
  return wrap;
}
function setStudy(m) {
  $("target-x").value = m.target.x;
  $("target-y").value = m.target.y;
  $("tolerance").value = m.tolerance;
  $("iterations").value = m.iterations;
  $("links").replaceChildren();
  $("limits").replaceChildren();
  m.links.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "link-row";
    const num = document.createElement("span");
    num.className = "link-number";
    num.textContent = String(i + 1).padStart(2, "0");
    row.append(
      num,
      field("length-" + i, "Length " + (i + 1), l.length, 5, 100),
      field("angle-" + i, "Start angle " + (i + 1), l.angle, -180, 180),
    );
    $("links").append(row);
    const limits = document.createElement("div");
    limits.className = "limit-row";
    const n = document.createElement("span");
    n.textContent = "J" + (i + 1);
    limits.append(
      n,
      field("min-" + i, "Minimum " + (i + 1), l.min, -180, 180),
      field("max-" + i, "Maximum " + (i + 1), l.max, -180, 180),
    );
    $("limits").append(limits);
  });
  $("add").disabled = m.links.length >= 8;
  $("remove").disabled = m.links.length <= 2;
}
function number(id) {
  if ($(id).value.trim() === "") throw Error("Fill in every numerical field.");
  return Number($(id).value);
}
function model() {
  const n = $("links").children.length;
  return validate({
    format: "reach-studio-v1",
    links: Array.from({ length: n }, (_, i) => ({
      length: number("length-" + i),
      angle: number("angle-" + i),
      min: number("min-" + i),
      max: number("max-" + i),
    })),
    target: { x: number("target-x"), y: number("target-y") },
    tolerance: number("tolerance"),
    iterations: number("iterations"),
  });
}
function run() {
  try {
    const m = model();
    stop();
    enable(false);
    $("error").textContent = "";
    $("status").textContent = "Comparing four starting poses…";
    worker.postMessage({ id: ++request, model: m });
  } catch (e) {
    enable(false);
    $("error").textContent = e.message;
    $("status").textContent = "Previous geometry is unchanged.";
  }
}
worker.onmessage = ({ data }) => {
  if (data.id !== request) return;
  if (data.error) {
    $("error").textContent = data.error;
    return;
  }
  result = data.result;
  selected = result.best;
  step = result.runs[selected].snapshots.length - 1;
  enable(true);
  $("status").textContent =
    result.runs.filter((r) => r.status === "reached").length +
    " of 4 starts reached tolerance.";
  renderRuns();
  render();
};
worker.onerror = () => {
  enable(false);
  $("error").textContent = "The solver worker stopped. Reload to restart it.";
};
function renderRuns() {
  const focusRun = document.activeElement?.dataset.run;
  $("runs").replaceChildren();
  result.runs.forEach((run, i) => {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", i === selected);
    b.dataset.run = i;
    const name = document.createElement("span");
    name.textContent =
      run.name + (i === result.best ? " · lowest final error" : "");
    const error = document.createElement("strong");
    error.textContent = run.snapshots.at(-1).error.toFixed(4) + " units";
    const meta = document.createElement("small");
    meta.textContent =
      run.status + " / " + (run.snapshots.length - 1) + " sweeps";
    const plot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    plot.setAttribute("viewBox", "0 0 240 46");
    plot.setAttribute("aria-hidden", "true");
    plot.classList.add("convergence");
    const maximum = Math.max(...run.snapshots.map((s) => s.error), 1e-12);
    const path = document.createElementNS(plot.namespaceURI, "polyline");
    path.setAttribute(
      "points",
      run.snapshots
        .map(
          (s, j) =>
            `${2 + (236 * j) / Math.max(1, run.snapshots.length - 1)},${42 - (38 * s.error) / maximum}`,
        )
        .join(" "),
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    plot.append(path);
    b.append(name, error, plot, meta);
    b.onclick = () => {
      stop();
      selected = i;
      step = run.snapshots.length - 1;
      renderRuns();
      render();
    };
    $("runs").append(b);
  });
  if (focusRun)
    document
      .querySelector(`[data-run="${focusRun}"]`)
      ?.focus({ preventScroll: true });
}
function render() {
  if (!result) return;
  const run = result.runs[selected],
    s = run.snapshots[step];
  $("run-label").textContent = run.name.toUpperCase();
  $("tip-error").textContent = s.error.toFixed(4);
  $("outcome").textContent =
    step === run.snapshots.length - 1 ? run.status : "in progress";
  $("iteration").textContent = step + " / " + (run.snapshots.length - 1);
  $("step").max = run.snapshots.length - 1;
  $("step").value = step;
  const reach = result.radialReach;
  $("reach-note").textContent = reach.outside
    ? "Outside the unconstrained radial reach. Minimum possible error ≥ " +
      reach.errorLowerBound.toFixed(3) +
      " units."
    : "Inside the unconstrained radial reach. Joint limits and local solver behavior may still prevent convergence.";
  const radius =
      Math.max(
        reach.outer,
        Math.abs(result.model.target.x),
        Math.abs(result.model.target.y),
        50,
      ) * 1.14,
    scale = 230 / radius,
    cx = 420,
    cy = 260;
  viewTransform = { radius, scale, cx, cy };
  const x = (v) => cx + v * scale,
    y = (v) => cy - v * scale;
  let svg =
    "<title>Arm pose at sweep " +
    step +
    ". Tip error " +
    s.error.toFixed(4) +
    ' units.</title><defs><linearGradient id="arm-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffdbac"/><stop offset=".48" stop-color="#f7ad68"/><stop offset="1" stop-color="#cb6b37"/></linearGradient></defs>';
  for (let i = -2; i <= 2; i++) {
    const offset = (i * radius) / 2;
    svg +=
      '<line x1="' +
      x(-radius) +
      '" y1="' +
      y(offset) +
      '" x2="' +
      x(radius) +
      '" y2="' +
      y(offset) +
      '" stroke="#293235"/><line x1="' +
      x(offset) +
      '" y1="' +
      y(-radius) +
      '" x2="' +
      x(offset) +
      '" y2="' +
      y(radius) +
      '" stroke="#293235"/>';
    if (i !== 0)
      svg +=
        '<text x="' +
        (x(offset) + 4) +
        '" y="' +
        (cy + 15) +
        '">' +
        offset.toFixed(0) +
        "</text>";
  }
  svg +=
    '<circle cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="' +
    reach.outer * scale +
    '" fill="none" stroke="#42504f" stroke-dasharray="3 5"/>';
  if (reach.inner > 0)
    svg +=
      '<circle cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      reach.inner * scale +
      '" fill="#242a2c" stroke="#42504f" stroke-dasharray="3 5"/>';
  const points = (ps) => ps.map((p) => x(p.x) + "," + y(p.y)).join(" ");
  svg +=
    '<polyline points="' +
    points(run.snapshots[0].points) +
    '" fill="none" stroke="#62706b" stroke-width="8" stroke-linecap="round" opacity=".2"/>';
  svg +=
    '<polyline points="' +
    points(run.snapshots.slice(0, step + 1).map((t) => t.points.at(-1))) +
    '" fill="none" stroke="#8c9a90" stroke-width="1.5" stroke-dasharray="2 4"/>';
  const tip = s.points.at(-1),
    target = result.model.target;
  if ($("show-mobility").checked) {
    const [major, minor] = s.mobility.singularValues,
      angle = (-s.mobility.orientationRadians * 180) / Math.PI;
    if (minor <= major * 1e-12) {
      const dx = 40 * Math.cos(s.mobility.orientationRadians),
        dy = -40 * Math.sin(s.mobility.orientationRadians);
      svg +=
        '<line x1="' +
        (x(tip.x) - dx) +
        '" y1="' +
        (y(tip.y) - dy) +
        '" x2="' +
        (x(tip.x) + dx) +
        '" y2="' +
        (y(tip.y) + dy) +
        '" stroke="#91bfad" stroke-width="1.2"/>';
    } else
      svg +=
        '<ellipse cx="' +
        x(tip.x) +
        '" cy="' +
        y(tip.y) +
        '" rx="40" ry="' +
        (major > 0 ? (40 * minor) / major : 0) +
        '" transform="rotate(' +
        angle +
        " " +
        x(tip.x) +
        " " +
        y(tip.y) +
        ')" fill="#91bfad22" stroke="#91bfad" stroke-width="1.2"/>';
  }
  svg +=
    '<line x1="' +
    x(tip.x) +
    '" y1="' +
    y(tip.y) +
    '" x2="' +
    x(target.x) +
    '" y2="' +
    y(target.y) +
    '" stroke="#bcb5a9" stroke-dasharray="3 4"/>';
  svg +=
    '<polyline class="arm" points="' +
    points(s.points) +
    '" fill="none" stroke="url(#arm-metal)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>';
  s.points.forEach((p, i) => {
    svg +=
      '<circle cx="' +
      x(p.x) +
      '" cy="' +
      y(p.y) +
      '" r="' +
      (i === 0 ? 10 : 6) +
      '" fill="#171b1d" stroke="#efa064" stroke-width="2"/>';
    if (i < s.angles.length)
      svg +=
        '<text x="' +
        (x(p.x) + 13) +
        '" y="' +
        (y(p.y) + 18) +
        '">J' +
        (i + 1) +
        "</text>";
  });
  svg +=
    '<circle cx="' +
    x(target.x) +
    '" cy="' +
    y(target.y) +
    '" r="11" class="target-ring" fill="none" stroke="#e5e7df" stroke-width="1.3"/><path d="M ' +
    (x(target.x) - 17) +
    " " +
    y(target.y) +
    " h 9 M " +
    (x(target.x) + 8) +
    " " +
    y(target.y) +
    " h 9 M " +
    x(target.x) +
    " " +
    (y(target.y) - 17) +
    " v 9 M " +
    x(target.x) +
    " " +
    (y(target.y) + 8) +
    ' v 9" stroke="#e5e7df"/><text x="' +
    (x(target.x) + 19) +
    '" y="' +
    (y(target.y) - 13) +
    '">' +
    target.x.toFixed(1) +
    ", " +
    target.y.toFixed(1) +
    '</text><text x="' +
    (cx + 13) +
    '" y="' +
    (cy - 13) +
    '">BASE / 0, 0</text>';
  $("scene").innerHTML = svg;
  $("joint-data").replaceChildren();
  s.angles.forEach((a, i) => {
    const row = document.createElement("tr");
    for (const v of [
      "J" + (i + 1),
      a.toFixed(3) + "°",
      ...s.mobility.columns[i].map((v) => v.toFixed(3)),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = v;
      row.append(cell);
    }
    $("joint-data").append(row);
  });
  $("mobility").textContent =
    "Singular values " +
    s.mobility.singularValues.map((v) => v.toFixed(3)).join(" / ") +
    ". Condition ratio " +
    (s.mobility.condition === null
      ? "singular or numerically singular"
      : s.mobility.condition.toFixed(3)) +
    ". Area factor " +
    s.mobility.areaFactor.toFixed(3) +
    ".";
}
function moveTarget(x, y) {
  try {
    model();
    $("target-x").value = Math.max(-800, Math.min(800, x)).toFixed(1);
    $("target-y").value = Math.max(-800, Math.min(800, y)).toFixed(1);
    run();
  } catch (e) {
    $("error").textContent = e.message;
  }
}
$("scene").onclick = (e) => {
  if (!viewTransform) return;
  const point = $("scene").createSVGPoint();
  point.x = e.clientX;
  point.y = e.clientY;
  const p = point.matrixTransform($("scene").getScreenCTM().inverse()),
    t = viewTransform;
  moveTarget((p.x - t.cx) / t.scale, (t.cy - p.y) / t.scale);
};
$("scene").onkeydown = (e) => {
  const delta = e.shiftKey ? 1 : 5,
    moves = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, delta],
      ArrowDown: [0, -delta],
    };
  if (moves[e.key]) {
    e.preventDefault();
    moveTarget(
      Number($("target-x").value) + moves[e.key][0],
      Number($("target-y").value) + moves[e.key][1],
    );
  }
};
$("controls").onsubmit = (e) => {
  e.preventDefault();
  run();
};
for (const id of ["target-x", "target-y", "tolerance", "iterations"])
  $(id).oninput = dirty;
for (const [id, fn] of [
  ["example", example],
  ["trap", trap],
])
  $(id).onclick = () => {
    setStudy(fn());
    run();
  };
for (const [id, add] of [
  ["add", true],
  ["remove", false],
])
  $(id).onclick = () => {
    try {
      const m = model();
      if (add && m.links.length < 8)
        m.links.push({ length: 40, angle: 20, min: -150, max: 150 });
      else if (!add && m.links.length > 2) m.links.pop();
      setStudy(m);
      dirty();
    } catch (e) {
      $("error").textContent = e.message;
    }
  };
$("show-mobility").onchange = render;
$("use-pose").onclick = () => {
  if (!ready) return;
  const m = structuredClone(result.model),
    pose = result.runs[selected].snapshots[step];
  m.links.forEach((link, i) => (link.angle = pose.angles[i]));
  setStudy(m);
  run();
};
$("step").oninput = () => {
  stop();
  step = Number($("step").value);
  render();
};
$("end").onclick = () => {
  stop();
  step = result.runs[selected].snapshots.length - 1;
  render();
};
$("play").onclick = () => {
  if (timer) {
    stop();
    return;
  }
  const end = result.runs[selected].snapshots.length - 1;
  if (step >= end) step = 0;
  render();
  if (end === 0) return;
  $("play").textContent = "Ⅱ";
  $("play").setAttribute("aria-label", "Pause solver replay");
  timer = setInterval(() => {
    if (step >= end) {
      stop();
      return;
    }
    step++;
    render();
  }, 180);
};
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => {
  if (ready)
    download("reach-studio-study.json", JSON.stringify(result.model, null, 2));
};
$("evidence").onclick = () => {
  if (ready)
    download(
      "reach-studio-evidence.json",
      JSON.stringify({ ...result, inspection: { selected, step } }, null, 2),
    );
};
$("csv").onclick = () => {
  if (ready)
    download(
      "reach-studio-replay.csv",
      "start,sweep,error,tip_x,tip_y," +
        result.model.links
          .map((_, i) => "joint_" + (i + 1) + "_degrees")
          .join(",") +
        "\n" +
        result.runs
          .flatMap((run) =>
            run.snapshots.map((s) =>
              [
                run.name,
                s.iteration,
                s.error,
                s.points.at(-1).x,
                s.points.at(-1).y,
                ...s.angles,
              ].join(","),
            ),
          )
          .join("\n") +
        "\n",
      "text/csv",
    );
};
$("svg").onclick = () => {
  if (ready)
    download(
      "reach-studio-drawing.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 520"><rect width="840" height="520" fill="#171b1d"/><style>text{font:10px Arial;fill:#9ba5a4}</style>' +
        $("scene").innerHTML +
        "</svg>",
      "image/svg+xml",
    );
};
$("open").onclick = () => $("file").click();
let fileSeq = 0;
$("file").onchange = async () => {
  const file = $("file").files[0],
    seq = ++fileSeq;
  $("file").value = "";
  if (!file) return;
  try {
    if (file.size > 50000) throw Error("Study files must be at most 50 KB.");
    const text = await file.text();
    if (seq !== fileSeq) return;
    setStudy(validate(JSON.parse(text)));
    run();
  } catch (e) {
    $("error").textContent = "Could not open study: " + e.message;
  }
};
setStudy(example());
run();
