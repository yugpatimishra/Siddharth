import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCityWorld, BuiltCityWorld } from './CityBuilder';
import { createCitizenModel, createSportsCarModel } from './ProceduralModels';
import { GameAudioSynth } from './AudioSynth';
import type { CityHub, MissionItem, NPCProfile, RemotePlayerState } from '../types/game';

export interface HudSnapshot {
  x: number;
  z: number;
  speedKmh: number;
  inVehicle: boolean;
  districtName: string;
  nearestNpc: NPCProfile | null;
  nearestMissionDist: number | null;
  timeOfDayLabel: string;
}

export interface WorldEngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onMissionReached: (mission: MissionItem) => void;
  onInteractNpc: (npc: NPCProfile) => void;
  onBroadcastPlayerState: (state: {
    x: number;
    y: number;
    z: number;
    heading: number;
    inVehicle: boolean;
    speed: number;
  }) => void;
}

// Pre-allocated scratch math helpers (Zero GC in tick)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _dummy = new THREE.Object3D();

export class WorldEngine {
  private container: HTMLElement;
  private callbacks: WorldEngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private cityWorld: BuiltCityWorld;
  private isSoftwareGl: boolean;
  private audio = new GameAudioSynth();

  private playerMesh: THREE.Group;
  private heroCar: THREE.Group;
  private npcMeshes = new Map<string, THREE.Group>();
  private peerMeshes = new Map<string, THREE.Group>();
  private missionBeacon: THREE.Group;

  private activeCity: CityHub;
  private activeMission: MissionItem | null = null;
  private npcs: NPCProfile[] = [];
  private playing = false;
  private disposed = false;
  private frameId = 0;
  private lastTime = performance.now();
  private lastHudEmit = 0;
  private lastNetEmit = 0;
  private elapsed = 0;

  // Player kinematics
  private playerX = 0;
  private playerZ = 48;
  private playerHeading = Math.PI;
  private walkCycle = 0;

  // Vehicle kinematics
  private carX = 6;
  private carZ = 42;
  private carHeading = Math.PI / 2;
  private carSpeed = 0;
  private inVehicle = false;

  // Input state (held vs edge-triggered)
  private heldKeys = new Set<string>();
  private touchVector = { x: 0, y: 0 };
  private touchSprint = false;
  private camYawOffset = 0;
  private isDraggingCam = false;
  private lastPointerX = 0;
  private speedPerkMult = 1.0;

  constructor(
    container: HTMLElement,
    initialCity: CityHub,
    callbacks: WorldEngineCallbacks
  ) {
    this.container = container;
    this.activeCity = initialCity;
    this.callbacks = callbacks;

    // Software WebGL guard
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(initialCity.skyHorizon);
    this.scene.fog = new THREE.FogExp2(initialCity.fogColor, 0.0042);

    this.camera = new THREE.PerspectiveCamera(
      58,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.2,
      480
    );
    this.camera.position.set(22, 16, 70);

    // Mandatory studio environment map on every device
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Warm sun key light + cool HemisphereLight fill
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x334155, 0.78);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(new THREE.Color(initialCity.sunColor), 2.1);
    this.keyLight.position.set(70, 88, 65);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -95;
    this.keyLight.shadow.camera.right = 95;
    this.keyLight.shadow.camera.top = 95;
    this.keyLight.shadow.camera.bottom = -95;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 260;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.cityWorld = buildCityWorld(
      this.scene,
      this.renderer.capabilities.getMaxAnisotropy(),
      initialCity.waterColor
    );

    // Player character & hero sports coupe
    this.playerMesh = createCitizenModel({ shirtColor: 0xf59e0b, accentColor: 0x38bdf8 });
    this.playerMesh.position.set(this.playerX, 0, this.playerZ);
    this.scene.add(this.playerMesh);

    this.heroCar = createSportsCarModel(0xe11d48);
    this.heroCar.position.set(this.carX, 0, this.carZ);
    this.heroCar.rotation.y = this.carHeading;
    this.scene.add(this.heroCar);

