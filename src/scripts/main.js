import * as THREE from "three";
import { Pane } from "tweakpane";
import { fragmentShader, vertexShader } from "./shaders.js";

const stage = document.querySelector("#webgl-stage");
const mediaElements = [...document.querySelectorAll(".card-media")];

if (!stage || mediaElements.length === 0) {
  throw new Error("Required DOM nodes for scroll image distortion were not found.");
}

const params = {
  maxDelta: 20,
  amplitude: 0.002,
};

let viewport;
let previousScrollY = window.scrollY;
let smoothScrollDelta = 0;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.z = 5;
viewport = getViewport();

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

const items = mediaElements.map((element, index) => createItem(element, index));

setupPane();
bindEvents();
animate();

function createItem(element, index) {
  const title = element.dataset.title || `Image ${index + 1}`;
  const src = element.dataset.src;
  const img = element.querySelector("img");
  const placeholder = createPlaceholderTexture(title, index);

  const uniforms = {
    uDelta: { value: new THREE.Vector2(0, 0) },
    uAmplitude: { value: params.amplitude },
    uTexture: { value: placeholder },
    uAlpha: { value: 1 },
  };

  const geometry = new THREE.PlaneGeometry(1, 1, 15, 15);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  if (src) {
    textureLoader.load(
      src,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        uniforms.uTexture.value = texture;
        if (img) {
          img.style.opacity = "0";
        }
      },
      undefined,
      () => {
        uniforms.uTexture.value = placeholder;
      },
    );
  }

  return { element, mesh, uniforms };
}

function setupPane() {
  const pane = new Pane({ title: "Distortion" });
  pane.element.style.position = "fixed";
  pane.element.style.top = "16px";
  pane.element.style.right = "16px";
  pane.element.style.zIndex = "1000";

  pane
    .addBinding(params, "maxDelta", {
      label: "maxDelta",
      min: 0,
      max: 120,
      step: 1,
    })
    .on("change", () => {
      smoothScrollDelta = clamp(smoothScrollDelta, -params.maxDelta, params.maxDelta);
    });

  pane
    .addBinding(params, "amplitude", {
      label: "amplitude",
      min: 0,
      max: 0.02,
      step: 0.0001,
    })
    .on("change", (event) => {
      for (const item of items) {
        item.uniforms.uAmplitude.value = event.value;
      }
    });
}

function bindEvents() {
  document.querySelectorAll("a.card").forEach((card) => {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      previousScrollY = 0;
      smoothScrollDelta = 0;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  window.addEventListener(
    "scroll",
    () => {
      const currentScrollY = window.scrollY;
      const rawDelta = currentScrollY - previousScrollY;
      previousScrollY = currentScrollY;
      smoothScrollDelta = clamp(
        lerp(smoothScrollDelta, rawDelta, 0.35),
        -params.maxDelta,
        params.maxDelta,
      );
    },
    { passive: true },
  );

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    viewport = getViewport();
  });
}

function animate() {
  requestAnimationFrame(animate);

  const hasScroll = Math.abs(smoothScrollDelta) > 0.05;

  if (hasScroll) {
    smoothScrollDelta = clamp(smoothScrollDelta * 0.9, -params.maxDelta, params.maxDelta);
  } else {
    smoothScrollDelta = 0;
  }

  for (const item of items) {
    if (hasScroll) {
      item.uniforms.uDelta.value.set(0, -smoothScrollDelta);
    } else {
      item.uniforms.uDelta.value.multiplyScalar(0.92);
    }

    syncMeshToElement(item);
  }

  renderer.render(scene, camera);
}

function syncMeshToElement(item) {
  const rect = item.element.getBoundingClientRect();
  const visible =
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth;

  item.mesh.visible = visible;

  if (!visible) return;

  const width = mapRange(rect.width, 0, window.innerWidth, 0, viewport.width);
  const height = mapRange(rect.height, 0, window.innerHeight, 0, viewport.height);

  item.mesh.scale.set(width, height, 1);

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  item.mesh.position.x = mapRange(
    centerX,
    0,
    window.innerWidth,
    -viewport.width / 2,
    viewport.width / 2,
  );
  item.mesh.position.y = mapRange(
    centerY,
    0,
    window.innerHeight,
    viewport.height / 2,
    -viewport.height / 2,
  );
}

function getViewport() {
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const height = 2 * Math.tan(fov / 2) * camera.position.z;
  const width = height * (window.innerWidth / window.innerHeight);

  return { width, height };
}

function createPlaceholderTexture(title, index) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const hue = (index * 47 + 215) % 360;

  canvas.width = 1024;
  canvas.height = 768;

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `hsl(${hue}, 70%, 62%)`);
  gradient.addColorStop(1, `hsl(${(hue + 80) % 360}, 70%, 34%)`);

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.font = "700 72px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(title, canvas.width / 2, canvas.height / 2 - 18);

  context.font = "400 30px Arial, sans-serif";
  context.fillText("Loading image…", canvas.width / 2, canvas.height / 2 + 52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start * (1 - amount) + end * amount;
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}
