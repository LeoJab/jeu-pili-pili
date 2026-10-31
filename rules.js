/* rules.js — règles de Pili Pili (logique pure, aucun accès au DOM).
 * Cartes : 1 à 55 + le Joker (codé 0, valeur annoncée de 0 à 56).
 * Chaque joueur parie son nombre de plis ; chaque écart = 1 Pili. 7 Pilis = fin de partie. */
const PP = (() => {
  const MAX_PILI = 7;
  const JOKER = 0;

  // expert = missions « expertes » ; cartes = nombre de cartes distribuées
  const MISSIONS = [
    { id: 'swap1', emoji: '🔁', nom: 'Passe-plat', cartes: 5, desc: 'Chacun passe 1 carte de sa main à son voisin de gauche, avant les paris.' },
    { id: 'handswap', emoji: '🎒', nom: 'Main baladeuse', cartes: 4, desc: 'Tout le monde passe toute sa main à son voisin de gauche, avant les paris.' },
    { id: 'no0', emoji: '🚫', nom: 'Zéro interdit', cartes: 5, desc: 'Impossible de parier 0 pli.' },
    { id: 'no1', emoji: '☝️', nom: 'Un interdit', cartes: 5, desc: 'Impossible de parier 1 pli.' },
    { id: 'blind', emoji: '🐂', nom: 'Front de taureau', cartes: 4, desc: 'Tu vois les cartes des autres, mais pas les tiennes ! Pari et jeu à l’aveugle.' },
    { id: 'bonus', emoji: '🎁', nom: 'Carte cadeau', cartes: 4, desc: 'Après les paris, chacun pioche 1 carte de plus : il y aura un pli de plus !' },
    { id: 'open', emoji: '👀', nom: 'Cartes sur table', cartes: 3, desc: 'Toutes les mains sont visibles par tout le monde. Aucun secret !' },
    { id: 'early', emoji: '🙈', nom: 'Pari à l’aveugle', cartes: 5, desc: 'Tu paries AVANT de découvrir tes cartes. Bonne chance !' },
    { id: 'simul', emoji: '⚡', nom: 'Tous ensemble', cartes: 4, desc: 'À chaque pli, tout le monde pose sa carte en même temps.' },
    { id: 'relief', emoji: '😇', nom: 'Pari béni', cartes: 5, desc: 'Pari réussi = tu défausses autant de Pilis que le nombre de plis parié.' },
    { id: 'reverse', emoji: '🙃', nom: 'Monde à l’envers', cartes: 5, expert: true, desc: 'La plus PETITE valeur gagne le pli ! Le Joker peut valoir de 0 à 56.' },
    { id: 'peek3', emoji: '🐟', nom: 'Mémoire de poisson rouge', cartes: 5, expert: true, desc: 'Tu regardes ta main 3 secondes, puis elle se cache. Mémorise !' },
    { id: 'firstlast', emoji: '🎯', nom: 'Premier & dernier', cartes: 5, expert: true, desc: 'Gagner le premier pli ou le dernier pli te coûte 1 Pili (chacun).' },
    { id: 'unique', emoji: '🦄', nom: 'Pari unique', cartes: 5, expert: true, desc: 'Interdit de parier la même chose qu’un autre joueur.' },
    { id: 'extreme', emoji: '⚖️', nom: 'Tout ou rien', cartes: 5, expert: true, desc: 'À chaque pli, tu dois jouer ta carte la plus forte ou la plus faible (le Joker passe partout).' },
    { id: 'cursed', emoji: '☠️', nom: 'Numéros maudits', cartes: 5, expert: true, desc: 'Gagner un pli qui contient un numéro maudit te coûte 1 Pili.' },
    { id: 'duo', emoji: '🔗', nom: 'Binôme infernal', cartes: 5, expert: true, desc: 'En fin de manche, tu encaisses aussi les Pilis de ton voisin de gauche.' },
  ];
  const byId = Object.fromEntries(MISSIONS.map(m => [m.id, m]));

  const BOT_NAMES = ['Chili Bot', 'Piment Bot', 'Habanero Bot', 'Jalapeño Bot', 'Cayenne Bot', 'Paprika Bot', 'Tabasco Bot'];

  const rnd = n => Math.floor(Math.random() * n);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const sortHand = (a, b) => (a || 99) - (b || 99); // le Joker en dernier
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const deck = () => shuffle(Array.from({ length: 56 }, (_, i) => i)); // 0 = Joker, 1..55

  const fx = (S, k, data) => { S.fxN = (S.fxN || 0) + 1; return Object.assign({ id: S.fxN, k }, data); };
  function log(S, txt) { S.log.push(txt); if (S.log.length > 8) S.log.shift(); }
  const reversed = S => S.mission === 'reverse';

  // force d'une carte posée : plus grand = gagne ; à valeur égale, le Joker perd
  function strength(S, e) { return (reversed(S) ? -e.v : e.v) * 2 + (e.c === JOKER ? 0 : 1); }
  function trickWinner(S) {
    let best = 0;
    S.trick.forEach((e, i) => { if (strength(S, e) > strength(S, S.trick[best])) best = i; });
    return best;
  }

  /* ---------- Salon / démarrage ---------- */
  function lobby() {
    return { v: 0, phase: 'lobby', mode: 'all', players: [], log: [], fx: null, fxN: 0 };
  }
  function addBot(S) {
    if (S.players.length >= 8) return false;
    const used = S.players.map(p => p.name);
    const name = BOT_NAMES.find(n => !used.includes(n)) || 'Bot ' + (S.players.length + 1);
    let k = 1; while (S.players.some(p => p.id === 'bot-' + k)) k++;
    S.players.push({ id: 'bot-' + k, name, bot: true });
    return true;
  }
  function startGame(S, gameId) {
    S.game = gameId; S.round = 0; S.over = false; S.winners = null; S.mission = null;
    S.players.forEach(p => { p.pili = 0; });
    S.dealer = rnd(S.players.length);
    S.log = [];
    startRound(S);
  }
  function toLobby(S) {
    ['hands', 'bets', 'won', 'extra', 'bonus', 'cursed', 'trick', 'recap', 'winners', 'game', 'tw', 'ready'].forEach(k => delete S[k]);
    S.phase = 'lobby'; S.picked = []; S._picks = {}; S.mission = null; S.log = [];
    S.players.forEach(p => { delete p.pili; });
    S.fx = fx(S, 'lobby', {});
  }

  /* ---------- Manche ---------- */
  function startRound(S) {
    const n = S.players.length;
    S.round++;
    if (S.round > 1) S.dealer = (S.dealer + 1) % n;
    const pool = MISSIONS.filter(m => (S.mode === 'all' || (S.mode === 'std' && !m.expert)) && m.id !== S.mission);
    const m = S.mode === 'none' || !pool.length ? null : pool[rnd(pool.length)];
    S.mission = m ? m.id : null;
    const k = m ? m.cartes : 5;
    const d = deck();
    S.hands = {}; S.bets = {}; S.won = {}; S.extra = {}; S.bonus = {};
    S.picked = []; S._picks = {};
    S.players.forEach(p => { S.hands[p.id] = d.splice(0, k).sort(sortHand); S.won[p.id] = 0; S.extra[p.id] = 0; });
    if (S.mission === 'bonus') S.players.forEach(p => { S.bonus[p.id] = d.shift(); });
    S.total = k + (S.mission === 'bonus' ? 1 : 0);
    S.cursed = null;
    if (S.mission === 'cursed') {
      const all = shuffle([].concat(...Object.values(S.hands)).filter(c => c !== JOKER));
      S.cursed = all.slice(0, 2).sort((a, b) => a - b);
    }
    if (S.mission === 'handswap') {
      const old = S.hands; S.hands = {};
      S.players.forEach((p, i) => { S.hands[S.players[(i + 1) % n].id] = old[p.id]; });
    }
    S.trick = []; S.trickNo = 0; S.tw = null; S.recap = null;
    S.phase = 'ready'; S.ready = [];
    S.turn = S.lead = S.dealer;
    S.fx = fx(S, 'mission', { m: S.mission, dealer: S.dealer });
    log(S, 'Manche ' + S.round + ' — ' + (m ? m.nom : 'manche classique'));
  }

  /* ---------- Prêt ? (début de manche) ---------- */
  function ready(S, pid) {
    if (S.phase !== 'ready' || S.ready.includes(pid) || !S.players.some(p => p.id === pid)) return false;
    S.ready.push(pid);
    if (S.ready.length === S.players.length) {
      S.phase = S.mission === 'swap1' ? 'swap' : 'bet'; S.ready = [];
      S.fx = fx(S, 'go', {});
    }
    return true;
  }

  /* ---------- Paris ---------- */
  function validBets(S) {
    const T = S.total, prev = Object.values(S.bets);
    const isLast = prev.length === S.players.length - 1;
    const all = Array.from({ length: T + 1 }, (_, i) => i);
    const sumOk = n => !(isLast && sum(prev) + n === T);
    let ok = all.filter(n => {
      if (S.mission === 'no0' && n === 0) return false;
      if (S.mission === 'no1' && n === 1) return false;
      if (S.mission === 'unique' && prev.includes(n)) return false;
      return sumOk(n);
    });
    if (!ok.length) ok = all.filter(sumOk);
    return ok.length ? ok : all;
  }
  function bet(S, pid, n) {
    if (S.phase !== 'bet' || S.players[S.turn].id !== pid || !validBets(S).includes(n)) return false;
    S.bets[pid] = n;
    const done = Object.keys(S.bets).length === S.players.length;
    S.fx = fx(S, 'bet', { p: pid, n, last: done, bonus: done && S.mission === 'bonus' });
    if (done) {
      if (S.mission === 'bonus') S.players.forEach(p => { S.hands[p.id].push(S.bonus[p.id]); S.hands[p.id].sort(sortHand); });
      S.phase = 'play'; S.trickNo = 1; S.turn = S.lead = S.dealer; S.picked = []; S._picks = {};
      log(S, 'Les paris sont faits : on joue !');
    } else S.turn = (S.turn + 1) % S.players.length;
    return true;
  }

  /* ---------- Jeu des plis ---------- */
  function legalCards(S, pid) {
    const hand = (S.hands && S.hands[pid]) || [];
    if (S.mission !== 'extreme') return hand.slice();
    const nums = hand.filter(c => c !== JOKER);
    if (!nums.length) return hand.slice();
    const lo = Math.min(...nums), hi = Math.max(...nums);
    return hand.filter(c => c === JOKER || c === lo || c === hi);
  }
  const jokerValue = (c, v) => c === JOKER ? clamp(Math.round(Number(v)) || 0, 0, 56) : c;
  const removeCard = (hand, c) => { const i = hand.indexOf(c); if (i >= 0) hand.splice(i, 1); };

  function play(S, pid, c, v) {
    if (S.phase !== 'play' || S.mission === 'simul' || S.players[S.turn].id !== pid) return false;
    if (!legalCards(S, pid).includes(c)) return false;
    removeCard(S.hands[pid], c);
    const e = { p: pid, c, v: jokerValue(c, v) };
    S.trick.push(e);
    S.fx = fx(S, 'card', { p: pid, c, v: e.v });
    if (S.trick.length === S.players.length) closeTrick(S);
    else S.turn = (S.turn + 1) % S.players.length;
    return true;
  }

  // Choix secrets : échange de cartes (swap) ou pose simultanée (simul)
  function pick(S, pid, c, v) {
    const n = S.players.length;
    if (!S.hands || !S.hands[pid] || S._picks[pid] !== undefined) return false;
    if (S.phase === 'swap') {
      if (!S.hands[pid].includes(c)) return false;
      S._picks[pid] = { c }; S.picked.push(pid);
      if (S.picked.length === n) {
        const give = {};
        S.players.forEach(p => { give[p.id] = S._picks[p.id].c; removeCard(S.hands[p.id], give[p.id]); });
        S.players.forEach((p, i) => { S.hands[S.players[(i + 1) % n].id].push(give[p.id]); });
        S.players.forEach(p => S.hands[p.id].sort(sortHand));
        S.phase = 'bet'; S.turn = S.dealer; S.picked = []; S._picks = {};
        S.fx = fx(S, 'swap', {});
      }
      return true;
    }
    if (S.phase === 'play' && S.mission === 'simul') {
      if (!legalCards(S, pid).includes(c)) return false;
      S._picks[pid] = { c, v: jokerValue(c, v) }; S.picked.push(pid);
      if (S.picked.length === n) {
        S.trick = S.players.map(p => ({ p: p.id, c: S._picks[p.id].c, v: S._picks[p.id].v }));
        S.trick.forEach(e => removeCard(S.hands[e.p], e.c));
        S.picked = []; S._picks = {};
        closeTrick(S);
      }
      return true;
    }
    return false;
  }

  function closeTrick(S) {
    const w = trickWinner(S), wid = S.trick[w].p;
    S.won[wid]++; S.tw = wid;
    let curse = false, fl = false;
    if (S.mission === 'cursed' && S.trick.some(e => S.cursed.includes(e.c))) { S.extra[wid]++; curse = true; }
    if (S.mission === 'firstlast' && (S.trickNo === 1 || S.trickNo === S.total)) { S.extra[wid]++; fl = true; }
    S.phase = 'trickEnd';
    S.turn = S.players.findIndex(p => p.id === wid);
    S.fx = fx(S, 'trick', { w: wid, curse, fl, joker: S.trick.some(e => e.c === JOKER), sim: S.mission === 'simul' });
    log(S, S.players[S.turn].name + ' remporte le pli ' + S.trickNo);
  }

  function advanceTrick(S) {
    if (S.phase !== 'trickEnd') return false;
    if (S.trickNo >= S.total) { endRound(S); return true; }
    S.trick = []; S.trickNo++; S.tw = null; S.phase = 'play'; S.lead = S.turn; S.picked = []; S._picks = {};
    return true;
  }

  /* ---------- Fin de manche / de partie ---------- */
  function endRound(S) {
    const n = S.players.length, pen = {}, base = {}, rel = {};
    S.players.forEach(p => {
      const b = S.bets[p.id], w = S.won[p.id];
      base[p.id] = Math.abs(b - w);
      pen[p.id] = base[p.id] + (S.extra[p.id] || 0);
      rel[p.id] = S.mission === 'relief' && b === w ? b : 0;
    });
    S.recap = S.players.map((p, i) => {
      const duo = S.mission === 'duo' ? pen[S.players[(i + 1) % n].id] : 0;
      const before = p.pili;
      p.pili = Math.max(0, p.pili + pen[p.id] + duo - rel[p.id]);
      return { id: p.id, bet: S.bets[p.id], won: S.won[p.id], base: base[p.id], extra: S.extra[p.id] || 0, duo, rel: rel[p.id], delta: p.pili - before, pili: p.pili };
    });
    S.over = S.players.some(p => p.pili >= MAX_PILI);
    S.phase = 'roundEnd'; S.trick = [];
    S.fx = fx(S, 'round', {});
  }
  function nextRound(S) {
    if (S.phase !== 'roundEnd') return false;
    if (!S.over) { startRound(S); return true; }
    const min = Math.min(...S.players.map(p => p.pili));
    S.winners = S.players.filter(p => p.pili === min).map(p => p.id);
    S.phase = 'end';
    S.fx = fx(S, 'victory', { w: S.winners });
    return true;
  }

  /* ---------- Bots ---------- */
  function botBet(S) {
    const p = S.players[S.turn], n = S.players.length;
    const eff = c => { const x = c === JOKER ? 1 : c / 55; return reversed(S) ? 1 - x : x; };
    let est = S.mission === 'early' ? S.total / n : sum(S.hands[p.id].map(c => Math.pow(eff(c), Math.max(1, (n - 1) * 0.9))));
    est += (Math.random() - 0.5) * 0.9;
    const want = Math.max(0, Math.round(est));
    const ok = validBets(S);
    return ok.reduce((a, x) => Math.abs(x - want) < Math.abs(a - want) ? x : a, ok[0]);
  }
  function botCard(S, pid) {
    const rev = reversed(S), want = S.bets[pid] - S.won[pid] > 0;
    const sv = c => c === JOKER ? (want ? (rev ? 0 : 56) : (rev ? 56 : 0)) : c;
    const power = c => (rev ? -sv(c) : sv(c)) * 2 + (c === JOKER ? 0 : 1);
    const cards = legalCards(S, pid).sort((a, b) => power(a) - power(b)); // faible → fort
    const cur = S.mission !== 'simul' && S.trick.length ? Math.max(...S.trick.map(e => strength(S, e))) : null;
    let c;
    if (want) c = cur === null ? cards[cards.length - 1] : (cards.find(x => power(x) > cur) || cards[0]);
    else if (cur === null) c = cards[0];
    else { const lose = cards.filter(x => power(x) < cur); c = lose.length ? lose[lose.length - 1] : cards[0]; }
    return { c, v: sv(c) };
  }
  function botSwap(S, pid) {
    const h = S.hands[pid], nj = h.filter(c => c !== JOKER);
    const src = nj.length ? nj : h;
    return src[rnd(src.length)];
  }

  return { MAX_PILI, JOKER, MISSIONS, byId, lobby, addBot, startGame, startRound, ready, toLobby, validBets, bet, legalCards, play, pick, advanceTrick, nextRound, botBet, botCard, botSwap, strength, rnd };
})();
if (typeof module !== 'undefined') module.exports = PP;
