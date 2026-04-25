export type CategoryColorPreset = {
  id: string;
  label: string;
  /** Raw hex, used by code paths that need a concrete color (e.g. SVG strokes in analytics). */
  hex: string;
  iconClass: string;
  chipClass: string;
  cardClass: string;
  percentClass: string;
};

export const CATEGORY_COLOR_PRESETS: CategoryColorPreset[] = [
  {
    id: 'neutral',
    label: 'Нейтральный',
    hex: '#9ca3af', // gray-400
    iconClass: 'text-white/60',
    chipClass: 'bg-white/10 border-white/20 text-white',
    cardClass: 'border border-white/10 bg-white/5',
    percentClass: 'text-white/70',
  },
  {
    id: 'rose',
    label: 'Розовый',
    hex: '#fb7185', // rose-400
    iconClass: 'text-rose-300',
    chipClass: 'bg-rose-500/15 border-rose-400/40 text-rose-100',
    cardClass: 'border border-rose-400/30 bg-rose-500/5',
    percentClass: 'text-rose-200',
  },
  {
    id: 'amber',
    label: 'Жёлтый',
    hex: '#fbbf24', // amber-400
    iconClass: 'text-amber-300',
    chipClass: 'bg-amber-500/15 border-amber-400/40 text-amber-100',
    cardClass: 'border border-amber-400/30 bg-amber-500/5',
    percentClass: 'text-amber-200',
  },
  {
    id: 'emerald',
    label: 'Зелёный',
    hex: '#34d399', // emerald-400
    iconClass: 'text-emerald-300',
    chipClass: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100',
    cardClass: 'border border-emerald-400/30 bg-emerald-500/5',
    percentClass: 'text-emerald-200',
  },
  {
    id: 'sky',
    label: 'Синий',
    hex: '#38bdf8', // sky-400
    iconClass: 'text-sky-300',
    chipClass: 'bg-sky-500/15 border-sky-400/40 text-sky-100',
    cardClass: 'border border-sky-400/30 bg-sky-500/5',
    percentClass: 'text-sky-200',
  },
  {
    id: 'violet',
    label: 'Сиреневый',
    hex: '#a78bfa', // violet-400
    iconClass: 'text-violet-300',
    chipClass: 'bg-violet-500/15 border-violet-400/40 text-violet-100',
    cardClass: 'border border-violet-400/30 bg-violet-500/5',
    percentClass: 'text-violet-200',
  },
  {
    id: 'pink',
    label: 'Розово-фиолетовый',
    hex: '#f472b6', // pink-400
    iconClass: 'text-pink-300',
    chipClass: 'bg-pink-500/15 border-pink-400/40 text-pink-100',
    cardClass: 'border border-pink-400/30 bg-pink-500/5',
    percentClass: 'text-pink-200',
  },
];

/**
 * Resolve a stored "color" value to a concrete hex for rendering.
 * Accepts either a preset id (current format) or a literal `#hex` (legacy
 * analytics timers before unification with the category palette).
 */
export function resolveColorHex(color: string | null | undefined, fallback = CATEGORY_COLOR_PRESETS[0].hex): string {
  if (!color) return fallback;
  if (color.startsWith('#')) return color;
  return CATEGORY_COLOR_MAP[color]?.hex ?? fallback;
}

/**
 * Pick the first preset id not yet used by any other entry. Returns null if
 * all presets are taken.
 */
export function pickFirstFreePresetId(usedIds: Iterable<string | null | undefined>): string | null {
  const used = new Set<string>();
  for (const id of usedIds) {
    if (id && !id.startsWith('#')) used.add(id);
  }
  for (const preset of CATEGORY_COLOR_PRESETS) {
    if (!used.has(preset.id)) return preset.id;
  }
  return null;
}

export const CATEGORY_COLOR_MAP = CATEGORY_COLOR_PRESETS.reduce<
  Record<string, CategoryColorPreset>
>((acc, preset) => {
  acc[preset.id] = preset;
  return acc;
}, {});

export function getCategoryColorPreset(colorId?: string | null): CategoryColorPreset {
  if (!colorId) return CATEGORY_COLOR_PRESETS[0];
  return CATEGORY_COLOR_MAP[colorId] ?? CATEGORY_COLOR_PRESETS[0];
}

export const TAXONOMY_DROPDOWN_SELECTOR = '[data-taxonomy-dropdown="true"]';
export const MAX_EXTRA_TIMERS = 4;
export const TIMERS_CONFIG_KEY = 'microTaskTimers';
export const TIMERS_CONFIG_VERSION = 2;
