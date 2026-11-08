# Workspace improvements — 2026-11-07

Implemented inventory summary loading and on-demand history; inactive/idle filters; filter restoration; add-color shortcut; review date filters, thumbnails and print; monthly reconciliation local drafts and filters; atomic order-line editing; administrator operation history.

Applied database migrations:

- 20261107195605_inventory_summary_order_edit_and_audit.sql
- 20261107205640_reject_unknown_order_status_edit.sql

Validation: all 49 Node tests pass, JavaScript syntax checks pass, and rollback SQL tests pass for order editing, stale/empty/unsupported-state rejection, inventory balances, audit snapshots/immutability and viewer restrictions. Summary balances match legacy sums. No new security advisories were introduced.

Browser visual verification was unavailable in the execution environment. Audit starts at activation; local drafts are per account and device. Existing historical operations are not reconstructed.
