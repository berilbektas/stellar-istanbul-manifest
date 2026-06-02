# Wallet MCP — Remote Signer for Agentic Payments

> **1Password for agent payments: agents ask, you approve, and your keys never leave your wallet.**

> **Bu doküman bağımsızdır.** Hiçbir önceki konuşma bağlamı varsayılmaz; bütün terimler, kararlar, gerekçeler, API kontratları ve dış kütüphane gerçekleri aşağıda tanımlıdır. Stellar hackathonu için; teslim: **yarın akşam 18:00**.
> **Teknik gerçekler (paket adları, facilitator URL'leri, Freighter API'si, AWS AMD SEV-SNP attestation) resmî dokümanlardan doğrulanmıştır (Haziran 2026).** Tek açık kalan nokta Bölüm 16'da işaretlidir.

---

## 0. TL;DR

AI agent'ları, kullanıcının private key'ini hiçbir zaman ele geçirmeden on-chain ödeme (x402) ve genel Stellar işlemi yapabilsin diye yazılan bir **remote signer** sistemi. Agent bir ödeme/imza isteği ürettiğinde, istek kullanıcının **kendi cüzdanına** (forklanmış Freighter extension) düşer; kullanıcı kendi eliyle onaylar; agent işine devam eder. Private key sadece cüzdanda durur — agent'a, MCP'ye, transporter'a veya resource server'a hiçbir zaman değmez.

Üç parça yazıyoruz: **(1) Wallet MCP** (agent host'unda), **(2) Transporter** (AWS'te bir **AMD SEV-SNP** confidential VM'inde çalışan relay servisi), **(3) Forklanmış Freighter** (private key + onay UI). Demoda dördüncü olarak basit bir **mock Twitter x402 MCP** örnek client görevi görür.

---

## 1. Sözlük (Glossary)

- **MCP (Model Context Protocol):** Anthropic'in açık standardı. Bir AI agent'a (örn. Claude Desktop) dışarıdan "tool" (fonksiyon) ve kaynak sunan sunucu protokolü. Yerel sunucular genelde **stdio** transport üzerinden konuşur.
- **x402:** HTTP 402 ("Payment Required") status kodunu kullanan açık ödeme protokolü (Coinbase Developer Platform kökenli, x402 Foundation yönetir, Apache-2.0). Sunucu bir kaynağı ücretli yapar; client ödemeyi HTTP header'larıyla iliştirip isteği tekrarlar. Hesap/API key gerektirmez.
- **Stellar:** Hızlı, düşük ücretli blockchain. ~5 saniye finality.
- **Soroban:** Stellar'ın smart contract platformu.
- **Soroban Authorization Entry (`SorobanAuthorizationEntry`):** Bir contract çağrısını yetkilendiren imzalı yapı. x402-on-Stellar'ın imzaladığı şey budur.
- **`HashIdPreimageSorobanAuthorization`:** Auth entry için imzalanan preimage yapısı. Freighter'ın `signAuthEntry`'sine ve `stellar-sdk`'nın `authorizeEntry`'sine verilen şey bunun XDR'ıdır.
- **XDR:** Stellar'ın binary serialization formatı. İşlemler ve preimage'lar XDR string olarak taşınır/imzalanır.
- **SEP-41:** Stellar'ın token standardı. x402'nin exact scheme'i SEP-41 token transferi (örn. USDC) üzerinden çalışır.
- **Freighter:** Stellar'ın resmî tarayıcı cüzdanı (browser extension). Auth-entry imzalamayı resmî destekler. **Freighter Mobile x402'yi DESTEKLEMİYOR** (extension şart).
- **G-account / C-account:** G-account klasik Stellar hesabı (Ed25519 keypair); hem işlem envelope'u hem auth entry imzalayabilir. C-account contract hesabı; **sadece** auth entry imzalayabilir. **Bizim cüzdan bir G-account'tur** → hem x402 (auth entry) hem genel işlem (envelope) imzalayabilir.
- **Facilitator:** x402 ödemesini on-chain doğrulayıp settle eden servis. Stellar için iki seçenek var (Bölüm 14).
- **USDC trustline:** Bir Stellar hesabının USDC tutabilmesi için önceden açması gereken yetki kaydı. Yoksa USDC settle başarısız olur.
- **stroop:** XLM'in en küçük birimi (1 XLM = 10^7 stroop). Testnet facilitator limit sorununu önlemek için fee'yi 1 stroop'a sabitlemek gerekir.
- **ledger:** Stellar'da bir blok. İmza geçerliliği "expiration ledger" ile sınırlanır. ~5 sn/ledger → ~5 dk ≈ ~60 ledger.
- **TEE (Trusted Execution Environment):** Donanım-izole, doğrulanabilir (attestation üreten) çalışma ortamı. Burada **AWS EC2 AMD SEV-SNP confidential VM** kullanıyoruz (Bölüm 18).
- **AMD SEV-SNP:** AMD'nin confidential computing teknolojisi; VM belleğini instance'a özel anahtarla şifreler ve **attestation report** üretir.
- **Launch measurement:** SEV-SNP attestation report'undaki, VM'in başlangıç guest memory + vCPU state'inin kriptografik hash'i. "Bu ölçülmüş kod, gerçek bir AMD ortamında çalışıyor" kanıtının temeli.
- **VLEK (Versioned Loaded Endorsement Key):** AMD'nin AWS için verdiği, attestation report'u imzalayan sertifika; AMD root of trust'a zincirlenir.
- **TOTP (Time-based One-Time Password):** Google Authenticator'daki gibi, paylaşılan secret'tan üretilen, 30 sn'de değişen 6 haneli kod. Kullanıcının cüzdana anlık erişimini kanıtlamak için.
- **JWT (JSON Web Token):** İmzalı, doğrulanabilir token. Eşleştirmeden sonra MCP'nin transporter'a kimlik kanıtlamak için kullandığı şey.

---

## 2. Arka Plan: x402, ve Stellar'da x402

### x402 protokolünün genel akışı
1. Client korumalı kaynağa istek atar.
2. Sunucu **402 Payment Required** + makine-okunur ödeme talimatları döner (fiyat, token, ağ, alıcı/facilitator).
3. Client on-chain öder, ödeme kanıtını retry isteğine iliştirir.
4. Sunucu settle'ı doğrular, kaynağı (+ makbuz) döner.

### Stellar'da x402 (KRİTİK — Base/EVM'den farklı)
Base/EVM'de client bir EIP-3009 `transferWithAuthorization` imzalar. **Stellar'da bu YOK.** Stellar'da:
- Sunucu **402 + `PAYMENT-REQUIRED`** header döner (fiyat, network, facilitator URL).
- Client bir **Soroban authorization entry** imzalar ve isteği **`PAYMENT-SIGNATURE`** header'ı ile tekrarlar.
- **Facilitator** ödemeyi doğrular ve on-chain settle eder; fee'yi sponsor eder (client'ın XLM tutmasına gerek yok), ~5 sn finality.
- Sunucu kaynağı **`PAYMENT-RESPONSE`** header'ı (settle teyidi) ile döner.
- Anti-replay benzersiz nonce ile, geçerlilik `max_ledger` / expiration ledger ile.
- Transfer SEP-41 token interface'i üzerinden yapılır (örn. testnet USDC).

