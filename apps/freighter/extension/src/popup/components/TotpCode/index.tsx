import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";

import { getRegistration } from "background/transporter/storage";
import { publicKeySelector } from "popup/ducks/accountServices";
import { base32ToBytes, secondsRemaining, totp } from "popup/helpers/totp";

import "./styles.scss";

const STEP = 30;

// SVG halka geometrisi — rakamların görsel yüksekliğiyle eşleşecek şekilde
const RING_SIZE = 25;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface TotpCodeProps {
  /**
   * Override the secret (raw bytes). When omitted, the active account's
   * transporter pairing secret (set by the bridge at /register) is used —
   * manifest §7 Flow A.4. Renders nothing until that secret exists.
   */
  secret?: Uint8Array;
  step?: number;
}

export const TotpCode = ({ secret, step = STEP }: TotpCodeProps) => {
  const { t } = useTranslation();
  const activePublicKey = useSelector(publicKeySelector);
  const [fetchedSecret, setFetchedSecret] = useState<Uint8Array | undefined>(
    undefined,
  );
  const [code, setCode] = useState("------");
  const [remaining, setRemaining] = useState(step);
  const [copied, setCopied] = useState(false);
  const counterRef = useRef(-1);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Pencere resetlenirken halkanın geriye doğru süpürmesini engelle.
  const [animate, setAnimate] = useState(true);

  // Load the real pairing secret for the active account from the transporter
  // registration (base32 → bytes). Poll: it may land shortly after mount.
  useEffect(() => {
    if (secret) {
      return undefined;
    }
    let active = true;
    const load = async () => {
      const registration = activePublicKey
        ? await getRegistration(activePublicKey)
        : undefined;
      if (active) {
        setFetchedSecret(
          registration?.totpSecret
            ? base32ToBytes(registration.totpSecret)
            : undefined,
        );
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [secret, activePublicKey]);

  const effectiveSecret = secret ?? fetchedSecret;

  const handleCopy = async () => {
    if (code.includes("-")) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard erişimi yoksa sessizce geç
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!effectiveSecret) {
      return undefined;
    }
    let active = true;
    counterRef.current = -1;

    const tick = async () => {
      const now = Date.now();
      const nextRemaining = secondsRemaining(step, now);

      setRemaining((prev) => {
        // remaining arttıysa yeni pencere başladı → bu kareye geçiş animasyonu uygulama
        setAnimate(nextRemaining <= prev);
        return nextRemaining;
      });

      // Kodu yalnızca 30sn'lik pencere değişince yeniden hesapla
      const c = Math.floor(now / 1000 / step);
      if (c !== counterRef.current) {
        const next = await totp(effectiveSecret, { step, now });
        if (active) {
          setCode(next);
          counterRef.current = c;
        }
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [effectiveSecret, step]);

  const dashOffset = RING_CIRCUMFERENCE * (1 - remaining / step);

  // Not paired with a transporter yet → nothing to show.
  if (!effectiveSecret) {
    return null;
  }

  return (
    <div className="TotpCode">
      <div className="TotpCode__label">{t("Pairing code")}</div>
      <div className="TotpCode__row">
        <div
          className="TotpCode__digits"
          title={t("Copy")}
          onClick={handleCopy}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleCopy();
            }
          }}
        >
          {copied ? (
            <span className="TotpCode__copied" key="copied">
              {t("Copied!")}
            </span>
          ) : (
            <span key="code">
              {code.slice(0, 3)} {code.slice(3)}
            </span>
          )}
        </div>
        <div className="TotpCode__timer">
          <svg width={RING_SIZE} height={RING_SIZE} className="TotpCode__ring">
            <circle
              className="TotpCode__ring-track"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <circle
              className="TotpCode__ring-progress"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{
                transition: animate ? "stroke-dashoffset 1s linear" : "none",
              }}
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
