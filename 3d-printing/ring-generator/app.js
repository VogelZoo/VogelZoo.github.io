import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/exporters/STLExporter.js";

const sizeInput = document.getElementById("size");
const widthInput = document.getElementById("width");
const thicknessInput = document.getElementById("thickness");
const comfortInput = document.getElementById("comfort");
const bevelInput = document.getElementById("bevel");
const comfortLabel = document.getElementById("comfortfitLabel");
const bevelLabel = document.getElementById("bevelsizeLabel");
const exportBtn = document.getElementById("exportBtn");
const canvas = document.getElementById("profile2d");
const ctx = canvas.getContext("2d");
const renderContainer = document.getElementById("render3d");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const controls = new OrbitControls(camera, renderer.domElement);
let mesh = null;

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0xffffff, 1);
renderContainer.appendChild(renderer.domElement);

camera.position.set(0, -40, 15);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 20;
controls.maxDistance = 120;
controls.update();

window.addEventListener("resize", resizeRenderer);
resizeRenderer();

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(10, 10, 10);
scene.add(light);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createProfile({ size, width, thickness, comfort, bevel }) {
  const innerDiameter = 11.63 + 0.8128 * size;
  const innerRadius = innerDiameter / 2;
  const outerRadius = innerRadius + thickness;
  const halfWidth = width / 2;
  const bevelRadius = Math.min(bevel, thickness * 0.49, width * 0.49);
  const comfortDepth = thickness * comfort;
  const points = [];

  points.push(new THREE.Vector2(outerRadius - bevelRadius, -halfWidth));
  points.push(new THREE.Vector2(outerRadius, -halfWidth + bevelRadius));

  const outerSteps = 20;
  for (let i = 0; i <= outerSteps; i += 1) {
    const t = i / outerSteps;
    const z = -halfWidth + bevelRadius + t * (width - 2 * bevelRadius);
    points.push(new THREE.Vector2(outerRadius, z));
  }

  points.push(new THREE.Vector2(outerRadius, halfWidth - bevelRadius));
  points.push(new THREE.Vector2(outerRadius - bevelRadius, halfWidth));

  const innerSteps = 60;
  for (let i = 0; i <= innerSteps; i += 1) {
    const t = i / innerSteps;
    const z = halfWidth - t * width;
    const normalized = z / halfWidth;
    const dome = comfortDepth * (1 - Math.cos((normalized * Math.PI) / 2));
    points.push(new THREE.Vector2(innerRadius + dome, z));
  }

  points.push(new THREE.Vector2(outerRadius - bevelRadius, -halfWidth));
  return points;
}

function drawProfile(profile) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(150, 300);
  ctx.scale(10, -10);

  drawGrid();
  drawAxes();
  drawTicks();

  ctx.beginPath();
  profile.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });

  for (let i = profile.length - 1; i >= 0; i -= 1) {
    const point = profile[i];
    ctx.lineTo(-point.x, point.y);
  }

  ctx.closePath();
  ctx.fillStyle = "rgba(107, 114, 128, 0.25)";
  ctx.fill();
  ctx.strokeStyle = "black";
  ctx.lineWidth = 0.1;
  ctx.stroke();
  ctx.restore();
}

function drawGrid() {
  ctx.beginPath();
  for (let x = -20; x <= 20; x += 1) {
    ctx.moveTo(x, -20);
    ctx.lineTo(x, 20);
  }
  for (let y = -20; y <= 20; y += 1) {
    ctx.moveTo(-20, y);
    ctx.lineTo(20, y);
  }
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 0.02;
  ctx.stroke();
}

function drawAxes() {
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(20, 0);
  ctx.moveTo(0, -20);
  ctx.lineTo(0, 20);
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 0.07;
  ctx.stroke();
}

function drawTicks() {
  ctx.fillStyle = "#374151";
  ctx.font = "0.9px Inter, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let x = -20; x <= 20; x += 5) {
    if (x === 0) continue;
    ctx.beginPath();
    ctx.moveTo(x, -0.5);
    ctx.lineTo(x, 0.5);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.06;
    ctx.stroke();
    ctx.fillText(String(x), x, 0.7);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = -20; y <= 20; y += 5) {
    if (y === 0) continue;
    ctx.beginPath();
    ctx.moveTo(-0.5, y);
    ctx.lineTo(0.5, y);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.06;
    ctx.stroke();
    ctx.fillText(String(y), -0.6, y);
  }
}

function getParams() {
  const sizeValue = clamp(Number(sizeInput.value) || 4, 4, 15);
  const widthValue = clamp(Number(widthInput.value) || 2, 2, 12);
  const thicknessValue = clamp(Number(thicknessInput.value) || 1.5, 1.5, 4);

  sizeInput.value = sizeValue;
  widthInput.value = widthValue;
  thicknessInput.value = thicknessValue;

  return {
    size: sizeValue,
    width: widthValue,
    thickness: thicknessValue,
    resolution: 250,
    comfort: Number(comfortInput.value),
    bevel: Number(bevelInput.value),
  };
}

function updateLabels(params) {
  comfortLabel.textContent = params.comfort.toFixed(2);
  bevelLabel.textContent = params.bevel.toFixed(2);
}

function update() {
  if (mesh) scene.remove(mesh);
  const params = getParams();
  updateLabels(params);

  const profile = createProfile(params);
  drawProfile(profile);

  const geometry = new THREE.LatheGeometry(profile, params.resolution);
  mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.3 })
  );
  scene.add(mesh);
}

function exportSTL() {
  if (!mesh) return;
  const exporter = new STLExporter();
  const stl = exporter.parse(mesh);
  const filename = `ring_s${sizeInput.value}_w${widthInput.value}_t${thicknessInput.value}.stl`;
  const blob = new Blob([stl], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function resizeRenderer() {
  const rect = renderContainer.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  renderer.setSize(rect.width, rect.height);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function bindEvents() {
  [sizeInput, widthInput, thicknessInput, comfortInput, bevelInput].forEach((input) => {
    input.addEventListener("input", update);
  });
  exportBtn.addEventListener("click", exportSTL);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

bindEvents();
animate();
update();
resizeRenderer();
