# Design specification

The primary screen uses a restrained developer-tool aesthetic: a charcoal navigation rail, warm near-white workspace, terracotta action color, open account rows, thin dividers, and minimal elevation. The account list remains the dominant surface; secondary activity and security information should never compete with switching.

The generated concept in `docs/design/claude-switcher-concept.png` is a visual reference, not a runtime asset. All shipped UI is native React, HTML, CSS, and SVG iconography.

## Tokens

- workspace: `#f8f7f4`
- paper: `#fbfaf8`
- sidebar: `#20201f`
- text: `#242321`
- muted text: `#77736e`
- border: `#ddd9d3`
- accent: `#d85b32`
- success: `#327c4b`

## Accessibility

- Controls have visible names or tooltips.
- State is communicated by text in addition to color.
- Motion honors `prefers-reduced-motion`.
- The minimum window size prevents the account table from becoming unusable.

## Fidelity ledger

The implementation was compared with the generated concept at a 1440 × 900 browser viewport.

| Area | Concept evidence | Render evidence | Result |
| --- | --- | --- | --- |
| App shell | dark top bar and left navigation | same two-axis shell and proportions | matched |
| Palette | charcoal, near-white, terracotta, green | token values applied consistently | matched |
| Account hierarchy | summary followed by open account rows | summary and table remain the primary content | matched |
| Add flow | right-side account panel | right-side modal with alias and safe authentication choices | matched with functional copy |
| Typography | strong uppercase page title and compact control labels | corresponding hierarchy is preserved | matched |
| Privacy cue | local-only message at lower left | same placement and meaning | matched |
| Activity | secondary section under accounts | real local events replace the concept's empty state | intentional functional improvement |

The concept proposed an API-key action and credential export. The MVP intentionally omits both: plaintext API-key activation would weaken the security model, and portable credential export needs passphrase-based authenticated encryption. These are documented roadmap items rather than inert controls.

Above-the-fold copy differs only where required by the working product: the renderer adds “Local account manager,” a one-line Accounts description, the alias field, and explicit capture/login safety language. It replaces the concept's generic import/API-key choices with operations the MVP can execute safely. Navigation, page title, primary action, CLI status, active-account labels, privacy note, and cancel action are preserved.
