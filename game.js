'use strict';
/* ============ 基础参数 ============ */
const COLS = 12, ROWS = 16;
const TILE = 48;

/* 路径（格子坐标，从上方入口走到下方基地） */
const PATH = [
  [1,0],[1,1],[1,2],[1,3],[2,3],[3,3],[4,3],[5,3],[5,4],[5,5],
  [5,6],[6,6],[7,6],[8,6],[9,6],[9,7],[9,8],[9,9],[8,9],[7,9],
  [6,9],[5,9],[5,10],[5,11],[5,12],[4,12],[3,12],[2,12],[2,13],[2,14],[2,15]
];
const PATH_SET = new Set(PATH.map(p => p[0] + ',' + p[1]));

/* ============ 塔定义 ============ */
const TOWERS = {
  arrow: {
    name: '箭塔', color: '#7ec8e3', cost: 45,
    desc: '单体高频，性价比高',
    base: { range: 2.4, dmg: 9, rate: 0.55, bullet: 'arrow' },
    grow: { range: 0.25, dmg: 7, rate: 0.92 },
    upCost: 45
  },
  cannon: {
    name: '炮塔', color: '#e8a05a', cost: 90,
    desc: '溅射伤害，克集群',
    base: { range: 2.1, dmg: 26, rate: 1.6, splash: 0.85, bullet: 'shell' },
    grow: { range: 0.2, dmg: 18, rate: 0.82 },
    upCost: 85
  },
  frost: {
    name: '冰塔', color: '#8fd7f0', cost: 80,
    desc: '减速，不叠加',
    base: { range: 2.3, dmg: 4, rate: 1.0, slow: 0.45, slowDur: 1.4, bullet: 'ice' },
    grow: { range: 0.25, dmg: 3, rate: 0.92, slow: 0.05 },
    upCost: 75
  },
  poison: {
    name: '毒塔', color: '#9ad46b', cost: 100,
    desc: '持续中毒，破高血',
    base: { range: 2.5, dmg: 6, rate: 1.1, poison: 5, poisonDur: 3.5, bullet: 'venom' },
    grow: { range: 0.2, dmg: 4, rate: 0.9, poison: 4 },
    upCost: 95
  },
  lightning: {
    name: '雷塔', color: '#c79bf0', cost: 150,
    desc: '链式闪电，穿多个目标',
    base: { range: 2.8, dmg: 20, rate: 1.3, chain: 3, bullet: 'bolt' },
    grow: { range: 0.2, dmg: 14, rate: 0.9, chain: 1 },
    upCost: 130
  }
};
const TOWER_KEYS = Object.keys(TOWERS);
const MAX_LV = 5;

/* ============ 敌人定义 ============ */
const ENEMIES = {
  grunt:  { name: '小兵', color: '#cbd5e1', hp: 28, speed: 1.1, gold: 12,  r: 11, dmg: 1 },
  runner: { name: '快兵', color: '#f6d365', hp: 22, speed: 2.0,  gold: 13,  r: 9,  dmg: 1 },
  tank:   { name: '重甲', color: '#8b98ad', hp: 200, speed: 0.72, gold: 22, r: 15, dmg: 2, armor: 3 },
  flyer:  { name: '飞兵', color: '#f08cc0', hp: 95, speed: 1.7,  gold: 16, r: 11, dmg: 1, flying: true },
  boss:   { name: '首领', color: '#ef4444', hp: 1100, speed: 0.62, gold: 140, r: 20, dmg: 5, armor: 10, boss: true }
};

/* 无限模式：按需生成每一波
   前 20 波沿用原曲线；之后数量封顶，只让血量继续线性增长，
   避免无限叠加导致后期帧率崩掉 */
function waveConfig(w) {
  const groups = [];
  // 前 20 波：线性增长，保持原手感
  // 20 波后：转为温和的指数（每波约 ×1.055），让玩家能靠升级和补塔再撑 10-20 波
  let hpScale;
  if (w <= 20) {
    hpScale = (1 + (w - 1) * 0.28) * (w >= 10 ? Math.pow(1.04, w - 9) : 1);
  } else {
    hpScale = (1 + 19 * 0.28) * Math.pow(1.04, 11) * Math.pow(1.055, w - 20);
  }
  const nClamp = (n, cap) => Math.min(n, cap);

  if (w % 5 === 0) {
    // 首领数量：前 10 波 1 只，之后每 10 波多一只，上限 4 只
    const bosses = w < 10 ? 1 : Math.min(4, 1 + Math.floor((w - 10) / 10));
    groups.push({ type: 'boss', n: bosses, gap: 1.6, hpScale: hpScale });
    groups.push({ type: 'grunt', n: nClamp(6 + w, 40), gap: 0.35, hpScale });
  } else if (w === 1) {
    groups.push({ type: 'grunt', n: 3, gap: 0.9, hpScale: 1 });
  } else {
    groups.push({ type: 'grunt', n: nClamp(4 + Math.floor(w * 1.6), 46), gap: 0.5, hpScale });
    if (w >= 2) groups.push({ type: 'runner', n: nClamp(2 + Math.floor(w * 0.9), 24), gap: 0.4, hpScale });
    if (w >= 4) groups.push({ type: 'tank', n: nClamp(Math.floor(w / 2.5), 14), gap: 1.0, hpScale });
    if (w >= 6) groups.push({ type: 'flyer', n: nClamp(Math.floor(w / 1.6), 20), gap: 0.55, hpScale });
  }
  return groups;
}

