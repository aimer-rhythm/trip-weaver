import { Button } from '../ui/Button';
import { Textarea } from '../ui/Field';
// 输入区：Enter 发送、Shift+Enter 换行；回答中可写下一条草稿，停止按钮独立控制当前轮次。
import { EditorIcon } from '../editor/EditorIcon';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  disabled: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
  stopping?: boolean;
  restoreDraft?: { text: string; key: number };
}

export function ChatInput({ disabled, sending, onSend, onStop, stopping, restoreDraft }: Props) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (restoreDraft) setText(restoreDraft.text); }, [restoreDraft]);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const resize = () => {
      if (!node.clientWidth) return;
      node.style.height = '0px';
      node.style.height = `${Math.max(44, Math.min(120, node.scrollHeight))}px`;
    };
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      resize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
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
    <div className="chat-input flex shrink-0 items-end gap-2 rounded-[28px] border border-solid border-white bg-[var(--color-editor-page-background-99)] p-2 shadow-[0_6px_18px_var(--color-editor-page-box-shadow-100)] focus-within:ring-2 focus-within:ring-brand/30">
      <Textarea
        ref={input}
        appearance="embedded"
        className="w-0 flex-1 resize-none overflow-y-auto leading-[1.6]"
        value={text}
        rows={1}
        maxLength={1000}
        disabled={disabled}
        placeholder="说说你想怎样调整行程…"
        aria-label="输入你的行程想法"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button className={`flex h-11 shrink-0 items-center justify-center rounded-full border-0 bg-gradient-to-br from-brand-light to-brand text-[16px] text-white shadow-[0_3px_10px_var(--color-editor-page-box-shadow-102)] disabled:from-brand-disabled disabled:to-brand-disabled-deep disabled:shadow-none ${sending ? 'min-w-16 px-3' : 'w-11 p-0'}`} variant="plain" type="button" disabled={sending ? stopping : !canSend} onClick={sending ? onStop : submit} aria-label={sending ? '停止回答' : '发送'}>
        {sending ? (stopping ? '停止中' : '停止') : <EditorIcon name="send" />}
      </Button>
    </div>
  );
}
