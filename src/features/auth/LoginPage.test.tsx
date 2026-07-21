import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

describe('LoginPage managed tokens', () => {
  it('does not generate or submit an empty token', () => {
    const onLogin = vi.fn(async () => undefined);
    render(<LoginPage onLogin={onLogin} error="" />);
    const button = screen.getByRole('button', { name: 'Enter Nerve' });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form')!);
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/created by the server administrator/i)).toBeInTheDocument();
  });

  it('submits an administrator-provisioned token unchanged', async () => {
    const onLogin = vi.fn(async () => undefined);
    render(<LoginPage onLogin={onLogin} error="" />);
    fireEvent.change(screen.getByLabelText('User Token'), { target: { value: 'example-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter Nerve' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('example-token'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enter Nerve' })).toBeEnabled());
  });
});