İmzalanan şey bir **Soroban auth entry'dir**, pre-signed transaction değil. Bu, projenin imza primitifini belirler.

### Resmî kaynaklar (uygulayıcı bunları açıp kullanmalı)
- x402 on Stellar (genel): `https://developers.stellar.org/docs/build/agentic-payments/x402`
- Built on Stellar facilitator (OZ): `https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar`
- x402 Quickstart (server.js + client.js, **çalışan örnek**): `https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide`
- Soroban imzalama (full-tx vs auth-entry): `https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations`
- Freighter — auth entry imzalama: `https://developers.stellar.org/docs/build/guides/freighter/sign-auth-entries`
- Freighter — Soroban XDR imzalama: `https://developers.stellar.org/docs/build/guides/freighter/sign-soroban-xdrs`
- Stellar x402 repo + örnekler (paywall örneği dahil): `https://github.com/stellar/x402-stellar`
- `stellar-sdk` `authorizeEntry` helper (referans implementasyon): `js-stellar-base` `src/auth.js`

---

## 3. Problem

x402 client'ı çalıştırmak için bir **signer** (private key'e erişimi olan imzalayıcı) gerekir. Standart kullanımda private key agent ortamına / MCP config'ine konur (resmî Stellar quickstart bile `.env`'de `STELLAR_PRIVATE_KEY=S...` ister ve "secret key cüzdandaki tüm varlıklara tam erişim verir; sadece testnet hot wallet için kullanın" diye uyarır). Bu kötü desen:
- Payment ayrı bir güven alanıdır; her MCP'ye/agent'a private key vermek tüm fonları riske atar.
- "Private key verdin, artık agent istediğini sessizce imzalar" modeli tehlikeli.

**Yok ettiğimiz anti-pattern tam olarak budur.**

---

## 4. Çözüm: Remote Signer

