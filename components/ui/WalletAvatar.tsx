'use client';

/**
 * WalletAvatar — deterministic SVG avatar for a wallet address.
 *
 * Renders a rounded gradient tile with 1-2 initial letters. Both the
 * gradient hue and the initials are derived from the display name (if
 * provided) or the address suffix. Same input → same avatar, always
 * — so a user's tile is recognizable across sessions without ever
 * hitting an image server.
 *
 * Design: iOS-family palette (blue, teal, green, orange, purple, pink),
 * soft gradient, white bold initials. Sized via the `size` prop; renders
 * as a square div with the given px dimension.
 */

import React from 'react';

interface Props {
  /** Wallet address — used as the deterministic seed when no name is set. */
  address?: string | null;
  /** Optional display name — takes precedence over address for initials + hue. */
  name?: string | null;
  /** Rendered size in px (square). Default 32. */
  size?: number;
  /** Extra classes for positioning / border etc. */
  className?: string;
}

// iOS-family gradient stops — desaturated enough to sit under white text
// at any size without contrast issues.
const GRADIENTS = [
  ['#0A84FF', '#5AC8FA'], // ios blue → cyan
  ['#00A79F', '#34C759'], // hedera teal → green
  ['#FF9500', '#FFCC00'], // orange → yellow
  ['#AF52DE', '#FF2D55'], // purple → pink
  ['#5856D6', '#0A84FF'], // indigo → blue
  ['#34C759', '#00A79F'], // green → teal
  ['#FF3B30', '#FF9500'], // red → orange
  ['#BF5AF2', '#5E5CE6'], // magenta → violet
];

function hashString(s: string): number {
  // Fast deterministic hash — enough entropy for palette selection + rotation.
  // Not cryptographic; identicon-only.
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return Math.abs(h);
}

function initials(name: string | null | undefined, address: string | null | undefined): string {
  if (name && name.trim().length > 0) {
    // Take first letter of each word, up to 2 letters. e.g. "Ashish Regmi" → "AR"
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0].toUpperCase();
  }
  if (address && address.length >= 4) {
    // Use characters 2-3 of the address (skip "0x"). Guarantees 2 hex chars.
    return address.slice(2, 4).toUpperCase();
  }
  return '?';
}

export function WalletAvatar({ address, name, size = 32, className = '' }: Props) {
  const seed = (name || address || '').toLowerCase();
  const hash = hashString(seed);
  const [c1, c2] = GRADIENTS[hash % GRADIENTS.length];
  const angle = hash % 360;
  const chars = initials(name, address);
  const fontSize = Math.max(9, Math.round(size * 0.42));

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full font-bold text-white flex-shrink-0 select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize,
        background: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
        lineHeight: 1,
      }}
      aria-label={name ? `${name}'s avatar` : `Avatar for ${address ?? 'unknown wallet'}`}
      title={name || address || ''}
    >
      {chars}
    </div>
  );
}
