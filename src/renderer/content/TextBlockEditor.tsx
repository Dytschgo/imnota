import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, useState } from 'react';
import './content-editors.css';

function markdownHtml(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { async: false, breaks: true, gfm: true }), {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
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

export function TextBlockEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState(false);
  const html = useMemo(() => markdownHtml(value), [value]);

  return (
    <section className="text-block-editor" data-content-editor="text" aria-label="Markdown editor">
      <div className="text-block-editor-bar">
        <span>Markdown</span>
        <div className="text-block-editor-toggle" role="group" aria-label="Editor mode">
          <button
            className={!preview ? 'is-active' : undefined}
            type="button"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            Edit
          </button>
          <button
            className={preview ? 'is-active' : undefined}
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
        </div>
      </div>
      {preview ? (
        <article
          className="markdown-preview"
          aria-label="Markdown preview"
          onAuxClick={(event) => event.preventDefault()}
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest('a')) event.preventDefault();
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <textarea
          className="markdown-input"
          aria-label="Markdown"
          data-testid="markdown-input"
          autoFocus
          spellCheck
          placeholder="Write notes in Markdown…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </section>
  );
}