x402 client'ındaki **signer'ı uzaktan çalışan bir signer ile değiştiriyoruz.** Signer'ın işi: "imzalanacak şeyi al, imzayı döndür." Normalde signer keypair'i lokal tutar. Bizim remote signer:
1. İmzalanacak yükü (Soroban auth entry preimage XDR, ya da işlem XDR'ı) **transporter'a** gönderir.
2. Transporter bunu kullanıcının **Freighter** cüzdanına push eder.
3. Kullanıcı cüzdanda inceleyip onaylar; Freighter **gerçek private key** ile imzalar.
4. İmza transporter üzerinden geri döner; x402 client akışına devam eder.

### Gerçek x402-stellar akışı (resmî quickstart client.js'ten)
Kullanılan paketler: `@x402/core`, `@x402/express` (server), `@x402/fetch` (client), `@x402/stellar` (Stellar şeması), `@stellar/stellar-sdk`.

Standart (lokal, **kötü**) client şöyle kuruluyor:
```js
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const signer = createEd25519Signer(STELLAR_PRIVATE_KEY, NETWORK);   // <-- private key BURADA
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer, rpcConfig));
const httpClient = new x402HTTPClient(client);

const firstTry = await fetch(url);                                  // 1) ödemesiz dene
const paymentRequired = httpClient.getPaymentRequiredResponse(n => firstTry.headers.get(n)); // 2) PAYMENT-REQUIRED parse
let paymentPayload = await client.createPaymentPayload(paymentRequired);   // 3) imza BURADA, signer ile, içeride
// 4) testnet fee fix: paymentPayload.payload.transaction'ı fee="1" ile yeniden kur (aşağıda)
const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);   // 5) PAYMENT-SIGNATURE header
const paid = await fetch(url, { method: "GET", headers });                 // 6) retry
const settle = httpClient.getPaymentSettleResponse(n => paid.headers.get(n)); // 7) PAYMENT-RESPONSE parse
```
Not: `signer.address` G-adresidir. İmza, `createPaymentPayload` içinde `signer` üzerinden yapılır. **Swap noktası tam olarak `ExactStellarScheme(signer, …)`'e verilen `signer`'dır.**

### Swap: remote signer
`createEd25519Signer(...)` yerine, aynı interface'i taşıyan ama imzayı cüzdana soran bir nesne koyuyoruz. Remote signer'ın çekirdek operasyonu **"bir Soroban auth entry preimage'ını imzala"dır** — bu, Freighter'ın `signAuthEntry(preimageXdr) → Buffer` API'siyle birebir aynı iştir. Zincir: `preimage → transporter → Freighter.signAuthEntry → Buffer → geri`.

```js
// Aynı interface, lokal key yok. (Tam metot adı/şekli için Bölüm 16'daki tek lookup.)
const signer = {
  address: USER_PUBLIC_KEY,                 // G-account
  // x402-stellar bunu auth entry imzalamak için çağırır. İmza işi cüzdanda olur.
  signAuthEntry: async (preimageXdr, meta) => {
    const { requestId } = await transporter.signRequest({
      jwt, type: "auth_entry", payload: preimageXdr, meta   // {amount, asset, destination, description}
    });
    return await transporter.pollUntilSigned(jwt, requestId); // Freighter'dan dönen imza (Buffer)
  },
};
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer, rpcConfig));
```

> **İki kritik gereklilik:**
> 1. **Remote signer ASENKRON olmalı** (insan onayını bekler). `@x402/stellar` şemasının asenkron signer kabul ettiği uygulama anında teyit edilmeli.
> 2. **İki entegrasyon stratejisi var:**
>    - **Strateji A (tercih, temiz):** `ExactStellarScheme`'in `signer` argümanına yukarıdaki gibi custom signer ver. Tek gereken: signer'ın imza metodunun **tam adı/dönüş şekli** (Bölüm 16).
>    - **Strateji B (fallback, tam kontrol):** Şemanın iç imzasını baypas et. `@x402/stellar` ile sadece `getPaymentRequiredResponse` + payload'ı kur; auth entry'yi **kendin** `stellar-sdk`'nın `authorizeEntry(entry, remoteSigner, validUntilLedger, networkPassphrase)`'ı ile imzala (remoteSigner asenkron olabilir, içeride cüzdana gider), sonra `encodePaymentSignatureHeader` ile header'ı kur. Daha fazla iş ama interface'e bağlı değil.

---

## 5. Sistem Mimarisi

Görsel diyagram aynı klasörde: `wallet-mcp-architecture.mermaid`.

### Bileşen 1 — Wallet MCP
- **Nerede:** Agent host'unda (Claude Desktop), yerel süreç. **Transport:** stdio.
- **Tool'lar:** `setup_wallet`, `pay_x402`, `sign_transaction`, `wallet_status` (Bölüm 10).
- **Sırları nerede tutar:** JWT'yi **MCP config'e DEĞİL**, `~/.wallet-mcp/creds.json`'a yazar. Sebep: MCP süreci host'un client config'ini çalışma anında reload edemez; restart gerekmesin diye. Config'de yalnızca `TRANSPORTER_URL` durur.
- **Private key tutar mı:** HAYIR.

### Bileşen 2 — Transporter (AWS AMD SEV-SNP confidential VM içinde)
- **Nerede:** AWS EC2 (M6a/C6a/R6a), SEV-SNP açık, Ubuntu 24.04 (Bölüm 18).
- **Görevi:** MCP ↔ Cüzdan arasında **saf relay** + eşleştirme otoritesi + attestation sunma.
- **HTTP:** `/register`, `/pair`, `/sign-request`, `GET /sign-request/:id`, `/sign-result`, `/attestation` (Bölüm 9).
- **WebSocket:** Cüzdanlarla kalıcı bağlantı (push için).
- **Tuttuğu durum:** cüzdan kayıtları (publicKey, TOTP secret, wallet token), bekleyen imza istekleri, JWT imzalama anahtarı.
- **Private key tutar mı:** HAYIR. Sadece relay + eşleştirme sırları.
- **Neden TEE:** Relay ettiği işlem verisini (kime/ne kadar) ve eşleştirme sırlarını (TOTP secret, JWT anahtarı) **host operatörüne karşı bile** korur (SEV-SNP bellek şifrelemesi); attestation ile "bu ölçülmüş kod, gerçek izole AMD VM'inde" kanıtı sunar. Güven hikâyesi buraya dayanır.

### Bileşen 3 — Forklanmış Freighter Extension
- **Nerede:** Kullanıcının tarayıcısı (browser extension). **Mobile DEĞİL** (Freighter Mobile x402 desteklemiyor).
- **Tuttuğu:** **Private key** (gerçek imza burada) + TOTP secret.
- **İmza API'leri (resmî Freighter API):**
  - x402 (auth entry): `HashIdPreimageSorobanAuthorization` kurулur, XDR'ı alınır, `await freighterApi.signAuthEntry(preimageXdr)` çağrılır → imzalı hash **Buffer**'ı döner. (`stellar-sdk` `authorizeEntry` helper'ıyla aynı mantık.)
  - genel işlem (XDR): `await freighterApi.signTransaction(xdr, opts)` → imzalı XDR.
- **Forktaki ek iş:** transporter'a register, kalıcı WebSocket, ve gelen isteği insan-okunur gösteren onay ekranı. Onayda yukarıdaki imza çağrıları tetiklenir.
- **Neden forklanmış (sıfırdan değil):** Hazır keypair yönetimi + Stellar entegrasyonu + auth-entry imzalama altyapısını yeniden kullanmak.

### Bileşen 4 (demo) — Mock Twitter x402 MCP
- **Nerede:** Ayrı yerel süreç (örnek "ücretli servis").
- **Konvansiyon (x402-mcp standardı):** `list`/`read` ücretsiz; state değiştiren/pahalı tool ücretli (ücretsiz GET / ücretli POST).
- **Somut:** ücretsiz `read_timeline` (mock veri) + ücretli `post_tweet` (çağrılınca 402 + PAYMENT-REQUIRED; ödeme sonrası "tweet atıldı" mock). Express + `@x402/express` `paymentMiddlewareFromConfig` ile.

---

## 6. Bileşenler ne tutar — özet tablo

| Bileşen | Private key | TOTP secret | JWT | Nerede çalışır |
|---|---|---|---|---|
| Wallet MCP | Hayır | Hayır | JWT **token**'ı creds'te | Agent host |
| Transporter | **Hayır** | Evet (doğrulama) | JWT **imzalama anahtarı** | AWS AMD SEV-SNP VM |
| Freighter (fork) | **Evet** | Evet | Hayır | Tarayıcı (extension) |
| Mock Twitter MCP | Hayır | Hayır | Hayır | Yerel süreç |

---

## 7. Üç Akış (tam adım adım)

### Akış A — Kayıt (Registration) — cüzdan başına bir kez
1. Kullanıcı forklanmış Freighter'ı açar, bir G-account oluşturur/seçer.
2. Cüzdan `POST /register { publicKey }` çağırır.
3. Transporter `totpSecret`, `walletId`, `walletToken` üretir; kaydı saklar; döner.
4. Cüzdan `totpSecret`'ı saklar, 30 sn'de değişen 6 haneli kod göstermeye başlar.
5. Cüzdan `walletToken` ile kalıcı WebSocket açar: `wss://<transporter>/ws`. Transporter soketi `walletId`/`publicKey` ile eşler.

### Akış B — Eşleştirme (Pairing) — agent başına bir kez
1. Kullanıcı Claude'da `setup_wallet`'ı tetikler.
2. MCP **public key** + cüzdandaki **6 haneli TOTP kodunu** ister.
3. MCP `POST /pair { publicKey, totpCode }` çağırır.
4. Transporter publicKey ile cüzdanı bulur, kodu saklı secret'a karşı doğrular.
5. Doğruysa **JWT** üretir (walletId/publicKey; transporter anahtarıyla imzalı) ve döner.
6. MCP JWT'yi `~/.wallet-mcp/creds.json`'a yazar. Restart gerekmez.

### Akış C — İmza (her işlemde)
1. Agent `pay_x402(...)` veya `sign_transaction(...)` çağırır.
2. MCP `POST /sign-request` (Bearer JWT) ile yükü + insan-okunur meta'yı gönderir.
3. Transporter JWT'yi doğrular → walletId çözer → aktif WS'e push → pending oluşturur. Döner: `{ requestId }`.
4. MCP `GET /sign-request/:requestId`'i poll eder (60–90 sn timeout).
5. Kullanıcı cüzdanda isteği inceler (kime/ne kadar/hangi işlem), onaylar/reddeder. Onayda Freighter gerçek key ile imzalar.
6. Cüzdan `POST /sign-result { requestId, status, signature }` döner.
7. Transporter pending'i günceller; MCP'nin poll'u sonucu alır.
8. MCP imzalı yükü agent'a döndürür (x402'de retry için; genel işlemde submit için).

---

## 8. x402 Ödeme Akışı (uçtan uca, gerçek header'larla)

`pay_x402(url)` çağrıldığında:
1. MCP içindeki x402 client `url`'e ister →
2. Sunucu **402 + `PAYMENT-REQUIRED`** (fiyat, network, facilitator URL) döner.
3. x402 client `createPaymentPayload` ile payload kurar; imza için **remote signer**'ı çağırır → MCP `POST /sign-request` (type=`auth_entry`, payload=preimage XDR, meta={amount, asset, destination, description}).
4. Transporter → Freighter'a WebSocket push.
5. Kullanıcı onaylar → Freighter `signAuthEntry(preimageXdr)` → `POST /sign-result`.
6. İmza transporter → MCP → x402 client'a döner.
7. (Testnet fee fix: payload tx'i fee="1" ile yeniden kurulur.) x402 client isteği **`PAYMENT-SIGNATURE`** header'ı ile tekrarlar.
8. Sunucu **facilitator** ile doğrular ve settle eder (fee sponsorlu).
9. Facilitator on-chain **USDC settle** eder (Stellar testnet).
10. Sunucu kaynağı + **`PAYMENT-RESPONSE`** döner → MCP agent'a sonucu verir.

### x402 dışı normal işlem (`sign_transaction`)
Adım 1–2 ve 7–10 düşer. MCP XDR'ı kendisi kurar, Akış C (3–6) ile Freighter'a `signTransaction(xdr)` ile imzalatır, imzalı XDR'ı doğrudan Soroban RPC'ye submit eder (veya imzalı XDR'ı döner — `submit` parametresine göre). Aynı imza kanalı, farklı uç.

---

## 9. API Kontratları (Transporter)

> Gövdeler JSON. Hatada `{ error }` + uygun HTTP kodu.

### `POST /register`
- İstek: `{ "publicKey": "G..." }`
- Cevap: `{ "walletId": "uuid", "totpSecret": "base32", "walletToken": "opaque-long-secret" }`

### `WS wss://<transporter>/ws`
- Kimlik: `walletToken` (örn. `?token=...`). Transporter soketi `walletId`'ye eşler.
- Sunucu→cüzdan push: `{ "type": "sign_request", "requestId": "...", "payloadType": "auth_entry|xdr", "payload": "<xdr>", "meta": { "amount": "...", "asset": "USDC", "destination": "...", "description": "..." } }`

### `POST /pair`
- İstek: `{ "publicKey": "G...", "totpCode": "123456" }`
- Cevap: `{ "jwt": "..." }`

### `POST /sign-request`
- Header: `Authorization: Bearer <jwt>`
- İstek: `{ "type": "auth_entry|xdr", "payload": "<xdr>", "meta": { ... } }`
- Cevap: `{ "requestId": "..." }`

### `GET /sign-request/:requestId`
- Header: `Authorization: Bearer <jwt>`
- Cevap: `{ "status": "pending|signed|rejected|expired", "result": "<signature/signedXdr|null>" }`

### `POST /sign-result` (cüzdandan)
- Kimlik: `walletToken`.
- İstek: `{ "requestId": "...", "status": "signed|rejected", "signature": "<...>|null" }`

### `GET /attestation` (TEE kanıtı, Bölüm 18)
- Cevap: `{ "report": "<base64 SEV-SNP report>", "vlekCertChain": "<pem>", "reportData": "<hex; transporter identity pubkey hash>" }`
- Doğrulayıcı: VLEK → AMD root zincirini ve report_data'yı kontrol eder.

### Transporter durum modeli
- `wallets: { walletId, publicKey, totpSecret, walletToken }`
- `pending: { requestId, walletId, type, payload, meta, status, result, createdAt, expiresAt }`
- `sockets: walletId -> WebSocket`
- `jwtSigningKey`, `identityKeypair` (attestation report_data'ya bağlanır)
- **Private key bu modelde YOK.** Hassas: `totpSecret`, `jwtSigningKey` — SEV-SNP'nin koruduğu şeyler.

---

## 10. MCP Tool Tanımları (Wallet MCP)

- **`setup_wallet(publicKey, totpCode) -> { ok }`** — `/pair` çağırır, JWT'yi creds'e yazar.
- **`wallet_status() -> { paired, publicKey? }`** — creds/JWT kontrolü.
- **`pay_x402(url, method?, body?) -> { resource, receipt }`** — x402 client ile gider; 402'de remote signer cüzdana round-trip yapar; kaynağı + makbuzu döner.
- **`sign_transaction(xdr, submit?=true) -> { signedXdr?, txHash? }`** — XDR'ı cüzdana imzalatır; `submit=true` ise RPC'ye gönderip `txHash`, değilse `signedXdr` döner.

> x402'ye özgü imza (auth entry) ile genel imza (XDR) aynı `/sign-request` kanalını `type` ile paylaşır; cüzdan onay ekranı `payloadType`'a göre gösterim yapar.

---

## 11. Güvenlik / Tehdit Modeli

- **Private key nerede:** Sadece Freighter'da. Sızması için kullanıcının kendi cüzdanının ele geçmesi gerekir (status quo'da key zaten config'te düz metin).
- **Transporter ne görür:** İmzalanacak yükü + meta'yı (relay sırasında). Bu yüzden SEV-SNP içinde: bellek şifreli, operatör bile içeriği/sırları okuyamaz; attestation bunu kanıtlar.
- **Eşleştirme:** Sadece public key yetmez; **TOTP** ile "o an cüzdana erişim" kanıtlanır. JWT transporter imzalı → sahtelenemez.
- **Replay/tazelik:** Auth entry benzersiz nonce + expiration ledger; MCP istekleri `expiresAt` ile timeout.
- **İnsan onayı:** Her işlem cüzdanda görülüp onaylanır; agent tek başına imza üretemez.
- **SEV-SNP'nin sınırı (dürüst çerçeve):** Launch measurement başlangıç imajını ölçer, çalışan uygulama state'ini değil. Anlamlı olması için minimal/tekrarlanabilir imaj kullan ve beklenen measurement'ı kaydet; transporter kimlik anahtarını report_data'ya bağla ki client "attested transporter ile konuşuyorum" diye doğrulayabilsin. (Detay Bölüm 18.)

---

## 12. Demo Planı

- **Örnek client:** mock Twitter x402 MCP. Ücretsiz `read_timeline` + ücretli `post_tweet`.
- **Önkoşul:** Stellar **testnet**; cüzdanda **USDC trustline**; facilitator (aşağıda); fee 1 stroop'a sabit; RPC `https://soroban-testnet.stellar.org`.
- **Testnet cüzdan kurulumu:** Stellar Lab'de keypair oluştur → testnet XLM ile fonla → USDC trustline kur (fund sayfasında buton) → Circle faucet'ten (`https://faucet.circle.com`, Stellar Testnet seç) testnet USDC al.
- **Kontrast kurgusu (pitch'in görsel can damarı):** Önce private key isteyen tipik kurulumu göster (`.env`'de `STELLAR_PRIVATE_KEY=S...`). Sonra remote signer'la o alanı **sil**; aynı ödemeyi cüzdandan onayla.
- **Demo sahnesi:** Claude'a iki MCP bağlı. Agent `post_tweet` çağırır → 402 → cüzdana bildirim → kullanıcı onaylar → tweet atılır. (İstersek `/attestation`'ı doğrulayıp "relay TEE'de" kanıtını gösteririz.)

### Pitch açılışı (~35 sn, yüksek sesle)
> **1Password for agent payments: agents ask, you approve, and your keys never leave your wallet.**
>
> Today, even with x402, every MCP that touches a blockchain asks you to paste your private key into its config. Payments are a separate domain — no agent should ever hold your keys.
>
> So we built a wallet MCP. When an agent hits an x402 paywall, our transporter — running inside a TEE — pushes the request to your own Freighter. You approve in one tap, the agent keeps going, and your key never leaves your wallet.
>
> Here's it working.

---

## 13. Build Planı (fazlı)

**İlke:** önce entegrasyonu de-risk et; her katmanda çalışan bir demo kalsın.

### Faz 0 — ilk 2–3 saat (en kritik)
Resmî quickstart'ı (`server.js` + `client.js`) birebir çalıştır: testnet hesap + USDC trustline + facilitator ile gerçek bir x402 ödemesini **lokal keypair** ile uçtan uca gör. Sonra bunu repo iskeletlerine böl (wallet-mcp, transporter, mock-twitter-mcp). Amaç: en riskli bilinmeyeni (auth entry + facilitator settle) 2. saatte doğrulamak.

### Faz 1
`createEd25519Signer`'ı **remote signer** ile değiştir (Bölüm 4, Strateji A; tıkanırsan B). Araya transporter koy; `MCP → transporter → imza → geri` akışını oturt (imza hâlâ lokal/stub key, Freighter yok). TOTP/JWT eşleştirmesini bağla.

### Faz 2 — en büyük iş
Freighter fork: register + kalıcı WebSocket + onay ekranı + `signAuthEntry`/`signTransaction`. Stub key yerine **gerçek Freighter onayı**. Biterse esas demo hazır. → **Uyu.**

### Faz 3 — sabah
AWS AMD SEV-SNP deploy (Bölüm 18) + `/attestation`. Cüzdan UI cila. Tam prova + slaytlar. TEE son "wow" — savaşırsa kesilir, mimari onsuz da çalışır (sadece güven hikâyesi zayıflar).

**Güvence:** Freighter fork sarkarsa bile Faz 1'den çalışan bir x402 demosu kalır.

---

## 14. Tech Stack

- **`@stellar/stellar-sdk`** — `authorizeEntry`, XDR, RPC submit, `Transaction`/`TransactionBuilder`.
- **x402 paketleri:** `@x402/core`, `@x402/express` (server middleware: `paymentMiddlewareFromConfig`, `HTTPFacilitatorClient`), `@x402/fetch` (client: `x402Client`, `x402HTTPClient`), `@x402/stellar` (`createEd25519Signer`, `getNetworkPassphrase`, `ExactStellarScheme` — `@x402/stellar/exact/client` ve `/exact/server`).
  - Kurulum: `npm install express dotenv @stellar/stellar-sdk @x402/core @x402/express @x402/fetch @x402/stellar`
- **`@modelcontextprotocol/sdk`** — MCP server (Wallet MCP + Twitter MCP).
- **`express`** — transporter HTTP + mock resource server.
- **`ws`** — WebSocket.
- **TOTP:** `otplib` veya `speakeasy`. **JWT:** `jsonwebtoken`.
- **Forklanmış Freighter** (extension).
- **Ağ:** Stellar **testnet**; Soroban RPC `https://soroban-testnet.stellar.org`; network = `stellar:testnet`.
- **Facilitator (iki seçenek):**
  - **Coinbase x402 testnet (en basit, API key yok):** `https://www.x402.org/facilitator`
  - **Built on Stellar / OpenZeppelin (production-grade, API key gerekir):** `https://channels.openzeppelin.com/x402/testnet` (mainnet: `https://channels.openzeppelin.com/x402`); Relayer API key Bearer ile `createAuthHeaders`'ta verilir.
- **TEE:** AWS EC2 **AMD SEV-SNP** (Bölüm 18). Attestation aracı: `snpguest`.

---

## 15. Kritik Tuzaklar

1. **Auth-entry expiration penceresi.** `signatureExpirationLedger`/`validUntilLedgerSequence` "beklenen submit zamanıyla hizalı" olmalı. Araya **insan onayı** girdiği için onay süresini kapsayacak kadar uzun tut (örn. ~60 ledger ≈ ~5 dk), ama gereksiz uzun bırakma. Çok kısa olursa (örn. 30 sn) auth bayatlar, settle revert olur.
2. **Async signer.** Remote signer insan onayını beklediği için asenkron olmak zorunda. Şema asenkron signer kabul etmezse Strateji B'ye düş (Bölüm 4).
3. **MV3 service worker WebSocket'i öldürür.** Forklanan extension'ın background'ı idle olunca kapanır. Çözüm: bağlantıyı açık bir extension sayfasında (options/popup) tut, ya da `chrome.alarms` ile ~25 sn keepalive + reconnect. **Erken test et.**
4. **USDC trustline + Circle faucet.** Trustline yoksa settle patlar; testnet USDC'yi Circle faucet'ten al.
5. **Testnet fee = 1 stroop.** Facilitator testnet limitini aşmamak için payload tx'ini fee="1" ile yeniden kur (quickstart bunu yapıyor).
6. **Soroban için doğru RPC.** Horizon değil **Soroban RPC**. Yeniden kurulan op'larda `sorobanData`'yı dahil et. C-account envelope imzalayamaz (bizde G-account olduğu için sorun yok).
7. **SEV-SNP kısıtları (Bölüm 18):** Sadece M6a/C6a/R6a + belirli bölgeler; **Dedicated Host ile uyumsuz**; host bakımında manuel stop/restart gerekir.

---

## 16. Tek Açık Nokta (uygulama anında 2 dakikalık lookup)

- **`@x402/stellar` signer'ının tam imza-metodu adı ve dönüş şekli.** `createEd25519Signer`'ın döndürdüğü nesnenin imza metodunun adı (ör. `signAuthEntry` / `signAuthorizationEntry` / başka) ve imzanın hangi tipte (Buffer / SCVal / `{publicKey, signature}`) beklendiği. **Nasıl bulunur:** paketi kurup `node_modules/@x402/stellar`'daki `*.d.ts` tip tanımlarına bak, ya da `github.com/stellar/x402-stellar` `src`'sinde `createEd25519Signer`'ı oku. Remote signer (Bölüm 4) tam olarak o şekli taklit etmeli. Bulunamazsa Strateji B (kendi `authorizeEntry` çağrın) bu bağımlılığı tamamen ortadan kaldırır.

> Diğer eski "open question"lar **araştırılıp çözüldü** ve dokümana işlendi: x402 Stellar imza primitifi (Soroban auth entry) ✓, gerçek paket/akış (`@x402/*`, quickstart client.js) ✓, Freighter API (`signAuthEntry`/`signTransaction`) ✓, facilitator URL'leri + API key durumu ✓, testnet USDC/trustline kurulumu ✓, AWS AMD SEV-SNP deploy + attestation ✓ (Bölüm 18).

---

## 17. Mimari Diyagram

Bkz. `wallet-mcp-architecture.mermaid`. Mavi = bizim bileşenler (Wallet MCP, Transporter, Freighter fork); gri = dış sistemler (x402 resource server, facilitator, Stellar). Numaralı oklar Bölüm 8'deki x402 akışı.

---

## 18. AWS AMD SEV-SNP — Deploy & Attestation

### Instance
- Tipler: **M6a / C6a / R6a** (örn. `c6a.large`). Belirli bölgelerde (resmî olarak test edilen örnek: **us-east-2**). AMI: **Ubuntu 24.04 LTS**.
- Launch'ta: Advanced details → CPU options → **AMD SEV-SNP = Enabled** (EC2 console veya CLI ile bir CPU flag).
- **Kısıtlar:** Dedicated Host **uyumsuz**. Bellek instance'a özel anahtarla şifrelenir. Host bakımı 14 gün önceden bildirilir; yeni host'a taşımak için instance'ı **manuel** durdur/başlat.

### Attestation (snpguest ile)
1. Guest içinde `snpguest` util'ini kur/derle (AMD SEV-guest araçları).
2. Report iste: `sudo ./snpguest report report.bin request-file.txt` — `request-file.txt` 64 baytlık **REPORT_DATA** taşır. **Buraya transporter'ın identity public key'inin hash'ini (veya doğrulayıcıdan gelen nonce'u) koy** ki attestation belirli bir transporter kimliğine bağlansın. (`--random` rastgele report_data üretir; biz kendi 64 baytımızı veririz.)
3. Sertifikaları al: `sudo ./snpguest certificates pem ./` (host belleğinden VLEK vb.).
4. VLEK root-of-trust zincirini AMD'den indir: `https://kdsintf.amd.com/vlek/v1/Milan/cert_chain` ("Milan" = AMD EPYC Milan nesli).
5. Doğrula: `snpguest`/`openssl` ile report'un VLEK tarafından imzalandığını ve VLEK'in AMD root'a zincirlendiğini kontrol et. Report içindeki **launch measurement** + **report_data** beklenenle eşleşmeli.

### Bizim akışa bağlanışı
- Transporter, açılışta bir `identityKeypair` üretir; report_data = hash(identity pubkey). `GET /attestation` report + VLEK cert chain + report_data döner.
- Bir doğrulayıcı (örn. demo'da biz): VLEK→AMD root zincirini doğrular, launch measurement'ı beklenen değere karşı kontrol eder, report_data'nın transporter'ın sunduğu identity pubkey'e bağlı olduğunu görür → "bu relay, ölçülmüş kodla, gerçek SEV-SNP VM'inde, ve şu kimlikle çalışıyor" sonucuna varır.
- **Dürüst sınır (Bölüm 11):** Launch measurement boot/initial imajı ölçer. Anlamlı kılmak için minimal/tekrarlanabilir bir guest imajı kullan ve beklenen measurement'ı önceden kaydet; demo'da en azından bellek-şifreleme + genuine-AMD + kimlik-bağlama özelliklerini göster.
- **Not:** Bu, AWS Nitro Enclaves DEĞİL. AWS'in ayrı bir attestation yolu daha var (NitroTPM + Attestable AMIs); ikisini karıştırma. Biz AMD SEV-SNP yolunu kullanıyoruz.
