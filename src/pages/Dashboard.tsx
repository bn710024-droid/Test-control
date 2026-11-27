import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { add, airplaneOutline, appsOutline, checkmarkCircle, chevronForward, cloudOfflineOutline, createOutline, flaskOutline, imageOutline, linkOutline, pricetagOutline, shieldCheckmarkOutline, timeOutline } from '../lib/glyphs';
import { useAuth } from '../contexts/AuthContext';
import { useData, type Product } from '../contexts/DataContext';
import { Wordmark } from '../components/Shell';
import { Icon } from '../components/Icon';
import { CategoryRail, ProductArt, priceInfo } from '../components/catalog';
import { Chip, ErrorPanel, Page, SectionHead, SkeletonRows } from '../components/ui';
import { MONTHS, ago, count, currentMonth, isAllYear, plural } from '../lib/format';
import { cx, glow } from '../lib/ui';

type Task = { key: string; tone: 'danger' | 'star' | 'neutral'; icon: string; title: string; detail: string; to: string };

const TONE_DOT: Record<Task['tone'], string> = {
  danger: 'bg-danger',
  star: 'bg-star',
  neutral: 'bg-fg-faint',
};

/** Chiffre façon étiquette de cagette : capitales étroites, comme les repères de l'application. */
/** Le chiffre monte jusqu'à sa valeur à l'ouverture, puis à chaque changement. */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 800);
      const next = Math.round(origin + (value - origin) * (1 - Math.pow(1 - k, 4)));
      from.current = next;
      setShown(next);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{count(reduced ? value : shown)}</>;
}

function Figure({ value, label, to, tone }: { value: number; label: string; to: string; tone?: 'leaf' | 'star' }) {
  return (
    <Link to={to} className="press block min-w-0" aria-label={`${value} ${label}`}>
      <span className={cx('poster-voice tabular block text-[46px] leading-[44px]', tone === 'leaf' && 'text-leaf', tone === 'star' && 'text-star')}>
        <CountUp value={value} />
      </span>
      <span className="label-voice mt-1 block truncate text-[12.5px] text-fg-dim">{label}</span>
    </Link>
  );
}

function Tile({ to, label, value, detail, tone }: { to: string; label: string; value: number; detail: string; tone?: 'star' | 'leaf' }) {
  return (
    <Link to={to} className="press card block p-4">
      <span className="label-voice block truncate text-[12px] text-fg-faint">{label}</span>
      <span className={cx('poster-voice tabular mt-1.5 block text-[38px] leading-[38px]', tone === 'star' && value > 0 && 'text-star', tone === 'leaf' && 'text-leaf')}>
        <CountUp value={value} />
      </span>
      <span className="mt-1.5 block text-[12.5px] leading-[17px] text-fg-dim">{detail}</span>
    </Link>
  );
}

function SeasonCard({ product: p }: { product: Product }) {
  const price = priceInfo(p);
  return (
    <Link to={`/produits/${p.id}`} className="press card flex w-[232px] shrink-0 items-center gap-3 p-2.5 pr-3.5">
      <ProductArt product={p} size={76} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-bold leading-5">{p.name}</span>
        <span className="mt-px block truncate text-[12.5px] text-fg-faint">{p.origin || 'Origine à renseigner'}</span>
        <span className={cx('tabular mt-[7px] block truncate text-[14.5px] font-extrabold', price.missing && 'text-star')}>
          {price.text} <span className="text-[12px] font-medium text-fg-faint">{price.unit}</span>
        </span>
      </span>
    </Link>
  );
}

