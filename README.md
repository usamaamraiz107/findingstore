# FindingStore

Upload a product photo (or paste an image URL). FindingStore identifies the product with Google Lens (via SerpAPI) and lists prices lowest-first for **local stores** (country auto-detected from IP, manually changeable) and **international stores**, with a "Similar items (lower confidence)" section for weaker matches.

## Run
```
npm install
SERPAPI_KEY=your_key node server.js   # http://localhost:8080
```
Without `SERPAPI_KEY` the app runs in clearly labelled DEMO (mock) mode. No dependencies beyond Node 20+.

## Environment
- `SERPAPI_KEY` – SerpAPI key (never commit it)
- `PORT` – default 8080

## Notes
- Uploaded photos are temporarily hosted on litterbox.catbox.moe (72h) so Lens can fetch them.
- Prices from the Google-search fallback are marked "from search results, verify on store".
- `cache.json` holds a seeded example result.

Deployed on Render (free): https://freefinding.store
