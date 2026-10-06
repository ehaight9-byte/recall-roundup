# Recall Roundup

Static site of recent U.S. consumer product recalls, built from the public CPSC recall API.

- Netlify runs `node build.js` on every deploy (see `netlify.toml`); output goes to `dist/`.
- The build fetches live data. If the fetch fails or returns nothing, the build fails and the last good site stays live.
- To refresh the data, trigger a new deploy (any commit to `main` does it).
- `site.json`: site name, live URL (enables sitemap/robots/canonical), days of history, Google verification code.
- Local test without network: `RECALLS_FILE=fixture.json node build.js`
