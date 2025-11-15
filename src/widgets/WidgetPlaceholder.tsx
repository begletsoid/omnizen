import clsx from 'clsx';

const accentMap = {
  green: 'from-emerald-500/20 to-emerald-400/5 border-emerald-500/40 text-emerald-200',
  amber: 'from-amber-500/20 to-amber-400/5 border-amber-500/40 text-amber-100',
  cyan: 'from-cyan-500/20 to-cyan-400/5 border-cyan-500/40 text-cyan-100',
  pink: 'from-pink-500/20 to-pink-400/5 border-pink-500/40 text-pink-100',
} as const;

export type WidgetPlaceholderProps = {
  title: string;
  description: string;
  accent?: keyof typeof accentMap;
};

export function WidgetPlaceholder({ title, description, accent = 'cyan' }: WidgetPlaceholderProps) {
  return (
    <section
      className={clsx(
        'glass-panel relative flex flex-col gap-3 border bg-gradient-to-b px-5 py-6 transition-colors',
        accentMap[accent],
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <span className="rounded-full border border-white/30 px-3 py-1 text-xs uppercase tracking-wide text-white/80">
          soon
        </span>
      </div>
      <p className="text-sm text-white/80">{description}</p>
      <span className="mt-auto text-xs uppercase tracking-[0.3rem] text-white/60">design placeholder</span>
    </section>
  );
}
