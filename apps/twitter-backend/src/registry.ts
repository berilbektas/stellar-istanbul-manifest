import type { TwitterApiv2 } from "twitter-api-v2";
import { z } from "zod";

/**
 * Backend handler'larına geçilen runtime context.
 * getMeId: like/retweet/follow gibi çağrılar authed user id ister; ilk
 * ihtiyaçta v2.me() ile lazy çekilip cache'lenir.
 */
export interface TwitterCtx {
  v2: TwitterApiv2;
  getMeId: () => Promise<string>;
}

/**
 * X (Twitter) API pay-per-use fiyatları (~2026, temsilî).
 * Her x402 endpoint'i, ilgili X işleminin fiyatına eşittir (sıfır markup).
 * Rakamlar yıl içinde değişti → deploy öncesi X'in canlı pricing sayfasından TEYİT EDİLECEK.
 */
export const PRICES = {
  POST_READ: "$0.005", // post okuma: search, get_tweet, timeline'lar
  PROFILE_READ: "$0.01", // profil/owned okuma: user lookup, me
  POST_CREATE: "$0.01", // post oluşturma (URL yoksa)
  POST_CREATE_WITH_URL: "$0.20", // URL içeren post (yüksek tier, dinamik)
  ENGAGEMENT_WRITE: "$0.015", // like/retweet/follow/bookmark vb.
} as const;

/** Metinde URL var mı? (post-create dinamik fiyatlandırması için) */
export function textHasUrl(text: unknown): boolean {
  return typeof text === "string" && /\bhttps?:\/\/\S+/i.test(text);
}

/** create_tweet/reply için: body.text'te URL varsa yüksek tier fiyat. */
export function priceForText(body: unknown): string {
  const text = (body as { text?: unknown } | null | undefined)?.text;
  return textHasUrl(text) ? PRICES.POST_CREATE_WITH_URL : PRICES.POST_CREATE;
}

export interface ToolDef<
  S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  /** MCP tool adı, örn "create_tweet" */
  name: string;
  /** Ajana gösterilen açıklama */
  description: string;
  /** MCP ↔ backend arası HTTP verb */
  method: "GET" | "POST" | "DELETE";
  /** Backend yolu, örn "/tweets/:id" (x402 matcher :param destekler) */
  path: string;
  /** input alanlarından hangileri path param (kalanlar query[GET]/body[POST]) */
  pathParams?: string[];
  /** zod input şeması (iki tarafta da validate edilir) */
  input: S;
  /** Statik x402 fiyatı (X pay-per-use). */
  price: string;
  /** Opsiyonel dinamik fiyat: request body'sine göre per-request fiyat (URL'li post). */
  dynamicPrice?: (body: unknown) => string;
  /** Gerçek twitter-api-v2 çağrısı — SADECE backend'de çalışır. */
  call: (ctx: TwitterCtx, args: z.infer<S>) => Promise<unknown>;
}

function def<S extends z.ZodObject<z.ZodRawShape>>(d: ToolDef<S>): ToolDef {
  return d as unknown as ToolDef;
}

/**
 * TEK DOĞRULUK KAYNAĞI (backend tarafı).
 * Express route'ları ve x402 fiyat config'i bu array'den üretilir.
 * Tüm endpoint'ler ücretli; fiyat per-operation (X pay-per-use).
 */
