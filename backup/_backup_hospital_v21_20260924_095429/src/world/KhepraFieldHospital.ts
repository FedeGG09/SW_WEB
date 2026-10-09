import {
  Color3,
  Mesh,
  MeshBuilder,
  PointLight,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

import { NerathisMaterialLibrary } from './materials/NerathisMaterialLibrary';

type HospitalMaterial = PBRMaterial | StandardMaterial;

export const FIELD_HOSPITAL_CENTER = new Vector3(8, 0, -58);

export interface FieldHospitalCollision {
  name: string;
  center: Vector3;
  size: Vector3;
  cameraBlocker?: boolean;
}

export interface FieldHospitalBuildResult {
  meshes: Mesh[];
  lights: PointLight[];
  collisions: FieldHospitalCollision[];
}

/**
 * KHEPRA VALE — DISTRICT 02
 * HOSPITALES DE CAMPAÑA
 *
 * V2 — NOVEL ALIGNMENT PASS
 *
 * Narrative authority:
 *
 * The medical district is NOT a purpose-built hospital complex.
 *
 * Its primary structure is an old industrial machinery warehouse belonging
 * to Cooperativa Khepra, forcibly converted into CLÍNICA 2 after the attack.
 *
 * Design goals:
 *
 * - preserve the approved location and gameplay scale from V1;
 * - replace repetitive medical boxes with one dominant industrial warehouse;
 * - make the conversion from industry -> emergency medicine visually obvious;
 * - expose part of the medical interior to the player;
 * - add overflow beds and improvised treatment areas;
 * - add the missing-person registry;
 * - add old industrial wear, grease, standing water and emergency repairs;
 * - introduce blue / white / red search markings;
 * - keep the route Spaceport -> Hospital -> Khepra open;
 * - prepare narrative locations for Elyra, Jalen, Nara and later NPC passes.
 */
export function buildKhepraFieldHospital(
  scene: Scene,
  materials: NerathisMaterialLibrary,
): FieldHospitalBuildResult {
  const meshes: Mesh[] = [];
  const lights: PointLight[] = [];
  const collisions: FieldHospitalCollision[] = [];

  // ----------------------------------------------------------------
  // MATERIAL LANGUAGE
  // ----------------------------------------------------------------

  const dark = materials.darkSteel;
  const wetMetal = materials.atlasWallWetMetal;
  const concrete = materials.atlasWallConcrete;
  const concreteB = materials.atlasWallConcreteB;

  const platform = materials.atlasFloorPlatform;
  const grate = materials.atlasFloorGrate;

  const canvas = materials.wetCanvas;
  const roofCanvas = materials.atlasRoofCanvas;
  const roofMetal = materials.atlasRoofMetal;
  const roofPanel = materials.atlasRoofPanel;

  const pipe = materials.atlasDetailPipe;
  const panel = materials.atlasDetailPanel;
  const vent = materials.atlasDetailVent;

  const warm = materials.warmGlass;
  const cold = materials.shipGlass;

  const emergency = materials.redBeacon;

  const yellow = materials.spaceportSafetyYellow;
  const neutral = materials.spaceportNeutralMarking;

  const DECK_Y = 0.20;
  const DECK_HEIGHT = 0.24;

  // ----------------------------------------------------------------
  // GENERIC HELPERS
  // ----------------------------------------------------------------

  const addBox = (
    name: string,
    width: number,
    height: number,
    depth: number,
    position: Vector3,
    material: HospitalMaterial,
    zone = 'FIELD_HOSPITAL',
  ) => {
    const mesh = MeshBuilder.CreateBox(
      name,
      {
        width,
        height,
        depth,
      },
      scene,
    );

    mesh.position.copyFrom(position);
    mesh.material = material;
    mesh.isPickable = false;

    mesh.metadata = {
      materialFamily:
        material === canvas ||
        material === roofCanvas
          ? 'CANVAS'
          : material === concrete ||
              material === concreteB
            ? 'CONCRETE'
            : material === emergency
              ? 'EMERGENCY'
              : material === cold
                ? 'COLD_LIGHT'
                : material === warm
                  ? 'WARM_LIGHT'
                  : 'METAL',

      mapping:
        'FIELD_HOSPITAL_V2_NOVEL',

      zone,
    };

    meshes.push(mesh);

    return mesh;
  };

  const addCylinder = (
    name: string,
    height: number,
    diameter: number,
    position: Vector3,
    material: HospitalMaterial,
    zone: string,
  ) => {
    const mesh =
      MeshBuilder.CreateCylinder(
        name,
        {
          height,
          diameter,
          tessellation: 12,
        },
        scene,
      );

    mesh.position.copyFrom(position);
    mesh.material = material;
    mesh.isPickable = false;

    mesh.metadata = {
      materialFamily: 'METAL',
      mapping:
        'FIELD_HOSPITAL_V2_NOVEL',
      zone,
    };

    meshes.push(mesh);

    return mesh;
  };

  const addCollision = (
    name: string,
    center: Vector3,
    size: Vector3,
    cameraBlocker = true,
  ) => {
    collisions.push({
      name,
      center: center.clone(),
      size: size.clone(),
      cameraBlocker,
    });
  };

  // ----------------------------------------------------------------
  // PILES / PLATFORMS
  // ----------------------------------------------------------------

  const addPiling = (
    name: string,
    x: number,
    z: number,
    height = 3.5,
  ) => {
    addBox(
      name,
      0.34,
      height,
      0.34,
      new Vector3(
        x,
        DECK_Y - height * 0.5,
        z,
      ),
      dark,
      'FIELD_HOSPITAL_PILING',
    );
  };

  const addPlatform = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    material: HospitalMaterial = platform,
  ) => {
    addBox(
      `${name}_deck`,
      width,
      DECK_HEIGHT,
      depth,
      new Vector3(
        x,
        DECK_Y,
        z,
      ),
      material,
      'FIELD_HOSPITAL_PLATFORM',
    );

    const px = width * 0.42;
    const pz = depth * 0.40;

    addPiling(
      `${name}_piling_nw`,
      x - px,
      z - pz,
    );

    addPiling(
      `${name}_piling_ne`,
      x + px,
      z - pz,
    );

    addPiling(
      `${name}_piling_sw`,
      x - px,
      z + pz,
    );

    addPiling(
      `${name}_piling_se`,
      x + px,
      z + pz,
    );
  };

  // ----------------------------------------------------------------
  // WALKWAYS
  // ----------------------------------------------------------------

  const addWalkway = (
    name: string,
    from: Vector3,
    to: Vector3,
    width = 3.4,
    rails = true,
  ) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;

    const length =
      Math.sqrt(
        dx * dx + dz * dz,
      );

    if (length <= 0.01) {
      return;
    }

    const center =
      from.add(to).scale(0.5);

    const rotationY =
      Math.atan2(dx, dz);

    const deck = addBox(
      `${name}_deck`,
      width,
      0.18,
      length,
      new Vector3(
        center.x,
        DECK_Y + 0.02,
        center.z,
      ),
      grate,
      'FIELD_HOSPITAL_WALKWAY',
    );

    deck.rotation.y = rotationY;

    if (!rails) {
      return;
    }

    const direction =
      new Vector3(
        dx,
        0,
        dz,
      ).normalize();

    const perpendicular =
      new Vector3(
        -direction.z,
        0,
        direction.x,
      );

    const offset =
      perpendicular.scale(
        width * 0.5 - 0.10,
      );

    for (const [side, sign] of [
      ['left', 1],
      ['right', -1],
    ] as const) {
      const railCenter =
        center.add(
          offset.scale(sign),
        );

      const rail =
        addBox(
          `${name}_rail_${side}`,
          0.10,
          0.88,
          length,
          new Vector3(
            railCenter.x,
            DECK_Y + 0.55,
            railCenter.z,
          ),
          dark,
          'FIELD_HOSPITAL_RAIL',
        );

      rail.rotation.y = rotationY;
    }
  };

  // ----------------------------------------------------------------
  // MEDICAL COT
  // ----------------------------------------------------------------

  const addCot = (
    name: string,
    x: number,
    z: number,
    rotationY = 0,
    blanket = false,
  ) => {
    const rootY =
      DECK_Y + 0.37;

    const frame = addBox(
      `${name}_frame`,
      0.95,
      0.16,
      2.05,
      new Vector3(
        x,
        rootY,
        z,
      ),
      dark,
      'FIELD_HOSPITAL_COT',
    );

    frame.rotation.y = rotationY;

    const mattress = addBox(
      `${name}_mattress`,
      0.85,
      0.12,
      1.86,
      new Vector3(
        x,
        rootY + 0.13,
        z,
      ),
      concreteB,
      'FIELD_HOSPITAL_COT',
    );

    mattress.rotation.y = rotationY;

    if (blanket) {
      const cover = addBox(
        `${name}_blanket`,
        0.88,
        0.055,
        0.92,
        new Vector3(
          x,
          rootY + 0.22,
          z + 0.34,
        ),
        canvas,
        'FIELD_HOSPITAL_COT',
      );

      cover.rotation.y = rotationY;
    }
  };

  // ----------------------------------------------------------------
  // TREATMENT / WORKSHOP TABLE
  // ----------------------------------------------------------------

  const addTreatmentTable = (
    name: string,
    x: number,
    z: number,
  ) => {
    addBox(
      `${name}_top`,
      1.55,
      0.12,
      0.72,
      new Vector3(
        x,
        DECK_Y + 0.92,
        z,
      ),
      wetMetal,
      'FIELD_HOSPITAL_TREATMENT',
    );

    for (const dx of [-0.62, 0.62]) {
      addBox(
        `${name}_leg_${dx}`,
        0.10,
        0.78,
        0.10,
        new Vector3(
          x + dx,
          DECK_Y + 0.52,
          z,
        ),
        dark,
        'FIELD_HOSPITAL_TREATMENT',
      );
    }
  };

  // ----------------------------------------------------------------
  // SERVICE LIGHT
  // ----------------------------------------------------------------

  const addServicePost = (
    name: string,
    x: number,
    z: number,
    lightMaterial: HospitalMaterial,
  ) => {
    addBox(
      `${name}_post`,
      0.14,
      2.45,
      0.14,
      new Vector3(
        x,
        1.42,
        z,
      ),
      dark,
      'FIELD_HOSPITAL_LIGHTING',
    );

    addBox(
      `${name}_lamp`,
      0.34,
      0.18,
      0.34,
      new Vector3(
        x,
        2.60,
        z,
      ),
      lightMaterial,
      'FIELD_HOSPITAL_LIGHTING',
    );
  };

  // ================================================================
  // 1. ISLAND / ROUTE
  // ================================================================

  addPlatform(
    'field_hospital_main',
    FIELD_HOSPITAL_CENTER.x,
    FIELD_HOSPITAL_CENTER.z,
    28,
    21,
    platform,
  );

  addPlatform(
    'field_hospital_arrival',
    0,
    -51.8,
    8.5,
    8.2,
    grate,
  );

  addPlatform(
    'field_hospital_north_service',
    11.5,
    -70.1,
    13,
    6.2,
    platform,
  );

  // Spaceport -> Hospital.
  addWalkway(
    'field_hospital_entry_bridge',
    new Vector3(
      0,
      0,
      -45.8,
    ),
    new Vector3(
      0,
      0,
      -49.0,
    ),
    4.5,
  );

  // Hospital -> rest of Khepra.
  addWalkway(
    'field_hospital_exit_bridge',
    new Vector3(
      0,
      0,
      -66.7,
    ),
    new Vector3(
      0,
      0,
      -74,
    ),
    4.2,
  );

  // Clear pedestrian corridor on the western side.
  addBox(
    'field_hospital_primary_route',
    4.4,
    0.035,
    17.5,
    new Vector3(
      -0.3,
      DECK_Y + 0.15,
      -58.5,
    ),
    grate,
    'FIELD_HOSPITAL_ROUTE',
  );

  // ================================================================
  // 2. CLÍNICA 2 — OLD INDUSTRIAL WAREHOUSE
  // ================================================================

  const clinic = {
    x: 10.1,
    z: -60.2,
    width: 16.2,
    depth: 11.3,
    height: 5.4,
  };

  const clinicFloorY =
    DECK_Y +
    DECK_HEIGHT * 0.5 +
    0.07;

  const halfW =
    clinic.width * 0.5;

  const halfD =
    clinic.depth * 0.5;

  const wallThickness = 0.30;

  const frontZ =
    clinic.z + halfD;

  const backZ =
    clinic.z - halfD;

  const leftX =
    clinic.x - halfW;

  const rightX =
    clinic.x + halfW;

  // ----------------------------------------------------------------
  // Industrial floor
  // ----------------------------------------------------------------

  addBox(
    'clinic2_industrial_floor',
    clinic.width,
    0.14,
    clinic.depth,
    new Vector3(
      clinic.x,
      clinicFloorY,
      clinic.z,
    ),
    concrete,
    'CLINIC2_FLOOR',
  );

  // ----------------------------------------------------------------
  // Back wall
  // ----------------------------------------------------------------

  addBox(
    'clinic2_back_wall',
    clinic.width,
    clinic.height,
    wallThickness,
    new Vector3(
      clinic.x,
      clinic.height * 0.5 + 0.28,
      backZ,
    ),
    wetMetal,
    'CLINIC2_SHELL',
  );

  addCollision(
    'clinic2_back_wall_collision',
    new Vector3(
      clinic.x,
      clinic.height * 0.5,
      backZ,
    ),
    new Vector3(
      clinic.width,
      clinic.height,
      wallThickness + 0.20,
    ),
  );

  // ----------------------------------------------------------------
  // Side walls
  // ----------------------------------------------------------------

  for (const [side, x] of [
    ['west', leftX],
    ['east', rightX],
  ] as const) {
    addBox(
      `clinic2_${side}_wall`,
      wallThickness,
      clinic.height,
      clinic.depth,
      new Vector3(
        x,
        clinic.height * 0.5 + 0.28,
        clinic.z,
      ),
      wetMetal,
      'CLINIC2_SHELL',
    );

    addCollision(
      `clinic2_${side}_wall_collision`,
      new Vector3(
        x,
        clinic.height * 0.5,
        clinic.z,
      ),
      new Vector3(
        wallThickness + 0.20,
        clinic.height,
        clinic.depth,
      ),
    );
  }

  // ----------------------------------------------------------------
  // Front wall with giant machinery door left OPEN.
  // ----------------------------------------------------------------

  const doorWidth = 7.2;
  const frontSegment =
    (clinic.width - doorWidth) * 0.5;

  const frontLeftX =
    clinic.x -
    doorWidth * 0.5 -
    frontSegment * 0.5;

  const frontRightX =
    clinic.x +
    doorWidth * 0.5 +
    frontSegment * 0.5;

  for (const [side, x] of [
    ['left', frontLeftX],
    ['right', frontRightX],
  ] as const) {
    addBox(
      `clinic2_front_${side}`,
      frontSegment,
      clinic.height,
      wallThickness,
      new Vector3(
        x,
        clinic.height * 0.5 + 0.28,
        frontZ,
      ),
      wetMetal,
      'CLINIC2_SHELL',
    );

    addCollision(
      `clinic2_front_${side}_collision`,
      new Vector3(
        x,
        clinic.height * 0.5,
        frontZ,
      ),
      new Vector3(
        frontSegment,
        clinic.height,
        wallThickness + 0.20,
      ),
    );
  }

  // Massive door frame.
  addBox(
    'clinic2_door_frame_left',
    0.30,
    4.3,
    0.35,
    new Vector3(
      clinic.x - doorWidth * 0.5,
      2.42,
      frontZ + 0.04,
    ),
    dark,
    'CLINIC2_DOOR',
  );

  addBox(
    'clinic2_door_frame_right',
    0.30,
    4.3,
    0.35,
    new Vector3(
      clinic.x + doorWidth * 0.5,
      2.42,
      frontZ + 0.04,
    ),
    dark,
    'CLINIC2_DOOR',
  );

  addBox(
    'clinic2_door_lintel',
    doorWidth + 0.35,
    0.35,
    0.35,
    new Vector3(
      clinic.x,
      4.48,
      frontZ + 0.04,
    ),
    dark,
    'CLINIC2_DOOR',
  );

  // ================================================================
  // 3. INDUSTRIAL ROOF
  // ================================================================

  const roofLeft =
    addBox(
      'clinic2_roof_left',
      clinic.width * 0.53,
      0.18,
      clinic.depth + 0.7,
      new Vector3(
        clinic.x -
          clinic.width * 0.245,
        clinic.height + 0.58,
        clinic.z,
      ),
      roofMetal,
      'CLINIC2_ROOF',
    );

  roofLeft.rotation.z = -0.11;

  const roofRight =
    addBox(
      'clinic2_roof_right',
      clinic.width * 0.53,
      0.18,
      clinic.depth + 0.7,
      new Vector3(
        clinic.x +
          clinic.width * 0.245,
        clinic.height + 0.58,
        clinic.z,
      ),
      roofPanel,
      'CLINIC2_ROOF',
    );

  roofRight.rotation.z = 0.11;

  // Some imperfect replacement sheeting.
  const patchRoof =
    addBox(
      'clinic2_roof_repair_patch',
      3.6,
      0.10,
      4.0,
      new Vector3(
        clinic.x + 3.1,
        clinic.height + 0.75,
        clinic.z - 1.4,
      ),
      dark,
      'CLINIC2_REPAIR',
    );

  patchRoof.rotation.z = 0.08;

  // ================================================================
  // 4. INDUSTRIAL STRUCTURAL FRAME
  // ================================================================

  for (const x of [
    clinic.x - 6.3,
    clinic.x - 2.1,
    clinic.x + 2.1,
    clinic.x + 6.3,
  ]) {
    addBox(
      `clinic2_internal_column_${x}`,
      0.24,
      5.0,
      0.24,
      new Vector3(
        x,
        2.70,
        clinic.z,
      ),
      dark,
      'CLINIC2_STRUCTURE',
    );

    addBox(
      `clinic2_overhead_beam_${x}`,
      0.22,
      0.22,
      clinic.depth - 0.7,
      new Vector3(
        x,
        4.95,
        clinic.z,
      ),
      dark,
      'CLINIC2_STRUCTURE',
    );
  }

  addBox(
    'clinic2_longitudinal_beam',
    clinic.width - 0.7,
    0.24,
    0.24,
    new Vector3(
      clinic.x,
      4.95,
      clinic.z,
    ),
    dark,
    'CLINIC2_STRUCTURE',
  );

  // ================================================================
  // 5. ORIGINAL COOPERATIVA SIGN + CLÍNICA 2 INTERVENTION
  // ================================================================

  // Old corroded industrial plaque.
  addBox(
    'clinic2_original_cooperative_sign',
    8.8,
    0.82,
    0.10,
    new Vector3(
      clinic.x,
      4.55,
      frontZ + 0.23,
    ),
    panel,
    'CLINIC2_SIGNAGE_OLD',
  );

  // Crude red panel painted over the old identity.
  addBox(
    'clinic2_red_clinic2_sign',
    3.9,
    0.64,
    0.09,
    new Vector3(
      clinic.x + 1.8,
      3.60,
      frontZ + 0.25,
    ),
    emergency,
    'CLINIC2_SIGNAGE_RED',
  );

  // Geometric "2" so the emergency designation reads even before
  // a future decal/text pass.
  const digitX =
    clinic.x + 2.65;

  const digitZ =
    frontZ + 0.31;

  for (const [name, x, y, w, h] of [
    ['top', digitX, 3.78, 0.60, 0.08],
    ['upper_right', digitX + 0.27, 3.62, 0.08, 0.32],
    ['middle', digitX, 3.46, 0.60, 0.08],
    ['lower_left', digitX - 0.27, 3.30, 0.08, 0.32],
    ['bottom', digitX, 3.14, 0.60, 0.08],
  ] as Array<
    [
      string,
      number,
      number,
      number,
      number,
    ]
  >) {
    addBox(
      `clinic2_number2_${name}`,
      w,
      h,
      0.035,
      new Vector3(
        x,
        y,
        digitZ,
      ),
      neutral,
      'CLINIC2_SIGNAGE_RED',
    );
  }

  // ================================================================
  // 6. OLD MACHINERY FLOOR GHOSTS / GREASE
  // ================================================================

  for (const [
    index,
    x,
    z,
    width,
    depth,
    rotation,
  ] of [
    [
      0,
      5.1,
      -57.5,
      2.4,
      1.3,
      0.07,
    ],

    [
      1,
      14.7,
      -58.8,
      2.0,
      1.0,
      -0.05,
    ],

    [
      2,
      6.4,
      -64.0,
      1.8,
      0.85,
      0.02,
    ],

    [
      3,
      14.2,
      -63.4,
      2.7,
      1.2,
      -0.08,
    ],
  ] as Array<
    [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  >) {
    const stain = addBox(
      `clinic2_old_machine_stain_${index}`,
      width,
      0.025,
      depth,
      new Vector3(
        x,
        clinicFloorY + 0.09,
        z,
      ),
      dark,
      'CLINIC2_FLOOR_HISTORY',
    );

    stain.rotation.y = rotation;
  }

  // ================================================================
  // 7. IMPROVISED MEDICAL INTERIOR
  // ================================================================

  // Left row.
  for (const [
    index,
    z,
    blanket,
  ] of [
    [0, -57.1, true],
    [1, -59.6, false],
    [2, -62.1, true],
    [3, -64.4, false],
  ] as Array<
    [
      number,
      number,
      boolean,
    ]
  >) {
    addCot(
      `clinic2_cot_left_${index}`,
      5.0,
      z,
      0,
      blanket,
    );
  }

  // Right row.
  for (const [
    index,
    z,
    blanket,
  ] of [
    [0, -57.0, false],
    [1, -59.5, true],
    [2, -62.0, false],
    [3, -64.5, true],
  ] as Array<
    [
      number,
      number,
      boolean,
    ]
  >) {
    addCot(
      `clinic2_cot_right_${index}`,
      15.25,
      z,
      0,
      blanket,
    );
  }

  // Workshop tables repurposed as medical treatment surfaces.
  addTreatmentTable(
    'clinic2_treatment_table_a',
    8.15,
    -59.1,
  );

  addTreatmentTable(
    'clinic2_treatment_table_b',
    12.0,
    -62.1,
  );

  // Blankets directly on the industrial floor.
  for (const [
    index,
    x,
    z,
  ] of [
    [0, 8.2, -64.0],
    [1, 10.3, -64.2],
    [2, 12.4, -64.0],
  ] as Array<
    [number, number, number]
  >) {
    const blanket =
      addBox(
        `clinic2_floor_blanket_${index}`,
        1.35,
        0.045,
        1.9,
        new Vector3(
          x,
          clinicFloorY + 0.11,
          z,
        ),
        canvas,
        'CLINIC2_OVERFLOW_INTERIOR',
      );

    blanket.rotation.y =
      index % 2 === 0
        ? 0.04
        : -0.05;
  }

  // ================================================================
  // 8. MANDALORIAN PATIENT RESERVED AREA
  // ================================================================

  addCot(
    'clinic2_mandalorian_patient_cot',
    16.0,
    -65.0,
    Math.PI * 0.5,
    true,
  );

  // Low divider — enough to establish a separate treatment zone.
  addBox(
    'clinic2_prisoner_zone_divider',
    0.12,
    1.35,
    3.4,
    new Vector3(
      13.6,
      0.95,
      -64.7,
    ),
    grate,
    'CLINIC2_PRISONER_AREA',
  );

  // ================================================================
  // 9. MEDICAL GAS / OXYGEN
  // ================================================================

  for (const [
    index,
    x,
    z,
  ] of [
    [0, 17.0, -57.3],
    [1, 17.65, -57.3],
    [2, 18.3, -57.3],
  ] as Array<
    [number, number, number]
  >) {
    addCylinder(
      `clinic2_medical_gas_${index}`,
      1.55,
      0.44,
      new Vector3(
        x,
        1.05,
        z,
      ),
      wetMetal,
      'CLINIC2_MEDICAL_GAS',
    );
  }

  addBox(
    'clinic2_medical_gas_pipe',
    2.5,
    0.18,
    0.18,
    new Vector3(
      17.65,
      1.70,
      -57.5,
    ),
    pipe,
    'CLINIC2_MEDICAL_GAS',
  );

  // ================================================================
  // 10. OVERFLOW MEDICAL CANOPY
  // ================================================================

  const overflowX = -2.0;
  const overflowZ = -59.5;

  const overflowRoof =
    addBox(
      'field_hospital_overflow_canvas',
      5.7,
      0.12,
      8.2,
      new Vector3(
        overflowX,
        3.05,
        overflowZ,
      ),
      roofCanvas,
      'FIELD_HOSPITAL_OVERFLOW',
    );

  overflowRoof.rotation.z =
    -0.05;

  for (const [
    index,
    x,
    z,
  ] of [
    [0, -4.4, -56.2],
    [1, 0.4, -56.2],
    [2, -4.4, -62.8],
    [3, 0.4, -62.8],
  ] as Array<
    [number, number, number]
  >) {
    addBox(
      `field_hospital_overflow_post_${index}`,
      0.13,
      2.85,
      0.13,
      new Vector3(
        x,
        1.63,
        z,
      ),
      dark,
      'FIELD_HOSPITAL_OVERFLOW',
    );
  }

  addCot(
    'field_hospital_overflow_cot_0',
    -3.25,
    -57.4,
    0,
    true,
  );

  addCot(
    'field_hospital_overflow_cot_1',
    -0.75,
    -59.8,
    0,
    false,
  );

  addCot(
    'field_hospital_overflow_cot_2',
    -3.15,
    -62.2,
    0,
    true,
  );

  // ================================================================
  // 11. MISSING PERSONS REGISTRY
  // ================================================================

  const registryX = -3.8;
  const registryZ = -53.8;

  // Main support structure.
  addBox(
    'field_hospital_missing_registry_board',
    4.7,
    2.4,
    0.16,
    new Vector3(
      registryX,
      1.55,
      registryZ,
    ),
    dark,
    'FIELD_HOSPITAL_MISSING_REGISTRY',
  );

  addCollision(
    'field_hospital_missing_registry_collision',
    new Vector3(
      registryX,
      1.2,
      registryZ,
    ),
    new Vector3(
      4.8,
      2.4,
      0.35,
    ),
    false,
  );

  // Hundreds of names are represented by many irregular paper rectangles.
  const notes = [
    [-5.3, 2.15, 0.58, 0.34],
    [-4.5, 2.18, 0.48, 0.28],
    [-3.8, 2.10, 0.62, 0.35],
    [-2.9, 2.20, 0.50, 0.31],
    [-5.0, 1.62, 0.56, 0.37],
    [-4.15, 1.60, 0.68, 0.34],
    [-3.15, 1.65, 0.55, 0.38],
    [-5.35, 1.10, 0.45, 0.29],
    [-4.65, 1.06, 0.58, 0.34],
    [-3.8, 1.10, 0.48, 0.31],
    [-3.05, 1.04, 0.64, 0.37],
    [-2.55, 1.55, 0.35, 0.26],
  ] as Array<
    [
      number,
      number,
      number,
      number,
    ]
  >;

  notes.forEach(
    (
      [
        x,
        y,
        width,
        height,
      ],
      index,
    ) => {
      addBox(
        `field_hospital_missing_note_${index}`,
        width,
        height,
        0.025,
        new Vector3(
          x,
          y,
          registryZ + 0.105,
        ),
        index % 7 === 0
          ? emergency
          : neutral,
        'FIELD_HOSPITAL_MISSING_REGISTRY',
      );
    },
  );

  // ================================================================
  // 12. IMPROVISED WAYFINDING
  // ================================================================

  const signPosts = [
    {
      name: 'water',
      x: -1.9,
      z: -51.0,
      material: cold,
    },

    {
      name: 'wounded',
      x: -0.8,
      z: -51.0,
      material: emergency,
    },

    {
      name: 'registry',
      x: -2.9,
      z: -51.0,
      material: neutral,
    },
  ];

  signPosts.forEach(
    (
      {
        name,
        x,
        z,
        material,
      },
    ) => {
      addBox(
        `field_hospital_sign_${name}_post`,
        0.10,
        1.75,
        0.10,
        new Vector3(
          x,
          1.08,
          z,
        ),
        dark,
        'FIELD_HOSPITAL_WAYFINDING',
      );

      addBox(
        `field_hospital_sign_${name}_plate`,
        1.05,
        0.42,
        0.07,
        new Vector3(
          x,
          1.82,
          z,
        ),
        material,
        'FIELD_HOSPITAL_WAYFINDING',
      );
    },
  );

  // ================================================================
  // 13. SEARCH MARKINGS
  //
  // Blue  = inspected
  // White = survivor found
  // Red   = dead
  // ================================================================

  const searchMarks = [
    {
      name: 'blue_a',
      x: 2.30,
      y: 1.80,
      z: -57.0,
      material: cold,
    },

    {
      name: 'white_a',
      x: 2.30,
      y: 1.18,
      z: -58.0,
      material: neutral,
    },

    {
      name: 'red_a',
      x: 2.30,
      y: 0.64,
      z: -59.0,
      material: emergency,
    },

    {
      name: 'red_b',
      x: 18.27,
      y: 1.45,
      z: -61.8,
      material: emergency,
    },
  ];

  searchMarks.forEach(
    (
      {
        name,
        x,
        y,
        z,
        material,
      },
    ) => {
      addBox(
        `field_hospital_search_mark_${name}`,
        0.52,
        0.52,
        0.035,
        new Vector3(
          x,
          y,
          z,
        ),
        material,
        'FIELD_HOSPITAL_SEARCH_MARK',
      );
    },
  );

  // ================================================================
  // 14. EXTERIOR SERVICE / GENERATORS
  // ================================================================

  for (const [
    index,
    x,
    z,
  ] of [
    [0, 15.3, -70.1],
    [1, 18.0, -70.0],
  ] as Array<
    [number, number, number]
  >) {
    addBox(
      `field_hospital_generator_${index}`,
      1.55,
      1.20,
      1.95,
      new Vector3(
        x,
        0.86,
        z,
      ),
      dark,
      'FIELD_HOSPITAL_GENERATOR',
    );

    addBox(
      `field_hospital_generator_panel_${index}`,
      0.90,
      0.42,
      0.05,
      new Vector3(
        x,
        0.95,
        z + 1.0,
      ),
      panel,
      'FIELD_HOSPITAL_GENERATOR',
    );

    addBox(
      `field_hospital_generator_vent_${index}`,
      0.72,
      0.32,
      0.06,
      new Vector3(
        x,
        0.50,
        z + 1.01,
      ),
      vent,
      'FIELD_HOSPITAL_GENERATOR',
    );

    addCollision(
      `field_hospital_generator_collision_${index}`,
      new Vector3(
        x,
        0.6,
        z,
      ),
      new Vector3(
        1.7,
        1.25,
        2.1,
      ),
    );
  }

  // ================================================================
  // 15. SUPPLY STACKS
  // ================================================================

  for (const [
    index,
    x,
    z,
    width,
    height,
    depth,
  ] of [
    [
      0,
      8.0,
      -70.2,
      1.3,
      0.9,
      1.1,
    ],

    [
      1,
      9.4,
      -69.8,
      1.0,
      0.7,
      0.9,
    ],

    [
      2,
      10.6,
      -70.4,
      1.4,
      1.1,
      1.0,
    ],

    [
      3,
      12.0,
      -69.8,
      0.9,
      0.8,
      0.9,
    ],
  ] as Array<
    [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  >) {
    addBox(
      `field_hospital_supply_crate_${index}`,
      width,
      height,
      depth,
      new Vector3(
        x,
        DECK_Y +
          height * 0.5 +
          0.15,
        z,
      ),
      concreteB,
      'FIELD_HOSPITAL_SUPPLIES',
    );
  }

  // ================================================================
  // 16. STANDING WATER / WET PATCHES
  // ================================================================

  for (const [
    index,
    x,
    z,
    width,
    depth,
    rotation,
  ] of [
    [
      0,
      -1.7,
      -55.5,
      2.1,
      0.7,
      0.18,
    ],

    [
      1,
      1.1,
      -63.8,
      1.5,
      0.8,
      -0.08,
    ],

    [
      2,
      19.0,
      -57.8,
      1.8,
      0.6,
      0.05,
    ],

    [
      3,
      5.6,
      -68.1,
      2.5,
      0.65,
      -0.13,
    ],
  ] as Array<
    [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  >) {
    const wetPatch =
      addBox(
        `field_hospital_wet_patch_${index}`,
        width,
        0.018,
        depth,
        new Vector3(
          x,
          DECK_Y + 0.145,
          z,
        ),
        wetMetal,
        'FIELD_HOSPITAL_WET_GROUND',
      );

    wetPatch.rotation.y =
      rotation;
  }

  // ================================================================
  // 17. SELECTIVE DAMAGE — BROKEN SERVICE SPUR
  // ================================================================

  addWalkway(
    'field_hospital_broken_service_spur',
    new Vector3(
      -5.0,
      0,
      -62.7,
    ),
    new Vector3(
      -10.2,
      0,
      -65.0,
    ),
    2.2,
    false,
  );

  // Broken rail remains, but no complete connection.
  const brokenRail =
    addBox(
      'field_hospital_broken_spur_rail',
      0.10,
      0.82,
      3.0,
      new Vector3(
        -7.1,
        0.78,
        -63.7,
      ),
      dark,
      'FIELD_HOSPITAL_DAMAGE',
    );

  brokenRail.rotation.y = 0.42;
  brokenRail.rotation.z = 0.20;

  // Hanging metal panel.
  const damagedPanel =
    addBox(
      'field_hospital_hanging_damage_panel',
      2.0,
      0.12,
      1.5,
      new Vector3(
        -9.7,
        0.05,
        -65.3,
      ),
      wetMetal,
      'FIELD_HOSPITAL_DAMAGE',
    );

  damagedPanel.rotation.x = 0.18;
  damagedPanel.rotation.z = -0.24;

  // ================================================================
  // 18. RESTRAINED SAFETY MARKINGS
  // ================================================================

  for (const x of [
    -4.9,
    21.0,
  ]) {
    addBox(
      `field_hospital_edge_warning_${x}`,
      0.075,
      0.025,
      13.5,
      new Vector3(
        x,
        DECK_Y + 0.16,
        -58.7,
      ),
      yellow,
      'FIELD_HOSPITAL_MARKING',
    );
  }

  addBox(
    'field_hospital_arrival_registration',
    4.2,
    0.025,
    0.10,
    new Vector3(
      0,
      DECK_Y + 0.16,
      -49.4,
    ),
    neutral,
    'FIELD_HOSPITAL_MARKING',
  );

  addBox(
    'field_hospital_exit_registration',
    4.0,
    0.025,
    0.10,
    new Vector3(
      0,
      DECK_Y + 0.16,
      -66.5,
    ),
    neutral,
    'FIELD_HOSPITAL_MARKING',
  );

  // ================================================================
  // 19. LIGHTING
  // ================================================================

  addServicePost(
    'field_hospital_arrival_light',
    -2.7,
    -50.2,
    cold,
  );

  addServicePost(
    'field_hospital_registry_light',
    -5.0,
    -53.1,
    warm,
  );

  addServicePost(
    'field_hospital_north_light',
    4.0,
    -68.2,
    cold,
  );

  // Main clinic work light.
  const clinicMainLight =
    new PointLight(
      'FieldHospitalClinicMainLight',
      new Vector3(
        10.1,
        4.35,
        -59.0,
      ),
      scene,
    );

  clinicMainLight.diffuse =
    new Color3(
      0.66,
      0.82,
      1.0,
    );

  clinicMainLight.intensity =
    7.5;

  clinicMainLight.range =
    11;

  lights.push(
    clinicMainLight,
  );

  // Rear medical light.
  const clinicRearLight =
    new PointLight(
      'FieldHospitalClinicRearLight',
      new Vector3(
        10.1,
        3.6,
        -64.0,
      ),
      scene,
    );

  clinicRearLight.diffuse =
    new Color3(
      0.72,
      0.88,
      1.0,
    );

  clinicRearLight.intensity =
    5.0;

  clinicRearLight.range =
    8.5;

  lights.push(
    clinicRearLight,
  );

  // Exterior warm service light.
  const exteriorLight =
    new PointLight(
      'FieldHospitalExteriorWarmLight',
      new Vector3(
        -2.3,
        3.0,
        -54.5,
      ),
      scene,
    );

  exteriorLight.diffuse =
    new Color3(
      1.0,
      0.55,
      0.28,
    );

  exteriorLight.intensity =
    3.6;

  exteriorLight.range =
    7.5;

  lights.push(
    exteriorLight,
  );

  // ================================================================
  // 20. EMERGENCY BEACONS
  //
  // Restrained. The hospital is exhausted, not a nightclub.
  // ================================================================

  for (const [
    index,
    x,
    z,
  ] of [
    [0, -4.8, -50.0],
    [1, 19.4, -54.1],
    [2, 18.8, -67.0],
  ] as Array<
    [number, number, number]
  >) {
    addBox(
      `field_hospital_emergency_beacon_${index}`,
      0.15,
      0.72,
      0.15,
      new Vector3(
        x,
        0.72,
        z,
      ),
      emergency,
      'FIELD_HOSPITAL_EMERGENCY',
    );
  }

  // ================================================================
  // 21. STORY / FUTURE NPC ANCHORS
  //
  // These are deliberately non-visible. Their names establish stable
  // authored coordinates for later Elyra / Jalen / Nara / Tarev passes.
  // ================================================================

  const storyAnchors = [
    {
      name: 'ELYRA',
      position: new Vector3(
        9.1,
        DECK_Y,
        -57.6,
      ),
    },

    {
      name: 'JALEN',
      position: new Vector3(
        11.1,
        DECK_Y,
        -58.0,
      ),
    },

    {
      name: 'NARA',
      position: new Vector3(
        7.3,
        DECK_Y,
        -61.7,
      ),
    },

    {
      name: 'TAREV',
      position: new Vector3(
        5.0,
        DECK_Y,
        -59.6,
      ),
    },

    {
      name: 'MANDALORIAN',
      position: new Vector3(
        16.0,
        DECK_Y,
        -65.0,
      ),
    },
  ];

  storyAnchors.forEach(
    ({
      name,
      position,
    }) => {
      const anchor =
        addBox(
          `FIELD_HOSPITAL_STORY_ANCHOR_${name}`,
          0.02,
          0.02,
          0.02,
          position,
          dark,
          'FIELD_HOSPITAL_STORY_ANCHOR',
        );

      anchor.setEnabled(false);

      anchor.metadata = {
        ...anchor.metadata,

        storyAnchor: name,

        authoredPosition:
          position.asArray(),
      };
    },
  );

  // ================================================================
  // RETURN
  // ================================================================

  return {
    meshes,
    lights,
    collisions,
  };
}