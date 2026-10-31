/* game.js — interface, réseau (SDK ChadGang) et orchestration de Pili Pili.
 * Modèle réseau : l'hôte (1er de la salle) fait foi. Les joueurs lui envoient leurs actions,
 * il diffuse l'état complet versionné (keep:true). Les bots et les joueurs absents sont joués par l'hôte. */
(() => {
  'use strict';
  const FAST = /[?&]fast\b/.test(location.search);       // accélère les pauses (tests)
  const T = ms => FAST ? Math.max(25, ms / 15) : ms;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  const hub = !!(window.ChadGang && ChadGang.join);
  let me = { id: 'local-' + Math.random().toString(36).slice(2, 8), name: 'Joueur', avatar: null };
  let net = null, room = null, S = null;
  let players = [];                 // joueurs réellement connectés à la salle (ordre d'arrivée)
  let present = new Set();
  let isHost = false, readyDone = false;
  const avatars = {};
  let lastFx = 0, driveT = 0, sheetT = 0, sheetKey = '', reportedGame = null;
  let selected = null, betSel = null, myPending = null, lastResend = 0;
  let peekKey = '', peekUntil = 0, dealKey = '';
  const seen = new Set();

  /* ================= Utilitaires UI ================= */
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function showScreen(name) {
    ['menu', 'lobby', 'game'].forEach(n => $('#' + n).classList.toggle('hidden', n !== name));
  }
  const hueOf = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  function avatarHTML(p) {
    if (p.bot) return '<div class="av bot">🤖</div>';
    const a = avatars[p.id], id = esc(p.id);
    if (a) return `<img class="av" src="${esc(a)}" alt="" data-chadgang-id="${id}">`;
    return `<div class="av" data-chadgang-id="${id}" style="--c:${hueOf(p.id)}">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</div>`;
  }
  const heat = c => c === 0 ? 0 : Math.round(210 - (c / 55) * 210);
  function cardHTML(c, o = {}) {
    if (o.back) return '<div class="card back"><span class="mid">🌶️</span></div>';
    if (c === 0) return `<div class="card joker"><span class="tl">★</span><span class="mid">🃏</span><span class="br">★</span><b class="jv">${o.v != null ? '= ' + o.v : 'JOKER'}</b></div>`;
    return `<div class="card" style="--h:${heat(c)}"><span class="tl">${c}</span><span class="mid">${c}</span><span class="br">${c}</span><i class="pips">${'🌶️'.repeat(Math.ceil(c / 11))}</i></div>`;
  }
  const seatOf = id => S ? S.players.findIndex(p => p.id === id) : -1;
  const mySeat = () => seatOf(me.id);
  const nameOf = id => { const p = S && S.players.find(x => x.id === id); return p ? p.name : '?'; };
  function seatPos(id) {
    const s = [...document.querySelectorAll('.seat')].find(e => e.dataset.p === id);
    if (!s) return { x: innerWidth / 2, y: innerHeight / 3 };
    const r = s.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.classList.remove('hidden'); return m; }
  function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }

  /* ================= Réseau ================= */
  function loopback() {
    const h = {};
    const emit = (ev, ...a) => (h[ev] || []).forEach(f => f(...a));
    const self = { id: me.id, name: me.name };
    const api = {
      on(ev, f) { (h[ev] = h[ev] || []).push(f); return api; },
      send(d) { setTimeout(() => emit('message', JSON.parse(JSON.stringify(d)), self), 0); },
      leave() { /* rien */ },
    };
    setTimeout(() => { emit('ready', { me: me.id, players: [self], last: null }); emit('players', [self]); }, 0);
    return api;
  }
  const send = (d, keep) => { try { if (net) net.send(d, keep ? { keep: true } : undefined); } catch (e) { /* ignore */ } };

  function enter(code, create) {
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (code.length < 4) return toast('Le code doit faire 4 caractères ou plus.');
    if (!hub) { const v = $('#pseudo').value.trim(); if (v) { me.name = v.slice(0, 16); lsSet('pp_name', me.name); } }
    leaveRoom(true);
    room = code; S = null; players = []; present = new Set(); readyDone = false; isHost = false; lastFx = 0;
    showScreen('lobby'); renderLobby();
    try { net = hub ? ChadGang.join(code, { create }) : loopback(); } catch (e) { toast('Impossible de rejoindre la salle.'); return leaveRoom(); }
    net.on('ready', info => {
      if (info && info.me) me.id = info.me;
      if (info && info.players) setPlayers(info.players);
      readyDone = true;
      if (info && info.last && info.last.t === 'state') { S = info.last.s; if (S.fx) lastFx = S.fx.id; }
      lsSet('pp_room', room);
      sendHi(); recomputeHost(); hostSync(); afterState();
    });
    net.on('players', list => { setPlayers(list); sendHi(); recomputeHost(); if (readyDone) { hostSync(); afterState(); } });
    net.on('message', onMessage);
    net.on('error', msg => { toast(typeof msg === 'string' ? msg : 'Salle introuvable.'); lsDel('pp_room'); leaveRoom(); });
  }
  function setPlayers(list) {
    players = (list || []).map(p => ({ id: p.id, name: p.name }));
    present = new Set(players.map(p => p.id));
  }
  function leaveRoom(quiet) {
    clearTimeout(driveT); clearTimeout(sheetT);
    if (net) { try { net.leave(); } catch (e) { /* ignore */ } }
    net = null; room = null; S = null; isHost = false; readyDone = false; sheetKey = '';
    selected = betSel = myPending = null;
    $('#sheet').classList.add('hidden'); closeModal();
    document.body.classList.remove('danger');
    if (!quiet) { lsDel('pp_room'); showScreen('menu'); setupMenu(); }
  }
  const sendHi = () => send({ t: 'hi', a: me.avatar });

  function onMessage(d, from) {
    if (!d || !d.t || !from) return;
    if (d.t === 'state') {
      if (from.id === me.id || !d.s) return;
      if (S && d.s.v <= S.v) return;
      S = d.s; afterState();
    } else if (d.t === 'act') { if (isHost) hostAct(d.a || {}, from.id); }
    else if (d.t === 'hi') { avatars[from.id] = d.a || null; if (S) render(); }
    else if (d.t === 'emo') emoFx(from.id, d.e);
  }

  /* ================= Hôte ================= */
  function recomputeHost() {
    const was = isHost;
    isHost = players.length ? players[0].id === me.id : false;
    if (isHost && !was && readyDone) onBecomeHost();
  }
  function onBecomeHost() {
    // les choix secrets de l'ancien hôte sont perdus : chacun renverra le sien
    if (S && (S.phase === 'swap' || (S.phase === 'play' && S.mission === 'simul'))) { S.picked = []; S._picks = {}; commit(); }
  }
  function hostSync() {
    if (!isHost || !readyDone) return;
    const humans = players.map(p => ({ id: p.id, name: p.name }));
    if (!S) { S = PP.lobby(); S.players = humans; commit(); return; }
    if (S.phase === 'lobby') {
      const next = humans.concat(S.players.filter(p => p.bot)).slice(0, 8);
      const key = l => JSON.stringify(l.map(p => [p.id, p.name, !!p.bot]));
      if (key(next) !== key(S.players)) { S.players = next; commit(); }
    }
  }
  function commit() {
    S.v = (S.v || 0) + 1;
    const out = JSON.parse(JSON.stringify(S, (k, v) => k[0] === '_' ? undefined : v));
    send({ t: 'state', s: out }, true);
    afterState();
  }
  function act(a) { if (isHost) hostAct(a, me.id); else send({ t: 'act', a }); }

  function hostAct(a, pid) {
    if (!isHost || !S) return;
    const mine = pid === me.id;
    let ok = false;
    switch (a.k) {
      case 'mode': if (mine && S.phase === 'lobby' && ['all', 'std', 'none'].includes(a.m)) { S.mode = a.m; ok = true; } break;
      case 'addbot': if (mine && S.phase === 'lobby') ok = PP.addBot(S); break;
      case 'delbot': if (mine && S.phase === 'lobby') { const n = S.players.length; S.players = S.players.filter(p => !(p.bot && p.id === a.id)); ok = S.players.length < n; } break;
      case 'start':
        if (mine && S.phase === 'lobby' && S.players.length >= 2) { PP.startGame(S, room + '-' + Date.now().toString(36)); ok = true; }
        break;
      case 'bet': ok = PP.bet(S, pid, a.n); break;
      case 'play': ok = PP.play(S, pid, a.c, a.v); break;
      case 'pick': ok = PP.pick(S, pid, a.c, a.v); break;
      case 'next': ok = PP.nextRound(S); break;
      case 'again': if (S.phase === 'end') { PP.toLobby(S); S.players = players.map(p => ({ id: p.id, name: p.name })).concat(S.players.filter(p => p.bot)); ok = true; } break;
    }
    if (ok) commit();
  }

  // Pilote les bots, les joueurs absents et les pauses entre les plis
  function drive() {
    clearTimeout(driveT);
    if (!isHost || !S) return;
    const v = S.v;
    const go = (ms, fn) => { driveT = setTimeout(() => { if (S && S.v === v && isHost) fn(); }, T(ms)); };
    const auto = p => p.bot || !present.has(p.id);
    const delay = p => p.bot ? 800 + Math.random() * 700 : 4500;
    if (S.phase === 'trickEnd') return go(2000, () => { if (PP.advanceTrick(S)) commit(); });
    if (S.phase === 'bet') {
      const p = S.players[S.turn];
      if (auto(p)) go(delay(p), () => { if (PP.bet(S, p.id, PP.botBet(S))) commit(); });
    } else if (S.phase === 'play' && S.mission !== 'simul') {
      const p = S.players[S.turn];
      if (auto(p)) go(delay(p), () => { const r = PP.botCard(S, p.id); if (PP.play(S, p.id, r.c, r.v)) commit(); });
    } else if (S.phase === 'swap' || (S.phase === 'play' && S.mission === 'simul')) {
      const p = S.players.find(q => auto(q) && !S.picked.includes(q.id));
      if (p) go(delay(p), () => {
        const ok = S.phase === 'swap' ? PP.pick(S, p.id, PP.botSwap(S, p.id)) : (r => PP.pick(S, p.id, r.c, r.v))(PP.botCard(S, p.id));
        if (ok) commit();
      });
    }
  }

  /* ================= Après chaque changement d'état ================= */
  function afterState() {
    if (!S) return;
    if (S.phase === 'end') report();
    const fxNew = S.fx && S.fx.id !== lastFx ? S.fx : null;
    if (fxNew) lastFx = fxNew.id;
    if (selected != null && (!canPlay() || !((S.hands && S.hands[me.id]) || []).includes(selected))) selected = null;
    if (!(S.phase === 'bet' && S.turn === mySeat())) betSel = null;
    render();
    if (fxNew) runFx(fxNew);
    if (isHost) drive();
    resendPending();
  }
  function resendPending() {
    if (!myPending || !S || Date.now() - lastResend < 1200) return;
    const q = myPending;
    if (q.game !== S.game || q.round !== S.round || q.phase !== S.phase || q.trickNo !== S.trickNo) { myPending = null; return; }
    if (S.picked && !S.picked.includes(me.id)) { lastResend = Date.now(); act(q.a); }
  }
  function report() {
    if (reportedGame === S.game) return;
    reportedGame = S.game;
    if (!hub || !ChadGang.finPartie) return;
    if (!S.players.some(p => p.id === me.id) || S.players.filter(p => !p.bot).length < 2) return;
    try { ChadGang.finPartie({ gagne: (S.winners || []).includes(me.id), partie: S.game }).catch(() => {}); } catch (e) { /* ignore */ }
  }

  /* ================= Rendu ================= */
  function render() {
    if (!room) return;
    if (!S) { showScreen('lobby'); renderLobby(); return; }
    if (S.phase === 'lobby') {
      showScreen('lobby'); renderLobby();
      $('#sheet').classList.add('hidden'); sheetKey = ''; document.body.classList.remove('danger');
      return;
    }
    showScreen('game'); renderGame();
  }

  function renderLobby() {
    $('#roomCode').textContent = room || '';
    const list = S ? S.players : players;
    $('#lobbyPlayers').innerHTML = list.length ? list.map((p, i) =>
      `<li>${avatarHTML(p)}<b>${esc(p.name)}</b>${i === 0 ? '<span class="tagx">👑 hôte</span>' : ''}${p.bot ? `<span class="tagx">bot</span>${isHost ? `<button class="x" data-del="${esc(p.id)}" title="Retirer">✕</button>` : ''}` : ''}</li>`
    ).join('') : '<li>Connexion à la salle…</li>';
    $('#hostCtl').classList.toggle('hidden', !isHost || !S);
    if (S) {
      $('#modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
      $('#btnStart').disabled = S.players.length < 2;
      $('#btnBot').disabled = S.players.length >= 8;
    }
    $('#lobbyWait').textContent = !S ? '' : isHost
      ? (S.players.length < 2 ? 'Il faut au moins 2 joueurs : invite un ami ou ajoute un bot !' : 'Tout le monde est là ? Lance la partie !')
      : 'En attente de l’hôte (' + esc(S.players[0] ? S.players[0].name : '…') + ')…';
  }

  function canPlay() {
    if (!S || mySeat() < 0) return false;
    if (S.phase === 'swap') return !S.picked.includes(me.id);
    if (S.phase !== 'play') return false;
    if (S.mission === 'simul') return !S.picked.includes(me.id);
    return S.turn === mySeat();
  }
  function myHandHidden() {
    if (!S || S.phase === 'roundEnd' || S.phase === 'end') return false;
    if (S.mission === 'blind') return true;
    if (S.mission === 'early') return S.phase === 'bet' || S.phase === 'swap';
    if (S.mission === 'peek3') return !(peekKey === S.game + S.round && Date.now() < peekUntil);
    return false;
  }
  const showFaces = pid => S.mission === 'open' || (S.mission === 'blind' && pid !== me.id);

  function renderGame() {
    const m = S.mission ? PP.byId[S.mission] : null;
    $('#roundInfo').textContent = 'Manche ' + S.round + (S.trickNo ? ' · pli ' + Math.min(S.trickNo, S.total) + '/' + S.total : '');
    const chip = $('#missionChip');
    chip.textContent = m ? m.emoji + ' ' + m.nom + (m.expert ? ' ⭐' : '') : '🌶️ Manche classique';
    chip.classList.toggle('expert', !!(m && m.expert));
    $('#missionDesc').textContent = m ? m.desc + (S.cursed ? ' Maudits : ' + S.cursed.join(' et ') + '.' : '') : 'Parie le bon nombre de plis !';
    $('.table').classList.toggle('rev', S.mission === 'reverse');
    $('#btnSound').textContent = Sfx.muted ? '🔇' : '🔊';
    renderSeats(); renderTrick(); renderStatus(); renderHand(); renderBottom(); renderSheet();
    const mine = S.players[mySeat()];
    document.body.classList.toggle('danger', !!mine && mine.pili >= PP.MAX_PILI - 2 && S.phase !== 'end');
  }

  function renderSeats() {
    const active = (S.phase === 'bet' || (S.phase === 'play' && S.mission !== 'simul')) ? S.turn : -1;
    $('#seats').innerHTML = S.players.map((p, i) => {
      const bet = S.bets[p.id], won = S.won[p.id] || 0;
      const stats = bet == null ? '<span>pari : …</span>' : `<span class="${won === bet ? 'ok' : ''}">plis ${won}/${bet}</span>`;
      const slots = Array.from({ length: PP.MAX_PILI }, (_, k) => `<i class="${k < p.pili ? 'on' + (p.pili >= PP.MAX_PILI - 2 ? ' hot' : '') : ''}">🌶️</i>`).join('');
      const hand = (S.hands && S.hands[p.id]) || [];
      const mini = p.id === me.id ? '' : hand.map(c => showFaces(p.id) ? `<i class="mc f ${c === 0 ? 'j' : ''}" style="--h:${heat(c)}">${c === 0 ? '★' : c}</i>` : '<i class="mc"></i>').join('');
      const away = !p.bot && !present.has(p.id);
      return `<div class="seat ${p.id === me.id ? 'me' : ''} ${i === active ? 'turn' : ''} ${away ? 'away' : ''} ${S.phase === 'trickEnd' && S.tw === p.id ? 'win' : ''}" data-p="${esc(p.id)}">
        ${S.picked && S.picked.includes(p.id) ? '<div class="ready">✓</div>' : ''}
        <div class="s-top">${avatarHTML(p)}<div class="s-name">${esc(p.name)}${i === S.dealer ? '<i class="dealer">D</i>' : ''}</div></div>
        <div class="s-stats">${away ? '💤 absent' : stats}</div><div class="pili">${slots}</div>${mini ? `<div class="mini">${mini}</div>` : ''}</div>`;
    }).join('');
  }

  function renderTrick() {
    $('#trick').innerHTML = (S.trick || []).map(e => {
      const key = S.game + '-' + S.round + '-' + S.trickNo + '-' + e.p;
      const isNew = !seen.has(key); seen.add(key);
      const cls = (isNew ? 'enter ' + (e.p === me.id ? 'from-me' : 'from-op') : '') + (S.phase === 'trickEnd' && e.p === S.tw ? ' winner' : '');
      return `<div class="tc ${cls}">${cardHTML(e.c, { v: e.c === 0 ? e.v : null })}<div class="tn">${esc(nameOf(e.p))}</div></div>`;
    }).join('');
  }

  function renderStatus() {
    const st = $('#status'), seat = mySeat();
    let txt = '', mineTurn = false;
    const cur = S.players[S.turn];
    const waiting = () => S.players.filter(p => !S.picked.includes(p.id)).map(p => esc(p.name)).join(', ');
    switch (S.phase) {
      case 'swap': txt = seat >= 0 && !S.picked.includes(me.id) ? 'Choisis 1 carte à passer à ton voisin de gauche ➡️' : 'En attente de : ' + waiting(); mineTurn = seat >= 0 && !S.picked.includes(me.id); break;
      case 'bet': mineTurn = S.turn === seat; txt = mineTurn ? 'À toi de parier !' : esc(cur.name) + ' réfléchit à son pari…'; break;
      case 'play':
        if (S.mission === 'simul') { mineTurn = canPlay(); txt = mineTurn ? 'Choisis ta carte (tout le monde joue en même temps) !' : 'En attente de : ' + waiting(); }
        else { mineTurn = S.turn === seat; txt = mineTurn ? 'À toi de jouer !' : 'Au tour de ' + esc(cur.name) + '…'; }
        break;
      case 'trickEnd': txt = '🏅 ' + esc(nameOf(S.tw)) + ' remporte le pli !'; break;
      case 'roundEnd': txt = 'Fin de la manche… 🌶️'; break;
      case 'end': txt = '🏆 Partie terminée !'; break;
    }
    if (seat < 0) txt = '👀 Tu regardes la partie — ' + txt;
    st.className = 'status' + (mineTurn ? ' mine' : '');
    st.innerHTML = txt;
  }

  function renderHand() {
    const hand = (S.hands && S.hands[me.id]) || [];
    const hidden = myHandHidden(), can = canPlay(), legal = can ? PP.legalCards(S, me.id) : [];
    const dk = S.game + '-' + S.round, deal = dk !== dealKey && hand.length > 0;
    if (deal) dealKey = dk;
    $('#hand').innerHTML = hand.map((c, i) => {
      const dis = can && !legal.includes(c);
      return `<button class="hc ${selected === c ? 'sel' : ''} ${dis ? 'dis' : ''} ${can && !dis ? 'can' : ''} ${deal ? 'deal' : ''}" data-c="${c}" ${deal ? `style="animation-delay:${i * 90}ms"` : ''}>${cardHTML(c, { back: hidden })}</button>`;
    }).join('');
  }

  function renderBottom() {
    const box = $('#betBox'), seat = mySeat();
    let html = '';
    if (seat < 0) html = '<div class="spec">👀 Tu es spectateur</div>';
    else if (S.phase === 'bet' && S.turn === seat) {
      const ok = PP.validBets(S), last = Object.keys(S.bets).length === S.players.length - 1;
      html = `<div class="bet-title">Combien de plis vas-tu remporter ? (sur ${S.total})</div><div class="bets">` +
        Array.from({ length: S.total + 1 }, (_, n) => `<button class="bn ${betSel === n ? 'sel' : ''}" data-n="${n}" ${ok.includes(n) ? '' : 'disabled'}>${n}</button>`).join('') + '</div>' +
        (last ? `<div class="note">Dernier à parier : le total des paris ne peut pas faire ${S.total}.</div>` : '') +
        `<button class="btn fire" id="btnBet" ${betSel == null ? 'disabled' : ''}>🎯 Je parie ${betSel == null ? '…' : betSel}</button>`;
    } else if (canPlay()) {
      html = `<button class="btn fire" id="btnPlay" ${selected == null ? 'disabled' : ''}>${S.phase === 'swap' ? '➡️ Passer cette carte' : '🃏 Jouer cette carte'}</button>`;
    } else if (S.bets[me.id] != null) {
      html = `Ton pari : <b>${S.bets[me.id]}</b> · Plis gagnés : <b>${S.won[me.id]}</b>`;
    }
    if (seat >= 0 && S.mission === 'peek3' && (S.phase === 'bet' || S.phase === 'play')) {
      const peeking = peekKey === S.game + S.round && Date.now() < peekUntil;
      if (peeking) html += '<div class="peek-bar"><i></i></div>';
      else if (peekKey !== S.game + S.round) html += '<button class="btn alt" id="btnPeek">👁️ Regarder ma main (3 s)</button>';
    }
    box.innerHTML = html;
    const emo = $('#emoBar');
    if (!emo.firstChild) emo.innerHTML = ['🔥', '😂', '😱', '👏', '🌶️', '💀'].map(e => `<button data-e="${e}">${e}</button>`).join('');
  }

  /* ---- Fenêtres de fin de manche / de partie ---- */
  function renderSheet() {
    let key = '';
    if (S.phase === 'roundEnd') key = 'r' + S.game + S.round;
    if (S.phase === 'end') key = 'e' + S.game;
    if (key === sheetKey) return;
    sheetKey = key; clearTimeout(sheetT);
    if (!key) { $('#sheet').classList.add('hidden'); return; }
    sheetT = setTimeout(() => { if (sheetKey === key) showSheet(); }, T(S.phase === 'roundEnd' ? 1700 : 2800));
  }
  function showSheet() {
    const sh = $('#sheet');
    if (S.phase === 'roundEnd') {
      const m = S.mission ? PP.byId[S.mission] : null;
      const rows = S.recap.map((r, i) => {
        const p = S.players.find(x => x.id === r.id);
        const exact = r.base === 0 && r.extra === 0 && r.duo === 0 && r.rel === 0;
        const parts = [];
        if (r.base) parts.push('écart ' + r.base); if (r.extra) parts.push('malus +' + r.extra);
        if (r.duo) parts.push('binôme +' + r.duo); if (r.rel) parts.push('béni −' + r.rel);
        const res = r.delta > 0 ? `<span class="res bad">+${r.delta} 🌶️</span>` : r.delta < 0 ? `<span class="res good">${r.delta} 😇</span>` : `<span class="res zero">${exact ? 'Pile poil ✨' : '0'}</span>`;
        return `<div class="recap-row" style="animation-delay:${i * 90}ms">${avatarHTML(p)}<div class="nm">${esc(p.name)}<small>${parts.join(' · ')}</small></div><div class="bw">${r.won}/${r.bet}</div>${res}</div>`;
      }).join('');
      sh.innerHTML = `<div class="panel"><h2>Manche ${S.round} terminée</h2><div class="hint">${m ? m.emoji + ' ' + esc(m.nom) : 'Manche classique'} · plis gagnés / pari</div>${rows}
        <div class="row"><button class="btn big fire" id="btnNext">${S.over ? '🏁 Voir le résultat' : '▶ Manche suivante'}</button></div>
        ${S.over ? '<div class="hint">Quelqu’un a atteint 7 Pilis : c’est la fin !</div>' : ''}</div>`;
    } else {
      const sorted = S.players.slice().sort((a, b) => a.pili - b.pili);
      const wn = S.winners.map(nameOf).join(' & ');
      sh.innerHTML = `<div class="panel"><h2>🏆 ${esc(wn)} ${S.winners.length > 1 ? 'gagnent' : 'gagne'} !</h2><div class="hint">Le moins de Pilis l’emporte.</div>
        <ul class="podium">${sorted.map((p, i) => `<li class="${S.winners.includes(p.id) ? 'w' : ''}" style="animation-delay:${i * 100}ms">${S.winners.includes(p.id) ? '👑' : '#' + (i + 1)} ${avatarHTML(p)}<b>${esc(p.name)}</b><span>${p.pili} 🌶️</span></li>`).join('')}</ul>
        <div class="row"><button class="btn big fire" id="btnAgain">🔁 Rejouer</button><button class="btn alt" id="btnQuit2">Quitter</button></div></div>`;
    }
    sh.classList.remove('hidden');
  }

  /* ================= Effets (réactions aux événements) ================= */
  function runFx(f) {
    const mine = f.p === me.id || f.w === me.id;
    switch (f.k) {
      case 'mission': return missionReveal(f);
      case 'bet': {
        Sfx.play('bet');
        const p = seatPos(f.p); Fx.floatText(p.x, p.y + 30, '🎯 ' + f.n, 'gold');
        if (f.bonus) setTimeout(() => { Fx.banner('🎁 CARTE CADEAU !', '', 1500); Sfx.play('win'); Fx.burst(innerWidth / 2, innerHeight * 0.8, 'confetti', 40); }, T(400));
        break;
      }
      case 'card':
        Sfx.play('card');
        if (f.c === 0) {
          Sfx.play('joker'); Fx.burst(innerWidth / 2, innerHeight * 0.45, 'rainbow', 60);
          Fx.banner('🃏 JOKER !<small>' + esc(nameOf(f.p)) + ' annonce ' + f.v + '</small>', '', 1500); Fx.shake(0.6);
        }
        break;
      case 'swap': Sfx.play('swap'); Fx.banner('🔁 Échange !', '', 1000); break;
      case 'trick': {
        const p = seatPos(f.w);
        Fx.burst(p.x, p.y, 'spark', 36); Fx.floatText(p.x, p.y + 30, '+1 pli', 'gold');
        Sfx.play(f.w === me.id ? 'win' : 'trick');
        if (f.w === me.id) Fx.burst(innerWidth / 2, innerHeight * 0.45, 'confetti', 30);
        if (f.curse) { Fx.banner('☠️ NUMÉRO MAUDIT !<small>+1 🌶️ pour ' + esc(nameOf(f.w)) + '</small>', 'red', 1700); Fx.shake(1); Fx.flash('#7a00ff'); Sfx.play('lose'); }
        else if (f.fl) { Fx.banner('🎯 Pli piégé !<small>+1 🌶️ pour ' + esc(nameOf(f.w)) + '</small>', 'red', 1500); Fx.shake(0.7); Sfx.play('lose'); }
        break;
      }
      case 'round': return roundFx();
      case 'victory': {
        Sfx.play('fanfare'); Fx.fireworks(5200); Fx.rain(200, 3000);
        Fx.banner('🏆 ' + esc(f.w.map(nameOf).join(' & ')) + '<small>remporte la partie !</small>', '', 2600);
        break;
      }
      default:
    }
    void mine;
  }

  function roundFx() {
    let bigMine = 0, exactMine = false;
    S.recap.forEach((r, i) => {
      const p = seatPos(r.id);
      setTimeout(() => {
        if (r.delta > 0) {
          Fx.burst(p.x, p.y, 'fire', 18 + r.delta * 8); Fx.floatText(p.x, p.y, '+' + r.delta + ' 🌶️', 'red');
          if (r.delta >= 3) Fx.burst(p.x, p.y, 'chili', 6 + r.delta);
          Sfx.play(r.delta >= 3 ? 'fire' : 'lose');
        } else if (r.delta < 0) { Fx.burst(p.x, p.y, 'confetti', 20); Fx.floatText(p.x, p.y, r.delta + ' 😇', 'green'); Sfx.play('win'); }
        else if (r.base === 0) { Fx.burst(p.x, p.y, 'spark', 30); Fx.floatText(p.x, p.y, 'Pile poil !', 'gold'); }
      }, T(i * 220));
      if (r.id === me.id) { bigMine = r.delta; exactMine = r.base === 0 && r.delta <= 0; }
    });
    if (bigMine >= 3) { Fx.shake(1.4); Fx.flash('#ff3b30'); Fx.banner('🔥 AÏE AÏE AÏE !<small>+' + bigMine + ' Pilis</small>', 'red', 1700); }
    else if (exactMine) { Fx.banner('✨ PILE POIL !', 'green', 1400); Fx.burst(innerWidth / 2, innerHeight * 0.4, 'confetti', 50); Sfx.play('win'); }
    const worst = S.players.find(p => p.pili >= PP.MAX_PILI);
    if (worst) setTimeout(() => { Fx.banner('💥 ' + esc(worst.name) + ' est cramé !<small>7 Pilis</small>', 'red', 1800); Fx.shake(1.6); Fx.flash('#ff8a1f'); }, T(700));
  }

  function missionReveal(f) {
    const m = f.m ? PP.byId[f.m] : null;
    Sfx.play('deal'); setTimeout(() => Sfx.play('mission'), T(250));
    const box = document.createElement('div');
    box.className = 'mission-reveal';
    box.innerHTML = `<div class="mr-card ${m && m.expert ? 'expert' : ''}"><div class="mr-emoji">${m ? m.emoji : '🌶️'}</div>
      ${m && m.expert ? '<span class="mr-tag">⭐ EXPERT</span>' : '<span class="mr-tag">MANCHE ' + S.round + '</span>'}
      <h3>${m ? esc(m.nom) : 'Manche classique'}</h3><p>${m ? esc(m.desc) : 'Parie le bon nombre de plis, sans autre règle spéciale.'}</p>
      <p class="hint">Donneur : ${esc(nameOf(S.players[f.dealer] ? S.players[f.dealer].id : ''))}</p></div>`;
    const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 400); };
    box.addEventListener('click', close);
    $('#overlay').appendChild(box);
    setTimeout(close, T(m ? 3600 : 1800));
    if (m && m.id === 'handswap') setTimeout(() => Sfx.play('swap'), T(900));
  }

  function emoFx(id, e) {
    if (typeof e !== 'string' || e.length > 4) return;
    const p = seatPos(id);
    Fx.floatText(p.x, p.y + 10, e, 'big'); Fx.burst(p.x, p.y, e === '🌶️' ? 'chili' : 'spark', 6);
  }

  /* ================= Interactions ================= */
  function confirmPlay() {
    const c = selected;
    if (c == null || !canPlay()) return;
    const go = v => {
      selected = null;
      const a = S.phase === 'swap' ? { k: 'pick', c } : S.mission === 'simul' ? { k: 'pick', c, v } : { k: 'play', c, v };
      if (a.k === 'pick') myPending = { a, game: S.game, round: S.round, phase: S.phase, trickNo: S.trickNo };
      act(a); render();
    };
    if (c === 0 && S.phase !== 'swap') jokerModal(go); else go(c);
  }

  function jokerModal(cb) {
    const rev = S.mission === 'reverse', start = rev ? 0 : 56;
    const m = openModal(`<div class="panel"><h3>🃏 Joker !</h3><p class="hint">Choisis sa valeur, de 0 à 56${rev ? ' — ici le plus petit gagne !' : ''}</p>
      <div class="jv-big" id="jvBig">${start}</div><input type="range" id="jvRange" min="0" max="56" value="${start}">
      <div class="row"><button class="btn alt" data-v="0">0</button><button class="btn alt" data-v="28">28</button><button class="btn alt" data-v="56">56</button></div>
      <div class="row"><button class="btn ghost dark" id="jvCancel">Annuler</button><button class="btn fire" id="jvOk">Valider</button></div></div>`);
    const r = $('#jvRange', m), big = $('#jvBig', m);
    r.oninput = () => { big.textContent = r.value; };
    m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { r.value = b.dataset.v; big.textContent = r.value; });
    $('#jvCancel', m).onclick = closeModal;
    $('#jvOk', m).onclick = () => { const v = +r.value; closeModal(); cb(v); };
  }

  function rulesModal() {
    const ms = PP.MISSIONS.map(m => `<li class="mi">${m.emoji} <b>${esc(m.nom)}</b>${m.expert ? ' ⭐' : ''} — ${esc(m.desc)}</li>`).join('');
    const m = openModal(`<div class="panel rules"><h3>📖 Règles de Pili Pili</h3>
      <p>Jeu de plis de <b>2 à 8 joueurs</b>. Cartes de <b>1 à 55</b> + un <b>Joker</b> qui vaut ce que tu veux (0 à 56).</p>
      <ul><li><b>Pari</b> : chacun voit sa main (5 cartes) et annonce combien de plis il va gagner. Le dernier à parier ne peut pas faire tomber le total pile sur le nombre de plis.</li>
      <li><b>Plis</b> : le donneur joue une carte, chacun pose la sienne. La valeur la plus haute gagne le pli et ouvre le suivant. Pas de couleurs, pas d’obligation de suivre.</li>
      <li><b>Pilis</b> : chaque écart entre ton pari et tes plis gagnés = <b>1 Pili 🌶️</b>. Pari exact = 0 !</li>
      <li><b>Fin</b> : dès qu’un joueur atteint <b>7 Pilis</b>, la partie s’arrête. Le moins de Pilis gagne.</li></ul>
      <p><b>Missions</b> (une par manche, modifient les règles) :</p><ul>${ms}</ul>
      <div class="row"><button class="btn" id="rulesOk">Compris !</button></div></div>`);
    $('#rulesOk', m).onclick = closeModal;
  }

  function setupMenu() {
    if (hub) $('#whoami').innerHTML = 'Salut <b>' + esc(me.name) + '</b> 👋';
    else {
      $('#whoami').textContent = 'Hors hub : joue contre des bots !';
      $('#pseudoRow').classList.remove('hidden'); $('#joinRow').classList.add('hidden');
      $('#pseudo').value = lsGet('pp_name') || me.name;
    }
    const saved = lsGet('pp_room'), rb = $('#btnResume');
    rb.classList.toggle('hidden', !saved || !hub);
    if (saved) rb.textContent = '↩ Reprendre la salle ' + saved;
  }

  function bindEvents() {
    const click = (sel, fn) => $(sel).addEventListener('click', fn);
    document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
    const genCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
    click('#btnCreate', () => enter(genCode(), true));
    click('#btnJoin', () => enter($('#code').value, false));
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') enter($('#code').value, false); });
    click('#btnResume', () => enter(lsGet('pp_room'), false));
    click('#btnRules', rulesModal); click('#btnHelp', rulesModal);
    click('#btnLeave', () => leaveRoom()); click('#btnQuit', () => {
      const m = openModal('<div class="panel"><h3>Quitter la partie ?</h3><div class="row"><button class="btn alt" id="qNo">Rester</button><button class="btn fire" id="qYes">Quitter</button></div></div>');
      $('#qNo', m).onclick = closeModal; $('#qYes', m).onclick = () => { closeModal(); leaveRoom(); };
    });
    click('#btnCopy', () => { try { navigator.clipboard.writeText(room); } catch (e) { /* ignore */ } toast('Code copié : ' + room); });
    click('#btnSound', () => { Sfx.toggle(); $('#btnSound').textContent = Sfx.muted ? '🔇' : '🔊'; });
    click('#missionChip', () => { const m = S && S.mission ? PP.byId[S.mission] : null; toast(m ? m.emoji + ' ' + m.nom + ' : ' + m.desc : 'Pas de mission : manche classique.'); });
    click('#btnBot', () => act({ k: 'addbot' })); click('#btnStart', () => act({ k: 'start' }));
    $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) act({ k: 'mode', m: b.dataset.m }); });
    $('#lobbyPlayers').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) act({ k: 'delbot', id: b.dataset.del }); });
    $('#emoBar').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || Date.now() - (bindEvents.lastEmo || 0) < 900) return;
      bindEvents.lastEmo = Date.now(); send({ t: 'emo', e: b.dataset.e });
    });
    $('#hand').addEventListener('click', e => {
      const b = e.target.closest('.hc'); if (!b || !canPlay()) return;
      const c = +b.dataset.c;
      if (!PP.legalCards(S, me.id).includes(c)) return toast('Cette carte est interdite : tu dois jouer ta plus forte ou ta plus faible.');
      if (selected === c) return confirmPlay();
      selected = c; Sfx.play('tick'); renderHand(); renderBottom();
    });
    $('#betBox').addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.n != null && !t.disabled) { betSel = +t.dataset.n; Sfx.play('tick'); renderBottom(); }
      else if (t.id === 'btnBet' && betSel != null) { const n = betSel; betSel = null; act({ k: 'bet', n }); }
      else if (t.id === 'btnPlay') confirmPlay();
      else if (t.id === 'btnPeek') {
        peekKey = S.game + S.round; peekUntil = Date.now() + 3000; renderHand(); renderBottom();
        setTimeout(() => { if (S) { renderHand(); renderBottom(); } }, 3050);
      }
    });
    $('#sheet').addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'btnNext') { t.disabled = true; act({ k: 'next' }); }
      else if (t.id === 'btnAgain') act({ k: 'again' });
      else if (t.id === 'btnQuit2') leaveRoom();
    });
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  }

  async function init() {
    Fx.init($('#fx'));
    if (hub) {
      try { const m = await ChadGang.me(); me = { id: m.id, name: m.name || 'Joueur', avatar: m.avatar || null }; } catch (e) { /* ignore */ }
    }
    avatars[me.id] = me.avatar;
    bindEvents(); setupMenu(); showScreen('menu');
    const inv = hub && ChadGang.room ? ChadGang.room() : null;
    if (inv) enter(inv, false);
  }
  init();
})();
