import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkspaceShell from './common/WorkspaceShell';
import { aesEncrypt } from '../engines/aes';
import { base64ToUint8, qAesEncryptWithKey } from '../engines/quantumAes';
import { sendMailService } from '../services/mailService';
import {
  getQkdPairSessionService,
  initiateQkdSessionService,
  reserveQkdChunkService,
  searchQkdPeersService,
} from '../services/qkdService';

function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  const email = (match?.[1] || raw).trim().toLowerCase();
  return email;
}

export default function ComposePage({ user, onLogout }) {
  const navigate = useNavigate();
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [composeForm, setComposeForm] = useState({
    to: '',
    subject: '',
    body: '',
    encryptAes: true,
    encryptQuantum: false,
    passphrase: '',
  });

  const sendMail = async () => {
    if (!composeForm.to.trim() || !composeForm.subject.trim() || !composeForm.body.trim()) {
      setComposeError('To, Subject, and Message are required.');
      return;
    }

    if (composeForm.encryptAes && composeForm.encryptQuantum) {
      setComposeError('Select only one encryption mode: AES or Quantum.');
      return;
    }

    if (composeForm.encryptAes && !composeForm.passphrase.trim()) {
      setComposeError('Passphrase is required for QuMail encryption.');
      return;
    }

    setComposeError('');
    setComposeLoading(true);
    try {
      let outboundBody = composeForm.body;
      if (composeForm.encryptAes) {
        const encrypted = await aesEncrypt(composeForm.body, composeForm.passphrase.trim());
        outboundBody = [
          'QuMail Encrypted Message',
          `Security-Level: ${encrypted.level}`,
          `Ciphertext(Base64): ${encrypted.ciphertext}`,
          `IV(Base64): ${encrypted.iv}`,
          `Salt(Base64): ${encrypted.salt}`,
          '',
          'Decrypt this message from QuMail mailbox view.',
        ].join('\n');
      } else if (composeForm.encryptQuantum) {
        const toEmail = extractEmailAddress(composeForm.to);
        const peerPayload = await searchQkdPeersService(user, toEmail, true);
        const peer = (peerPayload?.peers || []).find((item) => String(item.email || '').toLowerCase() === toEmail);
        if (!peer?.user_id) {
          throw new Error('Recipient is not currently active for QKD. Both users must be online now.');
        }

        const pair = await getQkdPairSessionService(user, peer.user_id);
        const session = pair?.session || await initiateQkdSessionService(user, peer.user_id, 100);
        const reserved = await reserveQkdChunkService(user, session.session_id, 32);
        const chunkB64 = reserved?.chunk_b64 || '';
        if (!chunkB64) {
          throw new Error('Unable to reserve QKD chunk from backend session.');
        }

        const encrypted = await qAesEncryptWithKey(composeForm.body, base64ToUint8(chunkB64));
        outboundBody = [
          'QuMail Encrypted Message',
          `Security-Level: ${encrypted.level}`,
          `Ciphertext(Base64): ${encrypted.ciphertext}`,
          `IV(Base64): ${encrypted.iv}`,
          `QKD-Key-Id: ${session.session_id}`,
          `QKD-Session-Id: ${session.session_id}`,
          `QKD-Offset: ${reserved.offset}`,
          `QKD-Size: ${reserved.chunk_size}`,
          '',
          'Decrypt this message from QuMail mailbox view.',
        ].join('\n');
      }

      await sendMailService(user, {
        to: composeForm.to.trim(),
        subject: composeForm.subject.trim(),
        body: outboundBody,
      });

      setComposeForm({
        to: '',
        subject: '',
        body: '',
        encryptAes: true,
        encryptQuantum: false,
        passphrase: '',
      });
      navigate('/sent');
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : 'Failed to send email.');
    } finally {
      setComposeLoading(false);
    }
  };

  const leftContent = (
    <div className="settings-box">
      <p>Compose your secure email in the right panel and send directly through connected Gmail.</p>
    </div>
  );

  const rightContent = (
    <div className="compose-card route-compose-card">
      <div className="compose-head">
        <h3>New Message</h3>
        <div className="encryption-options">
          <label className="quantum-toggle">
            <span>AES</span>
            <input
              type="checkbox"
              checked={composeForm.encryptAes}
              onChange={(event) => {
                const checked = event.target.checked;
                setComposeForm((prev) => ({
                  ...prev,
                  encryptAes: checked,
                  encryptQuantum: checked ? false : prev.encryptQuantum,
                }));
              }}
            />
          </label>
          <label className="quantum-toggle">
            <span>Quantum</span>
            <input
              type="checkbox"
              checked={composeForm.encryptQuantum}
              onChange={(event) => {
                const checked = event.target.checked;
                setComposeForm((prev) => ({
                  ...prev,
                  encryptQuantum: checked,
                  encryptAes: checked ? false : prev.encryptAes,
                }));
              }}
            />
          </label>
        </div>
      </div>

      <input placeholder="To" value={composeForm.to} onChange={(event) => setComposeForm((prev) => ({ ...prev, to: event.target.value }))} />
      <input placeholder="Subject" value={composeForm.subject} onChange={(event) => setComposeForm((prev) => ({ ...prev, subject: event.target.value }))} />
      {composeForm.encryptAes && (
        <input
          placeholder="Encryption passphrase"
          type="password"
          value={composeForm.passphrase}
          onChange={(event) => setComposeForm((prev) => ({ ...prev, passphrase: event.target.value }))}
        />
      )}
      <textarea placeholder="Write your message..." rows={9} value={composeForm.body} onChange={(event) => setComposeForm((prev) => ({ ...prev, body: event.target.value }))} />

      {composeError && <div className="inline-error">{composeError}</div>}

      <div className="compose-foot">
        <div className="compose-status">
          {composeForm.encryptAes
            ? 'AES mode active'
            : composeForm.encryptQuantum
              ? 'Quantum mode active'
              : 'Standard send mode'}
        </div>
        <button className="compose-send" onClick={sendMail} disabled={composeLoading}>{composeLoading ? 'Sending...' : 'Send'}</button>
      </div>
    </div>
  );

  return (
    <WorkspaceShell
      user={user}
      onLogout={onLogout}
      title="Compose"
      leftContent={leftContent}
      rightContent={rightContent}
    />
  );
}
