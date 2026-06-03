import { TwitterApi } from "twitter-api-v2";
import { env } from "./env.js";
import type { TwitterCtx } from "./registry.js";

/**
 * TwitterApi client'ı OAuth 1.0a user-context ile kurar. Ağ çağrısı YAPMAZ
 * (startup'ta credential/ağ olmadan da boot edilebilsin → x402 gate'i 402'leri
 * Twitter'a hiç dokunmadan döndürebilir). Authed kullanıcı id'si (me()) ilk
 * ihtiyaçta lazy çekilir ve cache'lenir.
 */
export function makeCtx(): TwitterCtx {
  const client = new TwitterApi({
    appKey: env.TWITTER_APP_KEY,
    appSecret: env.TWITTER_APP_SECRET,
    accessToken: env.TWITTER_ACCESS_TOKEN,
    accessSecret: env.TWITTER_ACCESS_SECRET,
  });
  const v2 = client.v2;

  let meIdPromise: Promise<string> | null = null;
  const getMeId = () => {
    if (!meIdPromise) {
      meIdPromise = v2.me().then((r) => {
        console.error(
          `[twitter] authed as @${r.data.username} (id=${r.data.id})`
        );
        return r.data.id;
      });
    }
    return meIdPromise;
  };

  return { v2, getMeId };
}
