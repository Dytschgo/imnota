import { describe, expect, it } from 'vitest';
import {
  formatTerminalHandoff,
  quoteTerminalPath,
  terminalHandoffSummary,
  terminalSafeLine,
  toWslPath,
} from '../terminal-handoff';

const markdown = [
  '# Checkout flow',
  '',
  'Bundle 1 of 2',
  '',
  '## Picture 1 — Login page',
  '',
  'Priority for agent: High',
  '',
  '## Drawing 2 — Layout sketch',
  '',
].join('\n');

const windowsMd =
  'C:\\Users\\Dylan Example\\Imnota\\Shop\\collections\\001-checkout\\exports\\Checkout - 261010-120000\\Checkout - 261010-120000 - 01.md';
const windowsPng = windowsMd.replace(/\.md$/, '.png');

describe('terminal hand-off', () => {
  it('summarises the collection, bundle position and picture titles in at most three lines', () => {
    expect(terminalHandoffSummary(markdown)).toEqual([
      'Imnota: Checkout flow (bundle 1 of 2)',
      '2 pictures: Login page; Layout sketch',
      'Read the Markdown for the annotated feedback; view the PNG for the marked-up screenshots.',
    ]);
    expect(terminalHandoffSummary('# Notes only\r\n\r\nBundle 1 of 1\r\n')[1]).toBe(
      'Text only, no pictures.',
    );
    const many = [
      '# Many',
      ...Array.from({ length: 6 }, (_, index) => `## Picture ${index + 1} — Shot ${index + 1}`),
    ];
    expect(terminalHandoffSummary(many.join('\n'))[1]).toBe(
      '6 pictures: Shot 1; Shot 2; Shot 3; Shot 4; +2 more',
    );
  });

  it('quotes Windows paths with double quotes and keeps backslashes and spaces literal', () => {
    expect(
      formatTerminalHandoff({ markdownPath: windowsMd, pngPath: windowsPng, markdown, style: 'windows' }),
    ).toBe(
      [
        'Imnota: Checkout flow (bundle 1 of 2)',
        '2 pictures: Login page; Layout sketch',
        'Read the Markdown for the annotated feedback; view the PNG for the marked-up screenshots.',
        `Markdown: "${windowsMd}"`,
        `Image: "${windowsPng}"`,
      ].join('\n'),
    );
  });

  it('translates Windows drive and WSL share paths for a WSL shell', () => {
    expect(toWslPath('C:\\Users\\Dylan Example\\a b.md')).toBe('/mnt/c/Users/Dylan Example/a b.md');
    expect(toWslPath('d:/Work/x.png')).toBe('/mnt/d/Work/x.png');
    expect(toWslPath('\\\\?\\E:\\Long\\path.md')).toBe('/mnt/e/Long/path.md');
    expect(toWslPath('\\\\wsl$\\Ubuntu\\home\\dylan\\x.md')).toBe('/home/dylan/x.md');
    expect(toWslPath('\\\\wsl.localhost\\Debian\\srv\\y.png')).toBe('/srv/y.png');
    expect(toWslPath('\\\\server\\share\\z.md')).toBeNull();
    const text = formatTerminalHandoff({
      markdownPath: windowsMd,
      pngPath: windowsPng,
      markdown,
      style: 'windows',
      wsl: true,
    });
    expect(text).toContain(
      "Markdown: '/mnt/c/Users/Dylan Example/Imnota/Shop/collections/001-checkout/exports/Checkout - 261010-120000/Checkout - 261010-120000 - 01.md'",
    );
    expect(text).not.toContain('\\');
  });

  it('refuses a WSL variant it cannot translate instead of copying a broken path', () => {
    expect(() =>
      formatTerminalHandoff({ markdownPath: '\\\\nas\\team\\a.md', markdown, style: 'windows', wsl: true }),
    ).toThrow(/network path/);
    expect(() =>
      formatTerminalHandoff({ markdownPath: '/home/u/a.md', markdown, style: 'posix', wsl: true }),
    ).toThrow(/only offered on Windows/);
  });

  it('single-quotes POSIX paths, escaping embedded single quotes, and omits a missing PNG', () => {
    expect(quoteTerminalPath("/Users/dy/It's here/a.md", 'posix')).toBe("'/Users/dy/It'\\''s here/a.md'");
    const text = formatTerminalHandoff({
      markdownPath: '/home/dy/My Shots/a.md',
      markdown: '# T',
      style: 'posix',
    });
    expect(text.split('\n').at(-1)).toBe("Markdown: '/home/dy/My Shots/a.md'");
    expect(text).not.toContain('Image:');
  });

  it('never carries control sequences or a trailing newline into the terminal', () => {
    const hostile = '# Evil\u001b[2J\u0007 title\u202e\n\n## Picture 1 — run\rrm -rf ~\n';
    const text = formatTerminalHandoff({
      markdownPath: '/tmp/a\u001b]0;x\u0007.md',
      markdown: hostile,
      style: 'posix',
    });
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f\u202e]/);
    expect(text.endsWith('\n')).toBe(false);
    expect(terminalSafeLine('x'.repeat(400))).toHaveLength(160);
  });
});
