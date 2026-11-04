// ---------- 요소 가져오기 ----------
const stage = document.querySelector('.stage');
const butterfly = document.querySelector('.butterfly');

const flowers = Array.from(document.querySelectorAll('.flower')).map(function (el) {
  return {
    el: el,
    bloomEl: el.querySelector('.bloom'),
    center: el.querySelector('.center'),
    petals: Array.from(el.querySelectorAll('.petal')),
    rx: Number(el.dataset.x),        // 영역 안 가로 위치 (0 ~ 1)
    ry: Number(el.dataset.y),        // 영역 안 세로 위치 (0 ~ 1)
    size: Number(el.dataset.size),
    bloom: 0.3                       // 0 = 오므림, 1 = 활짝
  };
});

// 움직임 감소 설정을 켠 사용자는 더 느리게
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = reduceMotion ? 0.5 : 1;

// ---------- 설정값 ----------
const HOVER_RANGE = 110;   // 꽃 중심에서 이 거리 안에 커서가 오면 꽃이 핌(px, 크기 비율 적용)
const FOLLOW_TIME = 2500;  // 마우스를 멈춘 뒤 이 시간 동안은 커서를 따라다님(ms)
const CLICK_TIME = 2200;   // 클릭한 곳으로 날아가는 시간(ms)
const MAX_SPEED = 2.2;     // 최대 비행 속도(px/frame)
const MIN_REST = 2000;     // 꽃에 앉으면 최소 이 시간은 머묾(ms)
const LINGER = 1800;       // 커서가 꽃에서 벗어나도 이 시간 동안은 더 앉아 있음(ms)
const AUTO_REST_MIN = 6000; // 혼자 있을 때 꽃에 머무는 시간(ms)
const AUTO_REST_MAX = 9000;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// ---------- 화면 크기에 맞춰 배치 ----------
let area = null;   // 메인 그래픽 영역
let k = 1;         // 크기 비율

function layout() {
  area = stage.getBoundingClientRect();
  k = clamp(Math.min(area.width / 1000, area.height / 640), 0.5, 1.1);

  butterfly.style.setProperty('--k', k);

  flowers.forEach(function (f) {
    f.el.style.left = `${area.left + area.width * f.rx}px`;
    f.el.style.top = `${area.top + area.height * f.ry}px`;
    f.el.style.setProperty('--fs', f.size * k);
  });
}

layout();
window.addEventListener('resize', layout);

// 나비가 화면 밖으로 나가지 않도록 제한 (화면 전체를 날아다님)
function keepInside(x, y) {
  const pad = 70 * k;
  return {
    x: clamp(x, pad, window.innerWidth - pad),
    y: clamp(y, pad, window.innerHeight - pad)
  };
}

