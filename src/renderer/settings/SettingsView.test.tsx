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

  it('keeps local agent access off until the workspace toggle is enabled', () => {
    const onAgentAccessChange = vi.fn();
    render(<SettingsView activeCategory="Workspace" onAgentAccessChange={onAgentAccessChange} />);
    const toggle = screen.getByTestId('agent-access-toggle');
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Allow local agent access')).toBeInTheDocument();
    expect(screen.getAllByText(/127\.0\.0\.1:17384\/mcp/).length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(onAgentAccessChange).toHaveBeenCalledWith({ enabled: true });
  });
});
