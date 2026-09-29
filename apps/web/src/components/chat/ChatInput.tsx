// 输入区：Enter 发送、Shift+Enter 换行；发送中禁用避免重复提交。
import { EditorIcon } from '../editor/EditorIcon';
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
    <div className={"chat-input flex [gap:8px] items-end [margin-top:10px] [&_textarea]:flex-1 [&_textarea]:[resize:vertical] [&_textarea]:[border:1px_solid_var(--color-border)] [&_textarea]:[border-radius:var(--radius)] [&_textarea]:[padding:8px_10px] [&_textarea]:[font:inherit] [&_textarea]:[font-size:0.9rem]"}>
      <textarea
        value={text}
        rows={1}
        maxLength={1000}
        disabled={disabled}
        placeholder="说说你想怎样调整行程…"
        aria-label="输入你的行程想法"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-primary [background:var(--color-primary)] [color:var(--color-btn-primary-color-3)] [&:not(:disabled):hover]:[background:var(--color-primary-dark)]"} disabled={!canSend} onClick={submit} aria-label={sending ? "思考中" : "发送"} title={sending ? "思考中" : "发送"}>
        <EditorIcon name="send" />
      </button>
    </div>
  );
}
