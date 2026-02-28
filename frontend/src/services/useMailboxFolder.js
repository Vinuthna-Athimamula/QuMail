import { useEffect, useMemo, useState } from 'react';
import { syncAndGetMessagesService } from './mailService';

export function useMailboxFolder(user, folder) {
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedMessage = useMemo(
    () => messages.find((message) => message.gmail_message_id === selectedId) || messages[0] || null,
    [messages, selectedId],
  );

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await syncAndGetMessagesService(user, folder);
      const nextMessages = payload?.messages || [];
      setMessages(nextMessages);
      setSelectedId(nextMessages[0]?.gmail_message_id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mailbox messages.');
      setMessages([]);
      setSelectedId('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, folder]);

  return {
    messages,
    selectedMessage,
    setSelectedId,
    loading,
    error,
    refresh,
  };
}
