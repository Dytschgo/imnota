import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TextBlockEditor } from './TextBlockEditor';

const previewControl = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('./markdown-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./markdown-preview')>();
  return {
    markdownHtml(value: string) {
      previewControl.calls += 1;
      if (previewControl.fail) throw new Error('Preview unavailable');
      return actual.markdownHtml(value);
    },
  };
});
afterEach(() => {
  cleanup();
  previewControl.fail = false;
  previewControl.calls = 0;
});

it('keeps relative numbered links while stripping executable link schemes', async () => {
  render(
    <TextBlockEditor
      value={'[Relative](diagram2.md)\n\n<a href="javascript:alert(1)">Unsafe</a>'}
      onChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByText('Relative')).toHaveAttribute('href', 'diagram2.md');
  expect(screen.getByText('Unsafe')).not.toHaveAttribute('href');
});

it('edits markdown directly and autofocuses the body field', () => {
  const onChange = vi.fn();
  render(<TextBlockEditor value="Initial note" onChange={onChange} />);

  const input = screen.getByRole('textbox', { name: 'Markdown' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Updated note' } });
  expect(onChange).toHaveBeenCalledWith('Updated note');
  expect(previewControl.calls).toBe(0);
});

it('renders sanitized Markdown in preview without a title field', async () => {
  render(
    <TextBlockEditor
      value={
        '# Heading\n\n[Safe](https://example.test)\n\n![remote](https://example.test/image.png)\n\n<script>window.bad = true</script>'
      }
      onChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  const preview = await screen.findByRole('article', { name: 'Markdown preview' });
  expect(preview).toHaveTextContent('Heading');
  expect(preview.querySelector('a')).toHaveAttribute('href', 'https://example.test');
  expect(preview.querySelector('script')).toBeNull();
  expect(preview.querySelector('img')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('keeps the note editable if preview rendering fails', async () => {
  previewControl.fail = true;
  const onChange = vi.fn();
  render(<TextBlockEditor value="# Saved note" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Switch to Edit');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const input = screen.getByRole('textbox', { name: 'Markdown' });
  expect(input).toHaveValue('# Saved note');
  fireEvent.change(input, { target: { value: 'Still editable' } });
  expect(onChange).toHaveBeenCalledWith('Still editable');
});

it('previews the latest note after leaving a pending preview', async () => {
  const view = render(<TextBlockEditor value="# Old note" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  view.rerender(<TextBlockEditor value="# Latest note" onChange={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Markdown' })).toHaveValue('# Latest note');
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByRole('heading', { name: 'Latest note' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Old note' })).not.toBeInTheDocument();
});
