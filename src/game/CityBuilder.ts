import * as THREE from 'three';

export interface BuildingCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface AmbientTrafficAgent {
  index: number;
  axis: 'x' | 'z';
  lanePos: number;
  coord: number;
  dir: 1 | -1;
  speed: number;
  color: THREE.Color;
}

export interface AmbientCrowdAgent {
  index: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  phase: number;
}

export interface BuiltCityWorld {
  colliders: BuildingCollider[];
  trafficMesh: THREE.InstancedMesh;
  trafficAgents: AmbientTrafficAgent[];
  crowdMesh: THREE.InstancedMesh;
  crowdAgents: AmbientCrowdAgent[];
  waterMat: THREE.MeshStandardMaterial;
  oceanUniforms: { uTime: { value: number } };
  dispose: () => void;
}

function createRoadTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  // Dark weathered asphalt
  ctx.fillStyle = '#1b1f29';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt grain
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 22 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // City grid avenues (every 256px)
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 16]);
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createFacadeTexture(accentHex: string, maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#1e2433';
  ctx.fillRect(0, 0, 256, 512);

  const cols = 8;
  const rows = 16;
  const w = 256 / cols;
  const h = 512 / rows;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const lit = Math.random() > 0.34;
      ctx.fillStyle = lit
        ? Math.random() > 0.8
          ? accentHex
          : '#fbd38d'
        : '#0f172a';
      ctx.globalAlpha = lit ? 0.65 + Math.random() * 0.3 : 0.85;
      ctx.fillRect(col * w + 4, r * h + 5, w - 8, h - 10);
    }
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function buildCityWorld(
  scene: THREE.Scene,
  maxAnisotropy: number,
  waterColorHex: string
): BuiltCityWorld {
  const disposables: Array<{ dispose: () => void }> = [];
  const colliders: BuildingCollider[] = [];

  // 1. Main City Peninsula Asphalt Ground (y = 0)
  const roadTex = createRoadTexture(maxAnisotropy);
  disposables.push(roadTex);
  const groundGeo = new THREE.PlaneGeometry(340, 340);
  const groundMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.86,
    metalness: 0.08,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  disposables.push(groundGeo, groundMat);

  // Sandy beachfront strip along +Z (z = 84..104)
  const sandGeo = new THREE.PlaneGeometry(360, 28);
  const sandMat = new THREE.MeshStandardMaterial({
    color: 0xd6b88d,
    roughness: 0.94,
    metalness: 0.02,
  });
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.03, 94);
  sand.receiveShadow = true;
  scene.add(sand);
  disposables.push(sandGeo, sandMat);

  // Extended coastal ocean plane with procedural vertex wave shimmer (y = -0.35)
  const oceanUniforms = { uTime: { value: 0 } };
  const waterGeo = new THREE.PlaneGeometry(1600, 1600, 48, 48);
  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(waterColorHex),
    roughness: 0.18,
    metalness: 0.72,
  });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = oceanUniforms.uTime;
    shader.vertexShader =
      `uniform float uTime;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.z += sin(position.x * 0.06 + uTime * 1.4) * 0.35 + cos(position.y * 0.05 + uTime * 1.1) * 0.25;`
      );
  };
  const ocean = new THREE.Mesh(waterGeo, waterMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.35, 220);
  scene.add(ocean);
  disposables.push(waterGeo, waterMat);

  // 2. Boulevard Roadways & Sidewalk Curbs (elevated y = 0.04 to avoid coplanar Z-fighting)
  const avenueMat = new THREE.MeshStandardMaterial({
    color: 0x161922,
    roughness: 0.78,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  disposables.push(avenueMat);

  const roadCoords = [-60, -20, 20, 60];
  for (const rc of roadCoords) {
    const hRoadGeo = new THREE.PlaneGeometry(240, 10);
    const hRoad = new THREE.Mesh(hRoadGeo, avenueMat);
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.position.set(0, 0.04, rc);
    hRoad.receiveShadow = true;
    scene.add(hRoad);
    disposables.push(hRoadGeo);

    const vRoadGeo = new THREE.PlaneGeometry(10, 180);
    const vRoad = new THREE.Mesh(vRoadGeo, avenueMat);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(rc, 0.04, -10);
    vRoad.receiveShadow = true;
    scene.add(vRoad);
    disposables.push(vRoadGeo);
  }

  // 3. District Architectural Skyline (Varied multi-part tower blocks + podiums)
  const facadeWarm = createFacadeTexture('#f59e0b', maxAnisotropy);
  const facadeCool = createFacadeTexture('#38bdf8', maxAnisotropy);
  const facadeRose = createFacadeTexture('#fb7185', maxAnisotropy);
  disposables.push(facadeWarm, facadeCool, facadeRose);

  const towerMats = [
    new THREE.MeshStandardMaterial({ map: facadeCool, roughness: 0.28, metalness: 0.65 }),
    new THREE.MeshStandardMaterial({ map: facadeWarm, roughness: 0.32, metalness: 0.55 }),
    new THREE.MeshStandardMaterial({ map: facadeRose, roughness: 0.35, metalness: 0.5 }),
  ];
  const podiumMat = new THREE.MeshStandardMaterial({ color: 0x262b38, roughness: 0.78, metalness: 0.15 });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });
  disposables.push(...towerMats, podiumMat, crownMat);

  const blockCenters = [-80, -40, 0, 40, 80];
  for (const bx of blockCenters) {
    for (const bz of [-80, -40, 0, 40]) {
      // Leave central plaza open around (0, 0) & oceanfront promenade clear
      if (bx === 0 && bz === 40) continue;

      const w = 16 + ((Math.abs(bx * 7 + bz * 3) % 7));
      const d = 16 + ((Math.abs(bx * 5 + bz * 11) % 7));
      const h =
        bx <= -40 && bz <= 0
          ? 34 + ((Math.abs(bx + bz) * 13) % 32) // Financial Core tall skyscrapers
          : 15 + ((Math.abs(bx * 3 + bz * 5) * 9) % 22);

      const group = new THREE.Group();
      group.position.set(bx, 0, bz);

      const podiumGeo = new THREE.BoxGeometry(w + 2, 3.2, d + 2);
      const podium = new THREE.Mesh(podiumGeo, podiumMat);
      podium.position.y = 1.6;
      podium.castShadow = true;
      podium.receiveShadow = true;
      group.add(podium);

      const towerGeo = new THREE.BoxGeometry(w, h, d);
      const tower = new THREE.Mesh(towerGeo, towerMats[Math.abs(bx + bz) % towerMats.length]);
      tower.position.y = 3.2 + h / 2;
      tower.castShadow = true;
      tower.receiveShadow = true;
      group.add(tower);

      const crownGeo = new THREE.BoxGeometry(w * 0.6, 1.1, d * 0.6);
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.y = 3.2 + h + 0.55;
      group.add(crown);

      scene.add(group);
      disposables.push(podiumGeo, towerGeo, crownGeo);

      colliders.push({
        minX: bx - (w + 2) / 2,
        maxX: bx + (w + 2) / 2,
        minZ: bz - (d + 2) / 2,
        maxZ: bz + (d + 2) / 2,
      });
    }
  }

  // 4. Instanced Palm Trees & Boulevard Greenery (> 120 trees)
  const treePositions: Array<[number, number]> = [];
  for (let x = -110; x <= 110; x += 14) {
    treePositions.push([x, 76]); // Oceanfront boardwalk palms
    treePositions.push([x, 82]);
  }
  for (let z = -90; z <= 60; z += 18) {
    treePositions.push([-12, z]);
    treePositions.push([12, z]);
  }
  const treeCount = treePositions.length;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 5.2, 7);
  trunkGeo.translate(0, 2.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9, metalness: 0.02 });
  const crownGeo = new THREE.ConeGeometry(2.1, 2.4, 7);
  crownGeo.translate(0, 5.6, 0);
  const crownLeafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.04 });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crownInst = new THREE.InstancedMesh(crownGeo, crownLeafMat, treeCount);
  trunkInst.castShadow = true;

  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();
  treePositions.forEach(([tx, tz], i) => {
    const scale = 0.85 + (i % 5) * 0.08;
    dummy.position.set(tx, 0, tz);
    dummy.rotation.set(0, (i * 1.1) % (Math.PI * 2), 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);
    crownInst.setMatrixAt(i, dummy.matrix);

    cColor.setHSL(0.32 + (i % 4) * 0.02, 0.55, 0.28 + (i % 3) * 0.05);
    crownInst.setColorAt(i, cColor);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  crownInst.instanceMatrix.needsUpdate = true;
  if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  crownInst.computeBoundingSphere();
  scene.add(trunkInst, crownInst);
  disposables.push(trunkGeo, trunkMat, crownGeo, crownLeafMat);

  // 5. Instanced Ambient Crowd Pedestrians (140 living citizens walking sidewalks)
  const crowdCount = 140;
  const pedGeo = new THREE.CapsuleGeometry(0.28, 0.95, 4, 8);
  pedGeo.translate(0, 0.78, 0);
  const pedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.08 });
  const crowdMesh = new THREE.InstancedMesh(pedGeo, pedMat, crowdCount);
  crowdMesh.frustumCulled = false;

  const crowdAgents: AmbientCrowdAgent[] = [];
  for (let i = 0; i < crowdCount; i++) {
    const isRow = i % 2 === 0;
    const lane = roadCoords[i % roadCoords.length] + (i % 3 === 0 ? 6.2 : -6.2);
    const along = -95 + ((i * 17) % 180);
    const x = isRow ? along : lane;
    const z = isRow ? lane : along;
    const sign = i % 2 === 0 ? 1 : -1;
    crowdAgents.push({
      index: i,
      x,
      z,
      dirX: isRow ? sign : 0,
      dirZ: isRow ? 0 : sign,
      speed: 1.6 + (i % 5) * 0.25,
      phase: i * 0.7,
    });
    dummy.position.set(x, 0, z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(i, dummy.matrix);
    cColor.setHSL((i * 0.13) % 1, 0.62, 0.54);
    crowdMesh.setColorAt(i, cColor);
  }
  crowdMesh.instanceMatrix.needsUpdate = true;
  if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
  scene.add(crowdMesh);
  disposables.push(pedGeo, pedMat);

  // 6. Instanced Ambient Traffic Vehicles (28 cruising city sedans)
  const trafficCount = 28;
  const tCarGeo = new THREE.BoxGeometry(1.9, 1.05, 4.1);
  tCarGeo.translate(0, 0.58, 0);
  const tCarMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.72,
    clearcoat: 0.85,
  });
  const trafficMesh = new THREE.InstancedMesh(tCarGeo, tCarMat, trafficCount);
  trafficMesh.frustumCulled = false;

  const trafficAgents: AmbientTrafficAgent[] = [];
  const palette = [0x38bdf8, 0xe11d48, 0xf59e0b, 0x10b981, 0xe2e8f0, 0x6366f1];
  for (let i = 0; i < trafficCount; i++) {
    const axis = i % 2 === 0 ? 'x' : 'z';
    const dir = i % 4 < 2 ? 1 : -1;
    const roadBase = roadCoords[i % roadCoords.length];
    const lanePos = roadBase + (dir === 1 ? 2.3 : -2.3);
    const coord = -100 + ((i * 23) % 200);
    const color = new THREE.Color(palette[i % palette.length]);
    trafficAgents.push({
      index: i,
      axis,
      lanePos,
      coord,
      dir,
      speed: 11 + (i % 4) * 2.2,
      color,
    });
    trafficMesh.setColorAt(i, color);
  }
  if (trafficMesh.instanceColor) trafficMesh.instanceColor.needsUpdate = true;
  scene.add(trafficMesh);
  disposables.push(tCarGeo, tCarMat);

  return {
    colliders,
    trafficMesh,
    trafficAgents,
    crowdMesh,
    crowdAgents,
    waterMat,
    oceanUniforms,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
