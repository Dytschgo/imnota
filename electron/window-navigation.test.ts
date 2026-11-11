import { describe, expect, it, vi } from 'vitest';
import { preventForeignNavigation } from './window-navigation.js';

describe('main app navigation', () => {
  it.each(['file:///C:/Program%20Files/Imnota/resources/app.asar/dist/index.html', 'http://localhost:5173/'])(
    'allows recovery to reload its existing document: %s',
    (currentUrl) => {
      const event = { url: currentUrl, preventDefault: vi.fn() };
      preventForeignNavigation(event, currentUrl);
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://example.invalid/',
    'http://localhost:5173/other',
    'file:///C:/Users/fixture/private.txt',
    'file:///C:/app/index.html?redirect=https://example.invalid',
    'file:///C:/app/index.html/other',
    'file:///C:/app/index.html.evil',
    'data:text/html,<script>alert(1)</script>',
    'javascript:alert(1)',
    'about:blank',
    '',
  ])('blocks a different target without broadening same-origin or path prefixes: %s', (url) => {
    const event = { url, preventDefault: vi.fn() };
    preventForeignNavigation(event, 'file:///C:/app/index.html');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('fails closed before main has established a document', () => {
    const event = { url: '', preventDefault: vi.fn() };
    preventForeignNavigation(event, '');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('preserves fragments within the configured app document', () => {
    const event = { url: 'file:///C:/app/index.html#section', preventDefault: vi.fn() };
    preventForeignNavigation(event, 'file:///C:/app/index.html');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not grant reload of another file after a renderer history change', () => {
    const event = { url: 'file:///C:/app/foreign.html#section', preventDefault: vi.fn() };
    preventForeignNavigation(event, 'file:///C:/app/index.html');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([
    ['file:///C:/Users/DYLANF~1/app/index.html', 'file:///C:/Users/DYLANF%7E1/app/index.html'],
    ['file:///C:/Users/DYLANF%7E1/app/index.html', 'file:///C:/Users/DYLANF~1/app/index.html'],
    ['file:///C:/app/caf%c3%a9/index.html', 'file:///C:/app/caf%C3%A9/index.html'],
  ])('allows the configured file with equivalent URL escaping: %s', (url, trusted) => {
    const event = { url, preventDefault: vi.fn() };
    preventForeignNavigation(event, trusted);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    'file:///C:/Users/DYLANF~1/app/private.html',
    'file:///C:/Users/DYLANF~1/app/index.html?reload=true',
    'file://foreign/C:/Users/DYLANF~1/app/index.html',
    'file:///C:/Users/DYLANF%257E1/app/index.html',
    'file:///C:/Users/DYLANF~1/app%2Findex.html',
    'file:///C:/Users/DYLANF~1/app%5Cindex.html',
    'file:///C:/Users/DYLANF~1/app/%FFindex.html',
  ])('keeps foreign or ambiguous file targets blocked: %s', (url) => {
    const event = { url, preventDefault: vi.fn() };
    preventForeignNavigation(event, 'file:///C:/Users/DYLANF%7E1/app/index.html');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
