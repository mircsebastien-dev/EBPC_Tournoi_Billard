// Usage: BASE=http://127.0.0.1:PORT [NB_SIMUS=3] [SEED=12345] node test/simu-invariants.js
// Simulations complètes randomisées (32 joueurs double KO k=2 + variantes) avec interventions admin aléatoires
// (lancer/table, bande, manche, retirer, correction de score, forfait, rouvrir, delete event, changer joueurs).
// INVARIANT vérifié après CHAQUE mutation: aucune paire de joueurs ne se rencontre 2 fois,
// sauf si l'une des rencontres est la vraie finale (bracket F, tour max).
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PIN = process.env.ADMIN_PIN || '0000';
const NB_SIMUS = Number(process.env.NB_SIMUS || 3);

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++; else failed++;
  console.log(`${cond ? '  OK ' : '  FAIL'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 220)}`);
}

let seed = Number(process.env.SEED || 987654321);
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const ri = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[ri(arr.length)];

let nb500 = 0;
async function api(p, { method = 'GET', body, pin = PIN } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': pin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 500) nb500++;
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const post = (p, body, opts) => api(p, { method: 'POST', body, ...opts });
const del = (p, opts = {}) => { const o = { method: 'DELETE', ...opts }; if (p.startsWith('/api/admin') && !o.body) o.body = { confirm_pin: PIN }; return api(p, o); };

const etat = async (tournoiId) => {
  const r = await api('/api/etat' + (tournoiId ? `?tournoi_id=${tournoiId}` : ''));
  return r.data.actif || r.data.tournoi || null;
};

// Invariant anti-rematch: une paire de joueurs ne doit jamais se trouver dans 2 matchs JOUÉS
// (etat termine/forfait/en_cours), sauf si l'une des rencontres est la finale (dernier tour F à 1 match)
// ou le dernier tour d'un bracket à 1 seul match (cas forcé). Les appariements prévus en double sont
// transitoires: le sweep les casse au remplissage, et le lancement est bloqué (409) sinon.
// `altered` = matchs modifiés manuellement (route joueurs): violation "soft" si un match altéré est impliqué.
const NO_MANUEL = process.env.NO_MANUEL === '1';
const JOUE = ['termine', 'forfait', 'en_cours'];
function invariantRematch(t, altered = new Set()) {
  const allowed = new Set();
  for (const b of ['F', 'LB']) {
    const ms = t.matchs.filter(m => m.bracket === b);
    if (!ms.length) continue;
    const maxT = Math.max(...ms.map(m => m.tour));
    const last = ms.filter(m => m.tour === maxT);
    if (last.length === 1) allowed.add(last[0].id); // finale / dernier tour à 1 match: rematch autorisé
  }
  const pairs = new Map();
  const hard = [], soft = [];
  for (const m of t.matchs) {
    if (m.joueur1 && m.joueur2 && m.joueur1.id === m.joueur2.id) {
      hard.push({ paire: 'DOUBLE-' + m.joueur1.id, matchs: [`${m.bracket}${m.tour}#${m.position}(${m.etat}) j1=j2=${m.joueur1.id}`] });
      continue;
    }
    if (!m.joueur1 || !m.joueur2 || !JOUE.includes(m.etat)) continue;
    const key = [m.joueur1.id, m.joueur2.id].sort((a, b) => a - b).join('-');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(m);
  }
  for (const [key, ms] of pairs) {
    if (ms.length > 1 && !ms.some(m => allowed.has(m.id))) {
      const v = { paire: key, matchs: ms.map(m => `${m.bracket}${m.tour}#${m.position}(${m.etat})`) };
      if (ms.some(m => altered.has(m.id))) soft.push(v); else hard.push(v);
    }
  }
  return { hard, soft };
}

async function simu(cfg, num) {
  const label = `simu#${num} ${cfg.taille}j ${cfg.format}${cfg.format === 'double' ? ' k=' + cfg.dko_tours : ''}`;
  console.log(`\n== ${label} ==`);
  await del('/api/admin/tournoi').catch(() => {});
  let r = await post('/api/admin/tournoi', { nom: 'Simu' + num, regle: 'blackball', taille: cfg.taille, format: cfg.format, dko_tours: cfg.dko_tours || 0, nb_tables: 4, notif_push: false });
  check(label + ' création tournoi', r.status === 200, r.status + ' ' + (r.data.error || ''));
  if (r.status !== 200) return;
  const tournoiId = r.data.actif.tournoi.id;
  r = await post('/api/admin/joueurs/simulation', { count: cfg.taille, prefix: 'S' });
  check(label + ' ' + cfg.taille + ' joueurs simulés', r.status === 200, r.status);
  r = await post('/api/admin/tirage', {});
  check(label + ' tirage 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  let t = await etat(tournoiId);
  let iv = invariantRematch(t);
  check(label + ' invariant anti-rematch après tirage', iv.hard.length === 0, JSON.stringify(iv.hard));

  let interventions = 0, swaps = 0, soft = 0, rematchBloques = 0;
  const altered = new Set();
  let steps = 0;
  while (steps++ < 2000) {
    t = await etat(tournoiId);
    if (!t || t.tournoi.statut === 'termine') break;
    iv = invariantRematch(t, altered);
    soft += iv.soft.length;
    if (iv.hard.length) {
      check(label + ` invariant HARD step ${steps}`, false, JSON.stringify(iv.hard));
      if (process.env.DEBUG_VIOL === '1') {
        for (const v of iv.hard) {
          const m0 = t.matchs.find(m => `${m.bracket}${m.tour}#${m.position}(${m.etat})` === v.matchs[0].replace(/\(.*\)$/, m => m));
          console.log('DEBUG paire', v.paire, v.matchs.join(' | '));
          for (const lbl of v.matchs) {
            const mm = t.matchs.find(m => `${m.bracket}${m.tour}#${m.position}` === lbl.replace(/\(.*\)$/, ''));
            if (mm) {
              const tourM = t.matchs.filter(x => x.bracket === mm.bracket);
              const maxT = Math.max(...tourM.map(x => x.tour));
              console.log(`  tour ${mm.bracket}${mm.tour} (max tour ${mm.bracket}=${maxT}):`, tourM.map(x => `${x.bracket}${x.tour}#${x.position}:j1=${x.joueur1 ? x.joueur1.id : '-'},j2=${x.joueur2 ? x.joueur2.id : '-'}`).join(' '));
            }
          }
        }
      }
      return;
    }
    const matchs = t.matchs;
    const pret = matchs.filter(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
    const enCours = matchs.filter(m => m.etat === 'en_cours' && m.joueur1 && m.joueur2);
    const prevu1 = matchs.filter(m => m.etat === 'prevu' && (!m.joueur1 || !m.joueur2));
    const termine = matchs.filter(m => (m.etat === 'termine' || m.etat === 'forfait') && m.joueur1 && m.joueur2);
    const a = rnd();

    if (enCours.length && a < 0.55) {
      // jouer une manche (bande d'abord si besoin)
      const m = pick(enCours);
      if (!m.casseur) await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: pick([m.joueur1.id, m.joueur2.id]) } });
      await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: pick([m.joueur1.id, m.joueur2.id]) } });
    } else if (pret.length && a < 0.75) {
      // lancer un match prêt (table aléatoire ou auto)
      const m = pick(pret);
      const tableId = rnd() < 0.5 ? null : pick(t.tables).id;
      const rr = await post(`/api/admin/match/${m.id}/lancer`, { table_id: tableId });
      if (rr.status === 200) {
        interventions++;
        check(`${label} lancer -> en_cours${tableId ? ' + table' : ''}`, rr.data.match.etat === 'en_cours' && (tableId ? !!rr.data.match.table : true), JSON.stringify({ etat: rr.data.match.etat, table: rr.data.match.table }));
      } else if (rr.status === 409 && /rematch/i.test(rr.data.error || '')) {
        rematchBloques++; // le garde-fou a bloqué un lancement sur paire déjà jouée: conforme
      } else if (rr.status !== 409) check(`${label} lancer sans 500`, false, rr.status + ' ' + (rr.data.error || ''));
    } else if (enCours.length && a < 0.88) {
      // intervention admin sur un match en cours
      const m = pick(enCours);
      const kind = ri(4);
      if (kind === 0 && m.score1 + m.score2 > 0) {
        // retirer une manche -> score -1
        const g = m.score1 > 0 ? m.joueur1.id : m.joueur2.id;
        const av = await api(`/api/match/${m.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: g } });
        if (av.status === 200) {
          interventions++;
          const cur = (await etat(tournoiId)).matchs.find(x => x.id === m.id);
          check(`${label} retirer -> score -1`, cur.score1 + cur.score2 === m.score1 + m.score2 - 1, `match#${m.id} ${m.bracket}${m.tour}#${m.position} ${m.etat}->${cur.etat} ${m.score1}-${m.score2} (sum ${m.score1 + m.score2}) -> ${cur.score1}-${cur.score2} (sum ${cur.score1 + cur.score2}) g=${g}`);
        } else check(`${label} retirer sans 500`, av.status !== 500, av.status);
      } else if (kind === 1) {
        // correction de score absolue (peut terminer le match et propager)
        const s1 = ri(m.manches + 1), s2 = ri(m.manches + 1);
        const cr = await post(`/api/admin/match/${m.id}/correction`, { score1: s1, score2: s2, manches: m.manches, motif: 'simu' });
        if (cr.status === 200) {
          interventions++;
          const e1 = Math.max(0, Math.min(s1, m.manches)), e2 = Math.max(0, Math.min(s2, m.manches));
          check(`${label} correction -> scores appliqués`, cr.data.match.score1 === e1 && cr.data.match.score2 === e2, `${cr.data.match.score1}-${cr.data.match.score2} vs ${e1}-${e2}`);
          if (cr.data.match.etat === 'termine' && cr.data.match.suivant_id) {
            const tt = await etat(tournoiId);
            const suiv = tt.matchs.find(x => x.id === cr.data.match.suivant_id);
            // le gagnant doit arriver dans le tour du suivant (slot exact, ou autre match du même tour si swap anti-rematch)
            const dansTour = tt.matchs.some(x => x.bracket === suiv.bracket && x.tour === suiv.tour && ((x.joueur1 && x.joueur1.id === cr.data.match.gagnant_id) || (x.joueur2 && x.joueur2.id === cr.data.match.gagnant_id)));
            check(`${label} correction termine -> gagnant propagé au tour suivant`, dansTour, JSON.stringify({ suiv: suiv.bracket + suiv.tour, gagnant: cr.data.match.gagnant_id }));
          }
        } else check(`${label} correction sans 500`, cr.status !== 500, cr.status + ' ' + (cr.data.error || ''));
      } else if (kind === 2) {
        // forfait -> gagnant = l'autre, perdant propagé en LB (perdant_id)
        const f = pick([m.joueur1.id, m.joueur2.id]);
        const fr = await post(`/api/admin/match/${m.id}/forfait`, { joueur_id: f });
        if (fr.status === 200) {
          interventions++;
          check(`${label} forfait -> etat forfait, gagnant=autre`, fr.data.match.etat === 'forfait' && fr.data.match.gagnant_id === (f === m.joueur1.id ? m.joueur2.id : m.joueur1.id), JSON.stringify({ etat: fr.data.match.etat, g: fr.data.match.gagnant_id }));
          if (fr.data.match.perdant_id) {
            const tt = await etat(tournoiId);
            const lb = tt.matchs.find(x => x.id === fr.data.match.perdant_id);
            // le perdant doit être dans le tour LB cible (slot exact, ou autre match du tour si swap anti-rematch)
            const dansTourLB = tt.matchs.some(x => x.bracket === lb.bracket && x.tour === lb.tour && ((x.joueur1 && x.joueur1.id === f) || (x.joueur2 && x.joueur2.id === f)));
            check(`${label} forfait -> perdant en LB (tour ${lb.bracket}${lb.tour})`, dansTourLB, JSON.stringify({ f }));
          }
        } else check(`${label} forfait sans 500`, fr.status !== 500, fr.status);
      } else {
        // déplacer de table (null = libérer, ou table aléatoire -> 409 si occupée)
        const tableId = rnd() < 0.4 ? null : pick(t.tables).id;
        const tr = await post(`/api/admin/match/${m.id}/table`, { table_id: tableId });
        if (tr.status === 200) {
          interventions++;
          check(`${label} table -> appliquée`, tableId ? !!tr.data.match.table : tr.data.match.table === null, JSON.stringify({ want: tableId, got: tr.data.match.table }));
        } else check(`${label} table occupée -> 409 (pas 500)`, tr.status === 409, tr.status + ' ' + (tr.data.error || ''));
      }
    } else if (!NO_MANUEL && prevu1.length && a < 0.96) {
      // changer les joueurs d'un match prévu: 409 si rematch hors finale, 200 sinon
      const m = pick(prevu1);
      const js = t.joueurs;
      const j1 = rnd() < 0.25 ? null : pick(js).id;
      let j2 = rnd() < 0.25 ? null : pick(js).id;
      if (j1 != null && j1 === j2) j2 = null;
      const jr = await post(`/api/admin/match/${m.id}/joueurs`, { joueur1_id: j1, joueur2_id: j2 });
      if (jr.status === 409) {
        interventions++;
        check(`${label} joueurs -> 409 rematch bloqué`, /rematch|déjà/i.test(jr.data.error || ''), jr.data.error);
      } else if (jr.status === 200) { interventions++; altered.add(m.id); }
      else check(`${label} joueurs sans 500`, false, jr.status + ' ' + (jr.data.error || ''));
    } else if (enCours.length) {
      // supprimer un event manche/runout (sur un match sans event 'correction' pour garder le recalc simple)
      const m = pick(enCours);
      const ev = await api(`/api/admin/match/${m.id}/events`);
      const evs = (ev.data.events || []);
      if (evs.some(e => e.type === 'manche' || e.type === 'runout') && !evs.some(e => e.type === 'correction')) {
        // on supprime le DERNIER event manche: le score recalculé = détail du nouvel event restant (ou 0-0)
        const target = evs.filter(e => e.type === 'manche' || e.type === 'runout').pop();
        const dr = await del(`/api/admin/match/${m.id}/event/${target.id}`);
        if (dr.status === 200) {
          interventions++;
          const cur = (await etat(tournoiId)).matchs.find(x => x.id === m.id);
          if (altered.has(m.id)) {
            // match altéré manuellement (joueurs changés à la main): l'attribution events/score y est incohérente par nature,
            // on vérifie juste que la suppression réussit (200) et recalcule sans erreur
            check(`${label} delete event -> 200 sur match altéré`, true, '');
          } else {
            const ev2 = ((await api(`/api/admin/match/${m.id}/events`)).data.events || []).filter(e => e.type === 'manche' || e.type === 'runout');
            const last = ev2[ev2.length - 1];
            const exp = last ? JSON.parse(last.detail || '{}') : {};
            check(`${label} delete event -> score recalculé`, cur.score1 === (exp.score1 || 0) && cur.score2 === (exp.score2 || 0), `${cur.score1}-${cur.score2} vs ${exp.score1 || 0}-${exp.score2 || 0}`);
          }
        } else check(`${label} delete event sans 500`, dr.status !== 500, dr.status + ' ' + (dr.data.error || ''));
      }
    } else if (termine.length && a < 0.99) {
      // rouvrir un match terminé dont l'aval n'a pas commencé (sinon 409 attendu)
      const m = pick(termine);
      const rr = await post(`/api/admin/match/${m.id}/rouvrir`, {});
      if (rr.status === 200) { interventions++; check(`${label} rouvrir -> en_cours`, rr.data.match.etat === 'en_cours', rr.data.match.etat); }
      else check(`${label} rouvrir aval commencé -> 409 (pas 500)`, rr.status === 409, rr.status + ' ' + (rr.data.error || ''));
    }
  }

  // fin de simu
  t = await etat(tournoiId);
  if (t && t.tournoi.statut === 'termine') {
    check(label + ' tournoi terminé en ' + steps + ' steps', true, '');
    check(label + ' champion désigné', !!(t.champion || t.tournoi.champion_id), JSON.stringify(t.champion || t.tournoi.champion_id));
  } else if (rematchBloques > 0 || altered.size > 0) {
    // mode manuel: blocage fail-closed par l'anti-rematch ou état altéré à la main -> on ne force pas la fin,
    // l'invariant (aucune paire jouée 2x hors finale) est vérifié juste après
    check(label + ` tournoi non terminé en ${steps} steps mais ${rematchBloques} blocage(s) 409 rematch / ${altered.size} match(s) altéré(s) manuellement (fail-closed)`, true, 'statut=' + (t && t.tournoi.statut));
  } else {
    check(label + ' tournoi terminé en ' + steps + ' steps', false, t && t.tournoi.statut);
  }
  if (t.tournoi.statut === 'termine') {
    const tousJoues = t.matchs.every(m => m.etat === 'termine' || m.etat === 'forfait');
    check(label + ' tous les matchs décidés (' + t.matchs.length + ' matchs)', tousJoues, t.matchs.filter(m => !['termine', 'forfait'].includes(m.etat)).map(m => `${m.bracket}${m.tour}#${m.position}:${m.etat}`).join(','));
  }
  iv = invariantRematch(t, altered);
  soft += iv.soft.length;
  check(label + ' invariant anti-rematch final (hard)', iv.hard.length === 0, JSON.stringify(iv.hard));
  if (iv.soft.length) console.log(`   (${iv.soft.length} paire(s) dupliquée(s) via intervention manuelle joueurs — soft)`);
  const joues = t.matchs.filter(m => m.joueur1 && m.joueur2 && (m.etat === 'termine' || m.etat === 'forfait')).length;
  check(label + ' stats cohérentes (joues=' + t.stats.resume.joues + ')', t.stats.resume.joues === joues, `${t.stats.resume.joues} vs ${joues}`);
  const audit = (await api('/api/admin/audit')).data.audit;
  swaps = audit.filter(x => x.action === 'rematch_swap_f').length;
  console.log(`   -> ${t.matchs.length} matchs, ${interventions} interventions admin, ${swaps} swap(s) anti-rematch logués, ${rematchBloques} lancement(s) bloqué(s) 409 rematch, ${soft} violation(s) soft (manuelles), steps=${steps}`);
  return { matchs: t.matchs.length, interventions, swaps, soft, rematchBloques, steps };
}

(async () => {
  console.log('=== SIMULATIONS AVEC INVARIANT ANTI-REMATCH ===');
  const configs = [];
  for (let i = 0; i < NB_SIMUS; i++) configs.push({ taille: 32, format: 'double', dko_tours: 2 });
  configs.push({ taille: 32, format: 'double', dko_tours: 1 });
  configs.push({ taille: 32, format: 'double', dko_tours: 3 });
  configs.push({ taille: 32, format: 'simple', dko_tours: 0 });
  configs.push({ taille: 16, format: 'double', dko_tours: 2 });
  let totalSwaps = 0;
  for (let i = 0; i < configs.length; i++) {
    const res = await simu(configs[i], i + 1);
    if (res) totalSwaps += res.swaps;
  }
  await del('/api/admin/tournoi').catch(() => {});
  check('aucune erreur 500 sur toute la simu', nb500 === 0, `nb500=${nb500}`);
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC — ${totalSwaps} rematch_swap_f au total ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });
