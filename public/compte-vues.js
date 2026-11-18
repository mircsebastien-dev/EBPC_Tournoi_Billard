// vues du compte, partages par les pages dediees du burger Compte :
// /parametres.html (vueParametres), /amis.html (vueAmis), /mes-matchs.html (vueMesMatchs).
// Ex-panneaux de compte.html extraits sans duplication.
// Dependances : common.js (el, api, LANG, themeActuel, basculerTheme, matchCard) ; push-client.js pour vueParametres.

async function vueParametres(main) {
  const { compte, prefs } = await api('/api/compte/moi');
  // panneau parametres : theme clair/sombre + langue (preferences locales, disponibles meme sans compte)
  // interrupteurs 0-1 alignes (grille .pref-row) : theme 0 = sombre (defaut) / 1 = clair - langue FR / EN
  const majSwTheme = () => { const on = themeActuel() === 'light'; swTheme.className = 'toggle-mini' + (on ? ' on' : ''); swTheme.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  const swTheme = el('button', { class: 'toggle-mini' + (themeActuel() === 'light' ? ' on' : ''), 'aria-pressed': themeActuel() === 'light' ? 'true' : 'false', 'aria-label': 'Interrupteur mode clair', title: '0 = sombre · 1 = clair', onclick: () => { basculerTheme(); majSwTheme(); } });
  function choisirLang(l) { try { localStorage.setItem('ebpc_lang', l); } catch {} location.reload(); }
  const swLang = el('button', { class: 'toggle-mini' + (LANG === 'en' ? ' on' : ''), 'aria-pressed': LANG === 'en' ? 'true' : 'false', 'aria-label': 'Interrupteur langue anglaise', title: 'FR = francais · EN = anglais', onclick: () => { choisirLang(LANG === 'en' ? 'fr' : 'en'); } });
  const prefTheme = el('div', { class: 'pref-row' },
    el('span', {}, 'Mode clair'),
    el('span', { class: 'hint muted small' }, '0'), swTheme,
    el('span', { class: 'hint muted small' }, '1'));
  const prefLangue = el('div', { class: 'pref-row' },
    el('span', {}, 'Langue'),
    el('span', { class: 'hint muted small' }, 'FR'), swLang,
    el('span', { class: 'hint muted small' }, 'EN'));
  const panneauParams = el('div', { class: 'panel', style: 'max-width:420px;margin:20px auto' },
    el('h2', {}, '⚙️ Paramètres'),
    el('div', { class: 'pref-sub' }, 'Préférences'),
    prefTheme, prefLangue);
  main.append(panneauParams);
  if (!compte) return;
  // sous-section Notifications (connecte uniquement) : push + preferences notifs amis
  const notifOk = await pushEstActif().catch(() => false);
  const btnNotif = notifOk
    ? el('button', { class: 'secondary', style: 'width:100%', onclick: async () => { try { await pushDesactiver(); alert('Notifications désactivées'); location.reload(); } catch (e) { alert(e.message); } } }, 'Désactiver')
    : el('button', { style: 'width:100%', onclick: async () => { try { await pushActiver(); alert('Notifications activées !'); location.reload(); } catch (e) { alert(e.message); } } }, 'Activer les notifications');
  const btnTest = el('button', { class: 'secondary', style: 'width:100%', onclick: async () => {
    try { const r = await api('/api/push/test', { method: 'POST', pin: null }); alert(r.envoyes > 0 ? '📨 Notif de test envoyée (' + r.envoyes + ' appareil(s)) !' : '⚠️ Aucun appareil abonné — active les notifications avant.'); }
    catch (e) { alert(e.message); }
  } }, 'Tester la notification');
  panneauParams.append(...[
    el('div', { class: 'pref-sub' }, 'Notifications'),
    el('p', { class: 'muted small' }, 'Reçois une notification push quand un de tes matchs est lancé (même écran verrouillé).'),
    estIOS() && !estPWA() ? el('p', { class: 'muted small' }, '📱 Sur iPhone : ajoute d\'abord le site à l\'écran d\'accueil (Safari → Partager → « Sur l\'écran d\'accueil »), puis active les notifications.') : null,
    el('div', {}, btnNotif),
    el('div', { style: 'margin-top:10px' }, btnTest),
    el('label', { class: 'row', style: 'justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding:6px 0;cursor:pointer' },
      el('span', {}, '🔔 Notifier quand un ami s\'inscrit à un tournoi'),
      el('input', { id: 'pref-ami-inscription', type: 'checkbox', class: 'toggle-mini', checked: !prefs || prefs.notif_amis_inscription !== false, onchange: async (e) => {
        const actif = e.target.checked;
        try { await api('/api/compte/preferences', { method: 'POST', body: JSON.stringify({ notif_amis_inscription: actif }) }); }
        catch (err) { e.target.checked = !actif; alert(err.message); }
      } })),
    el('label', { class: 'row', style: 'justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding:6px 0;cursor:pointer' },
      el('span', {}, '🔔 Notifier quand le match d\'un ami commence'),
      el('input', { id: 'pref-ami-match', type: 'checkbox', class: 'toggle-mini', checked: !prefs || prefs.notif_amis_match !== false, onchange: async (e) => {
        const actif = e.target.checked;
        try { await api('/api/compte/preferences', { method: 'POST', body: JSON.stringify({ notif_amis_match: actif }) }); }
        catch (err) { e.target.checked = !actif; alert(err.message); }
      } })),
  ].filter(Boolean));
}

async function vueAmis(main) {
  const { compte } = await api('/api/compte/moi');
  if (!compte) { location.replace('/compte.html#connexion'); return; }
  async function renderAmis() {
    const box = document.getElementById('amis-box');
    if (!box) return;
    const { amis } = await api('/api/compte/amis');
    box.innerHTML = '';
    const inp = el('input', { id: 'ami-q', placeholder: '🔍 Rechercher un pseudo… (Entrée)', maxlength: 24, style: 'width:100%;max-width:280px' });
    const res = el('div', { style: 'margin:6px 0' });
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      res.innerHTML = '';
      const q = inp.value.trim();
      if (q.length < 2) return;
      const { comptes } = await api('/api/comptes/recherche?q=' + encodeURIComponent(q));
      for (const c of comptes) {
        if (c.moi) continue;
        const deja = amis.some(a => a.compte_id === c.id);
        res.append(el('div', { class: 'row', style: 'justify-content:space-between;border-top:1px solid var(--line);padding:4px 0' },
          el('span', {}, c.pseudo),
          deja ? el('span', { class: 'muted small' }, 'déjà ami') : el('button', { class: 'secondary', style: 'padding:3px 10px;font-size:12px', onclick: async () => {
            try { await api('/api/compte/amis', { method: 'POST', body: JSON.stringify({ pseudo: c.pseudo }) }); renderAmis(); }
            catch (err) { alert(err.message); }
          } }, '➕ Ajouter')));
      }
      // aucun compte exact avec ce pseudo -> proposer le suivi par pseudo (ami sans compte)
      if (!comptes.some(c => c.pseudo.toLowerCase() === q.toLowerCase())) {
        const dejaSuivi = amis.some(a => a.sans_compte && a.pseudo.toLowerCase() === q.toLowerCase());
        res.append(el('div', { class: 'row', style: 'justify-content:space-between;border-top:1px solid var(--line);padding:4px 0' },
          el('span', {}, q, ' ', el('span', { class: 'muted small' }, '(sans compte)')),
          dejaSuivi ? el('span', { class: 'muted small' }, 'déjà suivi') : el('button', { class: 'secondary', style: 'padding:3px 10px;font-size:12px', onclick: async () => {
            try { await api('/api/compte/amis-pseudo', { method: 'POST', body: JSON.stringify({ pseudo: q }) }); renderAmis(); }
            catch (err) { alert(err.message); }
          } }, '➕ Suivre')));
      }
      const f = document.getElementById('ami-q'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    });
    box.append(inp, res);
    if (!amis.length) { box.append(el('p', { class: 'muted small', style: 'margin-top:8px' }, 'Aucun ami pour le moment — recherche un pseudo ci-dessus.')); return; }
    for (const a of amis) {
      const st = a.statut || {};
      const stTxt = { en_cours: `🟢 en cours vs ${st.vs || '?'} (${st.score}${st.table ? ' · table ' + st.table : ''})`, pret: `🕐 match programmé vs ${st.vs || '?'}`, inscrit: '📝 inscrit au tournoi', hors_tournoi: '— hors tournoi' }[st.type] || '—';
      const libelle = '👤 ' + a.pseudo + (a.sans_compte ? ' (sans compte)' : '');
      box.append(el('div', { class: 'row', style: 'justify-content:space-between;border-top:1px solid var(--line);padding:6px 0' },
        el('div', {}, a.joueur_id
          ? el('a', { href: `/joueur.html?id=${a.joueur_id}`, title: `Fiche de ${a.pseudo}`, style: 'color:inherit;text-decoration:none' }, el('div', { style: 'font-weight:700' }, libelle, ' ›'))
          : el('div', { style: 'font-weight:700' }, libelle), el('div', { class: 'muted small' }, stTxt)),
        el('button', { class: 'danger', style: 'padding:3px 10px;font-size:12px', onclick: async () => {
          if (!confirm('Retirer ' + a.pseudo + ' de tes amis ?')) return;
          await api(a.sans_compte ? '/api/compte/amis-pseudo/' + a.id : '/api/compte/amis/' + a.compte_id, { method: 'DELETE' }); renderAmis();
        } }, '🗑')));
    }
  }
  main.append(el('div', { class: 'panel', style: 'max-width:420px;margin:20px auto' },
    el('h2', {}, '👥 Amis'),
    el('p', { class: 'muted small' }, 'Suis des joueurs : tu reçois une notif quand leur match commence ou quand ils s\'inscrivent à un tournoi, et leur statut ici. Pas besoin de compte pour eux : entre son pseudo dans la recherche puis « Suivre ».'),
    el('div', { id: 'amis-box' })));
  renderAmis();
}

async function vueMesMatchs(main) {
  const { compte } = await api('/api/compte/moi');
  if (!compte) { location.replace('/compte.html#connexion'); return; }
  // mes matchs (inscriptions en cours / matchs joues) ; init() global de la page mes-matchs.html rafraichit apres desinscription
  const mm = await api('/api/compte/moi/matchs');
  const t = (await api('/api/etat')).actif;
  const mesInscriptions = t ? t.joueurs.filter(j => j.compte_id === compte.id) : [];
  if (mesInscriptions.length) {
    main.append(el('div', { class: 'panel' },
      el('h2', {}, '📋 Mon inscription'),
      ...mesInscriptions.map(j => el('p', {}, `✅Inscrit au tournoi « ${t.tournoi.nom} » en tant que ${j.pseudo} — statut : ${j.statut === 'paye' ? 'payé' : 'en attente'}`)),
      t.tournoi.statut === 'inscription' ? el('div', { style: 'margin-top:8px' },
        mesInscriptions[0].statut === 'paye'
          ? el('p', { class: 'muted small' }, '💰 Déjà payé : la désinscription se fait auprès de la table de marque (remboursement à voir avec le club).')
          : el('div', {},
              el('button', { class: 'danger', onclick: async () => {
                  if (!confirm('Te désinscrire du tournoi « ' + t.tournoi.nom + ' » ?')) return;
                  try { await api('/api/tournoi/desinscrire', { method: 'DELETE' }); init(); } catch (e) { alert(e.message); }
                } }, 'Me désinscrire'),
              el('p', { class: 'muted small', style: 'margin-top:6px' }, 'Possible tant que les inscriptions sont ouvertes et que tu n\'as pas payé.'))) : null));
  }
  if (mm.matchs && mm.matchs.length) {
    main.append(el('div', { class: 'panel' },
      el('h2', {}, '🎱 Mes matchs'),
      el('div', { class: 'matchs-grid' }, mm.matchs.map(m => matchCard(m))))); // tous les matchs, pas de limite
  }
  if (!mesInscriptions.length && !(mm.matchs && mm.matchs.length)) {
    main.append(el('div', { class: 'panel', style: 'max-width:420px;margin:20px auto;text-align:center' },
      el('h2', {}, '🎱 Mes matchs'),
      el('p', { class: 'muted' }, 'Pas (encore !) d\'inscription ni de match à afficher.')));
  }
}