/* ============ 游戏状态 ============ */
const G = {
  gold: 220, life: 20, wave: 0,
  towers: [], enemies: [], bullets: [], effects: [],
  spawnQueue: [], spawnTimer: 0,
  running: false, paused: false, over: false, speed: 1,
  time: 0, selected: null, buildAt: null,
  mouse: { x: -1, y: -1 }
};

/* ============ Canvas ============ */
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let dpr = 1, viewW = 0, viewH = 0, scale = 1, offX = 0, offY = 0;

function resize() {
  const stage = document.getElementById('stage');
  const w = stage.clientWidth, h = stage.clientHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.floor(w * dpr);
  cv.height = Math.floor(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  viewW = w; viewH = h;
  // 适配：整张图等比塞进视口
  const gw = COLS * TILE, gh = ROWS * TILE;
  scale = Math.min(w / gw, h / gh);
  offX = (w - gw * scale) / 2;
  offY = (h - gh * scale) / 2;
}
window.addEventListener('resize', resize);

/* 屏幕坐标 → 格子坐标 */
function toCell(px, py) {
  return {
    x: Math.floor((px - offX) / (TILE * scale)),
    y: Math.floor((py - offY) / (TILE * scale))
  };
}
function cellCenter(cx, cy) {
  return {
    x: offX + (cx + 0.5) * TILE * scale,
    y: offY + (cy + 0.5) * TILE * scale
  };
}

/* ============ 路径几何 ============ */
/* 把格子路径转成一串世界坐标点（单位：格） */
const WAYPOINTS = PATH.map(p => ({ x: p[0] + 0.5, y: p[1] + 0.5 }));
const SEG_LEN = [];
let PATH_LENGTH = 0;
for (let i = 0; i < WAYPOINTS.length - 1; i++) {
  const a = WAYPOINTS[i], b = WAYPOINTS[i + 1];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  SEG_LEN.push(d);
  PATH_LENGTH += d;
}

/* 依据已走的距离取位置与朝向 */
function posAt(dist) {
  let d = dist;
  for (let i = 0; i < SEG_LEN.length; i++) {
    if (d <= SEG_LEN[i]) {
      const a = WAYPOINTS[i], b = WAYPOINTS[i + 1];
      const t = SEG_LEN[i] === 0 ? 0 : d / SEG_LEN[i];
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        ang: Math.atan2(b.y - a.y, b.x - a.x)
      };
    }
    d -= SEG_LEN[i];
  }
  const last = WAYPOINTS[WAYPOINTS.length - 1];
  return { x: last.x, y: last.y, ang: Math.PI / 2 };
}

/* 升级费用：每级涨 1.6 倍 */
function upCostOf(t) {
  // 合成塔更贵：基础价按两座材料塔之和计
  const base = t.mix
    ? (TOWERS[t.mix.a].upCost + TOWERS[t.mix.b].upCost) * 2
    : TOWERS[t.type].upCost;
  return Math.round(base * Math.pow(1.6, t.lv - 1));
}

/* ============ 塔属性计算 ============ */
function towerStats(t) {
  // 合成塔：属性由两座材料塔直接相加，再乘合成倍率
  if (t.mix) return mixStats(t);

  const def = TOWERS[t.type];
  const lv = t.lv - 1;
  const s = {};
  for (const k of ['range', 'dmg', 'rate', 'splash', 'slow', 'slowDur', 'poison', 'poisonDur', 'chain']) {
    if (def.base[k] !== undefined) s[k] = def.base[k];
  }
  s.dmg = def.base.dmg * Math.pow(1.72, lv);
  if (def.base.range) s.range = def.base.range + (def.grow.range || 0) * lv;
  if (def.base.rate) s.rate = def.base.rate * Math.pow(def.grow.rate || 1, lv);
  if (def.base.splash) s.splash = def.base.splash + 0.08 * lv;
  if (def.base.slow) s.slow = Math.min(0.75, def.base.slow + (def.grow.slow || 0) * lv);
  if (def.base.poison) s.poison = def.base.poison + (def.grow.poison || 0) * lv;
  if (def.base.chain) s.chain = def.base.chain + (def.grow.chain || 0) * lv;
  return s;
}

/* 合成塔属性：两座材料塔满级属性相加，再乘合成强度 */
const MERGE_BOOST = 1.25;
function mixStats(t) {
  const a = t.mix.statsA, b = t.mix.statsB;
  const lvBonus = Math.pow(1.18, t.lv);   // 合成后还能继续升级
  const s = {
    dmg: (a.dmg + b.dmg) * MERGE_BOOST * lvBonus,
    range: Math.max(a.range, b.range) + 0.3,
    rate: Math.min(a.rate, b.rate) * 0.9,        // 取更快的那个，再略快
  };
  // 效果叠加：溅射 / 减速 / 中毒 / 连锁
  if (a.splash || b.splash) s.splash = Math.max(a.splash || 0, b.splash || 0) + 0.25;
  if (a.slow || b.slow) {
    // 减速取两者之和（只有一方有时就是它本身），上限 85%
    s.slow = Math.min(0.85, (a.slow || 0) + (b.slow || 0));
    s.slowDur = Math.max(a.slowDur || 0, b.slowDur || 0) + 0.4;
  }
  if (a.poison || b.poison) {
    s.poison = (a.poison || 0) + (b.poison || 0);
    s.poisonDur = Math.max(a.poisonDur || 0, b.poisonDur || 0) + 1;
  }
  if (a.chain || b.chain) s.chain = (a.chain || 0) + (b.chain || 0);
  return s;
}

/* ============ 建造 / 升级 / 出售 ============ */
function canBuild(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
  if (PATH_SET.has(cx + ',' + cy)) return false;
  return !G.towers.some(t => t.cx === cx && t.cy === cy);
}

