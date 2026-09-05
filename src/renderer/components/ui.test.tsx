import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './ui';

describe('UI primitives', () => {
  it('renders an accessible action and responds to click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Copy AI context</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy AI context' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
