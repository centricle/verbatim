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
//   netlify api purgeCache --data '{"body":{"site_slug":"verbatim-fyi","cache_tags":["api-trades"]}}'
//
// The CLI wants the payload under `body`; without it the API answers 400.
// The next request after a purge reaches the function and gets fresh data.
// A deploy clears the cache as well. Browsers keep a response for 30
// seconds, as before, because nothing can purge a browser.
//
// A failure never reaches these headers: guard() below answers it, uncached.
export function jsonFor(name) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30',
    'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600, stale-while-revalidate=86400',
    'Netlify-Cache-Tag': `api,api-${name}`,
  }
  return (data, status = 200) => ({ statusCode: status, headers, body: JSON.stringify(data) })
}

// Every handler is exported through guard(), so no error escapes it. One that
// did reached the visitor as Netlify's default 502: the error's name, its
// message and a /var/task stack trace (third pre-flip review, 2026-11-15).
// The visitor now gets one generic line and the detail goes to the function
// log. SQLSTATE class 22, a data exception (a value Postgres cannot cast, a
// number out of range, a NUL byte), comes from the request, so it answers
// 400; anything else is ours and answers 500. Neither is cached, by the CDN
// or the browser, so the next request after a fix gets a real answer.
// api.test.mjs fails any function in netlify/functions/ not exported
// this way.
const FAILURE_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

export function guard(name, handle) {
  return async (event) => {
    try {
      return await handle(event)
    } catch (err) {
      const badRequest = typeof err?.code === 'string' && err.code.startsWith('22')
      console.error(`api-${name}`, err?.code ?? '-', err?.message ?? String(err), event?.rawQuery ?? '')
      return {
        statusCode: badRequest ? 400 : 500,
        headers: FAILURE_HEADERS,
        body: JSON.stringify({ error: badRequest ? 'bad request' : 'server error' }),
      }
    }
  }
}
