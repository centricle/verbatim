// Every /api response is a pure function of its URL and the database, and the
// database changes only when a loader runs. So Netlify's CDN holds each
// response for an hour in its durable cache, which is shared by every edge
// node: a URL costs about one function invocation an hour, however many
// people ask for it. Plain `Cache-Control` is cached per edge node, which
// under real traffic is nearly no cache at all (2026-11-18: six identical
// requests in a row were six misses and six invocations).
//
// After a load, a URL can keep answering with the old data until its hour
// is up. Each function tags its responses `api-<name>`, so a load can clear
// its own:
//
//   netlify api purgeCache --data '{"site_slug":"verbatim-fyi","cache_tags":["api-trades"]}'
//
// A deploy clears the cache as well. Browsers keep a response for 30
// seconds, as before, because nothing can purge a browser.
//
// No handler catches a database error: a throw reaches the visitor as a 500
// carrying none of these headers, so a failure is never cached.
export function jsonFor(name) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30',
    'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600, stale-while-revalidate=86400',
    'Netlify-Cache-Tag': `api,api-${name}`,
  }
  return (data, status = 200) => ({ statusCode: status, headers, body: JSON.stringify(data) })
}
