import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function markdownHtml(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { async: false, breaks: true, gfm: true }), {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_ATTR: ['srcset', 'style'],
    FORBID_TAGS: [
      'audio',
      'base',
      'button',
      'embed',
      'form',
      'iframe',
      'img',
      'input',
      'object',
      'picture',
      'source',
      'style',
      'title',
      'track',
      'video',
    ],
    USE_PROFILES: { html: true },
  });
}
