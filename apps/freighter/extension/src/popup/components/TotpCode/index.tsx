import React, { useEffect, useState } from "react";
import { CopyText } from "@stellar/design-system";
import { useTranslation } from "react-i18next";

import { getRegistration } from "background/transporter/storage";
import { totpCode, totpSecondsRemaining } from "background/transporter/totp";

import "./styles.scss";

/**
 * Wallet MCP pairing code (manifest §7 Flow A.4).
 *
 * Shows the rotating 6-digit TOTP code for the active account, derived from the
 * `totpSecret` the transporter bridge stored at registration. The user reads it
 * and types it into the agent's `setup_wallet`. Renders nothing until the
 * account has been registered with a transporter.
 */
interface TotpCodeProps {
  publicKey: string;
}

export const TotpCode = ({ publicKey }: TotpCodeProps) => {
  const { t } = useTranslation();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("------");
  const [remaining, setRemaining] = useState(30);

  // Load (and keep polling for) this account's transporter registration. The
  // bridge registers on boot, which may land shortly after this view mounts.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const registration = await getRegistration(publicKey);
      if (active) {
        setSecret(registration?.totpSecret ?? null);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [publicKey]);

  // Tick the code + countdown once a second.
  useEffect(() => {
    if (!secret) {
      return undefined;
    }
    let active = true;
    const tick = async () => {
      const next = await totpCode(secret);
      if (active) {
        setCode(next);
        setRemaining(totpSecondsRemaining());
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [secret]);

  if (!secret) {
    return null;
  }

  return (
    <div className="TotpCode" data-testid="totp-code">
      <div className="TotpCode__label">{t("Wallet MCP pairing code")}</div>
      <div className="TotpCode__code-row">
        <CopyText textToCopy={code} doneLabel={t("Copied!")}>
          <span className="TotpCode__code" data-testid="totp-code-value">
            {code}
          </span>
        </CopyText>
        <span className="TotpCode__countdown">{remaining}s</span>
      </div>
      <div className="TotpCode__hint">
        {t(
          "Enter this in the agent's setup_wallet to pair. Rotates every 30s.",
        )}
      </div>
    </div>
  );
};
