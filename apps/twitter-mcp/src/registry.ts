import { z } from "zod";

/**
 * twitter-mcp tool metadata'sı (KEYLESS görünüm).
 * twitter-backend'in HTTP API'sini ajana tool olarak sunmak için gereken her şey:
 * isim, açıklama, method, path, path param'lar, zod input şeması.
 * twitter-api-v2 çağrıları ve fiyatlar BURADA YOK — onlar backend'in işi; fiyat
 * zaten backend'in döndüğü PAYMENT-REQUIRED içinde gelir.
 */
export interface ToolMeta<
  S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  name: string;
  description: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  pathParams?: string[];
  input: S;
}

function def<S extends z.ZodObject<z.ZodRawShape>>(d: ToolMeta<S>): ToolMeta {
  return d as unknown as ToolMeta;
}

const PAID =
  "Ücretli (x402). 402 dönerse Wallet MCP'nin pay_x402(url, method, body) tool'unu pay_with bilgisiyle çağır; ödeme onayı kullanıcının cüzdanında yapılır.";

/** twitter-backend ile birebir aynı route yüzeyi. */
export const REGISTRY: ToolMeta[] = [
  def({
    name: "create_tweet",
    description: `Yeni bir tweet at. ${PAID}`,
    method: "POST",
    path: "/tweets",
    input: z.object({ text: z.string().min(1).max(280) }),
  }),
  def({
    name: "delete_tweet",
    description: `Sahip olduğun bir tweet'i sil. ${PAID}`,
    method: "DELETE",
    path: "/tweets/:id",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
  }),
  def({
    name: "get_tweet",
    description: `Tek bir tweet'i id ile getir. ${PAID}`,
    method: "GET",
    path: "/tweets/:id",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
  }),
  def({
    name: "search_recent",
    description: `Son tweet'leri anahtar kelimeyle ara. ${PAID}`,
    method: "GET",
    path: "/search",
    input: z.object({
      query: z.string().min(1),
      max_results: z.number().int().min(10).max(100).optional(),
    }),
  }),
  def({
    name: "user_timeline",
    description: `Bir kullanıcının tweet'lerini getir. ${PAID}`,
    method: "GET",
    path: "/users/:id/timeline",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
  }),
  def({
    name: "home_timeline",
    description: `Authed kullanıcının ana akışını getir. ${PAID}`,
    method: "GET",
    path: "/home",
    input: z.object({}),
  }),
  def({
    name: "mentions",
    description: `Authed kullanıcının mention'larını getir. ${PAID}`,
    method: "GET",
    path: "/mentions",
    input: z.object({}),
  }),
  def({
    name: "get_user",
    description: `Bir kullanıcıyı id ile getir. ${PAID}`,
    method: "GET",
    path: "/users/:id",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
  }),
  def({
    name: "get_user_by_username",
    description: `Bir kullanıcıyı username ile getir. ${PAID}`,
    method: "GET",
    path: "/users/by/username/:username",
    pathParams: ["username"],
    input: z.object({ username: z.string() }),
  }),
  def({
    name: "me",
    description: `Authed kullanıcıyı getir. ${PAID}`,
    method: "GET",
    path: "/me",
    input: z.object({}),
  }),
  def({
    name: "like",
    description: `Bir tweet'i beğen. ${PAID}`,
    method: "POST",
    path: "/likes",
    input: z.object({ tweet_id: z.string() }),
  }),
  def({
    name: "unlike",
    description: `Bir beğeniyi kaldır. ${PAID}`,
    method: "DELETE",
    path: "/likes/:tweet_id",
    pathParams: ["tweet_id"],
    input: z.object({ tweet_id: z.string() }),
  }),
  def({
    name: "retweet",
    description: `Bir tweet'i retweet et. ${PAID}`,
    method: "POST",
    path: "/retweets",
    input: z.object({ tweet_id: z.string() }),
  }),
  def({
    name: "unretweet",
    description: `Bir retweet'i geri al. ${PAID}`,
    method: "DELETE",
    path: "/retweets/:tweet_id",
    pathParams: ["tweet_id"],
    input: z.object({ tweet_id: z.string() }),
  }),
  def({
    name: "reply",
    description: `Bir tweet'e yanıt ver. ${PAID}`,
    method: "POST",
    path: "/replies",
    input: z.object({
      text: z.string().min(1).max(280),
      in_reply_to_tweet_id: z.string(),
    }),
  }),
  def({
    name: "bookmark",
    description: `Bir tweet'i yer imlerine ekle. ${PAID}`,
    method: "POST",
    path: "/bookmarks",
    input: z.object({ tweet_id: z.string() }),
  }),
  def({
    name: "remove_bookmark",
    description: `Bir yer imini kaldır. ${PAID}`,
    method: "DELETE",
    path: "/bookmarks/:tweet_id",
    pathParams: ["tweet_id"],
    input: z.object({ tweet_id: z.string() }),
  }),
  def({
    name: "follow",
    description: `Bir kullanıcıyı takip et. ${PAID}`,
    method: "POST",
    path: "/following",
    input: z.object({ target_user_id: z.string() }),
  }),
  def({
    name: "unfollow",
    description: `Bir kullanıcıyı takipten çık. ${PAID}`,
    method: "DELETE",
    path: "/following/:target_user_id",
    pathParams: ["target_user_id"],
    input: z.object({ target_user_id: z.string() }),
  }),
  def({
    name: "followers",
    description: `Bir kullanıcının takipçilerini listele. ${PAID}`,
    method: "GET",
    path: "/users/:id/followers",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
  }),
  def({
    name: "following",
    description: `Bir kullanıcının takip ettiklerini listele. ${PAID}`,
    method: "GET",
    path: "/users/:id/following",
    pathParams: ["id"],
    input: z.object({ id: z.string() }),
  }),
];
