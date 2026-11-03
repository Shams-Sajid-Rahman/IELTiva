# IELTiva Design System

Standards for all frontend work. See it running at `/design-system`.

## Structure

| Location | Contents |
| --- | --- |
| `apps/web/src/app/globals.css` | Colour, type, radius and shadow tokens for both themes |
| `apps/web/src/components/ui/` | shadcn/ui primitives |
| `apps/web/src/components/brand/` | Logo, the only definition of the mark and name |
| `apps/web/src/components/layout/` | Providers, container, section, header, footer, theme toggle |
| `apps/web/src/components/motion/` | Reveal, stagger, hover effects and animated numbers |
| `apps/web/src/components/feedback/` | Band score, stat card, empty state, progress ring |
| `apps/web/src/features/` | Feature code. `auth/` holds the session provider, route guards and sign-in forms. `platform/` holds the dashboard shell, shared data views, and student and admin pages. `marketing/` holds the public site's interactive sections. `exam/` holds the exam interface preview |
| `apps/web/messages/` | Interface text per language |

## Rules

- **Colour:** use semantic tokens such as `bg-primary`, never raw colour values in components. Every token is defined for both themes.
- **Brand:** Midnight Navy `#101D3A` is the main brand colour, used for text and large brand surfaces (`bg-brand-surface`). Royal Blue `#2458D3` is the action colour, used through `primary`. Soft Blue `#8DB5FF` is the accent, Cloud White `#F5F7FC` the background and Success Green `#19B58A` the success colour. Text on light surfaces uses a darker green token, because the brand green fails contrast there. On brand surfaces, use the `onBrand` and `onBrandOutline` button variants and the `on-brand` text colours.
- **Type:** Manrope for headings and Inter for body and interface text.
- **Text:** product text goes in `messages/`. The internal design system page is exempt.
- **Layout:** design mobile first, using `Container` and `Section`. No page may scroll horizontally at 360px or wider.
- **Motion:** use the shared motion components, keep effects short, and don't animate anything essential to reading. `MotionConfig` respects the device's reduced-motion setting. Motion hides transforms but not every property, so chart and scroll-linked effects also check `useReducedMotion`. `AnimatedNumber` always renders the real final value first, so it's correct without JavaScript.
- **Touch:** controls grow on touch screens through `pointer-coarse:` variants. Keep targets at least 40px high there.
- **Honest content:** never add invented testimonials, student counts, prices or scores. Testimonials stay hidden until `features/marketing/testimonials.ts` holds real, approved quotes. Areas with no data yet say so, and show no placeholder figures.
- **Accessibility:** target WCAG 2.1 AA. Every control needs a label, keyboard operation and visible focus. Automated checks catch only part of this, so test new flows by keyboard too.
- **Band scores:** always use `BandScore`. Its hidden state can't accept a score, which supports the rule that students never see unvalidated bands. The API remains the enforcing layer.

## Data views

Use `QueryBoundary` for loading, error and ready states, `Empty` for empty states, `Pagination`, `TableFrame` for tables that scroll inside their own region, and `ConfirmButton` for sensitive actions. `TableFrame` with `cards` and `CardCell` turns a table into labelled cards on phones. If sorting lives in the header, add a sort control for phones too. Charts show one hue per series, with a screen-reader table of the same numbers. Hide that table through an `sr-only` wrapper, because browsers ignore `sr-only` size limits on a table itself.

## Exam interface preview

`/practice/preview/[skill]` shows the Listening, Reading, Writing and Speaking screens with original sample content. It's interface only: answers stay in memory, nothing is sent, marked or scored, and the microphone is never used. The site's `Permissions-Policy` still blocks the microphone, and Speaking will need that changed deliberately when recording is built.

## Adding shadcn components

Run the CLI from `apps/web`. It currently generates `import { cn } from "cn"`, so change that to `@/lib/utils`, the project's single helper. Don't let the CLI overwrite `globals.css` tokens.

## Testing

Each new shared component needs a component test. New pages join the viewport and theme matrix in `apps/web/e2e/foundation.spec.ts`, which checks horizontal overflow, accessibility and console errors. To capture screenshots for a design review, run `VISUAL_SHOTS=<folder> npx playwright test visual` from `apps/web`. They go to `docs/screenshots/frontend-upgrade/<folder>`.
