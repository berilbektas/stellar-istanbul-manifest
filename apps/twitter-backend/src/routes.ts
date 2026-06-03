import type { Express, Request, Response } from "express";
import { REGISTRY, type ToolDef, type TwitterCtx } from "./registry.js";

/**
 * REGISTRY'den Express route'ları üretir. Ödeme (x402) middleware'i bu
 * route'lara ulaşmadan önce gate'ler — buraya gelen istek ÖDENMİŞ demektir.
 * Handler input'u validate eder, twitter-api-v2 çağrısını yapar, JSON döner.
 */
export function registerRoutes(app: Express, ctx: TwitterCtx): void {
  for (const t of REGISTRY) {
    const handler = async (req: Request, res: Response) => {
      try {
        const raw = { ...req.params, ...req.query, ...req.body };
        const args = t.input.parse(raw);
        const result = await t.call(ctx, args);
        res.json(result);
      } catch (err) {
        const e = err as {
          name?: string;
          code?: unknown;
          message?: string;
          data?: unknown;
          issues?: unknown;
        };
        if (e?.name === "ZodError") {
          res.status(400).json({ error: "invalid_input", detail: e.issues });
          return;
        }
        // twitter-api-v2 ApiResponseError → upstream status/mesaj yansıt
        const status = typeof e?.code === "number" ? e.code : 500;
        res.status(status).json({
          error: e?.message ?? "twitter_error",
          detail: e?.data ?? null,
        });
      }
    };
    const verb = t.method.toLowerCase() as "get" | "post" | "delete";
    app[verb](t.path, handler);
  }
}

/** Route key'i x402 RoutesConfig formatına çevirir: "METHOD /path". */
export function routeKey(t: ToolDef): string {
  return `${t.method} ${t.path}`;
}