function buildTower(type, cx, cy) {
  const def = TOWERS[type];
  if (!canBuild(cx, cy) || G.gold < def.cost) return false;
  G.gold -= def.cost;
  const t = {
    type, cx, cy, lv: 1,
    cd: 0, angle: -Math.PI / 2, spent: def.cost, kills: 0,
    recoil: 0
  };
  G.towers.push(t);
  updateHud();
  return true;
}

function upgradeTower(t) {
  if (t.lv >= MAX_LV) return;
  const cost = Math.round(TOWERS[t.type].upCost * Math.pow(1.6, t.lv - 1));
  if (G.gold < cost) return;
  G.gold -= cost;
  t.spent += cost;
  t.lv++;
  updateHud();
  showTowerPanel(t);
}

function sellTower(t) {
  const back = Math.floor(t.spent * 0.6);
  G.gold += back;
  G.towers = G.towers.filter(x => x !== t);
  G.selected = null;
  hidePanels();
  updateHud();
}

/* ============ 合成 ============ */
const MERGE_COST = 200;          // 每次合成的金币
const MERGE_MAX_LV = 5;          // 合成塔也能升到 5 级

/* 找出某座塔的相邻塔（上下左右） */
function neighborsOf(t) {
  return G.towers.filter(o =>
    o !== t && Math.abs(o.cx - t.cx) + Math.abs(o.cy - t.cy) === 1
  );
}

/* 找出可以跟它合成的塔：双方都满级 */
function mergeableWith(t) {
  if (t.lv < MAX_LV) return [];
  return neighborsOf(t).filter(o => o.lv >= MAX_LV);
}

/* 塔的显示名（合成塔带组合名） */
function towerName(t) {
  if (t.mix) return t.mix.name;
  return TOWERS[t.type].name;
}

/* 塔的显示颜色（合成塔取两色之间的混合） */
function towerColor(t) {
  if (!t.mix) return TOWERS[t.type].color;
  return mixColor(TOWERS[t.mix.a].color, TOWERS[t.mix.b].color);
}

function mixColor(c1, c2) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
  const to = n => n.toString(16).padStart(2, '0');
  return '#' + to(Math.round((r1 + r2) / 2)) + to(Math.round((g1 + g2) / 2)) + to(Math.round((b1 + b2) / 2));
}

/* 把 t 和 other 合成，保留 t 的位置 */
function mergeTowers(t, other) {
  if (G.gold < MERGE_COST) return { ok: false, msg: '金币不足' };
  const canA = t.mix ? mergeableWith(t) : [t];
  if (t.lv < MAX_LV || other.lv < MAX_LV) return { ok: false, msg: '两座塔都要满级' };

  const statsA = towerStats(t);
  const statsB = towerStats(other);

  G.gold -= MERGE_COST;

  if (t.mix) {
    // 合成塔 + 普通满级塔：效果继续叠加
    t.mix.statsA = combineStats(t.mix.statsA, statsB);
    t.mix.statsB = t.mix.statsB;
    t.mix.a = t.mix.a;
    t.mix.b = t.mix.b;
    t.mix.count = (t.mix.count || 1) + 1;
  } else {
    // 两座普通塔：新合成塔，保留更强的那个类型作为主色
    const aType = t.type, bType = other.type;
    t.mix = {
      a: aType, b: bType,
      statsA: statsA, statsB: statsB,
      name: aType === bType ? TOWERS[aType].name + '·双' : TOWERS[aType].name + '·' + TOWERS[bType].name,
      count: 1
    };
    t.type = aType;
    t.lv = 1;                 // 合成后从 1 级重新练
    t.spent = Math.max(t.spent, other.spent);
  }

  G.towers = G.towers.filter(x => x !== other);
  spawnMergeFx(t);
  updateHud();
  showTowerPanel(t);
  return { ok: true };
}

/* 属性相加工具（用于合成塔再吸收新塔） */
function combineStats(a, b) {
  const s = { ...a };
  s.dmg = (a.dmg || 0) + (b.dmg || 0) * MERGE_BOOST;
  if (b.splash) s.splash = Math.max(a.splash || 0, b.splash) + 0.2;
  if (b.slow) {
    s.slow = Math.min(0.85, (a.slow || 0) + b.slow);
    s.slowDur = Math.max(a.slowDur || 0, b.slowDur || 0);
  }
  if (b.poison) {
    s.poison = (a.poison || 0) + b.poison;
    s.poisonDur = Math.max(a.poisonDur || 0, b.poisonDur || 0);
  }
  if (b.chain) s.chain = (a.chain || 0) + b.chain;
  return s;
}

function spawnMergeFx(t) {
  addEffect({ kind: 'merge', x: t.cx + 0.5, y: t.cy + 0.5, t: 0, dur: 0.6 });
}

/* ============ 敌人 ============ */
function spawnEnemy(type, hpScale) {
  const def = ENEMIES[type];
  const hp = Math.round(def.hp * hpScale);
  G.enemies.push({
    type, hp, maxHp: hp,
    dist: 0, x: 0, y: 0, ang: 0,
    speed: def.speed, r: def.r,
    slowT: 0, slowAmt: 0,
    poisonT: 0, poisonDps: 0,
    hitFlash: 0, dead: false
  });
}

/* ============ 波次 ============ */
function startWave() {
  if (G.running || G.over) return;
  G.wave++;
  G.running = true;
  G.spawnQueue = [];
  let t = 0;
  for (const g of waveConfig(G.wave)) {
    for (let i = 0; i < g.n; i++) {
      G.spawnQueue.push({ at: t, type: g.type, hpScale: g.hpScale });
      t += g.gap;
    }
    t += 1.0;
  }
  G.spawnQueue.sort((a, b) => a.at - b.at);
  G.spawnTimer = 0;
  document.getElementById('btnWave').disabled = true;
  document.getElementById('btnWave').textContent = '波次进行中…';
  updateHud();
}

