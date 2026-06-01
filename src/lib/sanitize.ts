import DOMPurify from 'dompurify';

export function sanitizeHTML(html: string): TrustedHTML {
  return DOMPurify.sanitize(html) as unknown as TrustedHTML;
}
