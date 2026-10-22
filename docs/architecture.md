# HZ Labs Architecture

HZ Labs is a separated monorepo with a public portfolio frontend and a backend CMS/API.

## Runtime

- Frontend: Next.js App Router, TypeScript, Tailwind CSS, shadcn-style primitives, React Query, React Hook Form, Zod, Framer Motion-ready.
- Backend: NestJS, Prisma, PostgreSQL, JWT access tokens, refresh-token rotation, Swagger, Cloudinary, GitHub API.
- Hosting: Vercel for `frontend/`, Render for `backend/`, Supabase for PostgreSQL.

## Data Flow

1. Public pages fetch `/profile`, `/skills`, `/projects`, `/blogs`, `/resume/latest`, and `/github/summary`.
2. Admin login calls `/auth/login` and stores access/refresh tokens in browser storage for CMS requests.
3. Admin CMS writes to `/admin/*` endpoints protected by `JwtAuthGuard`.
4. Cloudinary upload happens through `/admin/uploads`, keeping credentials backend-only.
5. GitHub sync runs from `/admin/github/sync`, stores snapshots, and creates approval suggestions.

## Phase 2

CV parsing and AI-assisted drafts should be implemented as suggestion producers that write to `SyncSuggestion` and require admin approval.