function waveCleared() {
  G.running = false;
  // 奖励随波次线性增长，但设上限，防止后期金币无限堆积
  G.gold += Math.min(25 + G.wave * 6, 240);
  updateHud();
  const btn = document.getElementById('btnWave');
  btn.disabled = false;
  btn.textContent = `开始第 ${G.wave + 1} 波`;
}

/* ============ 更新 ============ */
function update(dt) {
  if (G.paused || G.over) return;
  const d = dt * G.speed;
  G.time += d;

  /* --- 出怪 --- */
  if (G.running && G.spawnQueue.length) {
    G.spawnTimer += d;
    while (G.spawnQueue.length && G.spawnQueue[0].at <= G.spawnTimer) {
      const s = G.spawnQueue.shift();
      spawnEnemy(s.type, s.hpScale);
    }
  }

  /* --- 敌人移动 --- */
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.slowT > 0) e.slowT -= d;
    if (e.poisonT > 0) {
      e.poisonT -= d;
      e.hp -= e.poisonDps * d;
      if (e.hp <= 0) { e.dead = true; onEnemyDead(e); continue; }
    }
    if (e.hitFlash > 0) e.hitFlash -= d;

    const spd = e.speed * (e.slowT > 0 ? (1 - e.slowAmt) : 1);
    e.dist += spd * d;
    if (e.dist >= PATH_LENGTH) {
      e.dead = true;
      const def = ENEMIES[e.type];
      G.life -= def.dmg;
      addEffect({ kind: 'flash', x: WAYPOINTS[WAYPOINTS.length - 1].x, y: WAYPOINTS[WAYPOINTS.length - 1].y, t: 0, dur: 0.4 });
      updateHud();
      if (G.life <= 0) { G.life = 0; lose(); return; }
      continue;
    }
    const p = posAt(e.dist);
    e.x = p.x; e.y = p.y; e.ang = p.ang;
  }
  G.enemies = G.enemies.filter(e => !e.dead);

  /* --- 塔开火 --- */
  for (const t of G.towers) {
    t.cd -= d;
    if (t.recoil > 0) t.recoil -= d;
    const s = towerStats(t);
    const c = { x: t.cx + 0.5, y: t.cy + 0.5 };
    // 找目标：射程内走得最远的（最接近基地）
    let best = null, bestDist = -1;
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - c.x, e.y - c.y) <= s.range && e.dist > bestDist) {
        best = e; bestDist = e.dist;
      }
    }
    if (best) {
      t.angle = Math.atan2(best.y - c.y, best.x - c.x);
      if (t.cd <= 0) {
        t.cd = s.rate;
        t.recoil = 0.09;
        fire(t, s, best, c);
      }
    }
  }

  /* --- 子弹 --- */
  for (const b of G.bullets) {
    if (b.dead) continue;
    b.life -= d;
    if (b.life <= 0) { b.dead = true; continue; }
    const tx = b.tx, ty = b.ty;
    const dx = tx - b.x, dy = ty - b.y;
    const dist = Math.hypot(dx, dy);
    const step = b.speed * d;
    if (dist <= step) {
      b.x = tx; b.y = ty;
      hitTarget(b);
      b.dead = true;
    } else {
      b.x += dx / dist * step;
      b.y += dy / dist * step;
      b.ang = Math.atan2(dy, dx);
    }
  }
  G.bullets = G.bullets.filter(b => !b.dead);

  /* --- 特效 --- */
  for (const ef of G.effects) {
    ef.t += d;
    if (ef.t >= ef.dur) ef.dead = true;
  }
  G.effects = G.effects.filter(e => !e.dead);

  /* --- 波次判定 --- */
  if (G.running && !G.spawnQueue.length && !G.enemies.length) waveCleared();
}

function onEnemyDead(e) {
  const def = ENEMIES[e.type];
  // 后期递减：防止金币无限堆积（塔位和升级都封顶后，多余金币没有意义）
  const damp = Math.max(0.35, 1 - G.wave * 0.045);
  const gain = Math.max(1, Math.round(def.gold * damp));
  G.gold += gain;
  updateHud();
  addEffect({ kind: 'coin', x: e.x, y: e.y, t: 0, dur: 0.6, v: gain });
}

function fire(t, s, target, c) {
  const def = TOWERS[t.type];
  if (t.type === 'lightning') {
    // 链式：立即结算，画折线
    const chainList = [target];
    let cur = target;
    const hitSet = new Set([target]);
    for (let i = 1; i < s.chain; i++) {
      let nxt = null, nd = 1e9;
      for (const o of G.enemies) {
        if (o.dead || hitSet.has(o)) continue;
        const dd = Math.hypot(o.x - cur.x, o.y - cur.y);
        if (dd < 2.2 && dd < nd) { nxt = o; nd = dd; }
      }
      if (!nxt) break;
      chainList.push(nxt); hitSet.add(nxt); cur = nxt;
    }
    let prev = c;
    const pts = [c];
    chainList.forEach((en, i) => {
      pts.push({ x: en.x, y: en.y });
      const dmg = s.dmg * Math.pow(0.75, i);
      damageEnemy(en, dmg, def.effects || {});
      prev = en;
    });
    addEffect({ kind: 'bolt', pts, t: 0, dur: 0.18 });
    return;
  }
  G.bullets.push({
    x: c.x, y: c.y, tx: target.x, ty: target.y, target,
    speed: t.type === 'cannon' ? 9 : 16,
    life: 1.4, ang: t.angle,
    type: t.type, dmg: s.dmg, stats: s, dead: false,
    color: def.color
  });
}

