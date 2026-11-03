# IELTiva

An AI-assisted IELTS preparation platform, launching first in Bangladesh and designed for international use.

> **Status: Phase 1, frontend foundation.** Only the design system and frontend architecture are being built, so there's no product to use yet.

IELTiva isn't affiliated with or endorsed by the IELTS partners. Any AI band scores will be estimates, and they won't be shown publicly until validated against human-marked samples.

## Releases

| Release | Scope |
| --- | --- |
| 1 | Public website, authentication, student dashboard, Listening and Reading practice, AI Writing Assessment, basic mock tests, prepaid packages and payments |
| 2 | AI Speaking Assessment, AI IELTS Tutor, personalized study plans, advanced analytics |
| 3 | Advanced AI calibration, more learning content, international payments, performance optimization |

## Documents

| Document | Contents |
| --- | --- |
| [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) | System design, AI service, band gate, verified IELTS facts, decisions |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | Entities, relationships, calibration data, retention |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Proposed REST API |
| [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Releases, phases and parallel tracks |
| [.env.example](.env.example) | Planned environment variables |

## Planned stack

| Layer | Technology |
| --- | --- |
| Web | Next.js, React, TypeScript, Tailwind CSS (port 3000) |
| API and worker | Node.js, Express, TypeScript, BullMQ (port 5000) |
| Data | PostgreSQL, Prisma, Redis |
| Storage | Private Cloudflare R2 buckets |
| AI | Claude through a configurable AI service: Sonnet default, Opus complex, Haiku light |
| Speech | Azure AI Speech, under trial for Release 2 |
| Payments | SSLCommerz behind a gateway interface |

## Requirements for development

IELTiva requires **Node.js 24.22.1 or a newer 24.x release and npm 11.19.1 or newer**, as set in `package.json`, `.nvmrc` and `.node-version`. `.npmrc` makes npm refuse other Node versions in this project.

Later phases also need PostgreSQL 18 and Docker for local Redis, and speaking features need ffmpeg.

### Isolated Node 24 on Windows

Node 24 doesn't need to replace your system Node, so other projects are unaffected.

1. Download `node-v24.22.1-win-x64.zip` from [nodejs.org](https://nodejs.org/dist/v24.22.1/) and check it against `SHASUMS256.txt`.
2. Extract it to `%LOCALAPPDATA%\IELTiva-tools`, so that `%LOCALAPPDATA%\IELTiva-tools\node-v24.22.1-win-x64\node.exe` exists.
3. Run this in each new PowerShell terminal. It affects that terminal only:

```powershell
. .\scripts\use-node.ps1
```

### Run the frontend

```powershell
npm install
npm run dev
```

Open http://localhost:3000, and http://localhost:3000/design-system for the component reference. That page is off in production builds unless `DESIGN_SYSTEM_ENABLED=true` is set at build time.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check types |
| `npm run lint` | Check code style |
| `npm test` | Component tests |
| `npm run build` | Production build |
| `npm run test:e2e` | Browser, responsive and accessibility tests. Build first with `DESIGN_SYSTEM_ENABLED=true`. Uses installed Chrome, and updates `docs/screenshots/phase-1` |

See [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) for frontend standards.
