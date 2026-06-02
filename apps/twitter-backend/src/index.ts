/**
 * @wallet-mcp/twitter-backend — Mock Twitter backend (manifest Component 4, part 1/2)
 *
 * The x402-gated RESOURCE SERVER ("the merchant"). This is the thing that
 * charges money and settles on-chain via the facilitator. It is plain HTTP and
 * knows nothing about MCP — the twitter-mcp app (the remote MCP server) is its
 * only intended caller (besides wallet-mcp's pay_x402).
 *
 * Routes:
 *   GET  /timeline   (free)            -> mock timeline data
 *   POST /tweet      (paid, x402)      -> 402 + PAYMENT-REQUIRED; after settle, mock "tweet posted"
 *
 * Built with Express + @x402/express (paymentMiddlewareFromConfig +
 * HTTPFacilitatorClient). Price/asset/network/pay-to come from .env.
 *
 * See: README.md, docs/manifest.md §5 (Component 4), §8 (x402 flow), §12 (Demo).
 *
 * Scaffold only — no implementation yet.
 */

export {};
