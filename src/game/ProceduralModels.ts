import * as THREE from 'three';

let sharedContactShadowTex: THREE.CanvasTexture | null = null;

export function getContactShadowTexture(): THREE.CanvasTexture {
  if (sharedContactShadowTex) return sharedContactShadowTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedContactShadowTex = tex;
  return tex;
}

export function createCitizenModel(options: {
  shirtColor: number;
  accentColor?: number;
  pantsColor?: number;
  skinColor?: number;
}): THREE.Group {
  const root = new THREE.Group();
  const shadowGeo = new THREE.PlaneGeometry(1.15, 1.15);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.45,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  root.add(shadow);

  const jacketMat = new THREE.MeshStandardMaterial({
    color: options.shirtColor,
    roughness: 0.72,
    metalness: 0.06,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: options.pantsColor ?? 0x1e293b,
    roughness: 0.85,
    metalness: 0.04,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: options.skinColor ?? 0xd8a483,
    roughness: 0.62,
    metalness: 0.02,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.14,
    metalness: 0.88,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: options.accentColor ?? 0xf59e0b,
    roughness: 0.3,
    metalness: 0.6,
  });

  // Legs (bottom-center grounded at y = 0)
  const legGeo = new THREE.BoxGeometry(0.2, 0.74, 0.22);
  legGeo.translate(0, -0.37, 0);

  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.set(-0.14, 0.74, 0);
  leftLeg.castShadow = true;
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.set(0.14, 0.74, 0);
  rightLeg.castShadow = true;
  root.add(rightLeg);

  // Torso jacket + collar accent
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), jacketMat);
  torso.position.set(0, 1.08, 0);
  torso.castShadow = true;
  root.add(torso);

  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), trimMat);
  collar.position.set(0, 1.38, 0.01);
  root.add(collar);

  // Arms
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  armGeo.translate(0, -0.26, 0);

  const leftArm = new THREE.Mesh(armGeo, jacketMat);
  leftArm.position.set(-0.36, 1.35, 0);
  leftArm.castShadow = true;
  root.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, jacketMat);
  rightArm.position.set(0.36, 1.35, 0);
  rightArm.castShadow = true;
  root.add(rightArm);

  // Head + Sunglasses
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 14), skinMat);
  head.position.set(0, 1.62, 0);
  head.castShadow = true;
  root.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.14), visorMat);
  visor.position.set(0, 1.64, 0.13);
  root.add(visor);

  root.userData = { leftLeg, rightLeg, leftArm, rightArm };
  return root;
}

export function createSportsCarModel(bodyColor = 0xe11d48): THREE.Group {
  const car = new THREE.Group();

  // Ground contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.1),
    new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  car.add(shadow);

  // Sculpted wedge profile using beveled ExtrudeGeometry
  const sideProfile = new THREE.Shape();
  sideProfile.moveTo(-2.15, 0.28);
  sideProfile.lineTo(2.15, 0.28);
  sideProfile.lineTo(2.22, 0.62);
  sideProfile.lineTo(1.2, 0.84);
  sideProfile.lineTo(0.45, 1.24);
  sideProfile.lineTo(-0.85, 1.24);
  sideProfile.lineTo(-1.75, 0.88);
  sideProfile.lineTo(-2.18, 0.78);
  sideProfile.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(sideProfile, {
    depth: 1.82,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 2,
  });
  bodyGeo.center();
  // Rotate so length aligns with Z axis (+Z forward)
  bodyGeo.rotateY(-Math.PI / 2);

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    metalness: 0.68,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const chassis = new THREE.Mesh(bodyGeo, paintMat);
  chassis.position.y = 0.74;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  car.add(chassis);

  // Tinted glass canopy
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.9,
    roughness: 0.08,
  });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.36, 1.8), glassMat);
  cabin.position.set(0, 1.06, -0.15);
  car.add(cabin);

  // Matte carbon front splitter & rear wing
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.65,
    metalness: 0.25,
  });
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.08, 0.36), carbonMat);
  splitter.position.set(0, 0.28, 2.18);
  car.add(splitter);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.06, 0.28), carbonMat);
  wing.position.set(0, 1.14, -2.02);
  car.add(wing);

  // Headlights & Taillights
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfef9c3,
    emissive: 0xfef08a,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xe11d48,
    emissiveIntensity: 1.3,
    roughness: 0.2,
  });

  [-0.68, 0.68].forEach((x) => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.08), headMat);
    hl.position.set(x, 0.56, 2.24);
    car.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.08), tailMat);
    tl.position.set(x, 0.72, -2.22);
    car.add(tl);
  });

  // 4 composite wheels (tire + brushed alloy rim)
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.2, metalness: 0.92 });
  const wheelOffsets: Array<[number, number, number]> = [
    [-0.95, 0.36, 1.42],
    [0.95, 0.36, 1.42],
    [-0.95, 0.36, -1.42],
    [0.95, 0.36, -1.42],
  ];
  const wheels: THREE.Group[] = [];
  for (const [wx, wy, wz] of wheelOffsets) {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 12), rimMat);
    rim.rotation.z = Math.PI / 2;
    wg.add(tire, rim);
    wg.position.set(wx, wy, wz);
    car.add(wg);
    wheels.push(wg);
  }

  car.userData = { wheels };
  return car;
}