/** Ce que l'application d'achat garde sur l'appareil du client : aucune donnée n'arrive ici. */
const NOT_CONNECTED = [
  { title: 'Paiements', why: 'Aucun prestataire n’est branché : l’équipe pointe ici le paiement reçu.' },
  { title: 'Moyens de paiement', why: 'Liste fixe (Orange Money, Wave, virement, carte) écrite dans la tour : pas encore réglable ici.' },
  { title: 'Comptes clients', why: 'Créés et conservés sur chaque appareil, sans serveur.' },
  { title: 'Messages de suivi', why: 'Envoyés à l’application à chaque statut, pas encore affichés au client.' },
  { title: 'Étapes des demandes professionnelles', why: 'Le client voit « En attente de réponse » jusqu’au contrat, pas « Contacté » ni « En discussion ».' },
  { title: 'Publications photo', why: 'Publiées ici, pas encore affichées par l’application.' },
  { title: 'Avis et notes', why: 'Aucun système d’avis : les notes affichées sont des exemples.' },
];

export default function Dashboard() {
  const { products, categories, settings, activity, loading, error, reload, issuesOf, pendingRefs } = useData();
  const { isOwner } = useAuth();
  const [showOff, setShowOff] = useState(false);
  const month = currentMonth();

  const s = useMemo(() => {
    const active = products.filter((p) => !p.archived);
    // Une fiche non validée n'est pas publiée : elle ne compte ni comme visible, ni comme masquée.
    const unvalidated = active.filter((p) => !!p._seal && p._seal !== 'ok');
    const validated = active.filter((p) => !p._seal || p._seal === 'ok');
    const visible = validated.filter((p) => p.available);
    const withIssues = active.map((p) => ({ p, issues: issuesOf(p) })).filter((x) => x.issues.length > 0);
    const has = (code: string) => withIssues.filter((x) => x.issues.some((i) => i.code === code)).length;
    const offers = active.flatMap((p) => p.wholesale.map((o) => ({ p, o })));
    const inSeason = visible.filter((p) => p.months.includes(month));
    const counts: Record<string, number> = {};
    for (const p of active) counts[p.category] = (counts[p.category] ?? 0) + 1;
    return {
      active,
      visible,
      hidden: validated.length - visible.length,
      unvalidated: unvalidated.length,
      archived: products.length - active.length,
      incomplete: withIssues.length,
      example: active.filter((p) => p.is_example).length,
      noPhoto: has('photo'),
      noDescription: has('description'),
      noOrigin: has('origine'),
      noSeason: has('saison'),
      noPrice: has('prix'),
      proToConfirm: withIssues.reduce((n, x) => n + x.issues.filter((i) => i.code === 'prix-pro').length, 0),
      unknownCategory: has('rayon'),
      offers: offers.length,
      offerProducts: new Set(offers.map((x) => x.p.id)).size,
      inSeason,
      seasonal: inSeason.filter((p) => !isAllYear(p.months)),
      retail: visible.filter((p) => p.retail && p.retail.price !== null).length,
      counts,
    };
  }, [products, issuesOf, month]);

  const tasks = useMemo(() => {
    const list: Task[] = [];
    if (pendingRefs.length > 0) {
      list.push({
        key: 'seal',
        tone: 'danger',
        icon: shieldCheckmarkOutline,
        title: `${plural(pendingRefs.length, 'ligne', 'lignes')} à valider avant publication`,
        detail: isOwner
          ? 'Import initial ou écriture faite hors de l’administration : non publiées tant que vous ne les avez pas validées.'
          : 'Non publiées tant qu’un responsable ne les a pas validées.',
        to: '/reglages?section=integrite',
      });
    }
    if (s.noPrice > 0) {
      list.push({ key: 'prix', tone: 'star', icon: pricetagOutline, title: `${plural(s.noPrice, 'produit', 'produits')} sans prix`, detail: 'Sans prix particulier ni offre, un produit n’est proposé à personne.', to: '/produits?manque=prix' });
    }
    if (s.proToConfirm > 0) {
      list.push({ key: 'pro', tone: 'star', icon: airplaneOutline, title: `${plural(s.proToConfirm, 'offre professionnelle', 'offres professionnelles')} sans prix`, detail: 'L’application affiche « Prix à confirmer » et ne calcule aucun total.', to: '/prix?vue=pro' });
    }
    if (s.noPhoto > 0) {
      list.push({ key: 'photo', tone: 'star', icon: imageOutline, title: `${plural(s.noPhoto, 'produit', 'produits')} sans photo`, detail: 'Une photo détourée sur fond transparent est attendue.', to: '/produits?manque=photo' });
    }
    if (s.noDescription > 0) {
      list.push({ key: 'desc', tone: 'star', icon: createOutline, title: `${plural(s.noDescription, 'description', 'descriptions')} à rédiger`, detail: 'Affichée sur la fiche du produit.', to: '/produits?manque=description' });
    }
    if (s.noOrigin > 0) {
      list.push({ key: 'origine', tone: 'star', icon: createOutline, title: `${plural(s.noOrigin, 'origine', 'origines')} à renseigner`, detail: 'Affichée sous le nom, sur chaque carte du catalogue.', to: '/produits?manque=origine' });
    }
    if (s.noSeason > 0) {
      list.push({ key: 'saison', tone: 'star', icon: timeOutline, title: `${plural(s.noSeason, 'saison', 'saisons')} à renseigner`, detail: 'Mois de disponibilité du produit.', to: '/produits?manque=saison' });
    }
    if (s.unknownCategory > 0) {
      list.push({ key: 'rayon', tone: 'star', icon: appsOutline, title: `${plural(s.unknownCategory, 'produit', 'produits')} dans un rayon inconnu de l’application`, detail: 'L’application les rangerait dans « Fruits ».', to: '/produits?manque=rayon' });
    }
    if (s.example > 0) {
      list.push({ key: 'exemple', tone: 'neutral', icon: flaskOutline, title: `${plural(s.example, 'fiche', 'fiches')} en données d’exemple`, detail: 'Prix, origines et notes repris du catalogue d’exemple de l’application : à vérifier un par un.', to: '/produits?etat=exemple' });
    }
    if (settings?.link && !settings.link.appLinked) {
      list.push({ key: 'link', tone: 'neutral', icon: linkOutline, title: 'Application d’achat non reliée', detail: 'Vos modifications sont publiées ici, mais l’application lit encore son catalogue embarqué.', to: '/reglages?section=publication' });
    }
    return list;
  }, [s, pendingRefs, settings, isOwner]);

  if (error) {
    return (
      <Page>
        <div className="px-5" style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 14px) + 14px)' }}>
          <Wordmark compact />
        </div>
        <ErrorPanel message={error} onRetry={reload} />
      </Page>
    );
  }

  const hero = s.seasonal[0] ?? s.inSeason[0] ?? s.visible[0];
  const linked = settings?.link?.appLinked === true;

  return (
    <Page>
      <div className="flex items-center justify-between gap-3 px-5 lg:hidden" style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 14px) + 10px)' }}>
        <Wordmark compact />
      </div>

      <div className="px-5 pt-6 lg:pt-10">
        <h1 className="font-display text-[32px] font-semibold leading-[38px]">
          Le catalogue <span className="font-light italic text-fg-dim">en {MONTHS[month - 1]}</span>
        </h1>
        <p className="mt-1.5 text-[14.5px] leading-5 text-fg-dim">
          {loading
            ? 'Lecture du catalogue…'
            : s.active.length === 0
              ? 'Le catalogue est vide.'
              : `${plural(s.visible.length, 'produit visible', 'produits visibles')} sur ${count(s.active.length)}, dont ${count(s.retail)} proposé${s.retail > 1 ? 's' : ''} aux particuliers.`}
        </p>
      </div>

      {loading ? (
        <div className="pt-5">
          <SkeletonRows rows={4} />
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-6">
          <div className="min-w-0">
            {/* Bordereau : l'état du catalogue en trois chiffres. */}
            <section aria-label="État du catalogue" className="card-lit relative mx-5 mt-5 overflow-hidden p-5">
              {hero && (
                <>
                  <span className="absolute -right-10 -top-8 h-[210px] w-[230px]" style={{ backgroundImage: glow(hero.tint, 0.5) }} />
                  <motion.span
                    className="absolute right-2 top-3"
                    initial={{ opacity: 0, scale: 0.7, rotate: -12 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 180, damping: 14, delay: 0.15 }}
                  >
                    <span className="float block">
                      <ProductArt product={hero} size={118} variant="full" halo={0} eager />
                    </span>
                  </motion.span>
                </>
              )}
              <div className="relative">
                <span className="label-voice text-[13px] text-leaf">État du catalogue</span>
                <div className="mt-4 grid max-w-[78%] grid-cols-3 gap-3 sm:max-w-[70%]">
                  <Figure value={s.active.length} label="Produits" to="/produits" />
                  <Figure value={s.visible.length} label="Visibles" to="/produits?etat=visibles" tone="leaf" />
                  <Figure value={s.hidden} label="Masqués" to="/produits?etat=masques" />
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-dashed border-line-strong pt-4">
                  {s.unvalidated > 0 && <Chip tone="danger">{plural(s.unvalidated, 'fiche non publiée', 'fiches non publiées')}</Chip>}
                  {hero && <Chip tone="leaf">De saison : {hero.name}</Chip>}
                  {s.archived > 0 && <Chip>{plural(s.archived, 'archivé', 'archivés')}</Chip>}
                  <Chip icon={linked ? checkmarkCircle : cloudOfflineOutline} tone={linked ? 'leaf' : 'neutral'}>
                    {linked ? 'Application reliée' : 'Application non reliée'}
                  </Chip>
                </div>
              </div>
            </section>

            <div className="mx-5 mt-3 grid grid-cols-2 gap-3">
              <Tile to="/produits?etat=a-completer" label="À compléter" value={s.incomplete} tone="star" detail={s.incomplete === 0 ? 'Toutes les fiches sont complètes.' : 'Fiches où il manque une information.'} />
              <Tile to="/produits?etat=exemple" label="Données d’exemple" value={s.example} detail={s.example === 0 ? 'Plus aucune donnée d’exemple.' : 'Fiches à vérifier avant mise en service.'} />
              <Tile to="/prix?vue=pro" label="Offres pro" value={s.offers} detail={`Sur ${plural(s.offerProducts, 'produit', 'produits')}.`} />
              <Tile to="/produits?etat=saison" label={`De saison`} value={s.inSeason.length} tone="leaf" detail={`Visibles et de saison en ${MONTHS[month - 1]}.`} />
            </div>

            <SectionHead title="À traiter" right={tasks.length > 0 ? <span className="text-[13px] font-semibold text-fg-faint">{plural(tasks.length, 'tâche', 'tâches')}</span> : undefined} />
            {tasks.length === 0 ? (
              <div className="card mx-5 mt-3.5 flex items-center gap-3 p-4">
                <Icon src={checkmarkCircle} size={24} className="text-leaf" />
                <p className="text-[14.5px] leading-5 text-fg-dim">Rien à signaler : toutes les fiches sont complètes et validées.</p>
              </div>
            ) : (
              <ul className="mx-5 mt-3.5 flex flex-col gap-2.5">
                {tasks.map((t, i) => (
                  <motion.li key={t.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, delay: Math.min(i, 6) * 0.04 }}>
                    <Link to={t.to} className="press card flex items-center gap-3 p-3.5">
                      <span className={cx('ml-1 h-2.5 w-2.5 shrink-0 rounded-full', TONE_DOT[t.tone])} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold leading-5">{t.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-[18px] text-fg-dim">{t.detail}</span>
                      </span>
                      <Icon src={chevronForward} size={18} className="text-fg-faint" />
                    </Link>
                  </motion.li>
                ))}
              </ul>
            )}

            {s.seasonal.length > 0 && (
              <>
                <SectionHead title="En ce moment" right={<Chip tone="leaf" className="capitalize">{MONTHS[month - 1]}</Chip>} />
                <p className="px-5 pt-1 text-[13px] leading-[18px] text-fg-faint">Les produits de saison, présentés en premier aux clients.</p>
                <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
                  {s.seasonal.map((p) => (
                    <SeasonCard key={p.id} product={p} />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="min-w-0">
            <SectionHead title="Accès rapides" />
            <div className="mx-5 mt-3.5 grid grid-cols-2 gap-2.5">
              {[
                { to: '/produits', label: 'Produits' },
                { to: '/rayons', label: 'Rayons' },
                { to: '/prix', label: 'Prix' },
                { to: '/prix?vue=dispo', label: 'Disponibilités' },
              ].map((a) => (
                <Link key={a.label} to={a.to} className="press card flex min-h-[54px] items-center justify-between gap-2 px-4">
                  <span className="min-w-0 truncate text-[14.5px] font-bold">{a.label}</span>
                  <span className="shrink-0 text-[17px] font-bold leading-none text-leaf" aria-hidden>
                    →
                  </span>
                </Link>
              ))}
            </div>
            <Link to="/produits/nouveau" className="press mx-5 mt-4 flex min-h-[54px] items-center justify-between rounded-full border border-line-strong pl-5 pr-2">
              <span className="text-[15px] font-bold">Ajouter un produit</span>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-leaf text-on-leaf">
                <Icon src={add} size={22} />
              </span>
            </Link>

            <SectionHead title="Rayons" right={<Link to="/rayons" className="press -mr-2 flex min-h-11 min-w-11 items-center justify-center px-2 text-[13.5px] font-bold text-leaf">Gérer</Link>} />
            {categories.length === 0 ? (
              <p className="px-5 pt-3 text-[14px] text-fg-dim">Aucun rayon pour l’instant.</p>
            ) : (
              <div className="mt-3">
                <CategoryRail counts={s.counts} total={s.active.length} linkTo={(id) => (id === 'tout' ? '/produits' : `/produits?rayon=${id}`)} />
              </div>
            )}

            <SectionHead title="Dernières modifications" />
            {activity.length === 0 ? (
              <p className="px-5 pt-3 text-[14px] leading-[21px] text-fg-dim">
                Aucune modification enregistrée pour l’instant. Chaque changement fait ici apparaîtra dans ce journal.
              </p>
            ) : (
              <ul className="card mx-5 mt-3.5 divide-y divide-line px-4">
                {activity.slice(0, 6).map((a) => (
                  <li key={a.id} className="py-3">
                    <p className="text-[14px] font-semibold leading-5">{a.summary}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-fg-faint">
                      {ago(a.at)}
                      {a.by ? ` · ${a.by}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <SectionHead title="Hors de cette administration" />
            <div className="card mx-5 mt-3.5 p-4">
              <p className="text-[13.5px] leading-5 text-fg-dim">
                Reliée (variable EXPO_PUBLIC_CONTROL_TOWER_URL), l’application d’achat lit le catalogue publié ici et envoie à
                l’espace commandes ses commandes, demandes professionnelles, produits introuvables et réactions aux vidéos.
              </p>
              <button
                type="button"
                onClick={() => setShowOff((v) => !v)}
                aria-expanded={showOff}
                className="press mt-2 flex min-h-11 items-center gap-1.5 text-[13.5px] font-bold text-leaf"
              >
                {showOff ? 'Masquer le détail' : 'Voir ce qui n’est pas connecté'}
              </button>
              {showOff && (
                <ul className="mt-1 flex flex-col gap-3">
                  {NOT_CONNECTED.map((n) => (
                    <li key={n.title} className="flex items-start gap-3">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-bold leading-5">{n.title}</span>
                        <span className="block text-[12.5px] leading-[18px] text-fg-faint">{n.why}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
