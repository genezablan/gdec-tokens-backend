import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/**
 * Sanitizes user-authored rich HTML for Community posts.
 *
 * The frontend re-sanitizes on render (`src/utils/sanitize.js`), but the server
 * MUST sanitize on write too — never trust client HTML (docs/community.md §3.5).
 *
 * Allowed tags:  p br strong b em i u s ul ol li a code pre blockquote span
 * Allowed attrs: href target rel class, plus data-type/data-id/data-label on
 * span so inline @mention chips keep the user they point at.
 */
@Injectable()
export class CommunitySanitizerService {
  private readonly options: sanitizeHtml.IOptions = {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
      'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'class'],
      // An @mention is a <span class="mention" data-type="mention" data-id=…>.
      // Without these the chip survives as plain blue text that links nowhere.
      span: ['class', 'data-type', 'data-id', 'data-label'],
      '*': ['class'],
    },
    // Only safe link protocols; strips javascript:, data:, etc.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    // Force external links to be safe.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  };

  /** Sanitize rich HTML to the allowed tag/attr set. Returns '' for null/undefined. */
  sanitize(html?: string | null): string {
    if (!html) return '';
    return sanitizeHtml(html, this.options);
  }

  /**
   * Plain-text fallback (`body`) used for previews & search.
   * Strips ALL tags from the given HTML and collapses whitespace.
   */
  toPlainText(html?: string | null): string {
    if (!html) return '';
    const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
    return stripped.replace(/\s+/g, ' ').trim();
  }
}
