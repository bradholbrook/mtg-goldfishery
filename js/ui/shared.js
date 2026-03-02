/**
 * Shared utilities and constants used across ui/* modules.
 */

export const TYPE_COLORS = {
  Land:         '#a0845c',
  Creature:     '#4ade80',
  Instant:      '#60a5fa',
  Sorcery:      '#c084fc',
  Artifact:     '#94a3b8',
  Enchantment:  '#fbbf24',
  Planeswalker: '#f87171',
  Battle:       '#fb923c',
  MDFC:         '#818cf8',
  Other:        '#6b7280',
  Unknown:      '#6b7280',
};

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(isoString).toLocaleDateString();
}