export const REGISTRY: ToolDef[] = [
  // ---- Tweets ----
  def({
    name: "create_tweet",
    description:
      "Yeni bir tweet at. Ücretli (x402). 402 dönerse Wallet MCP'nin pay_x402(url, method, body) tool'unu pay_with bilgisiyle çağır.",
    method: "POST",
    path: "/tweets",
    input: z.object({ text: z.string().min(1).max(280) }),
    price: PRICES.POST_CREATE,
    dynamicPrice: priceForText,
    call: (ctx, a) => ctx.v2.tweet(a.text),
  }),
  def({
    name: "delete_tweet",
    description: "Sahip olduğun bir tweet'i sil. Ücretli (x402).",
    method: "DELETE",
    path: "/tweets/:id",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: (ctx, a) => ctx.v2.deleteTweet(a.id),
  }),
  def({
    name: "get_tweet",
    description: "Tek bir tweet'i id ile getir. Ücretli (x402).",
    method: "GET",
    path: "/tweets/:id",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
    price: PRICES.POST_READ,
    call: (ctx, a) => ctx.v2.singleTweet(a.id),
  }),
  // ---- Search ----
  def({
    name: "search_recent",
    description: "Son tweet'leri anahtar kelimeyle ara. Ücretli (x402).",
    method: "GET",
    path: "/search",
    input: z.object({
      query: z.string().min(1),
      max_results: z.number().int().min(10).max(100).optional(),
    }),
    price: PRICES.POST_READ,
    call: (ctx, a) =>
      ctx.v2.search(
        a.query,
        a.max_results ? { max_results: a.max_results } : undefined
      ),
  }),
  // ---- Timelines ----
  def({
    name: "user_timeline",
    description: "Bir kullanıcının tweet'lerini getir. Ücretli (x402).",
    method: "GET",
    path: "/users/:id/timeline",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
    price: PRICES.POST_READ,
    call: (ctx, a) => ctx.v2.userTimeline(a.id),
  }),
  def({
    name: "home_timeline",
    description:
      "Authed kullanıcının ana akışını (reverse-chron) getir. Ücretli (x402).",
    method: "GET",
    path: "/home",
    input: z.object({}),
    price: PRICES.POST_READ,
    call: (ctx) => ctx.v2.homeTimeline(),
  }),
  def({
    name: "mentions",
    description: "Authed kullanıcının mention'larını getir. Ücretli (x402).",
    method: "GET",
    path: "/mentions",
    input: z.object({}),
    price: PRICES.POST_READ,
    call: async (ctx) => ctx.v2.userMentionTimeline(await ctx.getMeId()),
  }),
  // ---- Users ----
  def({
    name: "get_user",
    description: "Bir kullanıcıyı id ile getir. Ücretli (x402).",
    method: "GET",
    path: "/users/:id",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
    price: PRICES.PROFILE_READ,
    call: (ctx, a) => ctx.v2.user(a.id),
  }),
  def({
    name: "get_user_by_username",
    description: "Bir kullanıcıyı username ile getir. Ücretli (x402).",
    method: "GET",
    path: "/users/by/username/:username",
    pathParams: ["username"],
    input: z.object({ username: z.string() }),
    price: PRICES.PROFILE_READ,
    call: (ctx, a) => ctx.v2.userByUsername(a.username),
  }),
  def({
    name: "me",
    description: "Authed kullanıcıyı getir. Ücretli (x402).",
    method: "GET",
    path: "/me",
    input: z.object({}),
    price: PRICES.PROFILE_READ,
    call: (ctx) => ctx.v2.me(),
  }),
  // ---- Engagement: likes ----
  def({
    name: "like",
    description: "Bir tweet'i beğen. Ücretli (x402).",
    method: "POST",
    path: "/likes",
    input: z.object({ tweet_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: async (ctx, a) => ctx.v2.like(await ctx.getMeId(), a.tweet_id),
  }),
  def({
    name: "unlike",
    description: "Bir beğeniyi kaldır. Ücretli (x402).",
    method: "DELETE",
    path: "/likes/:tweet_id",
    pathParams: ["tweet_id"],
    input: z.object({ tweet_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: async (ctx, a) => ctx.v2.unlike(await ctx.getMeId(), a.tweet_id),
  }),
  // ---- Engagement: retweets ----
  def({
    name: "retweet",
    description: "Bir tweet'i retweet et. Ücretli (x402).",
    method: "POST",
    path: "/retweets",
    input: z.object({ tweet_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: async (ctx, a) => ctx.v2.retweet(await ctx.getMeId(), a.tweet_id),
  }),
  def({
    name: "unretweet",
    description: "Bir retweet'i geri al. Ücretli (x402).",
    method: "DELETE",
    path: "/retweets/:tweet_id",
    pathParams: ["tweet_id"],
    input: z.object({ tweet_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: async (ctx, a) => ctx.v2.unretweet(await ctx.getMeId(), a.tweet_id),
  }),
  // ---- Reply ----
  def({
    name: "reply",
    description: "Bir tweet'e yanıt ver. Ücretli (x402).",
    method: "POST",
    path: "/replies",
    input: z.object({
      text: z.string().min(1).max(280),
      in_reply_to_tweet_id: z.string(),
    }),
    price: PRICES.POST_CREATE,
    dynamicPrice: priceForText,
    call: (ctx, a) => ctx.v2.reply(a.text, a.in_reply_to_tweet_id),
  }),
  // ---- Bookmarks ----
  def({
    name: "bookmark",
    description: "Bir tweet'i yer imlerine ekle. Ücretli (x402).",
    method: "POST",
    path: "/bookmarks",
    input: z.object({ tweet_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: (ctx, a) => ctx.v2.bookmark(a.tweet_id),
  }),
  def({
    name: "remove_bookmark",
    description: "Bir yer imini kaldır. Ücretli (x402).",
    method: "DELETE",
    path: "/bookmarks/:tweet_id",
    pathParams: ["tweet_id"],
    input: z.object({ tweet_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: (ctx, a) => ctx.v2.deleteBookmark(a.tweet_id),
  }),
  // ---- Follows ----
  def({
    name: "follow",
    description: "Bir kullanıcıyı takip et. Ücretli (x402).",
    method: "POST",
    path: "/following",
    input: z.object({ target_user_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: async (ctx, a) =>
      ctx.v2.follow(await ctx.getMeId(), a.target_user_id),
  }),
  def({
    name: "unfollow",
    description: "Bir kullanıcıyı takipten çık. Ücretli (x402).",
    method: "DELETE",
    path: "/following/:target_user_id",
    pathParams: ["target_user_id"],
    input: z.object({ target_user_id: z.string() }),
    price: PRICES.ENGAGEMENT_WRITE,
    call: async (ctx, a) =>
      ctx.v2.unfollow(await ctx.getMeId(), a.target_user_id),
  }),
  def({
    name: "followers",
    description: "Bir kullanıcının takipçilerini listele. Ücretli (x402).",
    method: "GET",
    path: "/users/:id/followers",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
    price: PRICES.POST_READ,
    call: (ctx, a) => ctx.v2.followers(a.id),
  }),
  def({
    name: "following",
    description: "Bir kullanıcının takip ettiklerini listele. Ücretli (x402).",
    method: "GET",
    path: "/users/:id/following",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
    price: PRICES.POST_READ,
    call: (ctx, a) => ctx.v2.following(a.id),
  }),
];
