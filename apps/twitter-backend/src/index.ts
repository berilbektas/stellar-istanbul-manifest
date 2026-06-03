/**
 * @wallet-mcp/twitter-backend — x402-gated Twitter resource server ("the merchant").
 *
 * Gerçek Twitter API v2'yi (twitter-api-v2) sarmalar. TÜM endpoint'ler x402 ile
 * korunur; ödenmeden cevap dönmez. Fiyat per-operation (X pay-per-use, registry'de).
 * MCP veya wallet-mcp'nin pay_x402'si dışındaki tek çağıran twitter-mcp'dir.
 *
 * Express + @x402/express (paymentMiddlewareFromConfig + HTTPFacilitatorClient +
 * ExactStellarScheme). Stellar testnet USDC, fee'ler facilitator tarafından sponsorlu.
 */

import type { RouteConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import express from "express";
import { env } from "./env.js";
import { REGISTRY } from "./registry.js";
import { registerRoutes, routeKey } from "./routes.js";
import { makeCtx } from "./twitter.js";

type Network = `${string}:${string}`;

async function main() {
  const app = express();
  app.use(express.json());

  // Ungated liveness (REGISTRY'de olmadığı için x402 gate'lemez)
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, network: env.NETWORK, x402Bypass: env.X402_BYPASS });
  });

  if (env.X402_BYPASS) {
    // BYPASS: ödeme middleware'i mount EDİLMEZ → route'lar 402'siz, ücretsiz çalışır.
    console.error(
      "[twitter-backend] ⚠️  X402_BYPASS aktif — ödeme YOK, tüm endpoint'ler ücretsiz! (sadece dev/test)"
    );
  } else {
    // REGISTRY'den x402 route config'i kur. Fiyat per-operation (X pay-per-use);
    // dynamicPrice olan route'lar request body'sine göre fiyat döner (URL'li post).
    const routes: Record<string, RouteConfig> = {};
    for (const t of REGISTRY) {
      const dyn = t.dynamicPrice;
      const price:
        | string
        | ((context: { adapter: { getBody(): unknown } }) => string) = dyn
        ? (context) => dyn(context.adapter.getBody())
        : t.price;
      routes[routeKey(t)] = {
        accepts: {
          scheme: "exact",
          payTo: env.PAY_TO,
          price,
          network: env.NETWORK as Network,
        },
        description: t.description,
      } as RouteConfig;
    }

    app.use(
      paymentMiddlewareFromConfig(
        routes,
        new HTTPFacilitatorClient({ url: env.FACILITATOR_URL }),
        [{ network: env.NETWORK as Network, server: new ExactStellarScheme() }]
      )
    );
  }

  const ctx = makeCtx(); // TwitterApi (lazy me() id) — startup'ta ağ çağrısı yok
  registerRoutes(app, ctx);

  app.listen(env.PORT, () => {
    console.error(`[twitter-backend] x402 seller :${env.PORT}`);
    console.error(
      `[twitter-backend] network=${env.NETWORK} payTo=${env.PAY_TO || "(bypass)"}`
    );
    console.error(`[twitter-backend] facilitator=${env.FACILITATOR_URL}`);
    console.error(
      env.X402_BYPASS
        ? `[twitter-backend] ${REGISTRY.length} endpoint kayıtlı — x402 BYPASS (ücretsiz)`
        : `[twitter-backend] ${REGISTRY.length} ücretli endpoint kayıtlı`
    );
  });
}

main().catch((err) => {
  console.error("[twitter-backend] fatal:", err);
  process.exit(1);
});
