import { useEffect, useState } from 'react';
import './content-editors.css';

type PreviewResult = { value: string; html: string } | { value: string; error: true };

export function TextBlockEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  useEffect(() => {
    if (!preview) return;
    let current = true;
    void import('./markdown-preview')
      .then(({ markdownHtml }) => {
        if (current) setResult({ value, html: markdownHtml(value) });
      })
      .catch(() => {
        if (current) setResult({ value, error: true });
      });
    return () => {
      current = false;
    };
  }, [preview, value]);
  const rendered = result?.value === value ? result : null;

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
        rendered && 'html' in rendered ? (
          <article
            className="markdown-preview"
            aria-label="Markdown preview"
            onAuxClick={(event) => event.preventDefault()}
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest('a')) event.preventDefault();
            }}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        ) : (
          <div className="markdown-preview" role={rendered ? 'alert' : 'status'}>
            {rendered ? 'Preview is unavailable. Switch to Edit to keep working.' : 'Loading preview…'}
          </div>
        )
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