    // Active Mission Beacon
    this.missionBeacon = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 36, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    beam.position.y = 18;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.0, 28),
      new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.missionBeacon.add(beam, ring);
    this.missionBeacon.visible = false;
    this.scene.add(this.missionBeacon);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.tick();
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  private handleResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleBlur = () => {
    this.heldKeys.clear();
    this.isDraggingCam = false;
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const code = e.code;
    if (!this.heldKeys.has(code)) {
      this.heldKeys.add(code);
      if (this.playing) {
        if (code === 'KeyF') this.toggleVehicle();
        if (code === 'KeyE') this.triggerNearestInteraction();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (!this.playing) return;
    this.isDraggingCam = true;
    this.lastPointerX = e.clientX;
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.isDraggingCam || !this.playing) return;
    const dx = e.clientX - this.lastPointerX;
    this.lastPointerX = e.clientX;
    this.camYawOffset -= dx * 0.0055;
  };

  private handlePointerUp = () => {
    this.isDraggingCam = false;
  };

  setPlaying(isPlaying: boolean) {
    this.playing = isPlaying;
    if (!isPlaying) {
      this.heldKeys.clear();
      this.audio.updateEngine(false, 0);
    }
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  setSpeedPerkMultiplier(mult: number) {
    this.speedPerkMult = mult;
  }

  setTouchInput(x: number, y: number, sprint: boolean) {
    this.touchVector.x = x;
    this.touchVector.y = y;
    this.touchSprint = sprint;
  }

  triggerAction(action: 'vehicle' | 'interact') {
    if (!this.playing) return;
    if (action === 'vehicle') this.toggleVehicle();
    else this.triggerNearestInteraction();
  }

  setCityHub(hub: CityHub) {
    this.activeCity = hub;
    this.scene.background = new THREE.Color(hub.skyHorizon);
    this.scene.fog = new THREE.FogExp2(hub.fogColor, 0.0042);
    this.keyLight.color.set(hub.sunColor);
    this.cityWorld.waterMat.color.set(hub.waterColor);
    this.audio.playChime('action');
  }

  setActiveMission(mission: MissionItem | null) {
    this.activeMission = mission;
    if (mission && mission.status !== 'completed') {
      this.missionBeacon.position.set(mission.targetX, 0, mission.targetZ);
      this.missionBeacon.visible = true;
    } else {
      this.missionBeacon.visible = false;
    }
  }

  syncNpcs(npcs: NPCProfile[]) {
    this.npcs = npcs;
    const seen = new Set<string>();
    for (const npc of npcs) {
      seen.add(npc.id);
      if (!this.npcMeshes.has(npc.id)) {
        const mesh = createCitizenModel({
          shirtColor: npc.shirtColor,
          accentColor: npc.accentColor,
        });
        mesh.position.set(npc.x, 0, npc.z);
        mesh.rotation.y = npc.heading;
        this.scene.add(mesh);
        this.npcMeshes.set(npc.id, mesh);
      }
    }
    for (const [id, mesh] of this.npcMeshes.entries()) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.npcMeshes.delete(id);
      }
    }
  }

  syncRemotePlayers(peers: RemotePlayerState[]) {
    const activeIds = new Set<string>();
    for (const peer of peers) {
      if (peer.cityId !== this.activeCity.id) continue;
      activeIds.add(peer.playerId);
      let mesh = this.peerMeshes.get(peer.playerId);
      if (!mesh) {
        mesh = createCitizenModel({
          shirtColor: new THREE.Color(peer.avatarColor || '#38bdf8').getHex(),
          accentColor: 0xffffff,
        });
        this.scene.add(mesh);
        this.peerMeshes.set(peer.playerId, mesh);
      }
      mesh.position.lerp(_vec3A.set(peer.x, 0, peer.z), 0.35);
      mesh.rotation.y = peer.heading;
    }
    for (const [pid, mesh] of this.peerMeshes.entries()) {
      if (!activeIds.has(pid)) {
        this.scene.remove(mesh);
        this.peerMeshes.delete(pid);
      }
    }
  }

  private toggleVehicle() {
    if (this.inVehicle) {
      this.inVehicle = false;
      this.carSpeed = 0;
      this.playerX = this.carX + Math.cos(this.carHeading) * 2.1;
      this.playerZ = this.carZ - Math.sin(this.carHeading) * 2.1;
      this.playerMesh.visible = true;
      this.audio.updateEngine(false, 0);
      this.audio.playChime('action');
    } else {
      const dist = Math.hypot(this.playerX - this.carX, this.playerZ - this.carZ);
      if (dist < 6.5) {
        this.inVehicle = true;
        this.playerMesh.visible = false;
        this.audio.playChime('action');
      }
    }
  }

  private triggerNearestInteraction() {
    const nearest = this.findNearestNpc(7.5);
    if (nearest) {
      this.audio.playChime('action');
      this.callbacks.onInteractNpc(nearest);
    }
  }

  private findNearestNpc(maxDist: number): NPCProfile | null {
    const px = this.inVehicle ? this.carX : this.playerX;
    const pz = this.inVehicle ? this.carZ : this.playerZ;
    let best: NPCProfile | null = null;
    let bestD = maxDist;
    for (const npc of this.npcs) {
      const mesh = this.npcMeshes.get(npc.id);
      const nx = mesh ? mesh.position.x : npc.x;
      const nz = mesh ? mesh.position.z : npc.z;
      const d = Math.hypot(px - nx, pz - nz);
      if (d < bestD) {
        bestD = d;
        best = npc;
      }
    }
    return best;
  }

  private resolveCollisions(nx: number, nz: number, radius: number): [number, number] {
    let x = THREE.MathUtils.clamp(nx, -112, 112);
    let z = THREE.MathUtils.clamp(nz, -105, 86); // Ocean shoreline natural perimeter at z = 86

    for (const box of this.cityWorld.colliders) {
      const closestX = Math.max(box.minX, Math.min(x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - closestX;
      const dz = z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = radius - dist;
        x += (dx / dist) * push;
        z += (dz / dist) * push;
      }
    }
    return [x, z];
  }

  private getGamepadInput(): { moveX: number; moveY: number; sprint: boolean } {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0];
    if (!gp) return { moveX: 0, moveY: 0, sprint: false };
    const ax = Math.abs(gp.axes[0] || 0) > 0.18 ? gp.axes[0] : 0;
    const ay = Math.abs(gp.axes[1] || 0) > 0.18 ? gp.axes[1] : 0;
    return { moveX: ax, moveY: -ay, sprint: Boolean(gp.buttons[0]?.pressed) };
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.cityWorld.oceanUniforms.uTime.value = this.elapsed;

    // 1. Update Instanced Ambient Traffic
    for (const agent of this.cityWorld.trafficAgents) {
      agent.coord += agent.dir * agent.speed * dt;
      if (agent.coord > 110) agent.coord = -110;
      if (agent.coord < -110) agent.coord = 110;
      if (agent.axis === 'x') {
        _dummy.position.set(agent.coord, 0, agent.lanePos);
        _dummy.rotation.y = agent.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        _dummy.position.set(agent.lanePos, 0, agent.coord);
        _dummy.rotation.y = agent.dir === 1 ? 0 : Math.PI;
      }
      _dummy.updateMatrix();
      this.cityWorld.trafficMesh.setMatrixAt(agent.index, _dummy.matrix);
    }
    this.cityWorld.trafficMesh.instanceMatrix.needsUpdate = true;

    // 2. Update Instanced Sidewalk Crowd
    for (const ped of this.cityWorld.crowdAgents) {
      ped.x += ped.dirX * ped.speed * dt;
      ped.z += ped.dirZ * ped.speed * dt;
      if (ped.x > 105 || ped.x < -105) ped.dirX *= -1;
      if (ped.z > 76 || ped.z < -95) ped.dirZ *= -1;
      const bob = Math.abs(Math.sin(this.elapsed * 5 + ped.phase)) * 0.07;
      _dummy.position.set(ped.x, bob, ped.z);
      _dummy.rotation.y = Math.atan2(ped.dirX, ped.dirZ);
      _dummy.updateMatrix();
      this.cityWorld.crowdMesh.setMatrixAt(ped.index, _dummy.matrix);
    }
    this.cityWorld.crowdMesh.instanceMatrix.needsUpdate = true;

    // 3. Animate Named NPCs along daily schedules
    const simHour = (8 + (this.elapsed * 0.12)) % 24;
    for (const npc of this.npcs) {
      const mesh = this.npcMeshes.get(npc.id);
      if (!mesh) continue;
      const slot =
        npc.schedule.find((s) =>
          s.startHour <= s.endHour
            ? simHour >= s.startHour && simHour < s.endHour
            : simHour >= s.startHour || simHour < s.endHour
        ) ?? npc.schedule[0];

      if (slot) {
        const dx = slot.x - mesh.position.x;
        const dz = slot.z - mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1.2) {
          const step = Math.min(dist, 2.2 * dt);
          mesh.position.x += (dx / dist) * step;
          mesh.position.z += (dz / dist) * step;
          mesh.rotation.y = Math.atan2(dx, dz);
          this.animateCitizenLimbs(mesh, this.elapsed * 6);
        } else {
          this.animateCitizenLimbs(mesh, 0);
        }
      }
    }

    // 4. Player / Vehicle Controls & Camera
    if (this.playing) {
      const gp = this.getGamepadInput();
      let inputTurn =
        (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft') ? 1 : 0) -
        (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight') ? 1 : 0);
      let inputForward =
        (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp') ? 1 : 0) -
        (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown') ? 1 : 0);

      if (Math.abs(this.touchVector.x) > 0.08 || Math.abs(this.touchVector.y) > 0.08) {
        inputTurn = -this.touchVector.x;
        inputForward = this.touchVector.y;
      } else if (Math.abs(gp.moveX) > 0.08 || Math.abs(gp.moveY) > 0.08) {
        inputTurn = -gp.moveX;
        inputForward = gp.moveY;
      }

      const sprinting =
        this.heldKeys.has('ShiftLeft') ||
        this.heldKeys.has('ShiftRight') ||
        this.touchSprint ||
        gp.sprint;

      if (this.inVehicle) {
        const maxSpeed = 28 * this.speedPerkMult;
        const accel = inputForward !== 0 ? inputForward * 24 * this.speedPerkMult : -this.carSpeed * 1.4;
        this.carSpeed = THREE.MathUtils.clamp(this.carSpeed + accel * dt, -10, maxSpeed);

        if (Math.abs(this.carSpeed) > 0.4) {
          const steerDir = this.carSpeed >= 0 ? 1 : -1;
          this.carHeading += inputTurn * 2.35 * steerDir * dt;
        }

        const nextX = this.carX + Math.sin(this.carHeading) * this.carSpeed * dt;
        const nextZ = this.carZ + Math.cos(this.carHeading) * this.carSpeed * dt;
        const [rx, rz] = this.resolveCollisions(nextX, nextZ, 1.55);
        this.carX = rx;
        this.carZ = rz;
        this.playerX = rx;
        this.playerZ = rz;

        this.heroCar.position.set(this.carX, 0, this.carZ);
        this.heroCar.rotation.y = this.carHeading;

        const wheels = (this.heroCar.userData.wheels as THREE.Group[]) ?? [];
        for (const w of wheels) {
          w.rotation.x += this.carSpeed * dt * 2.2;
        }

        this.audio.updateEngine(true, this.carSpeed / 24);

        // Smooth chase cam behind car
        const camDist = 11.5;
        const camAngle = this.carHeading + this.camYawOffset;
        _vec3A.set(
          this.carX - Math.sin(camAngle) * camDist,
          5.2,
          this.carZ - Math.cos(camAngle) * camDist
        );
        const damp = 1 - Math.exp(-7.5 * dt);
        this.camera.position.lerp(_vec3A, damp);
        _vec3B.set(this.carX, 1.4, this.carZ);
        this.camera.lookAt(_vec3B);

        // Dynamic FOV speed cue
        const targetFov = 58 + Math.min(12, Math.abs(this.carSpeed) * 0.42);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
        this.camera.updateProjectionMatrix();
      } else {
        this.audio.updateEngine(false, 0);
        const walkSpeed = (sprinting ? 10.5 : 5.6) * this.speedPerkMult;
        if (Math.abs(inputTurn) > 0.05 || Math.abs(inputForward) > 0.05) {
          const camBaseYaw = this.camYawOffset;
          const moveAngle = Math.atan2(-inputTurn, inputForward) + camBaseYaw;
          this.playerHeading = moveAngle;
          const nextX = this.playerX + Math.sin(moveAngle) * walkSpeed * dt;
          const nextZ = this.playerZ + Math.cos(moveAngle) * walkSpeed * dt;
          const [rx, rz] = this.resolveCollisions(nextX, nextZ, 0.55);
          this.playerX = rx;
          this.playerZ = rz;
          this.walkCycle += dt * (sprinting ? 13 : 8);
          this.animateCitizenLimbs(this.playerMesh, this.walkCycle);
          this.audio.playFootstep(sprinting);
        } else {
          this.animateCitizenLimbs(this.playerMesh, 0);
        }

        this.playerMesh.position.set(this.playerX, 0, this.playerZ);
        this.playerMesh.rotation.y = this.playerHeading;

        const camDist = 7.4;
        _vec3A.set(
          this.playerX - Math.sin(this.camYawOffset) * camDist,
          4.1,
          this.playerZ - Math.cos(this.camYawOffset) * camDist
        );
        const damp = 1 - Math.exp(-9 * dt);
        this.camera.position.lerp(_vec3A, damp);
        _vec3B.set(this.playerX, 1.5, this.playerZ);
        this.camera.lookAt(_vec3B);

        if (Math.abs(this.camera.fov - 58) > 0.2) {
          this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 58, 1 - Math.exp(-5 * dt));
          this.camera.updateProjectionMatrix();
        }
      }

      // Check active mission arrival
      if (this.activeMission && this.activeMission.status !== 'completed') {
        const px = this.inVehicle ? this.carX : this.playerX;
        const pz = this.inVehicle ? this.carZ : this.playerZ;
        const mDist = Math.hypot(px - this.activeMission.targetX, pz - this.activeMission.targetZ);
        this.missionBeacon.rotation.y += dt * 1.4;
        if (mDist < 4.5) {
          const completed = this.activeMission;
          this.activeMission = null;
          this.missionBeacon.visible = false;
          this.audio.playChime('mission');
          this.callbacks.onMissionReached(completed);
        }
      }

      // Throttled HUD & Multiplayer broadcast
      if (now - this.lastHudEmit > 160) {
        this.lastHudEmit = now;
        const px = this.inVehicle ? this.carX : this.playerX;
        const pz = this.inVehicle ? this.carZ : this.playerZ;
        const nearestNpc = this.findNearestNpc(7.5);
        const district =
          this.activeCity.districts.reduce((prev, cur) => {
            const dp = Math.hypot(px - prev.centerX, pz - prev.centerZ);
            const dc = Math.hypot(px - cur.centerX, pz - cur.centerZ);
            return dc < dp ? cur : prev;
          })?.name || this.activeCity.name;

        const mDist =
          this.activeMission && this.activeMission.status !== 'completed'
            ? Math.round(Math.hypot(px - this.activeMission.targetX, pz - this.activeMission.targetZ))
            : null;

        const hr = Math.floor(simHour);
        const mins = Math.floor((simHour - hr) * 60);
        const timeLabel = `${String(hr).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

        this.callbacks.onHudUpdate({
          x: px,
          z: pz,
          speedKmh: this.inVehicle ? Math.round(Math.abs(this.carSpeed) * 3.6) : 0,
          inVehicle: this.inVehicle,
          districtName: district,
          nearestNpc,
          nearestMissionDist: mDist,
          timeOfDayLabel: timeLabel,
        });
      }

      if (now - this.lastNetEmit > 120) {
        this.lastNetEmit = now;
        this.callbacks.onBroadcastPlayerState({
          x: this.inVehicle ? this.carX : this.playerX,
          y: 0,
          z: this.inVehicle ? this.carZ : this.playerZ,
          heading: this.inVehicle ? this.carHeading : this.playerHeading,
          inVehicle: this.inVehicle,
          speed: this.carSpeed,
        });
      }
    } else {
      // Title Screen: Atmospheric golden-hour aerial orbit over the living city
      const orbitAngle = this.elapsed * 0.11;
      _vec3A.set(Math.cos(orbitAngle) * 76, 32, Math.sin(orbitAngle) * 76 + 15);
      this.camera.position.lerp(_vec3A, 1 - Math.exp(-3 * dt));
      _vec3B.set(0, 6, 10);
      this.camera.lookAt(_vec3B);
    }

    this.renderer.render(this.scene, this.camera);
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private animateCitizenLimbs(group: THREE.Group, phase: number) {
    const { leftLeg, rightLeg, leftArm, rightArm } = group.userData as {
      leftLeg?: THREE.Mesh;
      rightLeg?: THREE.Mesh;
      leftArm?: THREE.Mesh;
      rightArm?: THREE.Mesh;
    };
    const swing = phase === 0 ? 0 : Math.sin(phase) * 0.55;
    if (leftLeg) leftLeg.rotation.x = swing;
    if (rightLeg) rightLeg.rotation.x = -swing;
    if (leftArm) leftArm.rotation.x = -swing * 0.8;
    if (rightArm) rightArm.rotation.x = swing * 0.8;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.cityWorld.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
