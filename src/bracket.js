const { db } = require('./db');

function log2int(n) {
  let t = 0;
  while ((1 << t) < n) t++;
  return t;
}

function pow2superieur(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function melanger(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ordreSerpentin(nb) {
  const order = [];
  let lo = 0, hi = nb - 1;
  while (lo <= hi) {
    order.push(lo++);
    if (lo <= hi) order.push(hi--);
  }
  return order;
}

function appariementPremierTour(ids, taille, graines, rng) {
  const slots = [];
  for (let m = 0; m < taille / 2; m++) slots.push([null, null]);
  const nbMatchs = taille / 2;
  const tds = graines.filter(j => j.tds != null && j.id != null).sort((a, b) => a.tds - b.tds);
  const autres = melanger(ids.filter(j => j.id != null && j.tds == null), rng);
  if (tds.length > 0) {
    const order = ordreSerpentin(nbMatchs);
    const nb = Math.min(tds.length, nbMatchs);
    for (let g = 0; g < nb; g++) {
      const m = order[g];
      const slot = g % 2 === 0 ? 0 : 1;
      slots[m][slot] = tds[g].id;
    }
  }
  // Mélanger joueurs ET blancs ensemble, puis verser dans les slots
  const nbJoueurs = tds.length + autres.length;
  const blancs = taille - nbJoueurs;
  const pool = melanger([...autres.map(j => j.id), ...Array(Math.max(0, blancs)).fill(null)], rng);
  let k = 0;
  for (let m = 0; m < nbMatchs; m++) {
    for (let s = 0; s < 2; s++) {
      if (slots[m][s] == null && k < pool.length) slots[m][s] = pool[k++];
    }
  }
  // Les blancs restent mélangés au hasard dans le tirage : un match peut être joueur-vs-blanc
  // (passe direct) ou blanc-vs-blanc (match vide auto-terminé, géré par appliquerBye).
  return slots;
}

function creerMatch(tournoiId, bracket, tour, position, manches, j1, j2) {
  const info = db.prepare(`
    INSERT INTO match (tournoi_id, bracket, tour, position, joueur1_id, joueur2_id, manches, etat)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'prevu')
  `).run(tournoiId, bracket, tour, position, j1, j2, manches);
  return Number(info.lastInsertRowid);
}

function setLien(id, champ, toId, slot) {
  db.prepare(`UPDATE match SET ${champ}_id = ?, ${champ}_slot = ? WHERE id = ?`).run(toId, slot, id);
}

function manchesDefaut(rounds, seuil = 'jamais', distanceSpeciale = 3) {
  const map = {};
  const n = rounds.length;
  const nbDepuisFin = seuil === 'finale' ? 1 : seuil === 'demis' ? 2 : seuil === 'quarts' ? 3 : 0;
  rounds.forEach((r, i) => {
    // Loser bracket : race to 2 par défaut ; WB et tableau final : 3 (ou distance spéciale vers la fin)
    if (r.bracket === 'LB') { map[r.key] = 2; return; }
    map[r.key] = (nbDepuisFin > 0 && i >= n - nbDepuisFin) ? distanceSpeciale : 3;
  });
  return map;
}

// Prochain mardi à 20h00 (heure serveur), au format 'YYYY-MM-DD HH:MM' UTC
function prochainMardi20h(from = new Date()) {
  const d = new Date(from.getTime());
  d.setUTCHours(20, 0, 0, 0);
  let add = (2 - d.getUTCDay() + 7) % 7; // 2 = mardi
  if (add === 0 && d.getTime() <= from.getTime()) add = 7; // si aujourd'hui mardi mais déjà passé 20h -> semaine prochaine
  d.setUTCDate(d.getUTCDate() + add);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function tailleAuto(nbPayes, tailleMax) {
  let taille = 4;
  while (taille < nbPayes) taille <<= 1;
  return Math.min(taille, tailleMax);
}

function listeRounds(taille, format, dkoTours) {
  const rounds = [];
  if (format === 'simple') {
    const tours = log2int(taille);
    for (let t = 1; t <= tours; t++) rounds.push({ key: `wb${t}`, bracket: 'WB', tour: t });
  } else {
    for (let t = 1; t <= dkoTours; t++) rounds.push({ key: `wb${t}`, bracket: 'WB', tour: t });
    const nbToursLB = dkoTours === 1 ? 1 : 2 * dkoTours - 2;
    for (let t = 1; t <= nbToursLB; t++) rounds.push({ key: `lb${t}`, bracket: 'LB', tour: t });
    const p = taille >> (dkoTours - 1);
    const toursF = log2int(p);
    for (let t = 1; t <= toursF; t++) rounds.push({ key: `f${t}`, bracket: 'F', tour: t });
  }
  return rounds;
}

function labelRound(key, taille, format, dkoTours) {
  const m = key.match(/^(wb|lb|f)(\d+)$/);
  const tour = parseInt(m[2], 10);
  const toursWB = log2int(taille);
  if (m[1] === 'wb') {
    if (format === 'simple') {
      if (tour === toursWB) return 'Finale';
      if (tour === toursWB - 1) return 'Demi-finales';
      if (tour === toursWB - 2) return 'Quarts de finale';
      return `1/${(taille >> tour)} de finale`;
    }
    // Double KO partiel : les tours WB restent "Tour N"
    return `Tour ${tour}`;
  }
  if (m[1] === 'lb') return `Loser bracket - tour ${tour}`;
  // Tableau final (bracket F) : libellés en fractions de finale (1/16, 1/8...) selon sa taille
  const p = taille >> (dkoTours - 1);
  const toursF = log2int(p);
  if (tour === toursF) return 'Finale';
  if (tour === toursF - 1) return 'Demi-finales';
  if (tour === toursF - 2) return 'Quarts de finale';
  return `1/${p >> tour} de finale`;
}

function genererBracket(tournoi, joueurs, manchesMap, rng = Math.random) {
  const taille = tournoi.taille;
  const format = tournoi.format;
  const k = tournoi.dko_tours;
  const tournoiId = tournoi.id;
  const manches = (key) => manchesMap[key] || 3;

  const ids = joueurs.map(j => ({ id: j.id, tds: tournoi.tetes_de_serie ? j.tete_de_serie : null }));
  while (ids.length < taille) ids.push({ id: null, tds: null });

  const M = { WB: {}, LB: {}, F: {} };
  const get = (b, t, p) => M[b][`${t}:${p}`];

  db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(tournoiId);
  db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(tournoiId);

  const tx = db.transaction(() => {
    if (format === 'simple') {
      const tours = log2int(taille);
      const slots = appariementPremierTour(ids, taille, ids, rng);
      for (let t = 1; t <= tours; t++) {
        const nb = taille >> t;
        for (let p = 1; p <= nb; p++) {
          const j1 = t === 1 ? slots[p - 1][0] : null;
          const j2 = t === 1 ? slots[p - 1][1] : null;
          M.WB[`${t}:${p}`] = creerMatch(tournoiId, 'WB', t, p, manches(`wb${t}`), j1, j2);
        }
      }
      for (let t = 1; t < tours; t++) {
        const nb = taille >> t;
        for (let p = 1; p <= nb; p++) {
          setLien(get('WB', t, p), 'suivant', get('WB', t + 1, Math.ceil(p / 2)), p % 2 === 1 ? 1 : 2);
        }
      }
    } else {
      for (let t = 1; t <= k; t++) {
        const nb = taille >> t;
        for (let p = 1; p <= nb; p++) {
          M.WB[`${t}:${p}`] = creerMatch(tournoiId, 'WB', t, p, manches(`wb${t}`), null, null);
        }
      }
      const slots = appariementPremierTour(ids, taille, ids, rng);
      for (let p = 1; p <= taille / 2; p++) {
        db.prepare('UPDATE match SET joueur1_id = ?, joueur2_id = ? WHERE id = ?')
          .run(slots[p - 1][0], slots[p - 1][1], get('WB', 1, p));
      }
      for (let t = 1; t < k; t++) {
        const nb = taille >> t;
        for (let p = 1; p <= nb; p++) {
          setLien(get('WB', t, p), 'suivant', get('WB', t + 1, Math.ceil(p / 2)), p % 2 === 1 ? 1 : 2);
        }
      }

      const nbToursLB = k === 1 ? 1 : 2 * k - 2;
      for (let t = 1; t <= nbToursLB; t++) {
        let nb;
        if (t === 1) nb = taille >> 2;
        else if (t % 2 === 1) nb = taille >> ((t + 1) / 2 + 1);
        else nb = taille >> (t / 2 + 1);
        for (let p = 1; p <= nb; p++) {
          M.LB[`${t}:${p}`] = creerMatch(tournoiId, 'LB', t, p, manches(`lb${t}`), null, null);
        }
      }
      for (let p = 1; p <= taille >> 2; p++) {
        setLien(get('WB', 1, 2 * p - 1), 'perdant', get('LB', 1, p), 1);
        setLien(get('WB', 1, 2 * p), 'perdant', get('LB', 1, p), 2);
      }
      for (let t = 2; t <= k; t++) {
        const lbTour = 2 * t - 2;
        if (lbTour >= 1 && lbTour <= nbToursLB) {
          const nb = taille >> t;
          for (let p = 1; p <= nb; p++) {
            setLien(get('WB', t, p), 'perdant', get('LB', lbTour, p), 2);
          }
        }
      }
      for (let t = 1; t < nbToursLB; t++) {
        const nb = Object.keys(M.LB).filter(key => key.startsWith(`${t}:`)).length;
        const nbSuiv = Object.keys(M.LB).filter(key => key.startsWith(`${t + 1}:`)).length;
        if ((t + 1) % 2 === 1) {
          // tour impair suivant (nbSuiv = nb/2) : croisement par bloc de 4 (extérieur <-> intérieur)
          // pour que les 2 feeders d'un match LB ne viennent jamais du même groupe de 4 du WB
          for (let p = 1; p <= nb; p++) {
            const q = Math.floor((p - 1) / 4);
            const r = (p - 1) % 4;
            const cible = (r === 0 || r === 3) ? 2 * q + 1 : 2 * q + 2;
            const slot = (r === 0 || r === 1) ? 1 : 2;
            setLien(get('LB', t, p), 'suivant', get('LB', t + 1, cible), slot);
          }
        } else {
          // tour PAIR suivant : il reçoit aussi les perdants du WB (slot 2 = perdant WB(t',p)).
          // CROISEMENT par bloc de 4 du niveau WB correspondant (p <-> p^1 dans chaque paire)
          // en slot 1 uniquement -> le perdant de WB ne retrouve jamais en LB le gagnant du match
          // voisin de son propre groupe de 4 (évite le re-match J1-vs-J2).
          for (let p = 1; p <= nb; p++) {
            const cible = p % 2 === 1 ? p + 1 : p - 1;
            setLien(get('LB', t, p), 'suivant', get('LB', t + 1, cible), 1);
          }
        }
      }

      const nbWBk = taille >> k;
      const p2 = taille >> (k - 1);
      const toursF = log2int(p2);
      for (let t = 1; t <= toursF; t++) {
        const nb = p2 >> t;
        for (let pos = 1; pos <= nb; pos++) {
          M.F[`${t}:${pos}`] = creerMatch(tournoiId, 'F', t, pos, manches(`f${t}`), null, null);
        }
      }
      for (let t = 1; t < toursF; t++) {
        const nb = p2 >> t;
        for (let pos = 1; pos <= nb; pos++) {
          setLien(get('F', t, pos), 'suivant', get('F', t + 1, Math.ceil(pos / 2)), pos % 2 === 1 ? 1 : 2);
        }
      }
      // Croisement en alternance supérieure/inférieure : WB tour k alimente le tableau final (slot 1),
      // le dernier tour LB alimente le slot 2 en ROTATION d'une demi-moitié (et non plus en miroir global),
      // pour que le joueur remonté du LB tombe dans la moitié OPPOSÉE à son groupe WB d'origine
      // -> impossible de se rejouer avant la vraie finale.
      const nbF1 = p2 >> 1;
      for (let p = 1; p <= nbWBk; p++) {
        setLien(get('WB', k, p), 'suivant', get('F', 1, p), 1);
      }
      const nbLB = Object.keys(M.LB).filter(key => key.startsWith(`${nbToursLB}:`)).length;
      const demi = Math.floor(nbF1 / 2) || 1;
      for (let p = 1; p <= nbLB; p++) {
        const pos = ((p - 1 + demi) % nbF1) + 1; // rotation d'une demi-moitié
        setLien(get('LB', nbToursLB, p), 'suivant', get('F', 1, pos), 2);
      }
    }
  });

  tx();
  return M;
}

module.exports = {
  log2int,
  pow2superieur,
  melanger,
  listeRounds,
  labelRound,
  manchesDefaut,
  prochainMardi20h,
  tailleAuto,
  genererBracket,
  appariementPremierTour,
};
