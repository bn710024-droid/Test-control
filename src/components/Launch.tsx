import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { glow } from '../lib/ui';

const LETTERS = 'Tropicaura'.split('');
const OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Ouverture de l'application : la mangue arrive sur son halo, le nom se lève lettre à lettre, puis
 * le rideau s'efface en s'approchant, comme une application qui s'ouvre. Une seconde environ,
 * pendant que le catalogue se charge derrière. Rien n'est joué si le système demande moins
 * d'animations.
 */
export function Launch() {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(true);

  useEffect(() => {
    let alive = true;
    const end = () => {
      if (alive) setShow(false);
    };
    const least = new Promise((resolve) => window.setTimeout(resolve, 1050));
    const fonts = document.fonts?.ready ?? Promise.resolve();
    Promise.all([least, fonts]).then(end, end);
    const cap = window.setTimeout(end, 2200);
    return () => {
      alive = false;
      window.clearTimeout(cap);
    };
  }, []);

  if (reduced) return null;
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          className="fixed inset-0 z-[95] grid place-items-center overflow-hidden bg-bg"
          exit={{ opacity: 0, scale: 1.12, filter: 'blur(10px)' }}
          transition={{ duration: 0.5, ease: OUT }}
        >
          <motion.span
            className="absolute h-[min(120vw,620px)] w-[min(150vw,760px)]"
            style={{ backgroundImage: glow('#D9A93A', 0.5) }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, ease: OUT }}
          />
          <div className="relative flex flex-col items-center">
            <motion.img
              src="/produce/thumb/mangue.webp"
              alt=""
              width={240}
              height={148}
              draggable={false}
              className="w-[176px]"
              initial={{ opacity: 0, scale: 0.6, y: 26, rotate: -14 }}
              animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 170, damping: 15 }}
            />
            <div className="poster-voice mt-6 flex overflow-hidden text-[44px] leading-[48px] tracking-[0.1em]">
              {LETTERS.map((letter, i) => (
                <motion.span
                  key={i}
                  className="block"
                  initial={{ y: '115%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.6, delay: 0.16 + i * 0.035, ease: OUT }}
                >
                  {letter}
                </motion.span>
              ))}
            </div>
            <motion.span
              className="label-voice mt-2 text-[13.5px] text-leaf"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.55, ease: OUT }}
            >
              Tour de contrôle
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
