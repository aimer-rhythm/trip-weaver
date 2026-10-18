import { useEffect, useState } from 'react';
import type { EmailCodePurpose } from '@tripweaver/shared';
import { useSendEmailCode } from '../api/hooks';
import { Button } from './ui/Button';
import { Input } from './ui/Field';

/** 重发倒计时：与服务端 RESEND_INTERVAL_MS（60 秒）对齐 */
const COUNTDOWN_SECONDS = 60;

/**
 * 邮箱验证码输入 + 获取按钮（10-18）。
 * 注册页与找回密码页共用；purpose 决定验证码用途，两种用途的码互不通用。
 */
export function EmailCodeField({ email, purpose, value, onChange, disabled }: {
  email: string;
  purpose: EmailCodePurpose;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const send = useSendEmailCode();
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const request = () => {
    setError('');
    setNote('');
    const target = email.trim();
    if (!target) {
      setError('请先填写邮箱');
      return;
    }
    send.mutate({ email: target, purpose }, {
      onSuccess: () => {
        setSeconds(COUNTDOWN_SECONDS);
        setNote('验证码已发送，请查收邮件（10 分钟内有效）');
      },
      onError: (err) => setError(err.message),
    });
  };

  const waiting = seconds > 0;
  return (
    <div className="flex flex-col [gap:5px] [font-size:0.88rem] [color:var(--color-muted)]">
      <label className="flex flex-col [gap:5px]">
        邮箱验证码
        <span className="flex items-center [gap:8px]">
          <Input
            className="min-w-0 flex-1"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={value}
            onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
          />
          <Button
            variant="secondary"
            type="button"
            className="shrink-0 whitespace-nowrap"
            disabled={disabled || waiting}
            onClick={request}
          >
            {send.isPending ? '发送中…' : waiting ? `${seconds}s 后重发` : '获取验证码'}
          </Button>
        </span>
      </label>
      {note && <p className="m-0 [font-size:0.82rem] text-brand">{note}</p>}
      {error && <p role="alert" className="m-0 [font-size:0.82rem] [color:var(--color-danger)]">{error}</p>}
    </div>
  );
}
