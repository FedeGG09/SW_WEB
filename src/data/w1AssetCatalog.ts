import type { AssetRecord } from './assetCatalog';

export interface W1AssetRecord extends AssetRecord { id: string; sourcePath: string; }
export const w1AssetCatalog: W1AssetRecord[] = [
  {
    "id": "shipExterior",
    "file": "star_wars_yt-2000.glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/donors/star_wars_yt-2000.glb",
    "fileSize": 2120068,
    "format": "GLB",
    "meshCount": 20,
    "triangleCount": 31028,
    "materialCount": 5,
    "textureCount": 2,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -4.6451802253723145,
        -1.598080039024353,
        -0.46865999698638916
      ],
      "max": [
        4.6451802253723145,
        9.083720207214355,
        1.3723200559616089
      ],
      "size": [
        9.290360450744629,
        10.681800246238708,
        1.840980052947998
      ]
    },
    "approximateHeight": 10.681800246238708,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "id": "shipInterior",
    "file": "star_wars_galaxies_-_yt1300_inside.glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/donors/star_wars_galaxies_-_yt1300_inside.glb",
    "fileSize": 9131508,
    "format": "GLB",
    "meshCount": 22,
    "triangleCount": 47516,
    "materialCount": 22,
    "textureCount": 27,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -13.217951774597168,
        -13.490970611572266,
        -3.1595640182495117
      ],
      "max": [
        14.912714004516602,
        12.667234420776367,
        3.235243082046509
      ],
      "size": [
        28.13066577911377,
        26.158205032348633,
        6.3948071002960205
      ]
    },
    "approximateHeight": 26.158205032348633,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "id": "cityKit",
    "file": "star_wars_inspired_low_poly_buildings.glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/donors/star_wars_inspired_low_poly_buildings.glb",
    "fileSize": 4441884,
    "format": "GLB",
    "meshCount": 13,
    "triangleCount": 68407,
    "materialCount": 1,
    "textureCount": 1,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -67.40953063964844,
        -62.7110595703125,
        -0.5850560069084167
      ],
      "max": [
        83.90596008300781,
        41.01654815673828,
        36.761962890625
      ],
      "size": [
        151.31549072265625,
        103.72760772705078,
        37.34701889753342
      ]
    },
    "approximateHeight": 103.72760772705078,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "id": "cantina",
    "file": "mos_eisley_cantina_star_wars.glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/donors/mos_eisley_cantina_star_wars.glb",
    "fileSize": 34295744,
    "format": "GLB",
    "meshCount": 108,
    "triangleCount": 38111,
    "materialCount": 16,
    "textureCount": 39,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -32.980098724365234,
        -41.62522888183594,
        -13.289030075073242
      ],
      "max": [
        49.58000183105469,
        40.32738494873047,
        50.31809997558594
      ],
      "size": [
        82.56010055541992,
        81.9526138305664,
        63.60713005065918
      ]
    },
    "approximateHeight": 81.9526138305664,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "id": "nara",
    "file": "nara_voss_twilek_v1.glb",
    "sourcePath": "public/assets/characters/nara/nara_voss_twilek_v1.glb",
    "fileSize": 18692316,
    "format": "GLB",
    "meshCount": 9,
    "triangleCount": 52563,
    "materialCount": 9,
    "textureCount": 18,
    "skeletonCount": 1,
    "boneCount": 755,
    "animationGroups": 11,
    "animationNames": [
      "walk_forward_v2",
      "idle_v2",
      "combat_ready",
      "slash_forward",
      "slash_left",
      "slash_right",
      "slash_diagonal_left",
      "slash_diagonal_right",
      "heavy_overhead",
      "block_center",
      "parry_right"
    ],
    "bounds": {
      "min": [-1.00936546, 0.0016799653, -0.351458895],
      "max": [1.00674373, 3.24169727, 0.588359823],
      "size": [2.01610919, 3.24001730, 0.93981872]
    },
    "approximateHeight": 3.24001730,
    "category": "CHARACTER",
    "performance": "MEDIUM"
  },
  {
    "id": "roughMountains",
    "file": "rough_mountaintop_landscape.glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/rough_mountaintop_landscape.glb",
    "fileSize": 28791544,
    "format": "GLB",
    "meshCount": 6,
    "triangleCount": 648512,
    "materialCount": 1,
    "textureCount": 2,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -2500,
        0,
        -2500
      ],
      "max": [
        2498.779541015625,
        1324.1473388671875,
        2498.779541015625
      ],
      "size": [
        4998.779541015625,
        1324.1473388671875,
        4998.779541015625
      ]
    },
    "approximateHeight": 1324.1473388671875,
    "category": "ENVIRONMENT",
    "performance": "VERY_HEAVY"
  },
  {
    "id": "forestMountains",
    "file": "the_landscape_is_a_forest_in_the_mountains.glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/the_landscape_is_a_forest_in_the_mountains.glb",
    "fileSize": 10462128,
    "format": "GLB",
    "meshCount": 546,
    "triangleCount": 19419,
    "materialCount": 10,
    "textureCount": 14,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -20.243139266967773,
        -20.243162155151367,
        -0.43846309185028076
      ],
      "max": [
        20.243139266967773,
        20.24311637878418,
        6.452828884124756
      ],
      "size": [
        40.48627853393555,
        40.48627853393555,
        6.891291975975037
      ]
    },
    "approximateHeight": 40.48627853393555,
    "category": "ENVIRONMENT",
    "performance": "LIGHT"
  },
  {
    "id": "secondaryCityKit",
    "file": "star_wars_tatooine (1).glb",
    "sourcePath": "C:/Users/Usuario/Documents/NerathisRPG/assets/star_wars_tatooine (1).glb",
    "fileSize": 38166220,
    "format": "GLB",
    "meshCount": 31,
    "triangleCount": 228464,
    "materialCount": 8,
    "textureCount": 26,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -59.589324951171875,
        -60.64529800415039,
        -47.806968688964844
      ],
      "max": [
        61.244911193847656,
        60.78325271606445,
        19.886489868164062
      ],
      "size": [
        120.83423614501953,
        121.42855072021484,
        67.6934585571289
      ]
    },
    "approximateHeight": 121.42855072021484,
    "category": "ENVIRONMENT",
    "performance": "HEAVY"
  }
] as W1AssetRecord[];
