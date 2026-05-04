'use client';

import { motion } from 'framer-motion';

interface Props {
  previousSceneId: string | null;
  nextSceneId: string | null;
  onNavigate: (sceneId: string, direction?: 1 | -1) => void;
}

export default function SceneNavigation({ previousSceneId, nextSceneId, onNavigate }: Props) {
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
