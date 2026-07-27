# Mindcraft Dashboard Design System

## 1. Atmosphere & Identity

Mindcraft is a practical, dark control surface for operating Minecraft agents: compact operational information, clear recovery actions, and familiar game-adjacent status colors. Its signature is a layered charcoal surface with blue for connection/start actions, green for healthy progress, amber for waiting or caution, and red for destructive or failed states.

## 2. Color

### Palette

| Role | Token | Dark value | Usage |
|---|---|---:|---|
| Page | `--surface-page` | `#1a1a1a` | Page background |
| Panel | `--surface-panel` | `#2d2d2d` | Agent container, footer, modal |
| Raised | `--surface-raised` | `#363636` | Agent cards |
| Field | `--surface-field` | `#262626` | Text inputs |
| Text primary | `--text-primary` | `#ffffff` | Headings and actionable text |
| Text | `--text-default` | `#e0e0e0` | Body copy |
| Text muted | `--text-muted` | `#aaaaaa` | Secondary state and last-message text |
| Border | `--border-default` | `#555555` | Inputs and controls |
| Accent | `--accent-primary` | `#2196F3` | Start and setup actions |
| Accent hover | `--accent-hover` | `#1976D2` | Hovered start actions |
| Success | `--status-success` | `#4CAF50` | In-game and ready status |
| Warning | `--status-warning` | `#d29922` | Waiting, blocked, and health caution |
| Error | `--status-error` | `#f44336` | Failed, remove, and disconnect actions |

### Rules

- Color communicates lifecycle state; do not use status colors decoratively.
- New dashboard UI uses these tokens rather than adding raw colors.
- Preserve the existing dark surface hierarchy; any future visual consolidation must migrate existing inline colors separately.

## 3. Typography

### Scale

| Level | Size | Weight | Usage |
|---|---:|---:|---|
| Page title | 32px | 700 | Dashboard title |
| Section title | 24px | 700 | Modal headings |
| Body | 16px | 400 | Default text |
| Small | 14px | 400 | Controls and metadata |
| Caption | 12px | 400 | Status and diagnostic copy |

### Font Stack

- Primary: `Arial, sans-serif`
- Mono: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### Rules

- Body text stays at or above 12px only for compact status labels; interactive body copy stays at or above 14px.
- Errors and recovery guidance use clear, literal wording rather than icon-only communication.

## 4. Spacing & Layout

### Base Unit

All new spacing uses a 4px base: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, and `--space-6` 24px.

### Grid

- Dashboard page inset: 20px.
- Agent details: responsive CSS grid with a 260px minimum card width.
- Forms: responsive grid with a 320px minimum field width.
- At narrow widths, controls may wrap but never clip their labels or status text.

## 5. Components

### Agent Card
- **Structure**: title/status row, telemetry grid, optional details, lifecycle controls.
- **Variants**: ready/in-game, connecting, blocked, failed, stopped.
- **Spacing**: `--space-2` internal gaps; `--space-3` card padding.
- **States**: lifecycle state is textual and color-supported; blocked/failed cards expose the sanitized failure reason and a recovery action.
- **Accessibility**: buttons use visible text, disabled actions remain legible, diagnostic text is not color-only.
- **Motion**: none required; lifecycle updates replace content without decorative animation.

### Lifecycle Action
- **Structure**: a visible-text button paired with short outcome feedback.
- **Variants**: Connect, Retry, Restart, Connecting, Unavailable.
- **States**: enabled only when the backend has a valid action; callback errors are shown inline on the card.
- **Accessibility**: native button semantics, disabled state, and keyboard activation.

### Health Banner
- **Structure**: concise heading plus one line per problem.
- **States**: hidden when healthy; warning when configuration or reachability is incomplete.
- **Accessibility**: text contains the issue and next action; warning color is supplementary.

## 6. Motion & Interaction

- Existing controls use instant state changes; do not add decorative motion for lifecycle feedback.
- Hover, focus, active, and disabled states are required for new interactive controls.
- Respect `prefers-reduced-motion` if a future component adds motion.

## 7. Depth & Surface

### Strategy

Mixed dark tonal-shift with restrained borders and shadows.

- Panels use `--surface-panel`; cards use `--surface-raised`; inputs use `--surface-field`.
- Existing modals retain the project shadow treatment; new lifecycle elements stay within their parent card and do not add elevation.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA: visible keyboard focus, 4.5:1 body-text contrast, explicit text for blocked/failed states, and no color-only status.
- Recovery actions must describe whether they connect, retry preflight, or restart a process.
- Health and agent failure output must remain sanitized: never display settings, keys, provider URLs, or raw exception objects.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Existing inline dashboard styles and non-semantic decorative glyphs | `src/mindcraft/public/index.html` | Pre-existing surface; this lifecycle pass preserves the current look rather than redesigning it. | Replace during a dedicated dashboard modernization with visual QA. |
| No production browser visual-audit harness | Repository-wide | The current application has no packaged browser test runner. | Add a dedicated harness before any visual redesign. |
