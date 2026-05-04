'use client';

import React, { useState } from 'react';

interface Props {
  topBar?: React.ReactNode;
  topOffset?: number;
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  questPanel: React.ReactNode;
  inventoryPanel: React.ReactNode;
  bottomBar: React.ReactNode;
}

export default function GameLayout({
  topBar,
  topOffset = 0,
  leftPanel,
  centerPanel,
  questPanel,
  inventoryPanel,
  bottomBar,
}: Props) {
  const [rightPanelTab, setRightPanelTab] = useState<'QUESTS' | 'INVENTORY'>('QUESTS');

  return (
    <div style={{
      width: '100vw', height: '100vh', 
      background: 'var(--color-dark-earth)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Absolute Top Bar Overlay */}
      {topBar}

      {/* Main Content Area (below top bar) */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        marginTop: topOffset,
        padding: '16px 16px 0 16px',
        gap: 16,
        minHeight: 0 // Crucial for flex scrolling children
      }}>
        
        {/* Left Panel: World Map */}
        <div style={{
          width: 280, flexShrink: 0,
          background: 'rgba(28,18,14,0.6)',
          border: '1px solid rgba(255,215,0,0.15)',
          borderRadius: '16px 16px 0 0',
          borderBottom: 'none',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column'
        }}>
          {leftPanel}
        </div>

        {/* Center Panel: Scene View */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          position: 'relative'
        }}>
          <div style={{
            flex: 1,
            borderRadius: '16px 16px 0 0',
            overflow: 'hidden',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,153,51,0.2)',
            borderBottom: 'none',
            background: 'var(--color-dark-surface)'
          }}>
            {centerPanel}
          </div>
        </div>

        {/* Right Panel: Quests / Inventory */}
        <div style={{
          width: 320, flexShrink: 0,
          background: 'rgba(28,18,14,0.6)',
          border: '1px solid rgba(255,215,0,0.15)',
          borderRadius: '16px 16px 0 0',
          borderBottom: 'none',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <button 
              onClick={() => setRightPanelTab('QUESTS')}
              style={{
                flex: 1, padding: '12px 0', background: 'transparent',
                border: 'none', borderBottom: rightPanelTab === 'QUESTS' ? '2px solid var(--color-saffron)' : '2px solid transparent',
                color: rightPanelTab === 'QUESTS' ? 'var(--color-saffron-light)' : 'var(--color-text-dim)',
                fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              📜 Quests
            </button>
            <button 
              onClick={() => setRightPanelTab('INVENTORY')}
              style={{
                flex: 1, padding: '12px 0', background: 'transparent',
                border: 'none', borderBottom: rightPanelTab === 'INVENTORY' ? '2px solid var(--color-gold)' : '2px solid transparent',
                color: rightPanelTab === 'INVENTORY' ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              🎒 Inventory
            </button>
          </div>
          
          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rightPanelTab === 'QUESTS' ? questPanel : inventoryPanel}
          </div>
        </div>

      </div>

      {/* Bottom Action Bar */}
      <div style={{ zIndex: 10 }}>
        {bottomBar}
      </div>

    </div>
  );
}
