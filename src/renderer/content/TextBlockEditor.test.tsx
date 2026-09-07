import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TextBlockEditor } from './TextBlockEditor';

afterEach(cleanup);

it('edits markdown directly and autofocuses the body field', () => {
  const onChange = vi.fn();
  render(<TextBlockEditor value="Initial note" onChange={onChange} />);

  const input = screen.getByRole('textbox', { name: 'Markdown' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Updated note' } });
  expect(onChange).toHaveBeenCalledWith('Updated note');
});

it('renders sanitized Markdown in preview without a title field', () => {
  render(
    <TextBlockEditor
      value={
        '# Heading\n\n[Safe](https://example.test)\n\n![remote](https://example.test/image.png)\n\n<script>window.bad = true</script>'
      }
      onChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  const preview = screen.getByRole('article', { name: 'Markdown preview' });
  expect(preview).toHaveTextContent('Heading');
  expect(preview.querySelector('a')).toHaveAttribute('href', 'https://example.test');
  expect(preview.querySelector('script')).toBeNull();
  expect(preview.querySelector('img')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});
