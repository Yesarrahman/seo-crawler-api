# SEO Crawler API

A production-ready HTTP API for SEO intelligence crawling using Crawlee and Playwright.

## Features

- 🔍 **SERP Crawler** - Google-safe search results extraction
- 🏢 **Competitor Crawler** - Website content monitoring with change detection
- ⭐ **Review Crawler** - Multi-platform review aggregation (Trustpilot, G2, Google)
- 🛡️ **Google-Safe** - Rate limiting, delays, proxy support
- 📦 **Docker Ready** - Easy deployment

## Quick Start

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Build TypeScript
npm run build

# Start server
npm start
```

## API Endpoints

### Health Check
```bash
curl http://localhost:3000/health
```

### SERP Crawler
```bash
curl -X POST http://localhost:3000/serp \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["best seo tools 2024", "keyword research"],
    "maxResults": 10
  }'
```

### Competitor Crawler
```bash
curl -X POST http://localhost:3000/competitor \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com", "https://competitor.com"],
    "includeSnapshots": true
  }'
```

### Review Crawler
```bash
curl -X POST http://localhost:3000/reviews \
  -H "Content-Type: application/json" \
  -d '{
    "sources": [
      {
        "type": "trustpilot",
        "url": "https://www.trustpilot.com/review/example.com",
        "businessName": "Example Inc"
      }
    ],
    "maxReviewsPerSource": 20
  }'
```

## Deployment (Render.com)

1. Push to GitHub
2. Create new Web Service on Render
3. Configure:
   - **Build Command**: `npm ci && npx playwright install chromium --with-deps && npm run build`
   - **Start Command**: `npm start`
   - **Node Version**: 20

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| NODE_ENV | Environment | development |

## License

MIT
