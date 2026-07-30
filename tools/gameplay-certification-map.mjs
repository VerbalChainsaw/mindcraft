#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'http://localhost:8080';
const MAP_TAG = 'mindcraft_cert_map';
const OVERWORLD_BOUNDS = {
    x1: 990,
    y1: 98,
    z1: 990,
    x2: 1150,
    y2: 130,
    z2: 1130,
};

function parseArguments(argv) {
    const operation = argv[0] || 'build';
    let baseUrl = process.env.MINDCRAFT_BASE_URL || DEFAULT_BASE_URL;
    for (let index = 1; index < argv.length; index += 1) {
        if (argv[index] === '--base-url' && argv[index + 1]) {
            baseUrl = argv[index + 1];
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${argv[index]}`);
        }
    }
    if (!['build', 'reset', 'spawn-combat', 'remove'].includes(operation)) {
        throw new Error(`Unknown operation '${operation}'. Use build, reset, spawn-combat, or remove.`);
    }
    return { operation, baseUrl: baseUrl.replace(/\/+$/, '') };
}

async function postCommand(baseUrl, command) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(`${baseUrl}/api/minecraft-server/command`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command }),
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success !== true) {
            throw new Error(`Command failed (${response.status}): ${command}\n${JSON.stringify(payload)}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}

function volume(box) {
    return (box.x2 - box.x1 + 1) * (box.y2 - box.y1 + 1) * (box.z2 - box.z1 + 1);
}

function splitFill(box, block, commands) {
    if (volume(box) <= 32_768) {
        commands.push(`fill ${box.x1} ${box.y1} ${box.z1} ${box.x2} ${box.y2} ${box.z2} ${block}`);
        return;
    }
    const axes = ['x', 'y', 'z'].sort((left, right) => (
        (box[`${right}2`] - box[`${right}1`]) - (box[`${left}2`] - box[`${left}1`])
    ));
    const axis = axes[0];
    const startKey = `${axis}1`;
    const endKey = `${axis}2`;
    const midpoint = Math.floor((box[startKey] + box[endKey]) / 2);
    splitFill({ ...box, [endKey]: midpoint }, block, commands);
    splitFill({ ...box, [startKey]: midpoint + 1 }, block, commands);
}

function fill(commands, x1, y1, z1, x2, y2, z2, block) {
    splitFill({
        x1: Math.min(x1, x2),
        y1: Math.min(y1, y2),
        z1: Math.min(z1, z2),
        x2: Math.max(x1, x2),
        y2: Math.max(y1, y2),
        z2: Math.max(z1, z2),
    }, block, commands);
}

function setblock(commands, x, y, z, block) {
    commands.push(`setblock ${x} ${y} ${z} ${block}`);
}

function chestItems(commands, x, y, z, items) {
    setblock(commands, x, y, z, 'chest');
    items.forEach(([slot, item, count]) => {
        commands.push(`item replace block ${x} ${y} ${z} container.${slot} with ${item} ${count}`);
    });
}

function makeTree(commands, x, z) {
    fill(commands, x - 2, 103, z - 2, x + 2, 105, z + 2, 'oak_leaves[persistent=true]');
    fill(commands, x - 1, 106, z - 1, x + 1, 106, z + 1, 'oak_leaves[persistent=true]');
    setblock(commands, x, 106, z, 'oak_leaves[persistent=true]');
    fill(commands, x, 100, z, x, 104, z, 'oak_log');
}

function borderedFloor(commands, x1, z1, x2, z2, floorBlock) {
    fill(commands, x1, 99, z1, x2, 99, z2, floorBlock);
    fill(commands, x1, 100, z1, x2, 101, z1, 'stone_bricks');
    fill(commands, x1, 100, z2, x2, 101, z2, 'stone_bricks');
    fill(commands, x1, 100, z1, x1, 101, z2, 'stone_bricks');
    fill(commands, x2, 100, z1, x2, 101, z2, 'stone_bricks');
}

function overworldBuildCommands() {
    const commands = [];
    commands.push(`kill @e[tag=${MAP_TAG}]`);
    commands.push('kill @e[x=990,y=90,z=990,dx=160,dy=50,dz=140,type=!player]');
    splitFill(OVERWORLD_BOUNDS, 'air', commands);
    commands.push('forceload add 990 990 1150 1130');
    fill(commands, 995, 99, 995, 1145, 99, 1125, 'smooth_stone');

    // Hub: neutral observation point and course start.
    borderedFloor(commands, 995, 995, 1020, 1020, 'smooth_stone');
    fill(commands, 999, 99, 999, 1016, 99, 1016, 'white_concrete');
    setblock(commands, 1007, 99, 1007, 'lime_concrete');
    setblock(commands, 1008, 99, 1007, 'yellow_concrete');
    setblock(commands, 1009, 99, 1007, 'red_concrete');
    chestItems(commands, 998, 100, 998, [
        [0, 'compass', 1],
        [1, 'clock', 1],
        [2, 'book', 1],
    ]);

    // Bootstrap biome: trees -> stone/coal/iron -> furnace progression.
    borderedFloor(commands, 1025, 995, 1065, 1035, 'grass_block');
    fill(commands, 1026, 99, 996, 1064, 99, 1034, 'grass_block');
    makeTree(commands, 1032, 1002);
    makeTree(commands, 1044, 1005);
    makeTree(commands, 1057, 1001);
    for (let x = 1028; x <= 1040; x += 3) {
        for (let z = 1014; z <= 1029; z += 3) {
            setblock(commands, x, 100, z, 'stone');
        }
    }
    setblock(commands, 1028, 100, 1014, 'coal_ore');
    setblock(commands, 1031, 100, 1014, 'coal_ore');
    setblock(commands, 1034, 100, 1014, 'iron_ore');
    setblock(commands, 1037, 100, 1014, 'iron_ore');
    setblock(commands, 1040, 100, 1014, 'iron_ore');
    fill(commands, 1044, 100, 1023, 1052, 100, 1031, 'water');
    fill(commands, 1043, 100, 1022, 1053, 100, 1022, 'sand');
    fill(commands, 1043, 100, 1032, 1053, 100, 1032, 'sand');
    fill(commands, 1043, 100, 1022, 1043, 100, 1032, 'sand');
    fill(commands, 1053, 100, 1022, 1053, 100, 1032, 'sand');
    fill(commands, 1057, 100, 1022, 1063, 100, 1033, 'oak_fence');
    fill(commands, 1058, 100, 1023, 1062, 100, 1032, 'air');
    setblock(commands, 1060, 100, 1022, 'oak_fence_gate');
    commands.push(`summon cow 1059.5 100 1027.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`summon cow 1061.5 100 1029.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`summon sheep 1059.5 100 1030.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`summon sheep 1061.5 100 1026.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);

    // Traversal: doors, water, gap, vertical ladder, and return route.
    borderedFloor(commands, 1070, 995, 1145, 1018, 'light_gray_concrete');
    fill(commands, 1074, 100, 998, 1074, 103, 1014, 'stone_bricks');
    fill(commands, 1074, 100, 1005, 1074, 101, 1006, 'air');
    setblock(commands, 1074, 100, 1005, 'oak_door[half=lower,facing=east]');
    setblock(commands, 1074, 101, 1005, 'oak_door[half=upper,facing=east]');
    fill(commands, 1080, 99, 998, 1086, 99, 1014, 'water');
    fill(commands, 1092, 99, 998, 1098, 99, 1014, 'air');
    fill(commands, 1092, 96, 998, 1098, 96, 1014, 'water');
    fill(commands, 1104, 100, 1000, 1110, 106, 1012, 'stone_bricks');
    fill(commands, 1105, 100, 1001, 1109, 105, 1011, 'air');
    fill(commands, 1105, 100, 1001, 1105, 105, 1001, 'ladder[facing=south]');
    fill(commands, 1104, 106, 1000, 1110, 106, 1012, 'stone_bricks');
    setblock(commands, 1105, 106, 1001, 'air');
    setblock(commands, 1115, 99, 1006, 'yellow_concrete');
    setblock(commands, 1138, 99, 1006, 'lime_concrete');
    fill(commands, 1122, 100, 1002, 1128, 105, 1010, 'stone');
    fill(commands, 1123, 100, 1003, 1127, 104, 1009, 'air');
    setblock(commands, 1125, 100, 1003, 'iron_ore');
    setblock(commands, 1125, 99, 1006, 'deepslate');

    // Mounted transport: current-protocol boat control and a genuinely saddled animal.
    fill(commands, 1074, 99, 1022, 1139, 99, 1039, 'smooth_stone');
    fill(commands, 1074, 100, 1022, 1139, 103, 1039, 'air');
    fill(commands, 1075, 100, 1023, 1138, 100, 1029, 'water');
    fill(commands, 1074, 100, 1022, 1139, 101, 1022, 'stone_bricks');
    fill(commands, 1074, 100, 1030, 1139, 101, 1030, 'stone_bricks');
    fill(commands, 1074, 100, 1022, 1074, 101, 1030, 'stone_bricks');
    fill(commands, 1139, 100, 1022, 1139, 101, 1030, 'stone_bricks');
    fill(commands, 1074, 100, 1032, 1139, 101, 1032, 'oak_fence');
    fill(commands, 1074, 100, 1038, 1139, 101, 1038, 'oak_fence');
    fill(commands, 1074, 100, 1032, 1074, 101, 1038, 'oak_fence');
    fill(commands, 1139, 100, 1032, 1139, 101, 1038, 'oak_fence');
    commands.push(`summon minecraft:oak_boat 1080.5 100.5 1026.5 {Tags:["${MAP_TAG}"]}`);
    commands.push(`summon minecraft:horse 1080.5 100 1035.5 {Tame:1b,Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`item replace entity @e[type=minecraft:horse,tag=${MAP_TAG},x=1074,y=99,z=1031,dx=65,dy=10,dz=8,limit=1] saddle with minecraft:saddle`);
    chestItems(commands, 1071, 100, 1035, [
        [0, 'saddle', 3],
        [1, 'carrot_on_a_stick', 1],
        [2, 'warped_fungus_on_a_stick', 1],
        [3, 'lead', 4],
    ]);

    // Farming: mature crops, empty hydrated plot, and breedable animal pens.
    borderedFloor(commands, 1025, 1040, 1065, 1075, 'grass_block');
    fill(commands, 1028, 100, 1043, 1040, 100, 1055, 'farmland[moisture=7]');
    fill(commands, 1033, 100, 1043, 1033, 100, 1055, 'water');
    fill(commands, 1028, 101, 1043, 1032, 101, 1055, 'wheat[age=7]');
    fill(commands, 1034, 101, 1043, 1040, 101, 1055, 'carrots[age=7]');
    fill(commands, 1028, 100, 1060, 1040, 100, 1072, 'farmland[moisture=7]');
    fill(commands, 1033, 100, 1060, 1033, 100, 1072, 'water');
    fill(commands, 1046, 100, 1044, 1062, 100, 1071, 'oak_fence');
    fill(commands, 1047, 100, 1045, 1061, 100, 1070, 'air');
    fill(commands, 1054, 100, 1058, 1054, 100, 1058, 'oak_fence');
    setblock(commands, 1050, 100, 1044, 'oak_fence_gate');
    setblock(commands, 1058, 100, 1044, 'oak_fence_gate');
    commands.push(`summon cow 1050.5 100 1051.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`summon cow 1052.5 100 1053.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`summon chicken 1057.5 100 1051.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);
    commands.push(`summon chicken 1059.5 100 1053.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`);

    // Construction: bounded empty pad with legitimate material supply.
    borderedFloor(commands, 1070, 1040, 1100, 1072, 'cyan_concrete');
    fill(commands, 1075, 99, 1045, 1095, 99, 1067, 'smooth_stone');
    fill(commands, 1081, 99, 1052, 1087, 99, 1058, 'yellow_concrete');
    chestItems(commands, 1073, 100, 1043, [
        [0, 'oak_planks', 64],
        [1, 'oak_planks', 64],
        [2, 'cobblestone', 64],
        [3, 'glass_pane', 16],
        [4, 'oak_door', 1],
        [5, 'torch', 16],
        [6, 'chest', 1],
        [7, 'furnace', 1],
        [8, 'red_bed', 1],
    ]);

    // Combat arena: three roofed cells; mobs are created only by spawn-combat.
    borderedFloor(commands, 1105, 1040, 1145, 1072, 'red_concrete');
    fill(commands, 1108, 100, 1044, 1142, 106, 1068, 'stone_bricks');
    fill(commands, 1109, 100, 1045, 1141, 105, 1067, 'air');
    fill(commands, 1119, 100, 1045, 1119, 105, 1067, 'iron_bars');
    fill(commands, 1131, 100, 1045, 1131, 105, 1067, 'iron_bars');
    fill(commands, 1108, 106, 1044, 1142, 106, 1068, 'stone_bricks');
    setblock(commands, 1113, 100, 1044, 'oak_door[facing=south,half=lower]');
    setblock(commands, 1113, 101, 1044, 'oak_door[facing=south,half=upper]');
    setblock(commands, 1125, 100, 1044, 'oak_door[facing=south,half=lower]');
    setblock(commands, 1125, 101, 1044, 'oak_door[facing=south,half=upper]');
    setblock(commands, 1137, 100, 1044, 'oak_door[facing=south,half=lower]');
    setblock(commands, 1137, 101, 1044, 'oak_door[facing=south,half=upper]');
    chestItems(commands, 1107, 100, 1042, [
        [0, 'stone_sword', 1],
        [1, 'shield', 1],
        [2, 'bow', 1],
        [3, 'arrow', 32],
        [4, 'cooked_beef', 8],
    ]);

    // Exploration: bounded open yard with three distinct remembered landmarks.
    borderedFloor(commands, 995, 1080, 1065, 1125, 'moss_block');
    // Keep the physical proof focused on discovery, memory, inventory recovery,
    // and route return rather than ambiguous interior collision geometry.
    fill(commands, 996, 100, 1081, 1064, 102, 1124, 'air');
    setblock(commands, 1000, 100, 1120, 'gold_block');
    setblock(commands, 1030, 100, 1103, 'emerald_block');
    setblock(commands, 1060, 100, 1085, 'diamond_block');
    chestItems(commands, 1059, 100, 1120, [[0, 'echo_shard', 1]]);

    // Portal lab: resource hazards and an empty marked 4x5 frame footprint.
    borderedFloor(commands, 1070, 1080, 1145, 1125, 'purple_concrete');
    fill(commands, 1075, 100, 1085, 1083, 100, 1093, 'lava');
    fill(commands, 1086, 100, 1085, 1094, 100, 1093, 'water');
    fill(commands, 1075, 100, 1098, 1092, 104, 1108, 'stone');
    setblock(commands, 1078, 100, 1098, 'diamond_ore');
    setblock(commands, 1080, 101, 1098, 'diamond_ore');
    setblock(commands, 1082, 102, 1098, 'diamond_ore');
    fill(commands, 1107, 99, 1092, 1110, 99, 1096, 'yellow_concrete');
    fill(commands, 1107, 100, 1092, 1110, 104, 1092, 'yellow_concrete');
    fill(commands, 1107, 100, 1096, 1110, 104, 1096, 'yellow_concrete');
    setblock(commands, 1115, 99, 1094, 'lime_concrete');
    chestItems(commands, 1138, 100, 1084, [
        [0, 'gravel', 32],
        [1, 'iron_ingot', 1],
    ]);

    // Continuous three-to-five-block paths between every station. Clearing
    // through the station borders makes the course traversable without
    // teleportation while preserving each bounded challenge.
    for (const [x1, z1, x2, z2] of [
        [1019, 1000, 1026, 1020], // hub -> bootstrap
        [1064, 1000, 1071, 1020], // bootstrap -> traversal
        [1042, 1034, 1046, 1041], // bootstrap -> farming
        [1080, 1017, 1084, 1041], // traversal -> construction
        [1064, 1050, 1071, 1054], // farming -> construction
        [1099, 1050, 1106, 1054], // construction -> combat
        [1030, 1074, 1034, 1081], // farming -> exploration
        [1083, 1071, 1087, 1081], // construction -> portal lab
        [1123, 1071, 1127, 1081], // combat -> portal lab
        [1064, 1100, 1071, 1104], // exploration -> portal lab
    ]) {
        fill(commands, x1, 99, z1, x2, 99, z2, 'smooth_stone');
        fill(commands, x1, 100, z1, x2, 102, z2, 'air');
    }

    // Spawn-proof the exposed course without adding collision to movement lanes.
    for (let x = 996; x <= 1146; x += 12) {
        for (let z = 996; z <= 1128; z += 12) {
            commands.push(`setblock ${x} 103 ${z} light[level=15] keep`);
        }
    }
    fill(commands, 994, 99, 994, 1146, 102, 994, 'stone_bricks');
    fill(commands, 994, 99, 1126, 1146, 102, 1126, 'stone_bricks');
    fill(commands, 994, 99, 994, 994, 102, 1126, 'stone_bricks');
    fill(commands, 1146, 99, 994, 1146, 102, 1126, 'stone_bricks');
    setblock(commands, 1113, 99, 1057, 'sea_lantern');
    setblock(commands, 1125, 99, 1057, 'sea_lantern');
    setblock(commands, 1137, 99, 1057, 'sea_lantern');

    // Safe Nether receiver near the 8:1 coordinate equivalent of the portal lab.
    commands.push('execute in minecraft:the_nether run forceload add 128 128 160 160');
    commands.push('execute in minecraft:the_nether run fill 134 66 132 146 78 144 air');
    commands.push('execute in minecraft:the_nether run fill 134 65 132 146 65 144 polished_blackstone_bricks');
    commands.push('execute in minecraft:the_nether run fill 134 66 132 146 70 132 polished_blackstone_bricks');
    commands.push('execute in minecraft:the_nether run fill 134 66 144 146 70 144 polished_blackstone_bricks');
    commands.push('execute in minecraft:the_nether run fill 134 66 132 134 70 144 polished_blackstone_bricks');
    commands.push('execute in minecraft:the_nether run fill 146 66 132 146 70 144 polished_blackstone_bricks');
    commands.push('execute in minecraft:the_nether run fill 138 66 138 138 70 138 obsidian');
    commands.push('execute in minecraft:the_nether run fill 141 66 138 141 70 138 obsidian');
    commands.push('execute in minecraft:the_nether run fill 138 66 138 141 66 138 obsidian');
    commands.push('execute in minecraft:the_nether run fill 138 70 138 141 70 138 obsidian');
    commands.push('execute in minecraft:the_nether run fill 139 67 138 140 69 138 nether_portal[axis=x]');
    commands.push('execute in minecraft:the_nether run fill 135 66 143 145 69 143 nether_quartz_ore');
    commands.push('execute in minecraft:the_nether run setblock 140 66 134 respawn_anchor[charges=4]');
    commands.push('execute in minecraft:the_nether run setblock 139 67 134 glowstone');

    return commands;
}

function combatCommands() {
    return [
        `kill @e[tag=${MAP_TAG},type=zombie]`,
        `kill @e[tag=${MAP_TAG},type=skeleton]`,
        `kill @e[tag=${MAP_TAG},type=creeper]`,
        `summon zombie 1113.5 100 1057.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b,CanPickUpLoot:0b}`,
        `summon skeleton 1125.5 100 1057.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b,CanPickUpLoot:0b}`,
        `summon creeper 1137.5 100 1057.5 {Tags:["${MAP_TAG}"],PersistenceRequired:1b}`,
    ];
}

function removeCommands() {
    const commands = [
        `kill @e[tag=${MAP_TAG}]`,
        'kill @e[x=990,y=90,z=990,dx=160,dy=50,dz=140,type=!player]',
    ];
    splitFill(OVERWORLD_BOUNDS, 'air', commands);
    commands.push('forceload remove 990 990 1150 1130');
    commands.push('execute in minecraft:the_nether run fill 128 60 128 152 84 152 air');
    commands.push('execute in minecraft:the_nether run forceload remove 128 128 160 160');
    return commands;
}

async function run() {
    const { operation, baseUrl } = parseArguments(process.argv.slice(2));
    const commands = operation === 'spawn-combat'
        ? combatCommands()
        : operation === 'remove'
            ? removeCommands()
            : overworldBuildCommands();

    process.stdout.write(`${operation}: sending ${commands.length} bounded commands to ${baseUrl}\n`);
    for (let index = 0; index < commands.length; index += 1) {
        await postCommand(baseUrl, commands[index]);
        if ((index + 1) % 25 === 0 || index === commands.length - 1) {
            process.stdout.write(`${operation}: ${index + 1}/${commands.length}\n`);
        }
    }
    process.stdout.write(
        operation === 'remove'
            ? 'Certification map removed and its forced chunks released.\n'
            : operation === 'spawn-combat'
                ? 'Combat cells populated with one tagged zombie, skeleton, and creeper.\n'
                : 'Certification map reset. Start at 1007 100 1007; use the operator guide in docs/gameplay-certification-map.md.\n',
    );
}

run().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
});
