import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ColorCandidate } from '../model/types';
import type { ThreePreviewProps } from './ThreePreviewPanel';
import ColorInspectionPanel from './ColorInspectionPanel';

const START_DISTANCE = Math.hypot(60, 35, 230),
  MIN_DISTANCE = 0.3,
  MAX_DISTANCE = 600;
const sliderDistance = (value: number, start = START_DISTANCE, maximum = MAX_DISTANCE) =>
  value <= 50
    ? maximum * (start / maximum) ** (value / 50)
    : start * (MIN_DISTANCE / start) ** ((value - 50) / 50);
const distanceSlider = (distance: number, start = START_DISTANCE, maximum = MAX_DISTANCE) =>
  distance >= start
    ? (50 * Math.log(distance / maximum)) / Math.log(start / maximum)
    : 50 + (50 * Math.log(distance / start)) / Math.log(MIN_DISTANCE / start);

export default function ThreePreview({
  model,
  palette,
  face,
  ...inspectionProps
}: ThreePreviewProps) {
  const badgeSize =
    inspectionProps.project.format === 'badge-atelier'
      ? inspectionProps.project.badgeBase
      : undefined;
  const liveBadgeSize = useRef(badgeSize);
  liveBadgeSize.current = badgeSize;
  const host = useRef<HTMLDivElement>(null);
  const zoomInput = useRef<HTMLInputElement>(null),
    zoomOutput = useRef<HTMLOutputElement>(null);
  const sceneRef = useRef<{
    group: THREE.Group;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    redraw: () => void;
    pickable: THREE.Object3D[];
    referenceDistance: number;
    resize: () => void;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [candidates, setCandidates] = useState<ColorCandidate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnsupported(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '真实网格三维预览，可拖动旋转、滚轮缩放');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa0b4, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-80, 100, 150);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe4b5, 1.5);
    fill.position.set(80, -60, -100);
    scene.add(fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = MAX_DISTANCE;
    controls.enablePan = true;
    camera.position.set(60, 35, 230);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    let startDistance = START_DISTANCE;
    const resize = () => {
      const w = container.clientWidth,
        h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      const size = liveBadgeSize.current;
      const nextDistance = size
        ? (START_DISTANCE * Math.max(size.height, size.width / Math.max(camera.aspect, 0.1))) / 100
        : START_DISTANCE;
      // Preserve the user's relative zoom when the canvas or badge changes size.
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextDistance / startDistance)
        .add(controls.target);
      startDistance = nextDistance;
      controls.maxDistance = size ? Math.max(MAX_DISTANCE, startDistance * 2) : MAX_DISTANCE;
      camera.far = Math.max(2000, controls.maxDistance * 2);
      if (sceneRef.current) sceneRef.current.referenceDistance = startDistance;
      camera.updateProjectionMatrix();
      redraw();
    };
    let frame = 0;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      frame = -1;
      const changing = controls.update();
      // Keep the original depth precision at normal viewing distances. Only
      // shorten the near plane when inspecting a fragment very close up.
      const near = Math.min(0.1, Math.max(0.01, controls.getDistance() * 0.05));
      if (Math.abs(camera.near - near) > 1e-6) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      // Keep the slider in sync without rerendering the candidate list on each
      // orbit/zoom frame. These controls only change the camera, never artwork.
      const distance = controls.getDistance();
      if (zoomInput.current) {
        const value = Math.max(
          0,
          Math.min(100, distanceSlider(distance, startDistance, controls.maxDistance)),
        ).toFixed(2);
        if (Number(zoomInput.current.value) !== Number(value)) zoomInput.current.value = value;
        const scale = startDistance / distance;
        const label = `${scale.toFixed(scale < 10 ? 2 : 1).replace(/\.?0+$/, '')}×`;
        zoomInput.current.setAttribute('aria-valuetext', label);
        if (zoomOutput.current && zoomOutput.current.textContent !== label)
          zoomOutput.current.textContent = label;
      }
      renderer.render(scene, camera);
      frame = changing && !document.hidden ? requestAnimationFrame(render) : 0;
    };
    const redraw = () => {
      if (!disposed && !document.hidden && frame === 0) frame = requestAnimationFrame(render);
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else redraw();
    };
    sceneRef.current = {
      group,
      camera,
      controls,
      redraw,
      pickable: [],
      referenceDistance: startDistance,
      resize,
    };
    let pointer: { id: number; x: number; y: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        !pointer ||
        pointer.id !== event.pointerId ||
        Math.hypot(pointer.x - event.clientX, pointer.y - event.clientY) > 5
      )
        return;
      pointer = null;
      const live = sceneRef.current;
      if (!live?.pickable.length) return;
      const bounds = renderer.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          1 - ((event.clientY - bounds.top) / bounds.height) * 2,
        ),
        camera,
      );
      const hit = ray.intersectObjects(live.pickable, false)[0];
      if (hit) setSelectedKey(hit.object.userData.componentKey as string);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    controls.addEventListener('change', redraw);
    document.addEventListener('visibilitychange', visibility);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    setReady(true);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', redraw);
      document.removeEventListener('visibilitychange', visibility);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sceneRef.current = null;
      setReady(false);
    };
  }, []);
  useEffect(() => {
    const live = sceneRef.current;
    if (!ready || !live || !model) return;
    const center = new THREE.Vector3(
      (model.bounds[0] + model.bounds[3]) / 2,
      (model.bounds[1] + model.bounds[4]) / 2,
      (model.bounds[2] + model.bounds[5]) / 2,
    );
    live.group.position.copy(center).multiplyScalar(-1);
    const parts: THREE.Mesh[] = [];
    for (const part of model.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: palette.find((c) => c.id === part.colorId)?.hex ?? '#ff69b4',
        roughness: 0.72,
        metalness: 0.03,
        side: THREE.DoubleSide,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      live.group.add(mesh);
      parts.push(mesh);
    }
    live.redraw();
    return () => {
      for (const mesh of parts) {
        live.group.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    };
  }, [model, palette, ready]);
  useEffect(() => {
    const live = sceneRef.current;
    if (!live || !ready) return;
    const markers: THREE.Mesh[] = [];
    for (const candidate of candidates) {
      const b = candidate.bounds;
      const active =
        candidate.componentKey === selectedKey || checkedKeys.includes(candidate.componentKey);
      // Local fragments use their exact volume for picking. Unselected fragments
      // stay pickable without drawing hundreds of overlapping boxes over the model.
      const geometry = candidate.fragment
        ? new THREE.BufferGeometry()
        : new THREE.BoxGeometry(
            Math.max(0.08, b[3] - b[0]) + 0.04,
            Math.max(0.08, b[4] - b[1]) + 0.04,
            Math.max(0.08, b[5] - b[2]) + 0.04,
          );
      if (candidate.fragment) {
        geometry.setAttribute('position', new THREE.BufferAttribute(candidate.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(candidate.indices, 1));
      }
      const material = new THREE.MeshBasicMaterial({
        color: 0xff4788,
        transparent: true,
        opacity:
          candidate.componentKey === selectedKey
            ? 0.4
            : checkedKeys.includes(candidate.componentKey)
              ? 0.25
              : 0.12,
        depthTest: false,
        wireframe: !candidate.fragment && !active,
        visible: !candidate.fragment || active,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (!candidate.fragment)
        mesh.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      mesh.userData.componentKey = candidate.componentKey;
      mesh.renderOrder = 10;
      live.group.add(mesh);
      markers.push(mesh);
    }
    const selected = candidates.find((candidate) => candidate.componentKey === selectedKey);
    if (selected && !selected.fragment) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(selected.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(selected.indices, 1));
      const material = new THREE.MeshBasicMaterial({
        color: 0xff4788,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const highlight = new THREE.Mesh(geometry, material);
      highlight.renderOrder = 11;
      highlight.userData.componentKey = selected.componentKey;
      live.group.add(highlight);
      markers.push(highlight);
    }
    live.pickable = markers;
    live.redraw();
    return () => {
      live.pickable = [];
      for (const marker of markers) {
        live.group.remove(marker);
        marker.geometry.dispose();
        (marker.material as THREE.Material).dispose();
      }
    };
  }, [candidates, selectedKey, checkedKeys, ready, model]);
  useEffect(() => {
    const live = sceneRef.current,
      candidate = candidates.find((entry) => entry.componentKey === selectedKey);
    if (!live || !ready || !candidate) return;
    const b = candidate.bounds,
      target = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2).add(
        live.group.position,
      );
    const direction = live.camera.position.clone().sub(live.controls.target).normalize();
    const distance = live.controls.getDistance();
    live.camera.position.copy(target).addScaledVector(direction, distance);
    live.controls.target.copy(target);
    live.controls.update();
    live.redraw();
  }, [candidates, selectedKey, ready, model]);
  useEffect(() => {
    const live = sceneRef.current;
    if (!ready || !live) return;
    const viewScale = live.referenceDistance / START_DISTANCE;
    live.camera.position.set(
      (face === 'front' ? 60 : -60) * viewScale,
      35 * viewScale,
      (face === 'front' ? 230 : -230) * viewScale,
    );
    live.camera.lookAt(0, 0, 0);
    live.controls.target.set(0, 0, 0);
    live.controls.update();
    live.redraw();
  }, [face, ready]);
  useEffect(() => {
    if (ready) sceneRef.current?.resize();
  }, [badgeSize?.width, badgeSize?.height, ready]);
  const zoomTo = (distance: number) => {
    const live = sceneRef.current;
    if (!live) return;
    live.camera.position
      .sub(live.controls.target)
      .setLength(Math.max(MIN_DISTANCE, Math.min(live.controls.maxDistance, distance)))
      .add(live.controls.target);
    live.controls.update();
    live.redraw();
  };
  return (
    <div className="three-preview">
      <div className="three-host" ref={host} />
      {!unsupported && (
        <section className="three-zoom" aria-label="3D 缩放控制">
          <div className="three-zoom-heading">
            <span>缩放</span>
            <output ref={zoomOutput}>1×</output>
            <button
              type="button"
              aria-label="3D 预览恢复 1 倍缩放"
              disabled={!ready || !model}
              onClick={() => zoomTo(sceneRef.current?.referenceDistance ?? START_DISTANCE)}
            >
              1×
            </button>
          </div>
          <div className="three-zoom-slider">
            <button
              type="button"
              aria-label="缩小 3D 预览"
              disabled={!ready || !model}
              onClick={() =>
                zoomTo((sceneRef.current?.controls.getDistance() ?? START_DISTANCE) * 1.2)
              }
            >
              −
            </button>
            <input
              ref={zoomInput}
              type="range"
              aria-label="3D 预览缩放"
              min="0"
              max="100"
              step="0.1"
              defaultValue="50"
              disabled={!ready || !model}
              onChange={(event) =>
                zoomTo(
                  sliderDistance(
                    Number(event.target.value),
                    sceneRef.current?.referenceDistance ?? START_DISTANCE,
                    sceneRef.current?.controls.maxDistance ?? MAX_DISTANCE,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label="放大 3D 预览"
              disabled={!ready || !model}
              onClick={() =>
                zoomTo((sceneRef.current?.controls.getDistance() ?? START_DISTANCE) / 1.2)
              }
            >
              ＋
            </button>
          </div>
        </section>
      )}
      <ColorInspectionPanel
        {...inspectionProps}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onCandidates={setCandidates}
        checkedKeys={checkedKeys}
        onCheckedKeys={setCheckedKeys}
      />
      {candidates.length > 0 && (
        <button
          type="button"
          className="color-check-reset"
          onClick={() => {
            const live = sceneRef.current;
            if (!live) return;
            live.camera.position.set(
              face === 'front' ? 60 : -60,
              35,
              face === 'front' ? 230 : -230,
            );
            live.controls.target.set(0, 0, 0);
            live.controls.update();
            live.redraw();
          }}
        >
          复位 3D 视角
        </button>
      )}
      {unsupported ? (
        <div className="preview-wait">
          当前浏览器无法显示 3D。
          <br />
          二维编辑和模型导出仍然可用。
        </div>
      ) : (
        !model && (
          <div className="preview-wait">
            <span className="spinner" />
            正在把轮廓变成实体…
          </div>
        )
      )}
    </div>
  );
}
