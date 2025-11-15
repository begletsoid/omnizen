# Tech Context

- **Frontend Stack**: Vite, React 18, TypeScript, Zustand (UI), React Query (server state), @dnd-kit, TailwindCSS + CSS vars (dark theme).
- **Backend/BaaS**: Supabase (Postgres + Storage + Auth) через `@supabase/supabase-js`.
- **Auth**: Google OAuth в Supabase; включить провайдера и указать Netlify домены в redirect.
- **Deployment**: Netlify, `netlify.toml` фиксирует `command = "npm run build"` и `publish = "dist"`. CI от пушей в `master`.
- **Инструменты разработки**:
  - Supabase CLI (`npx supabase login`, `supabase link`, `supabase migration new`, `supabase db push`).
  - ESLint + Prettier.
  - Vitest + React Testing Library + MSW.
- **Конфигурации**:
  - `.env` (dev) содержит `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; `.env.example` коммитим.
  - Netlify env vars для продакшена.
  - Supabase CLI конфиг и миграции храним в `supabase/`.
