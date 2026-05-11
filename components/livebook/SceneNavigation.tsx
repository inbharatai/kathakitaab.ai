'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

interface Props {
  previousSceneId: string | null;
  nextSceneId: string | null;
  onNavigate: (sceneId: string, direction?: 1 | -1) => void;
  /** Triggered when there is no next static scene — produces a fresh
   *  generated scene that continues the story past the canon end. */
  onContinueBeyond?: () => void;
  /** Slug used to construct the movie CTA at the end of the book.
   *  When omitted, the end-of-book state falls back to the plain
   *  "Journey Complete" pill (kept for the editor / preview cases
   *  that have no movie route). */
  bookSlug?: string;
}

export default function SceneNavigation({ previousSceneId, nextSceneId, onNavigate, onContinueBeyond, bookSlug }: Props) {
  const movieHref = bookSlug ? `/books/${bookSlug}/movie` : null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingBottom: 60 }}>
      {previousSceneId ? (
        <motion.button
          whileHover={{ x: -4, scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="btn-secondary"
          onClick={() => onNavigate(previousSceneId, -1)}
        >
          ← Previous Scene
        </motion.button>
      ) : <div />}

      {nextSceneId ? (
        <motion.button
          whileHover={{ x: 4, scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="btn-primary"
          onClick={() => onNavigate(nextSceneId, 1)}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          <motion.span
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ display: 'inline-block', marginRight: 4 }}
          >▶</motion.span>
          Next Scene
        </motion.button>
      ) : onContinueBeyond ? (
        <motion.button
          whileHover={{ x: 4, scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="btn-primary"
          onClick={onContinueBeyond}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          <motion.span
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ display: 'inline-block', marginRight: 4 }}
          >✨</motion.span>
          Continue the Journey
        </motion.button>
      ) : movieHref ? (
        // End of book. Surface the cinematic cut as the natural next
        // action — the reader's intent at this point is "what now?",
        // and the movie is the canonical answer (no extra render
        // cost; the Player streams it from the same assets).
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}
        >
          <div style={{ fontSize: '0.8rem', color: '#5CDB95', fontWeight: 600 }}>
            🌟 Journey complete — watch it play out:
          </div>
          <Link href={movieHref} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.05rem' }}>▶</span>
            Watch the movie
          </Link>
        </motion.div>
      ) : (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{ padding: '12px 28px', background: 'rgba(46,139,87,0.2)', color: '#5CDB95', borderRadius: 12, fontWeight: 700, border: '1px solid rgba(46,139,87,0.4)' }}
        >
          🌟 Journey Complete!
        </motion.div>
      )}
    </div>
  );
}
