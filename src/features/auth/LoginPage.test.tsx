import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import { LoginPage } from './LoginPage';

describe('LoginPage managed tokens', () => {
  it('does not generate or submit an empty token', () => {
    const onLogin = vi.fn(async () => undefined);
    renderWithSettings(<LoginPage onLogin={onLogin} error="" />);
    expect(screen.getByText('让想法自由分支')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '登录你的 ConvoSketchpad' })).toBeInTheDocument();
    expect(screen.queryByText('私人工作台')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '进入 ConvoSketchpad' });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form')!);
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/用户令牌由服务端管理员创建/)).toBeInTheDocument();
  });

  it('submits an administrator-provisioned token unchanged', async () => {
    const onLogin = vi.fn(async () => undefined);
    renderWithSettings(<LoginPage onLogin={onLogin} error="" />);
    fireEvent.change(screen.getByLabelText('用户令牌'), { target: { value: 'example-token' } });
    fireEvent.click(screen.getByRole('button', { name: '进入 ConvoSketchpad' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('example-token'));
    await waitFor(() => expect(screen.getByRole('button', { name: '进入 ConvoSketchpad' })).toBeEnabled());
  });
});
