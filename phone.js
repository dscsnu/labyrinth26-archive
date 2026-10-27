"use strict";
// The followed team's phone: the game's /play screen (frontend
// src/routes/play/+page.svelte) rebuilt at any moment from the events.
// The top bar (boss, HP, next attack, health), the map with the team's
// scanned points, its path and its cooled-down points, held and running
// powerups, the spell button, and what popped up: scan results, attacks,
// toasts and the quiz, with the game's own texts.
//
// What isn't recorded is inferred: the selected shape is the one the
// attempt ended up casting, and a popup or toast stays up for as long as
// the game shows it (or 2-4 s for ones a player taps away).
const Phone = (() => {
  const SW = 390, SH = 844, TOP = Math.round(SH * 0.25), MH = SH - TOP;
  const MS = MH / 1346, MW = Math.round(1168 * MS), OX = Math.round((SW - MW) / 2); // the map fits the height, centred
  const BANNERS = { 1: ["#1f1f1f", "#8f3414"], 2: ["#1f1f1f", "#5b2a86"], 3: ["#a0582a", "#f1e6cc"],
    4: ["#a8235e", "#f1e6cc"], 5: ["#4f3868", "#907868"], 6: ["#000000", "#ffffff"] };
  const NAMES = { damage_multiplier: "Damage Multiplier", heart: "Extra Life", short_qr_cooldown: "Quick Cooldown", instant_cast: "Instant Cast" };
  const ICONS = { damage_multiplier: "damage_multiplier_64", heart: "gain_a_life_64", short_qr_cooldown: "short_cooldown_64", instant_cast: "instant_cast_64" };
  const QR = ["#####...#####", "#...#.#.#...#", "#.#.#...#.#.#", "#...#.#.#...#", "#####...#####", ".............", ".#.#..#.#.#..",
    ".............", "#####...#.#.#", "#...#.#..#.#.", "#.#.#...#.#..", "#...#.#.....#", "#####....#.##"]
    .flatMap((row, y) => [...row.matchAll(/#+/g)].map((m) => `M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`)).join("");

  const el = document.getElementById("phone");
  el.innerHTML = `
    <div class="screen">
      <div class="top">
        <div class="tiles"><div class="checks"></div><div class="light"></div></div>
        <div class="row"><span class="px back">&lt;</span><span class="health"><span class="outline hp-n"></span><img src="assets/scott-face.png" alt=""></span></div>
        <div class="bossrow">
          <img class="boss" alt="">
          <div class="bossinfo"><p class="bossname"></p><div class="px bar"><div class="trail"></div><div class="fill"></div><span class="outline hptext"></span></div></div>
          <p class="px next outline"></p>
          <p class="outline done">Every boss defeated!</p>
        </div>
      </div>
      <div class="map">
        <canvas width="${SW}" height="${MH}"></canvas>
        <p class="ko outline">Knocked out! Your team can't cast or scan. Ask an organiser to revive you.</p>
        <div class="powerups"></div>
        <span class="px qr"><svg viewBox="0 0 13 13" shape-rendering="crispEdges"><path d="${QR}" fill="#1a1423"/></svg></span>
        <div class="controls">
          <span class="px zoom"><svg viewBox="0 0 8 8" shape-rendering="crispEdges"><path d="M3 1h2v2h2v2h-2v2h-2v-2h-2v-2h2z" fill="#1a1423"/></svg></span>
          <span class="px zoom"><svg viewBox="0 0 8 8" shape-rendering="crispEdges"><path d="M1 3h6v2h-6z" fill="#1a1423"/></svg></span>
          <span class="book"></span>
        </div>
      </div>
      <p class="px toast"></p>
      <div class="px popup scanpop"><p class="title outline"></p><p class="text"></p></div>
      <div class="px popup attackpop"><img class="atkboss" alt=""><p class="atktext"></p><p class="health big"><span class="outline atkhp"></span><img src="assets/scott-face.png" alt=""></p><span class="px gold">Okay, I will lock in now</span></div>
      <div class="dim quiz"><div class="px card"><p class="qhead"><span class="qwin"></span><span class="qleft"></span></p><h2 class="qq"></h2><div class="qopts"></div><p class="qnote"></p></div></div>
    </div>
    <p class="caption"><span class="label">PHONE</span><span class="chip"><i></i><span class="name"></span></span><button type="button" class="hide">Close</button></p>`;
  const $ = (s) => el.querySelector(s);
  $(".hide").onclick = () => (phoneOn = false);
  const mc = $(".map canvas"), m = mc.getContext("2d");
  m.imageSmoothingEnabled = false;

  // Each team's events, and each scan's selected shape: the shape its
  // attempt went on to cast.
  const byTeam = {};
  for (const e of T.events) if (e.team) (byTeam[e.team] ??= []).push(e);
  for (const list of Object.values(byTeam)) {
    let pending = [];
    for (const e of list) {
      if (e.type === "scan") pending.push(e);
      else if (e.type === "cast") { for (const s of pending) s.sel = e.shape; pending = []; }
    }
  }
  const quizzes = T.events.filter((e) => e.type === "quiz");
  const countdown = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const bossName = (serial) => T.bosses[serial - 1].name;
  const unlockedAt = (defeated) => Math.max(...Object.entries(T.rules.unlocks).filter(([b]) => Number(b) <= defeated).map(([, p]) => p));
  const shapeAt = (points) => Object.entries(T.shapePoints).find(([, p]) => p === points)?.[0];

  // The phone at t: everything on it, worked out from the team's events.
  function stateAt(id, t) {
    const s = { phaseStart: team[id].started, cds: {}, boosted: false, shortUntil: 0, stack: [], sel: null,
      hit: -1e15, lastAttack: null, lastScan: null, toast: null, answers: {} };
    for (const e of byTeam[id] ?? []) {
      if (e.t > t) break;
      switch (e.type) {
        case "scan": s.stack.push(e); s.sel = e.sel; s.lastScan = e; break;
        case "cast": {
          s.stack = []; s.sel = null;
          const cd = e.shortQR ? T.rules.shortQRCooldownMs : T.rules.qrCooldownMs;
          for (const wp of e.wps) s.cds[wp] = e.t + cd;
          if (e.boss) s.hit = e.t;
          if (e.boosted) s.boosted = false;
          if (e.instant) s.toast = { t: e.t, ok: true, text: `Instant cast: ${e.dealt} dmg${e.boss ? ` to ${bossName(e.boss)}` : ""}${e.defeated ? ", defeated!" : ""}` };
          if (e.defeated) {
            s.phaseStart = e.t;
            const d = e.boss, unlocked = unlockedAt(d) > unlockedAt(d - 1) ? shapeAt(unlockedAt(d)) : null;
            s.toast = { t: e.t, ok: true, text: `${bossName(e.boss)} defeated!${unlocked ? ` Unlocked: ${unlocked}` : ""}` };
          }
          s.lastCast = e;
          break;
        }
        case "attack": case "knockout": s.lastAttack = e;
          if (e.type === "knockout") s.toast = { t: e.t, ok: false, text: "Knocked out! Ask an organiser to revive your team." };
          break;
        case "revive": s.phaseStart = e.t; s.toast = { t: e.t, ok: true, text: "Revived: full health. Back in the game!" }; break;
        case "powerup":
          if (e.kind === "damage_multiplier") s.boosted = true;
          if (e.kind === "short_qr_cooldown") s.shortUntil = e.t + T.rules.shortQRWindowMs;
          if (e.kind !== "instant_cast") s.toast = { t: e.t, ok: true, text: `${NAMES[e.kind]} used` };
          break;
        case "answer":
          s.answers[e.qte] = e;
          if (e.granted) s.toast = { t: e.t, ok: true, text: `Powerup: ${NAMES[e.powerup]}!` };
          break;
      }
    }
    if (s.shortUntil && t >= s.shortUntil && t - s.shortUntil < 4000 * speedNow) s.toast = { t: s.shortUntil, ok: true, text: "Quick cooldown ended" };
    return s;
  }

  // The selected shape, drawn as the game's spell button does: its figure on cyan.
  function figure(points) {
    if (points === 2) return `<svg viewBox="0 0 40 40"><line x1="8" y1="32" x2="32" y2="8" stroke="#fff" stroke-width="4"/>${[[8, 32], [32, 8]].map(([x, y]) => `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="#f9f3a3"/>`).join("")}</svg>`;
    const pts = Array.from({ length: points }, (_, i) => { const a = -Math.PI / 2 + (points % 2 ? 0 : Math.PI / points) + (i / points) * Math.PI * 2; return [20 + 14 * Math.cos(a), 21 + 14 * Math.sin(a)]; });
    return `<svg viewBox="0 0 40 40"><polygon points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#fff" stroke-width="3"/>${pts.map(([x, y]) => `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#f9f3a3"/>`).join("")}</svg>`;
  }

  let speedNow = 60, lastSel = undefined, lastHeld = "";
  function render(t, speed, id, frame) {
    speedNow = speed;
    if (!id || !team[id] || t < team[id].started) { el.hidden = true; return; }
    el.hidden = false;
    const tm = team[id], ts = st.teams[id], s = stateAt(id, t), real = (ms) => ms * speed;
    const done = ts.defeated >= T.bosses.length, ko = ts.health <= 0 && !done;
    squeeze($(".caption .name"), tm.name);
    $(".caption .chip").style.setProperty("--c", tm.color);

    // The top bar.
    const serial = done ? null : ts.defeated + 1;
    const [dark, light] = serial ? BANNERS[serial] : ["#1b55b8", "#2a6fd6"];
    $(".checks").style.background = `repeating-conic-gradient(${dark} 0 25%, ${light} 0 50%) 0 0 / 64px 64px`;
    $(".tiles").style.background = dark;
    $(".hp-n").textContent = `x${ts.health}`;
    $(".health").classList.toggle("blink", !!s.lastAttack && t - s.lastAttack.t < real(1500));
    $(".done").hidden = !done;
    for (const sel of [".boss", ".bossinfo", ".next"]) $(sel).hidden = done;
    if (!done) {
      const boss = T.bosses[serial - 1], hp = Math.max(0, boss.hp - ts.damage);
      const src = `assets/stills/${serial}-still.png`;
      if (!$(".boss").src.endsWith(src)) $(".boss").src = src;
      $(".boss").classList.toggle("hurt", t - s.hit < real(500));
      $(".bossname").textContent = boss.name;
      $(".bossname").style.fontSize = `${Math.max(12, Math.min(32, Math.floor(200 / boss.name.length * 1.6)))}px`;
      $(".fill").style.width = $(".trail").style.width = `${(hp / boss.hp) * 100}%`;
      $(".hptext").textContent = `${hp} HP`;
      const I = T.rules.intervalMs, next = s.phaseStart + (Math.floor((t - s.phaseStart) / I) + 1) * I;
      $(".next").hidden = ko;
      if (!ko) {
        const share = Math.min(1, Math.max(0, (next - t) / I));
        $(".next").textContent = `Next Attack in ${countdown(next - t)}`;
        $(".next").style.backgroundColor = `color-mix(in oklch, #5fb04a ${Math.round(share * 100)}%, #c0453a)`;
      }
    }

    // The map: points, the attempt's path, cooldowns.
    m.drawImage(MAP, OX, 0, MW, MH);
    const P = (wp) => [OX + WP[wp].x * MS, WP[wp].y * MS];
    const castAge = s.lastCast ? (t - s.lastCast.t) / real(1200) : 2;
    const lit = castAge < 1 ? s.lastCast.wps : s.stack.map((e) => e.wp);
    const path = castAge < 1 ? outline(s.lastCast.wps).map(([x, y]) => [x / S * MS + OX, y / S * MS]) : s.stack.map((e) => P(e.wp));
    if (path.length > 1) {
      const wrong = castAge >= 1 && s.stack.some((e) => e.wrong);
      for (const [w, a] of [[10, 0.15], [6, 0.35], [3, 1]]) {
        m.beginPath(); path.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y)));
        if (castAge < 1 && path.length > 2) m.closePath();
        m.strokeStyle = a === 1 ? (wrong ? "#c0453a" : "#f7f8f8") : wrong ? "#c0453a" : "#f9f3a3";
        m.globalAlpha = a * (castAge < 1 ? 1 - castAge : 1); m.lineWidth = w; m.lineCap = m.lineJoin = "round"; m.stroke();
      }
      m.globalAlpha = 1;
    }
    for (const wp in WP) {
      const [x, y] = P(wp);
      if (x < -20 || x > SW + 20) continue;
      const left = (s.cds[wp] ?? 0) - t;
      m.globalAlpha = left > 0 ? 0.5 : 1;
      if (castAge < 0.5 && s.lastCast.wps.includes(wp)) drawSprite(m, "glow", Math.floor(castAge / 0.5 * 6), x, y - 8, 90);
      else if (lit.includes(wp)) drawSprite(m, "pulse", Math.floor(frame / 3), x, y, 34);
      else drawSprite(m, "coins", Math.floor(frame / 3), x, y, 24);
      m.globalAlpha = 1;
      if (left > 0) {
        m.font = "8px kongtext"; const label = countdown(left), w = m.measureText(label).width + 8;
        m.fillStyle = "#1a1423"; m.fillRect(x - w / 2, y - 30, w, 14);
        m.fillStyle = "#fff"; m.textAlign = "center"; m.textBaseline = "middle"; m.fillText(label, x, y - 23);
      }
    }
    $(".ko").hidden = !ko;

    // Powerups: running ones with their time left, then held ones.
    const running = [];
    if (s.boosted) running.push(["damage_multiplier", "next spell"]);
    if (s.shortUntil > t) running.push(["short_qr_cooldown", countdown(s.shortUntil - t)]);
    const held = [...ts.held];
    const key = JSON.stringify([running.map((r) => r[0]), held]) + running.map((r) => r[1]).join();
    if (key !== lastHeld) {
      lastHeld = key;
      $(".powerups").classList.toggle("down", ko);
      $(".powerups").innerHTML = running.map(([k, left]) => `<span class="run"><img src="assets/powerups/${ICONS[k]}.png" alt=""><span class="px left">${left}</span></span>`).join("")
        + held.map((k) => `<img src="assets/powerups/${ICONS[k]}.png" alt="">`).join("");
    }
    // The spell button: the selected shape on cyan, else the book.
    if (s.sel !== lastSel) {
      lastSel = s.sel;
      $(".book").innerHTML = s.sel ? `<span class="px sel">${figure(T.shapePoints[s.sel])}</span>` : `<img src="assets/book-icon.webp" alt="">`;
    }

    // Popups, newest wins: the scan result (2 s, as a refusal stays; a
    // counted scan stays till tapped), the attack (till tapped: 3 s here).
    const scanAge = s.lastScan ? t - s.lastScan.t : 1e15;
    const sp = $(".scanpop");
    sp.hidden = !(scanAge < real(2000));
    if (!sp.hidden) {
      const e = s.lastScan, cast = s.lastCast && s.lastCast.t >= e.t && s.lastCast.t - e.t < 1000 ? s.lastCast : null;
      sp.querySelector(".title").textContent = e.wrong ? "Wrong point" : "QR scanned";
      sp.querySelector(".title").style.color = e.wrong ? "#ff2f86" : "#5fb04a";
      sp.querySelector(".text").textContent = e.wrong
        ? `${e.wp} doesn't match any ${e.sel ?? "selected"} pattern with the points already scanned. Restart the attempt.`
        : cast ? `Spell cast: completed ${cast.wps.join("-")}${cast.repeat ? " (again)" : ""}${cast.boss ? `: ${cast.dealt} dmg to ${bossName(cast.boss)}${cast.defeated ? ", defeated!" : ""}` : ""}. You can close the scanner.`
        : "You can close the scanner.";
    }
    const ap = $(".attackpop"), a = s.lastAttack;
    ap.hidden = !(a && t - a.t < real(3000)) || !sp.hidden;
    if (!ap.hidden) {
      const src = `assets/stills/${a.boss}-still.png`;
      if (!$(".atkboss").src.endsWith(src)) $(".atkboss").src = src;
      const dealt = T.rules.attack[a.boss];
      $(".atktext").textContent = `${bossName(a.boss)} dealt ${dealt} ${dealt === 1 ? "heart" : "hearts"}`;
      $(".atkhp").textContent = `x${a.health}`;
    }
    const toast = $(".toast");
    toast.hidden = !(s.toast && t - s.toast.t < real(4000));
    if (!toast.hidden) {
      toast.textContent = s.toast.text;
      toast.style.color = s.toast.ok ? "#e0c068" : "#ff2f86";
      toast.style.top = `${TOP + (ko ? 64 : 16)}px`;
    }

    // The quiz: open for its window on every phone, then the answer for 2 s.
    const q = quizzes.filter((q) => q.t <= t && t < q.ends + real(2000)).pop();
    const qd = $(".quiz");
    qd.hidden = !q;
    if (q) {
      const open = t < q.ends, ans = s.answers[q.qte];
      $(".qwin").textContent = `Quiz · win: ${NAMES[q.powerup]}`;
      $(".qleft").textContent = open ? countdown(q.ends - t) : "Closed";
      $(".qq").textContent = q.question;
      $(".qopts").innerHTML = q.options.map((o, i) => {
        const chosen = ans?.option === i, right = q.correct === i && (!open || ans);
        const bg = right || (chosen && ans.correct) ? "#5fb04a" : chosen ? "#c0453a" : "#3d3159";
        const faded = (!open || ans) && !chosen && !right;
        return `<span class="px opt" style="background:${bg};${faded ? "opacity:.5" : ""}">${o}${chosen ? " ← your team" : ""}</span>`;
      }).join("");
      $(".qnote").textContent = ans ? (ans.correct ? (ans.granted ? `Right! Your team won ${NAMES[q.powerup]}.` : `Right! But your team already holds ${NAMES[q.powerup]}.`) : "Wrong answer.")
        : !open ? "Time's up." : ko ? "Knocked out teams can't answer." : "Anyone on your team can answer, once.";
    }
  }

  function drawSprite(ctx, name, frame, cx, cy, h) {
    const sh = SHEET[name], k = h / sh.h, w = sh.w * k;
    ctx.drawImage(SPR[name], sh.startX + (frame % sh.n) * sh.stride, 0, sh.w, sh.h, cx - w / 2, cy - h / 2, w, h);
  }
  return { render };
})();
