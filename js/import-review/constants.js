export const MATCH_STATUS = {
  EXACT: "exact_match",
  SUGGESTED: "suggested_match",
  MANUAL: "manual_match",
  UNKNOWN: "unknown",
  DUPLICATE: "duplicate_warning",
};

export const BATCH_STATUS = {
  DRAFT: "draft",
  PARTIAL: "partially_approved",
  APPROVED: "approved",
  CANCELLED: "cancelled",
};

export const MATCH_CONFIG = {
  suggestionThreshold: 0.72,
  colorCodeWeight: 0.25,
  colorNameWeight: 0.15,
  itemNameWeight: 0.6,
};
