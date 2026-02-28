import { useEffect, useState } from 'react';
import WorkspaceShell from './common/WorkspaceShell';
import { useMailboxFolder } from '../services/useMailboxFolder';
import { hydrateMessageService } from '../services/mailService';
import {
  buildEmailHtmlDoc,
  decodeHtmlEntities,
  decryptQuMailMessage,
  getAvatarLetter,
  getMessageHtmlBody,
  getMaskedPreviewBody,
  getMessagePreviewBody,
  getProtectedBodyPlaceholder,
  getSenderDisplayName,
  getSenderLine,
  parseQuMailEncryptedPayload,
} from '../services/qumailCryptoService';

function formatTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function DraftsPage({ user, onLogout }) {
  const { messages, selectedMessage, setSelectedId, loading, error, refresh } = useMailboxFolder(user, 'DRAFT');
  const [decrypting, setDecrypting] = useState(false);
  const [decryptedBody, setDecryptedBody] = useState('');
  const [decryptError, setDecryptError] = useState('');
  const [decryptPassphrase, setDecryptPassphrase] = useState('');
  const [hydratedMessage, setHydratedMessage] = useState(null);

  useEffect(() => {
    setDecrypting(false);
    setDecryptedBody('');
    setDecryptError('');
    setDecryptPassphrase('');
    setHydratedMessage(null);
  }, [selectedMessage?.gmail_message_id]);

  const activeMessage = hydratedMessage?.gmail_message_id === selectedMessage?.gmail_message_id
    ? hydratedMessage
    : selectedMessage;

  const quMailPayload = parseQuMailEncryptedPayload(activeMessage);
  const richHtmlBody = getMessageHtmlBody(activeMessage);

  useEffect(() => {
    let cancelled = false;
    const maybeHydrate = async () => {
      if (!selectedMessage?.gmail_message_id) {
        return;
      }
      const isEncrypted = parseQuMailEncryptedPayload(selectedMessage).isEncrypted;
      const hasHtml = Boolean(getMessageHtmlBody(selectedMessage));
      if (isEncrypted || hasHtml) {
        return;
      }
      try {
        const payload = await hydrateMessageService(user, selectedMessage.gmail_message_id);
        if (!cancelled && payload?.message) {
          setHydratedMessage(payload.message);
        }
      } catch {
        return;
      }
    };
    maybeHydrate();
    return () => {
      cancelled = true;
    };
  }, [selectedMessage?.gmail_message_id, user]);

  const decryptSelectedMessage = async () => {
    if (!selectedMessage) {
      return;
    }
    setDecryptError('');
    setDecrypting(true);
    const result = await decryptQuMailMessage(activeMessage, user, decryptPassphrase.trim());
    if (result.success) {
      setDecryptedBody(result.plaintext || '');
    } else {
      setDecryptError(result.error || 'Failed to decrypt message.');
    }
    setDecrypting(false);
  };

  const leftContent = (
    <>
      {error && <div className="inline-error">{error}</div>}
      <div className="mail-list">
        {loading && <div className="loading-text">Loading messages...</div>}
        {!loading && messages.length === 0 && <div className="loading-text">No draft messages found.</div>}
        {!loading && messages.map((message) => (
          <button
            key={message.gmail_message_id}
            className={`mail-item ${selectedMessage?.gmail_message_id === message.gmail_message_id ? 'active' : ''}`}
            onClick={() => setSelectedId(message.gmail_message_id)}
          >
            <div className="mail-item-top">
              <strong>{getSenderDisplayName(message)}</strong>
              <span>{formatTime(message.internal_ts)}</span>
            </div>
            <div className="mail-subject">{decodeHtmlEntities(message.subject) || '(No Subject)'}</div>
            <div className="mail-snippet">{getMaskedPreviewBody(message)}</div>
          </button>
        ))}
      </div>
    </>
  );

  const rightContent = selectedMessage ? (
    <>
      <div className="detail-header">
        <h2>{decodeHtmlEntities(activeMessage.subject) || '(No Subject)'}</h2>
      </div>
      <div className="detail-meta">
        <div className="avatar-dot">{getAvatarLetter(activeMessage)}</div>
        <div>
          <strong>{getSenderLine(activeMessage)}</strong>
          <p>{formatTime(activeMessage.internal_ts)}</p>
        </div>
      </div>
      {quMailPayload.isEncrypted && (
        <div className="decrypt-row">
          {quMailPayload.requiresPassphrase && (
            <input
              className="decrypt-input"
              type="password"
              placeholder="Enter passphrase"
              value={decryptPassphrase}
              onChange={(event) => setDecryptPassphrase(event.target.value)}
            />
          )}
          <button className="mini-btn" onClick={decryptSelectedMessage} disabled={decrypting}>
            {decrypting ? 'Decrypting...' : 'Decrypt'}
          </button>
          <span className="loading-text">
            {quMailPayload.requiresPassphrase ? 'QuMail AES message' : 'QuMail encrypted message'}
          </span>
        </div>
      )}
      {decryptError && <div className="inline-error">{decryptError}</div>}
      {decryptedBody ? (
        <article className="mail-body">{decryptedBody}</article>
      ) : (!quMailPayload.isEncrypted && richHtmlBody) ? (
        <iframe
          className="mail-html-frame"
          title="Email content"
          srcDoc={buildEmailHtmlDoc(richHtmlBody)}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
        />
      ) : (
        <article className="mail-body">{quMailPayload.isEncrypted ? getProtectedBodyPlaceholder(activeMessage) : getMessagePreviewBody(activeMessage)}</article>
      )}
    </>
  ) : (
    <div className="loading-text">Select a draft to view details.</div>
  );

  return (
    <WorkspaceShell
      user={user}
      onLogout={onLogout}
      title="Drafts"
      onRefresh={refresh}
      leftContent={leftContent}
      rightContent={rightContent}
    />
  );
}
