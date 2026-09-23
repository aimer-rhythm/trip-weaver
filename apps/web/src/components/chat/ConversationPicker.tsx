// 历史对话选择器：换设备/换标签页后回到某次未完成的对话。
import type { Conversation } from '@tripweaver/shared';
import { conversationSummary } from '../../lib/chatDerive';
import { Modal } from '../Modal';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function ConversationPicker({ conversations, activeId, loading, onSelect, onDelete, onClose }: Props) {
  return (
    <Modal title="历史对话" onClose={onClose}>
      {loading && <p className="muted">加载中…</p>}
      {!loading && conversations.length === 0 && <p className="muted">还没有对话。关上这个窗口说一句话就能开始。</p>}

      <ul className="chat-conv-list">
        {conversations.map((conversation) => (
          <li key={conversation.id} className={conversation.id === activeId ? 'is-active' : ''}>
            <button type="button" className="chat-conv-main" onClick={() => onSelect(conversation.id)}>
              <span className="chat-conv-title">{conversation.title}</span>
              <span className="muted">{conversationSummary(conversation.brief)}</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`删除对话 ${conversation.title}`}
              onClick={() => onDelete(conversation.id)}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
