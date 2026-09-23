// 输入区：Enter 发送、Shift+Enter 换行；发送中禁用避免重复提交。
import { useState, type KeyboardEvent } from 'react';

interface Props {
  disabled: boolean;
  sending: boolean;
  onSend: (text: string) => void;
}

export function ChatInput({ disabled, sending, onSend }: Props) {
  const [text, setText] = useState('');
  const canSend = !disabled && !sending && text.trim().length > 0;

  const submit = () => {
    const value = text.trim();
    if (!value || !canSend) return;
    onSend(value);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="chat-input">
      <textarea
        value={text}
        rows={2}
        maxLength={1000}
        disabled={disabled}
        placeholder="用一句话说说你的行程想法，例如：11月去成都玩3天，带2岁小孩"
        aria-label="输入你的行程想法"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="btn btn-primary" disabled={!canSend} onClick={submit}>
        {sending ? '思考中…' : '发送'}
      </button>
    </div>
  );
}
