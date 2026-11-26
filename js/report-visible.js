export const REPORT_BATCH_SIZE = 20;

export function visibleReportRows(requested, total) {
  return Math.min(Math.max(0, requested), Math.max(0, total));
}

export function nextReportRows(current, total) {
  return visibleReportRows(current + REPORT_BATCH_SIZE, total);
}
