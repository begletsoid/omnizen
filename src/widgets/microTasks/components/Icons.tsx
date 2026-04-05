export function TagIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 7.5V6a3 3 0 0 1 3-3h4.5a3 3 0 0 1 2.12.88l7.5 7.5a3 3 0 0 1 0 4.24l-4.5 4.5a3 3 0 0 1-4.24 0l-7.5-7.5A3 3 0 0 1 3 7.5Z" />
      <path d="M7 8h.01" />
    </svg>
  );
}

export function SaveIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 3h10l4 4v14H3V3h4z" />
      <path d="M7 3v6h10V7" />
      <path d="M7 21v-7h10v7" />
    </svg>
  );
}

export function ArchiveIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M5 7v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
      <path d="M3 7l2-3h14l2 3" />
      <path d="M10 11h4" />
    </svg>
  );
}
