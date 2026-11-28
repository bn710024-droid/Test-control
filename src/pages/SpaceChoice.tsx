import { motion } from 'framer-motion';
import { Navigate, useNavigate } from 'react-router-dom';
import { Backdrop, Wordmark } from '../components/Shell';
import { SPACES, rememberSpace, rememberedSpace, type Space } from '../lib/space';
import { cx } from '../lib/ui';

/**
 * Entrée de la tour : choix en grand de l'espace. Le choix est mémorisé sur l'appareil ; ensuite,
 * on arrive directement dans son espace, et le commutateur de la barre du haut permet de changer.
 */
export default function SpaceChoice({ force }: { force?: boolean }) {
  const navigate = useNavigate();
  const remembered = rememberedSpace();
  if (remembered && !force) return <Navigate to={`/${SPACES[remembered].slug}`} replace />;

  const pick = (space: Space) => {
    rememberSpace(space);
    navigate(`/${SPACES[space].slug}`);
  };

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1100px] flex-col justify-center px-5 py-14">
        <div className="mb-10 flex justify-center">
          <Wordmark />
        </div>
        <h1 className="font-display text-center text-[34px] font-semibold leading-[1.05] lg:text-[48px]">Quel espace ouvrir ?</h1>
        <p className="mx-auto mt-3 max-w-[460px] text-center text-[15px] leading-[22px] text-fg-dim">
          Deux catalogues séparés : ce que vous changez dans un espace ne touche jamais l’autre.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          {(['b2c', 'b2b'] as Space[]).map((space, i) => {
            const meta = SPACES[space];
            const gold = space === 'b2b';
            return (
              <motion.button
                key={space}
                type="button"
                onClick={() => pick(space)}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className={cx(
                  'press group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[30px] border p-7 text-left lg:min-h-[300px] lg:p-9',
                  gold ? 'border-star/40 bg-star-wash' : 'border-[#a8d54f]/40 bg-[rgba(168,213,79,0.1)]',
                )}
              >
                <span className={cx('label-voice text-[13px]', gold ? 'text-star' : 'text-[#a8d54f]')}>Espace {i + 1}</span>
                <span>
                  <span className="font-display block text-[30px] font-semibold leading-[1.05] lg:text-[40px]">{meta.label}</span>
                  <span className="mt-3 block max-w-[380px] text-[14.5px] leading-[21px] text-fg-dim">{meta.hint}</span>
                </span>
                <span
                  className={cx(
                    'mt-6 inline-flex h-12 w-fit items-center gap-2 rounded-full px-5 text-[14.5px] font-extrabold',
                    gold ? 'bg-star text-bg-deep' : 'bg-[#a8d54f] text-[#11180a]',
                  )}
                >
                  Ouvrir <span aria-hidden>→</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
