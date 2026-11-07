# Workspace improvements — 2026-11-07

Status: implementation prepared; final local tests and UI verification interrupted by disconnected execution environment. Do not deploy this branch before completing the checks below.

## Implemented
- Inventory summary view, on-demand movement history, inactive-positive and 30/60/90-day inactivity filters, inactive badges, per-user session filter and scroll restoration.
- Add a color using an existing material's classification/name/unit/description without reusing its image.
- Purchases/sales review quick date ranges, movement versus entry date, item thumbnails, print/save PDF.
- Monthly reconciliation search/group filters, per-user local draft and live difference display.
- Atomic optimistic order-line editing for draft/confirmed orders.
- Administrator-only operation history, immutable to app clients, with before/after snapshots.
- Shared control styles and synchronized cache versions.

## Database state
Applied migration: 20261107195605_inventory_summary_order_edit_and_audit.sql.
Rollback transaction tests in tests/workspace-improvements.sql passed: edit quantities, stale edit rejection, empty lines rejection, pending-sale rejection, balances, audit snapshots, audit immutability and viewer denial. Live inventory balances matched legacy sums (zero mismatches).
Pending: supabase/pending/reject_unknown_order_status_edit.sql. Apply through migration tool and record actual migration version. Confirmation expired; this fix has NOT been applied. It rejects NULL/unknown order status explicitly.

## Remaining validation
1. Review changes, run JS syntax checks and node tests (local test command result unavailable after disconnect).
2. Add regression coverage for the new stock filters and audit permissions; verify UI element references and imports.
3. Browser check inventory/history, monthly draft restore, copy-color, order editor, movement dates, print layout, audit page, mobile controls.
4. Check Supabase security advisories and validate pending status fix.
5. Update main only after successful validation, then confirm Pages deployment.
6. Verify no new main changes since parent c2f788896dd88950f2bd295390e826b7a88e9b44 before merging.

All database mutation tests were rolled back. Audit logging begins at activation and does not reconstruct historical actors. Drafts are local to the user's device.
