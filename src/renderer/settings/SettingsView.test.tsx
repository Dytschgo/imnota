import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';

vi.mock('../components/UpdateControl', () => ({ UpdateControl: () => null }));

afterEach(cleanup);

describe('SettingsView category navigation', () => {
  it('starts on Appearance and keeps its own category when uncontrolled', () => {
    render(<SettingsView />);
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
  });

  it('uses the controlled category restored by navigation and reports category selections', () => {
    const onCategoryChange = vi.fn();
    const { rerender } = render(
      <SettingsView activeCategory="Sharing" onCategoryChange={onCategoryChange} />,
    );
    expect(screen.getByRole('button', { name: 'Sharing' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(onCategoryChange).toHaveBeenCalledWith('Appearance');
    expect(screen.getByRole('button', { name: 'Sharing' })).toHaveAttribute('aria-current', 'page');

    rerender(<SettingsView activeCategory="Appearance" onCategoryChange={onCategoryChange} />);
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps beta MCP access off until its feature toggle is enabled', () => {
    const onAgentAccessChange = vi.fn();
    render(<SettingsView activeCategory="Features" onAgentAccessChange={onAgentAccessChange} />);
    const toggle = screen.getByTestId('agent-access-toggle');
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Allow local agent access')).toBeInTheDocument();
    expect(screen.getAllByText(/127\.0\.0\.1:17384\/mcp/).length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(onAgentAccessChange).toHaveBeenCalledWith({ enabled: true });
  });

  it('offers one agent-agnostic MCP setup prompt instead of editor-specific snippets', async () => {
    const copyText = vi.fn(async () => {});
    window.imnota = { copyText } as unknown as typeof window.imnota;
    render(<SettingsView activeCategory="Features" />);
    const section = screen.getByRole('region', { name: 'MCP access Beta' });
    expect(section).not.toHaveTextContent(/Claude|Cursor/);
    const prompt = screen.getByTestId('agent-access-prompt').textContent ?? '';
    expect(prompt).toContain('http://127.0.0.1:17384/mcp');
    expect(prompt).toContain('--mcp');
    expect(prompt).toContain('mcpServers');
    for (const tool of [
      'list_projects',
      'list_collection_items',
      'get_latest_bundle',
      'get_item',
      'search_saved_text',
    ])
      expect(prompt).toContain(tool);
    expect(prompt).toContain('Allow local agent access');
    expect(prompt).not.toMatch(/Claude|Cursor/);

    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(prompt);
  });

  it('replays what’s new from Updates & about', () => {
    const onReplayWhatsNew = vi.fn();
    render(
      <SettingsView
        activeCategory="Updates & about"
        updateStatus={{ state: 'idle', currentVersion: '0.2.8', channel: 'stable' }}
        onReplayWhatsNew={onReplayWhatsNew}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replay what’s new' }));
    expect(onReplayWhatsNew).toHaveBeenCalledOnce();
  });
});
