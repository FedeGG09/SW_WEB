export type AssetCategory = 'CHARACTER' | 'CREATURE' | 'WEAPON' | 'ENVIRONMENT' | 'PROP' | 'UNKNOWN';
export type PerformanceClass = 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'VERY_HEAVY';
export interface AssetRecord {
  file: string; sourcePath: string; fileSize: number; format: string; category: AssetCategory;
  performance?: PerformanceClass; meshCount?: number; triangleCount?: number; materialCount?: number;
  textureCount?: number; skeletonCount?: number; boneCount?: number; animationGroups?: number;
  animationNames?: string[]; approximateHeight?: number; bounds?: { min: number[]; max: number[]; size: number[] } | null;
}
export const assetCatalog: AssetRecord[] = [
  {
    "file": "Twilek_Standard_Walk.usdz",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Aliados\\Twilek_Standard_Walk.usdz",
    "fileSize": 9346333,
    "format": "USDZ",
    "category": "CHARACTER"
  },
  {
    "file": "star_wars_ithorian_endor_rebel_rigged.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Aliados\\star_wars_ithorian_endor_rebel_rigged.glb",
    "fileSize": 10403340,
    "format": "GLB",
    "meshCount": 11,
    "triangleCount": 64159,
    "materialCount": 2,
    "textureCount": 6,
    "skeletonCount": 1,
    "boneCount": 47,
    "animationGroups": 1,
    "animationNames": [
      "walk-ip"
    ],
    "bounds": {
      "min": [
        -0.8199179768562317,
        -0.21654284000396729,
        -0.47533321380615234
      ],
      "max": [
        0.8198590278625488,
        2.5263330936431885,
        0.47874701023101807
      ],
      "size": [
        1.6397770047187805,
        2.7428759336471558,
        0.9540802240371704
      ]
    },
    "approximateHeight": 2.7428759336471558,
    "category": "CHARACTER",
    "performance": "MEDIUM"
  },
  {
    "file": "sullustan_star_wars_pnj.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Aliados\\sullustan_star_wars_pnj.glb",
    "fileSize": 19973736,
    "format": "GLB",
    "meshCount": 9,
    "triangleCount": 44922,
    "materialCount": 9,
    "textureCount": 14,
    "skeletonCount": 1,
    "boneCount": 529,
    "animationGroups": 1,
    "animationNames": [
      "Sullustran_Walk"
    ],
    "bounds": {
      "min": [
        -50.448848724365234,
        -31.96297836303711,
        0.11137868463993073
      ],
      "max": [
        50.44881820678711,
        14.985496520996094,
        163.02099609375
      ],
      "size": [
        100.89766693115234,
        46.9484748840332,
        162.90961740911007
      ]
    },
    "approximateHeight": 46.9484748840332,
    "category": "CHARACTER",
    "performance": "MEDIUM"
  },
  {
    "file": "dewback.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Criaruras\\dewback.glb",
    "fileSize": 9948220,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 35244,
    "materialCount": 2,
    "textureCount": 6,
    "skeletonCount": 1,
    "boneCount": 94,
    "animationGroups": 1,
    "animationNames": [
      "Unreal Take"
    ],
    "bounds": {
      "min": [
        -81.54296875,
        -249.80470275878906,
        -1.9561830759048462
      ],
      "max": [
        81.54296875,
        368.1640625,
        228.7109375
      ],
      "size": [
        163.0859375,
        617.9687652587891,
        230.66712057590485
      ]
    },
    "approximateHeight": 617.9687652587891,
    "category": "CREATURE",
    "performance": "MEDIUM"
  },
  {
    "file": "eopie_star_wars.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Criaruras\\eopie_star_wars.glb",
    "fileSize": 9361416,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 34831,
    "materialCount": 2,
    "textureCount": 6,
    "skeletonCount": 1,
    "boneCount": 63,
    "animationGroups": 1,
    "animationNames": [
      "Unreal Take"
    ],
    "bounds": {
      "min": [
        -58.7890625,
        -198.2421875,
        -2.406301975250244
      ],
      "max": [
        54.00390625,
        70.7519302368164,
        218.74996948242188
      ],
      "size": [
        112.79296875,
        268.9941177368164,
        221.15627145767212
      ]
    },
    "approximateHeight": 268.9941177368164,
    "category": "CREATURE",
    "performance": "MEDIUM"
  },
  {
    "file": "jotaz_walk.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Criaruras\\jotaz_walk.glb",
    "fileSize": 19197340,
    "format": "GLB",
    "meshCount": 3,
    "triangleCount": 23388,
    "materialCount": 3,
    "textureCount": 6,
    "skeletonCount": 1,
    "boneCount": 291,
    "animationGroups": 1,
    "animationNames": [
      "brute_rig.ao|brute00_NAV_bipedalSlowWalk_02"
    ],
    "bounds": {
      "min": [
        -3.9424359798431396,
        -0.03247721120715141,
        -2.1110262870788574
      ],
      "max": [
        3.9424304962158203,
        3.920009136199951,
        1.3348561525344849
      ],
      "size": [
        7.88486647605896,
        3.9524863474071026,
        3.4458824396133423
      ]
    },
    "approximateHeight": 3.9524863474071026,
    "category": "CREATURE",
    "performance": "MEDIUM"
  },
  {
    "file": "ronto_star_wars.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Criaruras\\ronto_star_wars.glb",
    "fileSize": 9288132,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 32426,
    "materialCount": 2,
    "textureCount": 6,
    "skeletonCount": 1,
    "boneCount": 95,
    "animationGroups": 1,
    "animationNames": [
      "Unreal Take"
    ],
    "bounds": {
      "min": [
        -130.37109375,
        -269.9219665527344,
        -1.394630789756775
      ],
      "max": [
        130.37109375,
        228.71090698242188,
        793.75
      ],
      "size": [
        260.7421875,
        498.63287353515625,
        795.1446307897568
      ]
    },
    "approximateHeight": 498.63287353515625,
    "category": "CREATURE",
    "performance": "MEDIUM"
  },
  {
    "file": "star_wars_bantha_walk.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Criaruras\\star_wars_bantha_walk.glb",
    "fileSize": 14708732,
    "format": "GLB",
    "meshCount": 4,
    "triangleCount": 71776,
    "materialCount": 4,
    "textureCount": 9,
    "skeletonCount": 1,
    "boneCount": 50,
    "animationGroups": 1,
    "animationNames": [
      "Bantha_Walk"
    ],
    "bounds": {
      "min": [
        -108.49609375,
        -239.2578125,
        -17.61469078063965
      ],
      "max": [
        108.49609375,
        450.390625,
        302.3437194824219
      ],
      "size": [
        216.9921875,
        689.6484375,
        319.9584102630615
      ]
    },
    "approximateHeight": 689.6484375,
    "category": "CREATURE",
    "performance": "MEDIUM"
  },
  {
    "file": "water_vaporator__vaporateur_dhumidite.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Elementos de escenarios\\water_vaporator__vaporateur_dhumidite.glb",
    "fileSize": 3698264,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 49365,
    "materialCount": 2,
    "textureCount": 2,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        0,
        0,
        0
      ],
      "max": [
        43.35580062866211,
        43.35580062866211,
        202.79989624023438
      ],
      "size": [
        43.35580062866211,
        43.35580062866211,
        202.79989624023438
      ]
    },
    "approximateHeight": 43.35580062866211,
    "category": "PROP",
    "performance": "MEDIUM"
  },
  {
    "file": "b1_battle_droid.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\b1_battle_droid.glb",
    "fileSize": 449724,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 1708,
    "materialCount": 2,
    "textureCount": 2,
    "skeletonCount": 1,
    "boneCount": 24,
    "animationGroups": 1,
    "animationNames": [
      "ArmatureAction"
    ],
    "bounds": {
      "min": [
        -0.3108272850513458,
        -0.5729653239250183,
        -1.0392444133758545
      ],
      "max": [
        0.2828426957130432,
        0.24079883098602295,
        0.9830048680305481
      ],
      "size": [
        0.593669980764389,
        0.8137641549110413,
        2.0222492814064026
      ]
    },
    "approximateHeight": 0.8137641549110413,
    "category": "CHARACTER",
    "performance": "LIGHT"
  },
  {
    "file": "darth_maul_-_wip.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\darth_maul_-_wip.glb",
    "fileSize": 2947328,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 4110,
    "materialCount": 2,
    "textureCount": 6,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -0.2787640690803528,
        -1.1258833408355713,
        -0.015283050946891308
      ],
      "max": [
        0.7284632921218872,
        1.2045938968658447,
        1.6306098699569702
      ],
      "size": [
        1.00722736120224,
        2.330477237701416,
        1.6458929209038615
      ]
    },
    "approximateHeight": 2.330477237701416,
    "category": "CHARACTER",
    "performance": "LIGHT"
  },
  {
    "file": "darth_revan_-_the_clone_wars_style.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\darth_revan_-_the_clone_wars_style.glb",
    "fileSize": 7864140,
    "format": "GLB",
    "meshCount": 18,
    "triangleCount": 38368,
    "materialCount": 5,
    "textureCount": 14,
    "skeletonCount": 1,
    "boneCount": 74,
    "animationGroups": 1,
    "animationNames": [
      "Idle Pose"
    ],
    "bounds": {
      "min": [
        -1.3150346279144287,
        -2.4809322357177734,
        -1.1100893020629883
      ],
      "max": [
        1.3150334358215332,
        2.4708988666534424,
        1.2007275819778442
      ],
      "size": [
        2.630068063735962,
        4.951831102371216,
        2.3108168840408325
      ]
    },
    "approximateHeight": 4.951831102371216,
    "category": "CHARACTER",
    "performance": "MEDIUM"
  },
  {
    "file": "free_droide_de_seguridad_k-2so_by_oscar_creativo.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\free_droide_de_seguridad_k-2so_by_oscar_creativo.glb",
    "fileSize": 20348296,
    "format": "GLB",
    "meshCount": 3,
    "triangleCount": 36837,
    "materialCount": 3,
    "textureCount": 11,
    "skeletonCount": 1,
    "boneCount": 180,
    "animationGroups": 1,
    "animationNames": [
      "motion"
    ],
    "bounds": {
      "min": [
        -133.18174743652344,
        -32.01289367675781,
        -0.00002216547727584839
      ],
      "max": [
        133.1820068359375,
        18.662364959716797,
        218.4187774658203
      ],
      "size": [
        266.36375427246094,
        50.67525863647461,
        218.4187996312976
      ]
    },
    "approximateHeight": 50.67525863647461,
    "category": "CHARACTER",
    "performance": "MEDIUM"
  },
  {
    "file": "mandalorian_-_star_wars.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\mandalorian_-_star_wars.glb",
    "fileSize": 22530904,
    "format": "GLB",
    "meshCount": 10,
    "triangleCount": 41400,
    "materialCount": 9,
    "textureCount": 26,
    "skeletonCount": 1,
    "boneCount": 67,
    "animationGroups": 1,
    "animationNames": [
      "Take 001"
    ],
    "bounds": {
      "min": [
        -96.66947937011719,
        -2.2636566162109375,
        -31.315269470214844
      ],
      "max": [
        96.98723602294922,
        192.40179443359375,
        19.38557243347168
      ],
      "size": [
        193.6567153930664,
        194.6654510498047,
        50.70084190368652
      ]
    },
    "approximateHeight": 194.6654510498047,
    "category": "CHARACTER",
    "performance": "MEDIUM"
  },
  {
    "file": "pyke_marksman_walk.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\pyke_marksman_walk.glb",
    "fileSize": 23667412,
    "format": "GLB",
    "meshCount": 16,
    "triangleCount": 81846,
    "materialCount": 16,
    "textureCount": 19,
    "skeletonCount": 1,
    "boneCount": 34,
    "animationGroups": 1,
    "animationNames": [
      "mixamo.com"
    ],
    "bounds": {
      "min": [
        -21.23470115661621,
        8.820459811431647e-7,
        -53.05314636230469
      ],
      "max": [
        21.234729766845703,
        162.1797332763672,
        53.05314636230469
      ],
      "size": [
        42.469430923461914,
        162.1797323943212,
        106.10629272460938
      ]
    },
    "approximateHeight": 162.1797323943212,
    "category": "CHARACTER",
    "performance": "HEAVY"
  },
  {
    "file": "rancor_star_wars.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\rancor_star_wars.glb",
    "fileSize": 18245544,
    "format": "GLB",
    "meshCount": 5,
    "triangleCount": 98375,
    "materialCount": 5,
    "textureCount": 6,
    "skeletonCount": 1,
    "boneCount": 693,
    "animationGroups": 1,
    "animationNames": [
      "Unreal Take"
    ],
    "bounds": {
      "min": [
        -446.2103271484375,
        -288.3100280761719,
        -1.5306059122085571
      ],
      "max": [
        446.08087158203125,
        165.0554656982422,
        550.7521362304688
      ],
      "size": [
        892.2911987304688,
        453.36549377441406,
        552.2827421426773
      ]
    },
    "approximateHeight": 453.36549377441406,
    "category": "CHARACTER",
    "performance": "HEAVY"
  },
  {
    "file": "sephi_-_star_wars_elf.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\sephi_-_star_wars_elf.glb",
    "fileSize": 21436548,
    "format": "GLB",
    "meshCount": 6,
    "triangleCount": 653508,
    "materialCount": 1,
    "textureCount": 1,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -0.7911679744720459,
        -0.5633749961853027,
        -0.9506980180740356
      ],
      "max": [
        0.7890999913215637,
        0.5658490061759949,
        0.9480559825897217
      ],
      "size": [
        1.5802679657936096,
        1.1292240023612976,
        1.8987540006637573
      ]
    },
    "approximateHeight": 1.1292240023612976,
    "category": "CHARACTER",
    "performance": "VERY_HEAVY"
  },
  {
    "file": "star_wars_droide_b2_by_oscar_creativo.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Enemigos\\star_wars_droide_b2_by_oscar_creativo.glb",
    "fileSize": 35196164,
    "format": "GLB",
    "meshCount": 6,
    "triangleCount": 371340,
    "materialCount": 4,
    "textureCount": 13,
    "skeletonCount": 1,
    "boneCount": 72,
    "animationGroups": 1,
    "animationNames": [
      "Motion"
    ],
    "bounds": {
      "min": [
        -33.21345901489258,
        -23.19235610961914,
        -0.00004613650526152924
      ],
      "max": [
        33.214027404785156,
        20.45104217529297,
        166.8905487060547
      ],
      "size": [
        66.42748641967773,
        43.64339828491211,
        166.89059484255995
      ]
    },
    "approximateHeight": 43.64339828491211,
    "category": "CHARACTER",
    "performance": "VERY_HEAVY"
  },
  {
    "file": "--.ancient-ruin.-.c.-.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\--.ancient-ruin.-.c.-.glb",
    "fileSize": 106245392,
    "format": "GLB",
    "meshCount": 18,
    "triangleCount": 1948297,
    "materialCount": 1,
    "textureCount": 3,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -0.4060041904449463,
        -0.31136634945869446,
        -0.48914334177970886
      ],
      "max": [
        0.40494754910469055,
        0.3121486008167267,
        0.4895469546318054
      ],
      "size": [
        0.8109517395496368,
        0.6235149502754211,
        0.9786902964115143
      ]
    },
    "approximateHeight": 0.6235149502754211,
    "category": "ENVIRONMENT",
    "performance": "VERY_HEAVY"
  },
  {
    "file": "fanart_star_wars_-_droid_shop.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\fanart_star_wars_-_droid_shop.glb",
    "fileSize": 40625984,
    "format": "GLB",
    "meshCount": 89,
    "triangleCount": 1130572,
    "materialCount": 83,
    "textureCount": 0,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 1,
    "animationNames": [
      "Object_0"
    ],
    "bounds": {
      "min": [
        -54.96635437011719,
        -3.8509771823883057,
        -48.791542053222656
      ],
      "max": [
        53.18443298339844,
        300.9999694824219,
        47.700965881347656
      ],
      "size": [
        108.15078735351562,
        304.8509466648102,
        96.49250793457031
      ]
    },
    "approximateHeight": 304.8509466648102,
    "category": "ENVIRONMENT",
    "performance": "VERY_HEAVY"
  },
  {
    "file": "imperial_star_destroyer_hangar_fake_3d_test.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\imperial_star_destroyer_hangar_fake_3d_test.glb",
    "fileSize": 1093760,
    "format": "GLB",
    "meshCount": 4,
    "triangleCount": 5488,
    "materialCount": 3,
    "textureCount": 3,
    "skeletonCount": 2,
    "boneCount": 14,
    "animationGroups": 2,
    "animationNames": [
      "Armature.001Action",
      "Armature.001Action.001"
    ],
    "bounds": {
      "min": [
        -29.777421951293945,
        -29.777414321899414,
        -29.777446746826172
      ],
      "max": [
        29.77743148803711,
        29.777414321899414,
        29.777414321899414
      ],
      "size": [
        59.554853439331055,
        59.55482864379883,
        59.554861068725586
      ]
    },
    "approximateHeight": 59.55482864379883,
    "category": "ENVIRONMENT",
    "performance": "LIGHT"
  },
  {
    "file": "jedi_council_baked.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\jedi_council_baked.glb",
    "fileSize": 5304720,
    "format": "GLB",
    "meshCount": 7,
    "triangleCount": 63937,
    "materialCount": 6,
    "textureCount": 6,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 2,
    "animationNames": [
      "Action",
      "RotatorAction"
    ],
    "bounds": {
      "min": [
        -2918.213134765625,
        -356.9288330078125,
        -2282.694580078125
      ],
      "max": [
        1524.0394287109375,
        606.9758911132812,
        2292.875244140625
      ],
      "size": [
        4442.2525634765625,
        963.9047241210938,
        4575.56982421875
      ]
    },
    "approximateHeight": 963.9047241210938,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "file": "jedi_temple.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\jedi_temple.glb",
    "fileSize": 4829904,
    "format": "GLB",
    "meshCount": 156,
    "triangleCount": 105268,
    "materialCount": 4,
    "textureCount": 0,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -250,
        -4389.3388671875,
        -551.25048828125
      ],
      "max": [
        252.64707946777344,
        257.1428527832031,
        551.25048828125
      ],
      "size": [
        502.64707946777344,
        4646.481719970703,
        1102.5009765625
      ]
    },
    "approximateHeight": 4646.481719970703,
    "category": "ENVIRONMENT",
    "performance": "HEAVY"
  },
  {
    "file": "jedi_temple_walkway.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\jedi_temple_walkway.glb",
    "fileSize": 2061832,
    "format": "GLB",
    "meshCount": 110,
    "triangleCount": 25307,
    "materialCount": 12,
    "textureCount": 11,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -96.87378692626953,
        -2.5,
        -69.41201782226562
      ],
      "max": [
        96.87378692626953,
        47.000938415527344,
        69.41201782226562
      ],
      "size": [
        193.74757385253906,
        49.500938415527344,
        138.82403564453125
      ]
    },
    "approximateHeight": 49.500938415527344,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "file": "old_jedi_temple.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\old_jedi_temple.glb",
    "fileSize": 3267184,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 49654,
    "materialCount": 1,
    "textureCount": 3,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -0.48507699370384216,
        -0.4922789931297302,
        0
      ],
      "max": [
        0.48504599928855896,
        0.4930109977722168,
        1.000427007675171
      ],
      "size": [
        0.9701229929924011,
        0.985289990901947,
        1.000427007675171
      ]
    },
    "approximateHeight": 0.985289990901947,
    "category": "ENVIRONMENT",
    "performance": "MEDIUM"
  },
  {
    "file": "star_wars_home_one_briefing_room.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\Escenarios\\star_wars_home_one_briefing_room.glb",
    "fileSize": 2337704,
    "format": "GLB",
    "meshCount": 37,
    "triangleCount": 15560,
    "materialCount": 17,
    "textureCount": 7,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -10.604029655456543,
        -14.883661270141602,
        -7.19934606552124
      ],
      "max": [
        10.604029655456543,
        11.150976181030273,
        17.093311309814453
      ],
      "size": [
        21.208059310913086,
        26.034637451171875,
        24.292657375335693
      ]
    },
    "approximateHeight": 26.034637451171875,
    "category": "ENVIRONMENT",
    "performance": "LIGHT"
  },
  {
    "file": "-star_wars-_mara_jades_lightsaber.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\-star_wars-_mara_jades_lightsaber.glb",
    "fileSize": 708932,
    "format": "GLB",
    "meshCount": 18,
    "triangleCount": 15490,
    "materialCount": 5,
    "textureCount": 0,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 1,
    "animationNames": [
      "Lightsaber Action"
    ],
    "bounds": {
      "min": [
        -1.2121168375015259,
        -3.712878704071045,
        -63.30973815917969
      ],
      "max": [
        8.768522262573242,
        7.487061977386475,
        2.6404755115509033
      ],
      "size": [
        9.980639100074768,
        11.19994068145752,
        65.95021367073059
      ]
    },
    "approximateHeight": 11.19994068145752,
    "category": "WEAPON",
    "performance": "LIGHT"
  },
  {
    "file": "clockwork_light_saber.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\clockwork_light_saber.glb",
    "fileSize": 8727148,
    "format": "GLB",
    "meshCount": 14,
    "triangleCount": 18650,
    "materialCount": 4,
    "textureCount": 9,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 1,
    "animationNames": [
      "ClockWork"
    ],
    "bounds": {
      "min": [
        -1.3197083473205566,
        -1.3986232280731201,
        -2.970060110092163
      ],
      "max": [
        1.1790599822998047,
        1.1790612936019897,
        38.871971130371094
      ],
      "size": [
        2.4987683296203613,
        2.57768452167511,
        41.84203124046326
      ]
    },
    "approximateHeight": 2.57768452167511,
    "category": "WEAPON",
    "performance": "LIGHT"
  },
  {
    "file": "darth_malguss_lightsaber.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\darth_malguss_lightsaber.glb",
    "fileSize": 3584760,
    "format": "GLB",
    "meshCount": 13,
    "triangleCount": 10114,
    "materialCount": 3,
    "textureCount": 3,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -16.061595916748047,
        -0.37214231491088867,
        -0.7450073957443237
      ],
      "max": [
        2.902292251586914,
        0.34759315848350525,
        0.7450073957443237
      ],
      "size": [
        18.96388816833496,
        0.7197354733943939,
        1.4900147914886475
      ]
    },
    "approximateHeight": 0.7197354733943939,
    "category": "WEAPON",
    "performance": "LIGHT"
  },
  {
    "file": "dl-44_heavy_blaster_pistol__han_solo.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\dl-44_heavy_blaster_pistol__han_solo.glb",
    "fileSize": 10600796,
    "format": "GLB",
    "meshCount": 4,
    "triangleCount": 24483,
    "materialCount": 4,
    "textureCount": 12,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -1,
        -0.6348450183868408,
        -0.23972800374031067
      ],
      "max": [
        1,
        0.6348450183868408,
        0.23972800374031067
      ],
      "size": [
        2,
        1.2696900367736816,
        0.47945600748062134
      ]
    },
    "approximateHeight": 1.2696900367736816,
    "category": "WEAPON",
    "performance": "MEDIUM"
  },
  {
    "file": "e-11_blaster.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\e-11_blaster.glb",
    "fileSize": 7620568,
    "format": "GLB",
    "meshCount": 2,
    "triangleCount": 24306,
    "materialCount": 2,
    "textureCount": 8,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -3.498882293701172,
        -0.12749671936035156,
        -0.4293653964996338
      ],
      "max": [
        3.5240020751953125,
        2.7747726440429688,
        0.9346904754638672
      ],
      "size": [
        7.022884368896484,
        2.9022693634033203,
        1.364055871963501
      ]
    },
    "approximateHeight": 2.9022693634033203,
    "category": "WEAPON",
    "performance": "MEDIUM"
  },
  {
    "file": "pulsar_edge_-_adoxs_lightsaber.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\pulsar_edge_-_adoxs_lightsaber.glb",
    "fileSize": 8937740,
    "format": "GLB",
    "meshCount": 7,
    "triangleCount": 38520,
    "materialCount": 7,
    "textureCount": 7,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 1,
    "animationNames": [
      "Adox_Saber_014"
    ],
    "bounds": {
      "min": [
        -5.434372425079346,
        -14.432696342468262,
        -3.01560640335083
      ],
      "max": [
        5.434387683868408,
        223.87301635742188,
        8.320856094360352
      ],
      "size": [
        10.868760108947754,
        238.30571269989014,
        11.336462497711182
      ]
    },
    "approximateHeight": 238.30571269989014,
    "category": "WEAPON",
    "performance": "MEDIUM"
  },
  {
    "file": "the_5_great_jedi_lightsabers.glb",
    "sourcePath": "C:\\Users\\Usuario\\Documents\\SW Game\\armas\\the_5_great_jedi_lightsabers.glb",
    "fileSize": 10166220,
    "format": "GLB",
    "meshCount": 66,
    "triangleCount": 303730,
    "materialCount": 12,
    "textureCount": 0,
    "skeletonCount": 0,
    "boneCount": 0,
    "animationGroups": 0,
    "animationNames": [],
    "bounds": {
      "min": [
        -76.99999237060547,
        -1.2485077381134033,
        -2.5059473514556885
      ],
      "max": [
        1.248509168624878,
        1.9753921031951904,
        67.64413452148438
      ],
      "size": [
        78.24850153923035,
        3.2238998413085938,
        70.15008187294006
      ]
    },
    "approximateHeight": 3.2238998413085938,
    "category": "WEAPON",
    "performance": "VERY_HEAVY"
  }
];
export const assetCatalogSummary = {
  "files": 33,
  "glb": 32,
  "characters": 11,
  "creatures": 5,
  "weapons": 7,
  "environments": 8,
  "props": 1
};
