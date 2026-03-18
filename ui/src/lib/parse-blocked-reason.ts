/**
 * Parses raw blocked-reason strings into structured items for display.
 *
 * Blocked reasons arrive in several formats from the worker:
 *  1. Severity-tagged: "[HIGH] scope: Too broad; [MEDIUM] acceptance: Missing criteria"
 *  2. Semicolon-delimited context needs: "which DB table?; what auth method?"
 *  3. Simple strings: "Checks failed after inline fix attempt"
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface BlockedItem {
  severity: Severity;
  field: string | null;
  message: string;
}

export type BlockCategory =
  | 'needs_context'
  | 'checks_failed'
  | 'quality_failed'
  | 'spec_issues'
  | 'implementation_blocked'
  | 'unknown';

export interface ParsedBlockedReason {
  category: BlockCategory;
  categoryLabel: string;
  items: readonly BlockedItem[];
}

const SEVERITY_PATTERN = /^\[(\w+)\]\s*/;
const FIELD_PATTERN = /^([a-zA-Z_-]+):\s*/;

function parseSeverity(raw: string): Severity {
  switch (raw.toUpperCase()) {
    case 'CRITICAL': return 'critical';
    case 'HIGH': return 'high';
    case 'MEDIUM': return 'medium';
    case 'LOW': return 'low';
    default: return 'info';
  }
}

function parseItem(raw: string): BlockedItem {
  let remaining = raw.trim();
  if (!remaining) return { severity: 'info', field: null, message: '' };

  // Try to extract [SEVERITY]
  let severity: Severity = 'info';
  const sevMatch = SEVERITY_PATTERN.exec(remaining);
  if (sevMatch) {
    severity = parseSeverity(sevMatch[1]);
    remaining = remaining.slice(sevMatch[0].length);
  }

  // Try to extract field:
  let field: string | null = null;
  const fieldMatch = FIELD_PATTERN.exec(remaining);
  if (fieldMatch) {
    field = fieldMatch[1];
    remaining = remaining.slice(fieldMatch[0].length);
  }

  return { severity, field, message: remaining.trim() };
}

function detectCategory(reason: string): { category: BlockCategory; label: string } {
  const lower = reason.toLowerCase();

  if (lower.includes('needs additional context') || lower.includes('need') && lower.includes('context')) {
    return { category: 'needs_context', label: 'Needs Context' };
  }
  if (lower.includes('checks failed') || lower.includes('inline fix')) {
    return { category: 'checks_failed', label: 'Checks Failed' };
  }
  if (lower.includes('code quality') || lower.includes('quality review')) {
    return { category: 'quality_failed', label: 'Quality Review Failed' };
  }
  if (SEVERITY_PATTERN.test(reason)) {
    return { category: 'spec_issues', label: 'Spec Issues' };
  }
  if (lower.includes('blocked') || lower.includes('cannot proceed') || lower.includes('conflicting')) {
    return { category: 'implementation_blocked', label: 'Implementation Blocked' };
  }
  return { category: 'unknown', label: 'Blocked' };
}

export function parseBlockedReason(reason: string): ParsedBlockedReason {
  const { category, label } = detectCategory(reason);

  // Split on semicolons (the worker joins multiple items with '; ')
  const parts = reason.split(/;\s*/).filter(Boolean);

  const items = parts.map(parseItem).filter(item => item.message.length > 0);

  // If nothing parsed (shouldn't happen), fall back to full string
  if (items.length === 0) {
    return {
      category,
      categoryLabel: label,
      items: [{ severity: 'info', field: null, message: reason }],
    };
  }

  return { category, categoryLabel: label, items };
}
