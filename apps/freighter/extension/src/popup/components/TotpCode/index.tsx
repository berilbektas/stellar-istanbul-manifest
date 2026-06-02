import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { totp, secondsRemaining } from "popup/helpers/totp";

import "./styles.scss";

// STUB: backend (transporter) hazır olunca burayı /register'dan dönen secret ile
// değiştir; Base32 gelirse base32ToBytes(...) ile çöz. Görüntüleme/geri sayım aynı kalır.
const STUB_SECRET = new TextEncoder().encode("freighter-hackathon-stub-secret");

const STEP = 30;

// SVG halka geometrisi — rakamların görsel yüksekliğiyle eşleşecek şekilde
const RING_SIZE = 25;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface TotpCodeProps {
  secret?: Uint8Array;
  step?: number;
}

export const TotpCode = ({
  secret = STUB_SECRET,
  step = STEP,
}: TotpCodeProps) => {
  const { t } = useTranslation();
  const [code, setCode] = useState("------");
  const [remaining, setRemaining] = useState(step);
  const [copied, setCopied] = useState(false);
  const counterRef = useRef(-1);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Pencere resetlenirken halkanın geriye doğru süpürmesini engelle.
  const [animate, setAnimate] = useState(true);

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
        const next = await totp(secret, { step, now });
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
  }, [secret, step]);

  const dashOffset = RING_CIRCUMFERENCE * (1 - remaining / step);

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
                transition: animate
                  ? "stroke-dashoffset 1s linear"
                  : "none",
              }}
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
