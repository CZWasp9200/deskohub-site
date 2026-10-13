---
name: deskohub-workspace-administration
description: Workspace admin dashboard, /admin pages, administration API, dhw CLI, CLI sessions, operator cancellation and refunds, access recovery, standalone access codes, invoices, discount codes, vouchers, sales administration.
---

# Deskohub Workspace administration

Read the reference that matches the change:

- [references/dashboard.md](references/dashboard.md): `/admin` rendering, data sources, reservation and customer projections, cancellation and refund state, access recovery, standalone access codes, and history.
- [references/discounts.md](references/discounts.md): discount, code, voucher, audience, and claim mutations.
- [references/dhw-cli.md](references/dhw-cli.md): the shared administration API contract, `dhw` authentication, confirmation, retries, configuration, checks, and releases.

Always apply these rules:

- Route the Admin UI, administration API, and `dhw` through the same application services and schemas so all three enforce the same validation.
- Keep page loads read-only. Mutate only inside an explicit operator workflow, such as cancellation, access recovery, or a discount change.
- Read the business specifications before changing operator-visible policy: [administration](../../../apps/deskohub-workspace/docs/administration-dashboard.md), [discounts](../../../apps/deskohub-workspace/docs/discount-codes.md), and [`dhw`](../../../apps/dhw/README.md).
