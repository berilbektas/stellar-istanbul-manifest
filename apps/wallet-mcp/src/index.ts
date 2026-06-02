/**
 * @wallet-mcp/mcp — Wallet MCP (manifest Component 1)
 *
 * A stdio MCP server on the agent host (e.g. Claude Desktop). It holds NO
 * private key: every signature is round-tripped through the transporter to the
 * user's forked Freighter, where the real key signs (manifest §4, §5, §10).
 *
 * Tools (manifest §10):
 *   setup_wallet(publicKey, totpCode)      -> pair; write JWT to ~/.wallet-mcp/creds.json
 *   wallet_status()                        -> { paired, publicKey? }
 *   pay_x402(url, method?, body?)          -> { resource, receipt }
 *   sign_transaction(xdr, submit?=true)    -> { signedXdr? } | { txHash, status }
 *
 * stdio transport: NOTHING may be written to stdout except JSON-RPC — all logs
 * go to stderr (console.error).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";
import { config } from "./config.js";
import { readCreds, writeCreds } from "./creds.js";
import { createRemoteSigner, type MetaRef } from "./remote-signer.js";
import { SignError, TransporterClient } from "./transporter-client.js";
import type { Creds, SignMeta } from "./types.js";
import { payX402 } from "./x402.js";

const transporter = new TransporterClient(config.transporterUrl);
const poll = {
  timeoutMs: config.signPollTimeoutMs,
  intervalMs: config.signPollIntervalMs,
};

// --- tool result helpers ---------------------------------------------------

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

async function requirePaired(): Promise<Creds> {
  const creds = await readCreds();
  if (!creds) {
    throw new SignError(
      "wallet not paired — run setup_wallet with your public key and the " +
        "6-digit code from your wallet first"
    );
  }
  return creds;
}

function signerFor(creds: Creds, metaRef: MetaRef) {
  return createRemoteSigner({
    address: creds.publicKey,
    jwt: creds.jwt,
    transporter,
    metaRef,
    poll,
  });
}

/** Submit a signed XDR to Soroban RPC and poll for its result (manifest §8). */
async function submitToRpc(
  signedXdr: string
): Promise<{ txHash: string; status: string }> {
  const server = new rpc.Server(config.sorobanRpcUrl);
  const tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new SignError(
      `RPC rejected the transaction: ${JSON.stringify(
        sent.errorResult ?? sent.status
      )}`
    );
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(sent.hash);
    if (got.status !== "NOT_FOUND") {
      return { txHash: sent.hash, status: got.status };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return { txHash: sent.hash, status: "PENDING" };
}

// --- server + tools --------------------------------------------------------

const server = new McpServer({ name: "wallet-mcp", version: "0.1.0" });

server.registerTool(
  "setup_wallet",
  {
    title: "Pair this agent with your wallet",
    description:
      "Pair the agent with your forked Freighter wallet. Provide your Stellar " +
      "public key (G...) and the 6-digit code currently shown in the wallet. " +
      "Stores a pairing token locally. Your private key is never shared.",
    inputSchema: {
      publicKey: z.string().describe("Your Stellar public key (G...)"),
      totpCode: z
        .string()
        .describe("The 6-digit code currently shown in your wallet"),
    },
  },
  async ({ publicKey, totpCode }) => {
    try {
      const jwt = await transporter.pair(publicKey, totpCode);
      await writeCreds({
        jwt,
        publicKey,
        transporterUrl: config.transporterUrl,
        pairedAt: new Date().toISOString(),
      });
      return ok({ ok: true, publicKey });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "wallet_status",
  {
    title: "Wallet pairing status",
    description: "Report whether this agent is paired with a wallet.",
    inputSchema: {},
  },
  async () => {
    const creds = await readCreds();
    return ok({
      paired: creds !== null,
      publicKey: creds?.publicKey,
      transporterUrl: config.transporterUrl,
    });
  }
);

server.registerTool(
  "pay_x402",
  {
    title: "Pay an x402 paywall",
    description:
      "Fetch a URL; if it returns HTTP 402 (Payment Required), pay it via the " +
      "x402 protocol. The payment is signed in your wallet after you approve " +
      "it — no key is held here. Returns the resource and the settle receipt.",
    inputSchema: {
      url: z.string().describe("The URL to fetch / pay"),
      method: z
        .string()
        .optional()
        .describe("HTTP method (default GET, or POST when a body is given)"),
      body: z.unknown().optional().describe("Optional JSON request body"),
    },
  },
  async ({ url, method, body }) => {
    try {
      const creds = await requirePaired();
      const metaRef: MetaRef = { current: {} };
      const signer = signerFor(creds, metaRef);
      const result = await payX402({
        url,
        method: method ?? (body !== undefined ? "POST" : "GET"),
        body,
        signer,
        metaRef,
        config,
      });
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "sign_transaction",
  {
    title: "Sign (and optionally submit) a Stellar transaction",
    description:
      "Have your wallet sign a transaction XDR after you approve it. With " +
      "submit=true (default) it is sent to Soroban RPC and the tx hash is " +
      "returned; otherwise the signed XDR is returned. No key is held here.",
    inputSchema: {
      xdr: z.string().describe("The transaction envelope XDR to sign"),
      submit: z
        .boolean()
        .optional()
        .describe("Submit to Soroban RPC after signing (default true)"),
    },
  },
  async ({ xdr, submit }) => {
    try {
      const creds = await requirePaired();
      const metaRef: MetaRef = {
        current: { description: "Sign transaction (general)" } as SignMeta,
      };
      const signer = signerFor(creds, metaRef);
      if (!signer.signTransaction) {
        return fail(new SignError("signer does not support signTransaction"));
      }
      const { signedTxXdr } = await signer.signTransaction(xdr, {
        networkPassphrase: config.networkPassphrase,
      });
      if (submit === false) {
        return ok({ signedXdr: signedTxXdr });
      }
      return ok(await submitToRpc(signedTxXdr));
    } catch (err) {
      return fail(err);
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[wallet-mcp] ready · transporter=${config.transporterUrl} · network=${config.network}`
  );
}

main().catch((err) => {
  console.error("[wallet-mcp] fatal:", err);
  process.exit(1);
});