function hitTarget(b) {
  const e = b.target;
  const s = b.stats;
  const t = b.type;
  if (t === 'cannon' && s.splash) {
    addEffect({ kind: 'boom', x: b.x, y: b.y, t: 0, dur: 0.35, r: s.splash });
    for (const o of G.enemies) {
      if (o.dead) continue;
      const dd = Math.hypot(o.x - b.x, o.y - b.y);
      if (dd <= s.splash) {
        const falloff = 1 - (dd / s.splash) * 0.45;
        damageEnemy(o, s.dmg * falloff, {});
      }
    }
    return;
  }
  if (e && !e.dead) {
    damageEnemy(e, s.dmg, s);
    if (t === 'frost') {
      e.slowT = s.slowDur;
      e.slowAmt = Math.max(e.slowAmt * (e.slowT > 0 ? 1 : 0), s.slow);
      addEffect({ kind: 'frost', x: e.x, y: e.y, t: 0, dur: 0.3 });
    } else if (t === 'poison') {
      e.poisonT = s.poisonDur;
      e.poisonDps = s.poison;
    } else {
      addEffect({ kind: 'spark', x: e.x, y: e.y, t: 0, dur: 0.2 });
    }
  }
}

function damageEnemy(e, dmg, stats) {
  const def = ENEMIES[e.type];
  const armor = def.armor || 0;
  const real = Math.max(1, dmg - armor * 0.5);
  e.hp -= real;
  e.hitFlash = 0.1;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    onEnemyDead(e);
  }
}

function addEffect(ef) { G.effects.push(ef); }

/* ============ 绘制 ============ */
function draw() {
  const W = viewW, H = viewH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(TILE * scale, TILE * scale);
  ctx.lineWidth = 1 / (TILE * scale);

  drawGrid();
  drawPath();
  drawBuildHint();
  drawTowers();
  drawEnemies();
  drawBullets();
  drawEffects();

  ctx.restore();
}

function drawGrid() {
  // 空地
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (PATH_SET.has(x + ',' + y)) continue;
      const shade = (x + y) % 2 === 0 ? '#151a24' : '#12171f';
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 细线
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.beginPath();
  for (let x = 0; x <= COLS; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, ROWS); }
  for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y); ctx.lineTo(COLS, y); }
  ctx.stroke();
}

