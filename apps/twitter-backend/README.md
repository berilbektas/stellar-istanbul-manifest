# `@wallet-mcp/twitter-backend` — Mock Twitter backend (demo, part 1/2)

> Manifest Component 4 (§5, §12), **split part 1**: the x402-gated **resource
> server** ("the merchant"). Plain HTTP, no MCP. Paired with
> [`twitter-mcp`](../twitter-mcp) (the remote MCP server, part 2/2).

## Routes

| Route          | Price | Behavior                                                            |
| -------------- | ----- | ------------------------------------------------------------------ |
| `GET /timeline`| free  | Returns mock timeline data.                                        |
| `POST /tweet`  | paid  | `402` + `PAYMENT-REQUIRED`; after the facilitator settles, returns a mock "tweet posted" + `PAYMENT-RESPONSE`. |

Built with **Express + `@x402/express`** (`paymentMiddlewareFromConfig`,
`HTTPFacilitatorClient`). The actual payer is the user's wallet, via the Wallet
MCP's `pay_x402` (the remote signer flow, manifest §4/§8).

## Why split from the MCP?

Deploying is simpler when the merchant API and the agent-facing MCP are separate
services: the backend is a stateless HTTP service you can host anywhere, and the
remote MCP server ([`twitter-mcp`](../twitter-mcp)) talks to it over HTTP. No
shared workspace packages — each app is self-contained.

## Config

See `.env.example` (port, network, facilitator, pay-to, price). Prereqs:
testnet, **USDC trustline**, fee fixed to 1 stroop (manifest §12, §15).

## Entry point

`src/index.ts` (scaffold).
