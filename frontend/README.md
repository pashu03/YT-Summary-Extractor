# Frontend

Next.js (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui.

See the [project README](../README.md) for setup, configuration and deployment.

```bash
npm install
npm run dev        # http://localhost:3000 (expects the API on http://localhost:4000)
npm run build      # production build
npm test           # unit tests for formatting and export helpers
npm run lint
```

Set `NEXT_PUBLIC_API_URL` (see `.env.example`) when the API is not on `http://localhost:4000`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Root layout, the single page, global styles and theme tokens |
| `src/components/` | Link form, progress, error and video panels, landing sections |
| `src/components/results/` | The four dashboard tabs |
| `src/components/ui/` | shadcn/ui primitives |
| `src/hooks/use-transcript.ts` | State for one request: progress, result, error, cancel |
| `src/lib/api.ts` | Streaming API client and PDF request |
| `src/lib/exporters.ts` | TXT, SRT and VTT generation and file download |
| `src/types/api.ts` | API types, mirrored from `backend/src/types.ts` |