function drawPath() {
  const w = 0.78;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2b3444';
  ctx.lineWidth = w;
  ctx.beginPath();
  PATH.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0] + 0.5, p[1] + 0.5);
    else ctx.lineTo(p[0] + 0.5, p[1] + 0.5);
  });
  ctx.stroke();

  // 内侧亮线（行走的纹理）
  ctx.strokeStyle = 'rgba(120,150,200,0.10)';
  ctx.lineWidth = 0.06;
  ctx.setLineDash([0.18, 0.26]);
  ctx.lineDashOffset = -G.time * 0.5;
  ctx.beginPath();
  PATH.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0] + 0.5, p[1] + 0.5);
    else ctx.lineTo(p[0] + 0.5, p[1] + 0.5);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 入口
  const s = PATH[0], e = PATH[PATH.length - 1];
  ctx.fillStyle = 'rgba(239,107,107,0.16)';
  ctx.fillRect(s[0], s[1] - 0.5, 1, 0.5);
  // 基地
  ctx.save();
  ctx.translate(e[0] + 0.5, e[1] + 0.5);
  const pulse = 1 + Math.sin(G.time * 3) * 0.05;
  ctx.scale(pulse, pulse);
  ctx.fillStyle = G.life <= 5 ? 'rgba(239,68,68,0.35)' : 'rgba(74,222,128,0.2)';
  ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = G.life <= 5 ? '#ef4444' : '#4ade80';
  ctx.beginPath(); ctx.arc(0, 0, 0.24, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBuildHint() {
  if (!G.buildAt) return;
  const { x, y } = G.buildAt.cell;
  // 选中格子但还没选塔类型时，只画格子高亮
  if (!G.buildAt.type) {
    const empty = canBuild(x, y);
    ctx.fillStyle = empty ? 'rgba(120,180,255,0.16)' : 'rgba(239,68,68,0.20)';
    ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = empty ? 'rgba(120,180,255,0.8)' : 'rgba(239,68,68,0.8)';
    ctx.lineWidth = 1.6 / (TILE * scale);
    ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
    return;
  }
  const ok = canBuild(x, y) && G.gold >= TOWERS[G.buildAt.type].cost;
  ctx.fillStyle = ok ? 'rgba(74,222,128,0.20)' : 'rgba(239,68,68,0.20)';
  ctx.fillRect(x, y, 1, 1);
  ctx.strokeStyle = ok ? 'rgba(74,222,128,0.8)' : 'rgba(239,68,68,0.8)';
  ctx.lineWidth = 1.6 / (TILE * scale);
  ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
  // 射程预览
  const s = TOWERS[G.buildAt.type].base;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.fillStyle = 'rgba(120,180,255,0.055)';
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, s.range, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

function drawTowers() {
  for (const t of G.towers) {
    const col = towerColor(t);
    const cx = t.cx + 0.5, cy = t.cy + 0.5;
    const rec = t.recoil > 0 ? t.recoil / 0.09 * 0.06 : 0;

    // 合成塔：底部光环
    if (t.mix) {
      const pulse = 0.55 + Math.sin(G.time * 4 + t.cx) * 0.12;
      const g = ctx.createRadialGradient(cx, cy, 0.1, cx, cy, 0.62);
      g.addColorStop(0, hexA(col, 0.42 * pulse));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, 0.62, 0, Math.PI * 2); ctx.fill();
    }

    // 底座
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy + 0.06, 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.mix ? '#2a2440' : '#232c3c';
    ctx.beginPath(); ctx.arc(cx, cy, 0.33, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = t.mix ? 0.06 : 0.045;
    ctx.stroke();

    // 等级刻度
    const maxLv = t.mix ? MERGE_MAX_LV : MAX_LV;
    for (let i = 0; i < t.lv - 1; i++) {
      const a = -Math.PI / 2 + (i - (t.lv - 2) / 2) * 0.5;
      ctx.fillStyle = '#f0c04a';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 0.44, cy + Math.sin(a) * 0.44, 0.045, 0, Math.PI * 2);
      ctx.fill();
    }

    // 合成塔：外圈双环
    if (t.mix) {
      ctx.strokeStyle = hexA(col, 0.55);
      ctx.lineWidth = 0.028;
      ctx.beginPath(); ctx.arc(cx, cy, 0.47, 0, Math.PI * 2); ctx.stroke();
      if (t.mix.count > 1) {
        ctx.setLineDash([0.08, 0.07]);
        ctx.beginPath(); ctx.arc(cx, cy, 0.54, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 炮身
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t.angle);
    ctx.translate(-rec, 0);
    ctx.fillStyle = col;
    const shape = t.mix ? t.mix.a : t.type;
    if (shape === 'cannon') {
      ctx.fillRect(0, -0.1, 0.36, 0.2);
    } else if (shape === 'lightning') {
      ctx.beginPath();
      ctx.moveTo(0.05, -0.13); ctx.lineTo(0.36, 0); ctx.lineTo(0.05, 0.13);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(0, -0.055, 0.34, 0.11);
    }
    ctx.restore();

    // 中心
    ctx.fillStyle = t.mix ? '#1a1530' : '#12161f';
    ctx.beginPath(); ctx.arc(cx, cy, 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, t.mix ? 0.1 : 0.085, 0, Math.PI * 2); ctx.fill();

    // 选中射程
    if (G.selected === t) {
      const s = towerStats(t);
      ctx.strokeStyle = t.mix ? 'rgba(200,160,255,0.6)' : 'rgba(240,192,74,0.55)';
      ctx.setLineDash([0.12, 0.1]);
      ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(cx, cy, s.range, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/* #rrggbb + alpha → rgba() */
function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawEnemies() {
  for (const e of G.enemies) {
    const def = ENEMIES[e.type];
    const r = e.r / TILE;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + r * 0.7, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    // 身体
    let col = def.color;
    if (e.hitFlash > 0) col = '#ffffff';
    ctx.fillStyle = col;
    ctx.beginPath();
    if (def.flying) {
      const f = Math.sin(G.time * 10 + e.dist) * 0.06;
      ctx.arc(e.x, e.y - 0.1 + f, r, 0, Math.PI * 2);
    } else {
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // 中毒/减速环
    if (e.poisonT > 0) {
      ctx.strokeStyle = 'rgba(154,212,107,0.9)';
      ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(e.x, e.y, r + 0.05, 0, Math.PI * 2); ctx.stroke();
    }
    if (e.slowT > 0) {
      ctx.strokeStyle = 'rgba(143,215,240,0.85)';
      ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(e.x, e.y, r + 0.1, 0, Math.PI * 2); ctx.stroke();
    }

    // 重甲/首领描边
    if (def.armor) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.62, 0, Math.PI * 2); ctx.stroke();
    }

    // 血条
    const hpRatio = Math.max(0, e.hp / e.maxHp);
    if (hpRatio < 1) {
      const bw = r * 2.6, bh = 0.075;
      const bx = e.x - bw / 2, by = e.y - r - 0.19;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.22 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(bx, by, bw * hpRatio, bh);
    }
  }
}

function drawBullets() {
  for (const b of G.bullets) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.ang);
    if (b.type === 'cannon') {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(0, 0, 0.1, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'frost') {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(0, 0, 0.075, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'poison') {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(0, 0, 0.08, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = b.color;
      ctx.fillRect(-0.12, -0.028, 0.22, 0.056);
    }
    ctx.restore();
  }
}

function drawEffects() {
  for (const ef of G.effects) {
    const p = Math.min(1, ef.t / ef.dur);
    const a = 1 - p;
    if (ef.kind === 'boom') {
      ctx.fillStyle = `rgba(255,170,80,${a * 0.55})`;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, ef.r * (0.4 + p * 0.7), 0, Math.PI * 2); ctx.fill();
    } else if (ef.kind === 'frost') {
      ctx.strokeStyle = `rgba(143,215,240,${a})`;
      ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, 0.2 + p * 0.4, 0, Math.PI * 2); ctx.stroke();
    } else if (ef.kind === 'spark') {
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, 0.12 * (1 - p) + 0.04, 0, Math.PI * 2); ctx.fill();
    } else if (ef.kind === 'coin') {
      ctx.fillStyle = `rgba(240,192,74,${a})`;
      ctx.font = `${0.36}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('+' + ef.v, ef.x, ef.y - p * 0.8);
    } else if (ef.kind === 'flash') {
      ctx.fillStyle = `rgba(239,68,68,${a * 0.4})`;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, 0.5 + p * 0.7, 0, Math.PI * 2); ctx.fill();
    } else if (ef.kind === 'bolt') {
      ctx.strokeStyle = `rgba(220,180,255,${a})`;
      ctx.lineWidth = 0.07;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ef.pts.forEach((pt, i) => {
        const jx = (Math.random() - 0.5) * 0.12;
        const jy = (Math.random() - 0.5) * 0.12;
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x + jx, pt.y + jy);
      });
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`;
      ctx.lineWidth = 0.025;
      ctx.stroke();
    } else if (ef.kind === 'merge') {
      // 合成：扩散的紫色光环
      const rr = 0.2 + p * 0.9;
      ctx.strokeStyle = `rgba(180,140,255,${a})`;
      ctx.lineWidth = 0.09 * (1 - p) + 0.02;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(240,220,255,${a * 0.7})`;
      ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, rr * 0.65, 0, Math.PI * 2); ctx.stroke();
      // 中心闪光
      ctx.fillStyle = `rgba(255,255,255,${a * 0.85})`;
      ctx.beginPath(); ctx.arc(ef.x, ef.y, 0.3 * (1 - p) + 0.05, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ============ UI ============ */
const $ = id => document.getElementById(id);

function updateHud() {
  $('hWave').textContent = `${G.wave}`;
  $('hLife').textContent = G.life;
  $('hGold').textContent = Math.floor(G.gold);
  const best = Math.max(getBest(), G.wave);
  const hb = $('hBest');
  if (hb) hb.textContent = best;
  if (G.selected) showTowerPanel(G.selected);
}

function hidePanels() {
  $('buildMenu').classList.add('hidden');
  $('towerPanel').classList.add('hidden');
  G.buildAt = null;
}

function showBuildMenu(px, py, cell) {
  G.buildAt = { cell, px, py };
  G.buildMenuAt = performance.now();
  const box = $('bmTowers');
  box.innerHTML = '';
  for (const k of TOWER_KEYS) {
    const def = TOWERS[k];
    const b = document.createElement('button');
    b.className = 'tower-opt';
    b.disabled = G.gold < def.cost;
    b.innerHTML = `<span class="dot" style="background:${def.color}"></span>
      <span class="nm">${def.name}<span class="dsc">${def.desc}</span></span>
      <span class="cs">${def.cost}</span>`;
    b.onclick = () => {
      // 防误触：菜单刚弹出的瞬间不接受选择
      if (performance.now() - (G.buildMenuAt || 0) < 250) return;
      if (buildTower(k, cell.x, cell.y)) hidePanels();
    };
    box.appendChild(b);
  }
  const m = $('buildMenu');
  m.classList.remove('hidden');
  const stage = $('stage');
  const mw = 230, mh = m.offsetHeight || 260;
  // 优先右上方，避开手指位置；放不下就翻到左侧
  let left = px + 14, top = py - mh / 2;
  if (left + mw > stage.clientWidth - 6) left = px - mw - 14;
  if (left < 6) left = 6;
  top = Math.max(6, Math.min(stage.clientHeight - mh - 6, top));
  m.style.left = left + 'px';
  m.style.top = top + 'px';
}

function showTowerPanel(t) {
  G.selected = t;
  const s = towerStats(t);
  $('tpName').textContent = towerName(t);
  const maxLv = t.mix ? MERGE_MAX_LV : MAX_LV;
  $('tpLv').textContent = `Lv.${t.lv}/${maxLv}${t.lv >= maxLv ? ' (满级)' : ''}`;
  let html = `<div><i>伤害</i>${s.dmg.toFixed(1)}</div>
    <div><i>射程</i>${s.range.toFixed(2)} 格</div>
    <div><i>攻速</i>${(1 / s.rate).toFixed(2)} 次/秒</div>`;
  if (s.splash) html += `<div><i>溅射</i>${s.splash.toFixed(2)} 格</div>`;
  if (s.slow) html += `<div><i>减速</i>${Math.round(s.slow * 100)}% / ${(+s.slowDur).toFixed(1)}s</div>`;
  if (s.poison) html += `<div><i>中毒</i>${s.poison.toFixed(1)}/秒 × ${(+s.poisonDur).toFixed(1)}s</div>`;
  if (s.chain) html += `<div><i>连锁</i>${s.chain} 个目标</div>`;
  if (t.mix && t.mix.count > 1) html += `<div><i>合成</i>${t.mix.count} 合 1</div>`;
  $('tpStats').innerHTML = html;

  const upBtn = $('tpUp');
  if (t.lv >= maxLv) {
    upBtn.disabled = true;
    upBtn.textContent = '已满级';
  } else {
    const cost = upCostOf(t);
    upBtn.disabled = G.gold < cost;
    upBtn.textContent = `升级 ${cost}`;
  }

  // 合成按钮：只有满级且左右上下有满级塔时才可用
  const mgBtn = $('tpMerge');
  if (mgBtn) {
    if (t.lv < MAX_LV) {
      mgBtn.classList.add('hidden');
    } else {
      mgBtn.classList.remove('hidden');
      const partners = mergeableWith(t);
      if (!partners.length) {
        mgBtn.disabled = true;
        mgBtn.textContent = '相邻没有满级塔';
      } else if (G.gold < MERGE_COST) {
        mgBtn.disabled = true;
        mgBtn.textContent = `合成需 ${MERGE_COST}`;
      } else {
        mgBtn.disabled = false;
        const p = partners[0];
        mgBtn.textContent = `合成 → ${TOWERS[t.type].name}·${TOWERS[p.type].name} (${MERGE_COST})`;
      }
    }
  }

  $('tpSell').textContent = `卖掉 +${Math.floor(t.spent * 0.6)}`;

  const p = $('towerPanel');
  p.classList.remove('hidden');
  const stage = $('stage');
  const cc = cellCenter(t.cx, t.cy);
  const pw = p.offsetWidth || 230, ph = p.offsetHeight || 190;
  const half = TILE * scale * 0.5;
  const stageW = stage.clientWidth, stageH = stage.clientHeight;
  const gap = 12;

  // 优先放右侧；右侧空间不够就翻到左侧；都放不下就居中浮在塔上方
  let left;
  const rightRoom = stageW - (cc.x + half) - gap;
  const leftRoom = (cc.x - half) - gap;
  if (rightRoom >= pw) left = cc.x + half + gap;
  else if (leftRoom >= pw) left = cc.x - half - pw - gap;
  else left = Math.max(6, Math.min(stageW - pw - 6, cc.x - pw / 2));

  // 垂直方向尽量与塔对齐，但不超出屏幕
  let top = cc.y - ph / 2;
  top = Math.max(6, Math.min(stageH - ph - 6, top));

  p.style.left = left + 'px';
  p.style.top = top + 'px';
  $('buildMenu').classList.add('hidden');
}

/* ============ 输入 ============ */
function localPos(ev) {
  const r = cv.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

cv.addEventListener('pointerdown', ev => {
  if (G.over) return;
  // 关键：阻止触摸后浏览器补发的合成 click。
  // 否则菜单弹在手指下方时，那次 click 会直接点到塔选项上，
  // 表现就是「点一下空地就直接建塔，跳过了选择」。
  ev.preventDefault();
  const p = localPos(ev);
  const cell = toCell(p.x, p.y);

  // 先看有没有点中塔
  const hitTower = G.towers.find(t => t.cx === cell.x && t.cy === cell.y);
  if (hitTower) {
    if (G.selected === hitTower) { hidePanels(); G.selected = null; }
    else showTowerPanel(hitTower);
    return;
  }

  if (!canBuild(cell.x, cell.y)) {
    hidePanels();
    G.selected = null;
    return;
  }
  // 空地 → 开建造菜单
  const stage = $('stage');
  const r = cv.getBoundingClientRect();
  showBuildMenu(p.x + (r.left - stage.getBoundingClientRect().left),
                p.y + (r.top - stage.getBoundingClientRect().top), cell);
});

$('bmClose').onclick = () => { hidePanels(); };
$('tpClose').onclick = () => { hidePanels(); G.selected = null; };
$('tpUp').onclick = () => { if (G.selected) upgradeTower(G.selected); };
$('tpSell').onclick = () => { if (G.selected) sellTower(G.selected); };
$('tpMerge').onclick = () => {
  if (!G.selected) return;
  const partners = mergeableWith(G.selected);
  if (!partners.length) return;
  const r = mergeTowers(G.selected, partners[0]);
  if (!r.ok && r.msg) $('tip').textContent = r.msg;
};

$('btnWave').onclick = () => startWave();

$('btnPause').onclick = () => {
  G.paused = !G.paused;
  $('btnPause').textContent = G.paused ? '▶' : '❚❚';
};

$('btnSpeed').onclick = () => {
  G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 3 : 1;
  $('btnSpeed').textContent = G.speed + '×';
};

/* ============ 结算 ============ */
function showOverlay(title, text, btn, fn) {
  $('ovTitle').textContent = title;
  $('ovText').textContent = text;
  const b = $('ovBtn');
  b.textContent = btn;
  b.onclick = fn;
  $('overlay').classList.remove('hidden');
}

function win() {
  // 无限模式不再有「通关」，保留此函数供扩展
  G.over = true;
  hidePanels();
  showOverlay('守住了！', `剩余生命 ${G.life}。`, '再来一局', () => location.reload());
}

/* 最高波次记录（本地保存） */
const BEST_KEY = 'td_best_wave';
function getBest() {
  try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) { return 0; }
}
function saveBest(w) {
  try {
    if (w > getBest()) { localStorage.setItem(BEST_KEY, String(w)); return true; }
  } catch (e) {}
  return false;
}

function lose() {
  G.over = true;
  hidePanels();
  const btn = document.getElementById('btnWave');
  btn.disabled = true;
  btn.textContent = '失守';
  const prevBest = getBest();
  const isNew = saveBest(G.wave);
  let text = `坚持到第 ${G.wave} 波。`;
  if (isNew) text += ` 新的最高纪录！（之前 ${prevBest} 波）`;
  else text += ` 历史最高：第 ${prevBest} 波`;
  showOverlay(isNew ? '新纪录！' : '基地失守', text, '再来一局', () => location.reload());
}

/* ============ 主循环 ============ */
let lastT = 0;
function loop(ts) {
  if (!lastT) lastT = ts;
  let dt = (ts - lastT) / 1000;
  lastT = ts;
  if (dt > 0.1) dt = 0.1;   // 后台回来不跳帧
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ============ 启动 ============ */
/* 注意：页面在后台时 rAF 不触发，所以首帧必须直接绘制一次，
   否则切回来看到的是一片空白 */
function boot() {
  resize();
  updateHud();
  draw();
}
boot();
window.addEventListener('orientationchange', () => setTimeout(() => { resize(); draw(); }, 220));
requestAnimationFrame(loop);

/* 后台标签页加载时，首次 canvas 绘制可能被丢弃（rAF 也不触发）。
   用几个延迟重绘兜底，等页面真正可见时一定有一帧 */
[60, 200, 600, 1500].forEach(ms => setTimeout(() => { if (!document.hidden) { resize(); draw(); } }, ms));

/* 后台标签页里 rAF 会停，靠 interval 兜底推进（防止画面卡死在旧帧） */
setInterval(() => {
  if (document.hidden) {
    update(0.05);
    draw();
  }
}, 200);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { lastT = 0; resize(); draw(); }
});