// 꽃 중심의 현재 위치 (꽃이 기울어져도 정확히 따라감)
function centerOf(f) {
  const r = f.center.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ---------- 나비 상태 ----------
const b = {
  x: area.left + area.width * 0.5,
  y: area.top + area.height * 0.3,
  vx: 0,
  vy: 0,
  resting: false,
  restFlower: null,
  landedAt: 0,
  lingerUntil: 0,
  tilt: 0,
  orbit: 0
};

// 혼자 있을 때: 꽃을 골라 앉았다가, 잠깐 날아다니다가, 다른 꽃으로
const auto = {
  flower: null,
  last: null,
  restUntil: 0,
  wanderUntil: 1500,
  wx: b.x,
  wy: b.y
};

function pickWanderPoint() {
  auto.wx = window.innerWidth * rand(0.08, 0.92);
  auto.wy = window.innerHeight * rand(0.12, 0.85);
}

function land(f) {
  b.resting = true;
  b.restFlower = f;
  b.landedAt = performance.now();
  butterfly.classList.add('resting');
}

function takeOff() {
  b.resting = false;
  b.restFlower = null;
  b.vy = -1.6;
  b.vx = rand(-1, 1);
  butterfly.classList.remove('resting');
}

// ---------- 마우스 입력 ----------
const mouse = { x: null, y: null, lastMove: -Infinity };
let clickGoal = null;

window.addEventListener('mousemove', function (e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.lastMove = performance.now();
});

document.addEventListener('mouseleave', function () {
  mouse.x = null;
  mouse.y = null;
});

window.addEventListener('click', function (e) {
  const now = performance.now();
  let hit = null;

  flowers.forEach(function (f) {
    const p = centerOf(f);
    if (Math.hypot(p.x - e.clientX, p.y - e.clientY) < HOVER_RANGE * k) hit = f;
  });

  if (hit) {
    // 꽃을 누르면 꽃이 톡 튀고, 앉아 있던 나비는 놀라서 날아오름
    hit.bloomEl.classList.remove('pulse');
    void hit.bloomEl.offsetWidth;
    hit.bloomEl.classList.add('pulse');

    if (b.restFlower === hit) {
      takeOff();
      const p = centerOf(hit);
      clickGoal = { x: p.x + rand(-150, 150) * k, y: p.y - rand(100, 160) * k, until: now + CLICK_TIME };
    }
  } else {
    // 빈 곳을 누르면 그곳으로 팔랑팔랑 날아감
    if (b.resting) takeOff();
    clickGoal = { x: e.clientX, y: e.clientY, until: now + CLICK_TIME };
  }
});

// ---------- 매 프레임 실행 ----------
let prevHover = null;

function update(now) {
  // 1. 커서가 올라간 꽃 찾기
  let hover = null;
  if (mouse.x !== null) {
    flowers.forEach(function (f) {
      const p = centerOf(f);
      if (Math.hypot(p.x - mouse.x, p.y - mouse.y) < HOVER_RANGE * k) hover = f;
    });
  }

  // 커서가 앉아 있던 꽃에서 벗어나면, 바로 떠나지 않고 잠깐 더 머묾
  if (prevHover && !hover && b.resting && b.restFlower === prevHover) {
    b.lingerUntil = now + LINGER;
  }
  prevHover = hover;

  const lingering = b.resting && (now < b.lingerUntil || now - b.landedAt < MIN_REST);

  // 2. 갈 곳 정하기: 꽃 위 커서 → 클릭한 곳 → 잠깐 더 머물기 → 커서 → 혼자 놀기
  let goalFlower = null;
  let gx = 0;
  let gy = 0;

  if (clickGoal && now > clickGoal.until) clickGoal = null;

  if (hover) {
    goalFlower = hover;
  } else if (clickGoal) {
    gx = clickGoal.x;
    gy = clickGoal.y;
  } else if (lingering) {
    goalFlower = b.restFlower;
  } else if (mouse.x !== null && now - mouse.lastMove < FOLLOW_TIME) {
    b.orbit += 0.012 * SPEED;
    gx = mouse.x + Math.cos(b.orbit) * 80 * k;
    gy = mouse.y + Math.sin(b.orbit) * 50 * k - 30 * k;
  } else {
    if (!auto.flower && now > auto.wanderUntil) {
      const options = flowers.filter(function (f) { return f !== auto.last; });
      auto.flower = options[Math.floor(Math.random() * options.length)];
    }
    if (auto.flower) {
      goalFlower = auto.flower;
    } else {
      gx = auto.wx;
      gy = auto.wy;
    }
  }

  // 앉아 있는데 갈 곳이 바뀌거나, 혼자 쉬는 시간이 끝나면 날아오름
  if (b.resting) {
    if (goalFlower !== b.restFlower) {
      takeOff();
    } else if (!hover && !lingering && goalFlower === auto.flower && now > auto.restUntil) {
      auto.last = auto.flower;
      auto.flower = null;
      auto.wanderUntil = now + rand(3000, 6000);
      pickWanderPoint();
      takeOff();
      goalFlower = null;
      gx = auto.wx;
      gy = auto.wy;
    }
  }

  // 3. 움직임
  if (b.resting) {
    // 꽃 위에 앉아 꽃과 함께 흔들림
    const p = centerOf(b.restFlower);
    b.x += (p.x - b.x) * 0.25;
    b.y += (p.y - 8 * k - b.y) * 0.25;
  } else {
    if (goalFlower) {
      const p = centerOf(goalFlower);
      gx = p.x;
      gy = p.y - 8 * k;
    } else {
      const inside = keepInside(gx, gy);
      gx = inside.x;
      gy = inside.y;
    }

    const dx = gx - b.x;
    const dy = gy - b.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (goalFlower && dist < 10) {
      // 꽃에 사뿐히 내려앉음
      land(goalFlower);
      if (!hover && goalFlower === auto.flower) {
        auto.restUntil = now + rand(AUTO_REST_MIN, AUTO_REST_MAX);
      }
    } else {
      if (!goalFlower && !clickGoal && dist < 30) pickWanderPoint();

      // 목표 방향 + 좌우 지그재그 + 약간의 불규칙한 흔들림
      const zig = Math.sin(now * 0.005) * 0.12;
      b.vx += dx * 0.003 + (-dy / dist) * zig + rand(-0.04, 0.04);
      b.vy += dy * 0.003 + (dx / dist) * zig + rand(-0.04, 0.04);
      b.vx *= 0.95;
      b.vy *= 0.95;

      // 목표에 가까워질수록 천천히
      const max = MAX_SPEED * SPEED * clamp(dist / 120, 0.45, 1);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > max) {
        b.vx *= max / sp;
        b.vy *= max / sp;
      }

      b.x += b.vx;
      b.y += b.vy;
    }
  }

  // 날아가는 방향으로 기울어짐
  const tiltTarget = b.resting ? 0 : clamp(b.vx * 8, -25, 25);
  b.tilt += (tiltTarget - b.tilt) * 0.08;

  butterfly.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.tilt}deg)`;

  // 4. 꽃: 커서가 오거나 나비가 앉으면 활짝 피고 빛남
  flowers.forEach(function (f) {
    let target = 0.3;
    if (b.restFlower === f) target = 0.85;
    if (hover === f) target = 1;

    f.bloom += (target - f.bloom) * 0.04 * SPEED;

    f.petals.forEach(function (petal, i) {
      const angle = i * 90 + 45 + (1 - f.bloom) * 25;
      const sx = 0.4 + 0.6 * f.bloom;
      const sy = 0.55 + 0.45 * f.bloom;
      petal.style.transform = `rotate(${angle}deg) scale(${sx}, ${sy})`;
    });

    const glow = (f.bloom - 0.3) / 0.7;
    f.el.style.filter = `drop-shadow(0 0 ${(4 + glow * 20).toFixed(1)}px rgba(255, 200, 225, ${(0.2 + glow * 0.5).toFixed(2)}))`;
  });

  requestAnimationFrame(update);
}

requestAnimationFrame(update);
