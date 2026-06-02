# `@wallet-mcp/twitter-backend` — Twitter x402 backend (part 1/2)

> Manifest Component 4 (§5, §12), **split part 1**: the x402-gated **resource
> server** ("the merchant"). Plain HTTP, no MCP. Paired with
> [`twitter-mcp`](../twitter-mcp) (the remote MCP server, part 2/2).

Wraps the **real Twitter API v2** (`twitter-api-v2`, OAuth 1.0a user-context).
**Every** endpoint is x402-gated — nothing returns without an on-chain payment
settling on Stellar testnet (USDC, fees sponsored by the facilitator).

## Pricing — per-operation (X pay-per-use, not flat)

Each endpoint's x402 price equals what the X API charges for that operation
(zero markup). Defined in `src/registry.ts` → `PRICES`:

| Category              | Price    | Operations                                              |
| --------------------- | -------- | ------------------------------------------------------- |
| post read             | `$0.005` | search, get_tweet, user/home/mentions timeline          |
| user read             | `$0.01`  | get_user, get_user_by_username                          |
| follows read          | `$0.01`  | followers, following                                    |
| owned read            | `$0.001` | me                                                      |
| post create           | `$0.015` | create_tweet, reply (no URL)                            |
| post create + URL     | `$0.20`  | create_tweet/reply when the text contains a URL (**dynamic**) |
| interaction create    | `$0.015` | like, retweet, follow                                   |
| delete interaction    | `$0.01`  | unlike, unretweet, unfollow, delete_tweet               |
| bookmark              | `$0.005` | bookmark, remove_bookmark                               |

> Aligned with the official page: https://docs.x.com/x-api/getting-started/pricing
> Dynamic pricing uses `@x402/core`'s `DynamicPrice` (reads the request body per request).

## Endpoints (21)

Generated from the single `REGISTRY` in `src/registry.ts` (one source of truth
for routes + x402 price + the `twitter-api-v2` call). Examples:
`POST /tweets`, `GET /tweets/:id`, `DELETE /tweets/:id`, `GET /search`,
`GET /home`, `GET /mentions`, `GET /me`, `POST /likes`, `POST /retweets`,
`POST /following`, `GET /users/:id/timeline`, … plus `GET /healthz` (ungated).

Built with **Express + `@x402/express`** (`paymentMiddlewareFromConfig` +
`HTTPFacilitatorClient` + `ExactStellarScheme`). The actual payer is the user's
wallet, via the Wallet MCP's `pay_x402` (remote signer flow, manifest §4/§8).

## Config

See `.env.example`: `PORT`, `STELLAR_NETWORK`, `FACILITATOR_URL`, `PAY_TO`
(seller G-address, USDC trustline open), and `TWITTER_*` (OAuth 1.0a keys).
There is **no global price** — pricing is per-operation in the registry.

> Twitter init is lazy: the server boots without valid Twitter creds and still
> serves `402`s (the gate runs before any Twitter call), so the x402 layer can be
> demoed independently. `me()` is fetched+cached on first engagement call.

### x402 bypass (dev/test only)

Set `X402_BYPASS=true` in `.env` to **skip payment entirely** — the x402
middleware is not mounted, so every endpoint runs free (no `402`). `PAY_TO` is
not required in this mode. `GET /healthz` reports `{ "x402Bypass": true }`.
**Never enable in production.** With bypass on + real Twitter creds, tools return
data directly; the MCP relays that as `{ "status": "ok", "result": … }`.

## Run

```bash
bun run dev    # tsx watch, :4021
bun run typecheck
bun run lint   # biome
```

Gate check (no Twitter creds needed):

```bash
curl -i http://localhost:4021/me                       # 402 + PAYMENT-REQUIRED (amount 100000 = $0.01)
curl -i -X POST http://localhost:4021/tweets -H 'content-type: application/json' -d '{"text":"hi https://x.com"}'
#                                                       # dynamic → amount 2000000 = $0.20
```

## Entry point

`src/index.ts` → `src/{env,twitter,routes,registry}.ts`.
