import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('semantic typography class merging', () => {
  const sizes = ['micro', 'caption', 'body-sm', 'body', 'body-lg', 'field', 'title', 'title-lg', 'metric'];
  it.each(sizes)('%s keeps the semantic foreground color', size => {
    expect(cn('text-[color:var(--btn-primary-text)]', `text-${size}`))
      .toBe(`text-[color:var(--btn-primary-text)] text-${size}`);
    expect(cn(`text-${size}`, 'text-status-danger')).toBe(`text-${size} text-status-danger`);
  });
  it('overriding a size preserves the button foreground', () => {
    expect(cn('text-[color:var(--btn-primary-text)] text-body-lg', 'text-micro'))
      .toBe('text-[color:var(--btn-primary-text)] text-micro');
  });
});
