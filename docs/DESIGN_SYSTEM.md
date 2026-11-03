# IELTiva Design System

Standards for all frontend work. See it running at `/design-system`.

## Structure

| Location | Contents |
| --- | --- |
| `apps/web/src/app/globals.css` | Colour, type, radius and shadow tokens for both themes |
| `apps/web/src/components/ui/` | shadcn/ui primitives |
| `apps/web/src/components/brand/` | Logo, the only definition of the mark and name |
| `apps/web/src/components/layout/` | Providers, container, section, header, footer, theme toggle |
| `apps/web/src/components/motion/` | Reveal, stagger and hover effects |
| `apps/web/src/components/feedback/` | Band score, stat card, empty state |
| `apps/web/src/features/` | Feature code. `auth/` holds the session provider, route guards and sign-in forms |
| `apps/web/messages/` | Interface text per language |

## Rules

- **Colour:** use semantic tokens such as `bg-primary`, never raw colour values in components. Every token is defined for both themes.
- **Type:** Fraunces for headings and Inter for body and interface text.
- **Text:** product text goes in `messages/`. The internal design system page is exempt.
- **Layout:** design mobile first, using `Container` and `Section`. No page may scroll horizontally at 360px or wider.
- **Motion:** use the shared motion components, keep effects short, and don't animate anything essential to reading. `MotionConfig` respects the device's reduced-motion setting.
- **Accessibility:** target WCAG 2.1 AA. Every control needs a label, keyboard operation and visible focus. Automated checks catch only part of this, so test new flows by keyboard too.
- **Band scores:** always use `BandScore`. Its hidden state can't accept a score, which supports the rule that students never see unvalidated bands. The API remains the enforcing layer.

## Adding shadcn components

Run the CLI from `apps/web`. It currently generates `import { cn } from "cn"`, so change that to `@/lib/utils`, the project's single helper. Don't let the CLI overwrite `globals.css` tokens.

## Testing

Each new shared component needs a component test. New pages join the viewport and theme matrix in `apps/web/e2e/foundation.spec.ts`, which checks horizontal overflow, accessibility and console errors.
