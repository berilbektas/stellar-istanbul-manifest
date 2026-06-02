/**
 * @wallet-mcp/twitter-mcp — Twitter remote MCP server (manifest Component 4, part 2/2)
 *
 * Ajan-yüzlü, KEYLESS MCP. Wallet MCP'den (local, stdio) farklı olarak bu REMOTE
 * bir MCP server'dır: MCP Streamable HTTP transport'unu Express üzerinden konuşur.
 * twitter-backend (x402 merchant) önünde ince bir adaptördür — private key tutmaz,
 * asla ödeme yapmaz.
 *
 * twitter-backend'in 21 endpoint'inin her biri için bir tool sunar. Bir tool
 * çağrıldığında backend'e düz fetch atar; backend ücretli olduğu için 402 +
 * PAYMENT-REQUIRED döner. MCP bu gerçek 402'yi ajana yansıtır ve "Wallet MCP'nin
 * pay_x402(url, method, body) tool'uyla öde" yönergesini verir (remote signer
 * akışı, §4/§8). Ödeme + retry dış Wallet MCP tarafından yapılır; backend tweet'i
 * atar ve sonucu pay_x402'nin cevabında döner.
 *
 * Transport: StreamableHTTPServerTransport (stateless), Express ile servis edilir.
 *
 * See: README.md, twitter-backend/README.md, docs/manifest.md §5, §8, §12.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { REGISTRY, type ToolMeta } from "./registry.js";

const BACKEND_URL = (
  process.env.TWITTER_BACKEND_URL ??
  process.env.BACKEND_URL ??
  "http://localhost:4021"
).replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 4022);
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

/** input args'ından backend URL + fetch init kurar (path param + query/body). */
function buildRequest(t: ToolMeta, args: Record<string, unknown>) {
  let path = t.path;
  const rest: Record<string, unknown> = { ...args };
  for (const p of t.pathParams ?? []) {
    path = path.replace(`:${p}`, encodeURIComponent(String(rest[p])));
    delete rest[p];
  }
  let url = `${BACKEND_URL}${path}`;
  const init: RequestInit = { method: t.method };
  let body: unknown = null;
  if (t.method === "GET") {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)]))
    ).toString();
    if (qs) url += `?${qs}`;
  } else if (Object.keys(rest).length) {
    body = rest;
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(rest);
  }
  return { url, init, method: t.method, body };
}

function text(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
  };
}

/** PAYMENT-REQUIRED header'ı (base64 JSON) okunur objeye çevirir. */
function decodePaymentRequired(header: string | null): unknown {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Bir tool çağrısını işler: backend'e gider, 402'yi keyless yansıtır. */
async function callTool(t: ToolMeta, args: Record<string, unknown>) {
  const { url, init, method, body } = buildRequest(t, args ?? {});
  let res: Response;
  try {
    res = await fetch(url, init); // düz fetch — ödeme YOK, key YOK
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    return {
      ...text({
        status: "backend_unreachable",
        url,
        error: msg,
      }),
      isError: true,
    };
  }

  // Beklenen yol: backend ücretli → 402 + PAYMENT-REQUIRED.
  if (res.status === 402) {
    const header = res.headers.get("PAYMENT-REQUIRED");
    const paymentRequired =
      decodePaymentRequired(header) ?? header ?? (await res.text());
    return text({
      status: "payment_required",
      instruction:
        "Bu işlem ücretli. Tamamlamak için Wallet MCP'nin pay_x402 tool'unu aşağıdaki " +
        "pay_with bilgisiyle çağır; ödeme onayı kullanıcının cüzdanında yapılır.",
      pay_with: { tool: "pay_x402", url, method, body },
      payment_required: paymentRequired,
    });
  }

  const payload = await res.text();
  const parsed = (() => {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  })();

  if (res.ok) return text({ status: "ok", result: parsed });
  return {
    ...text({ status: "error", http: res.status, body: parsed }),
    isError: true,
  };
}

/** Her istekte taze bir McpServer kurar (stateless Streamable HTTP). */
function buildServer(): McpServer {
  const server = new McpServer({ name: "twitter-x402", version: "0.1.0" });
  for (const t of REGISTRY) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.input.shape },
      (args: Record<string, unknown>) => callTool(t, args)
    );
  }
  return server;
}

function main() {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, backend: BACKEND_URL, tools: REGISTRY.length });
  });

  // Stateful Streamable HTTP: session id ile transport'lar kalıcı tutulur
  // (initialize → mcp-session-id header → sonraki istekler aynı session'da).
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post(MCP_PATH, async (req, res) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    try {
      let transport: StreamableHTTPServerTransport;
      if (sid && transports[sid]) {
        transport = transports[sid];
      } else if (!sid && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        await buildServer().connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: geçerli session id yok",
          },
          id: null,
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[twitter-mcp] request error:", err);
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    }
  });

  // GET (SSE stream) + DELETE (session sonlandırma) — mevcut session gerektirir.
  const handleSession = async (req: express.Request, res: express.Response) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    if (!sid || !transports[sid]) {
      res.status(400).send("Invalid or missing session id");
      return;
    }
    await transports[sid].handleRequest(req, res);
  };
  app.get(MCP_PATH, handleSession);
  app.delete(MCP_PATH, handleSession);

  app.listen(PORT, () => {
    console.error(
      `[twitter-mcp] keyless remote MCP (Streamable HTTP) :${PORT}${MCP_PATH}`
    );
    console.error(
      `[twitter-mcp] backend=${BACKEND_URL} tools=${REGISTRY.length}`
    );
  });
}

main();
