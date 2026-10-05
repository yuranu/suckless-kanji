// Redirect Worker for alternate hostnames (the old kanji.yuranu.com and www.suckless-kanji.com):
// 301 to the canonical domain, path and query kept. It is a separate Worker
// (server/redirect.wrangler.toml) so the main one never runs for static files: those are
// served directly by Cloudflare, free and outside the Worker request quota.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return new Response(null, {
      status: 301,
      headers: { location: `https://${env.CANONICAL_HOST}${url.pathname}${url.search}`, 'cache-control': 'public, max-age=86400' },
    });
  },
};
