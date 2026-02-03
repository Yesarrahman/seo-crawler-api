// src/crawlers/serp-crawler.ts
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import { Page } from 'playwright';
import type { SerpCrawlerConfig, SERPResult } from '../types/index.js';

/**
 * Runs the SERP crawler and returns results in-memory (no Dataset usage)
 */
export async function runSerpCrawler(config: SerpCrawlerConfig): Promise<SERPResult[]> {
    const {
        keywords,
        maxResults = 10,
        proxyUrls,
        minDelay = 3000,
        maxDelay = 8000,
    } = config;

    // Validate input
    if (!keywords || keywords.length === 0) {
        throw new Error('At least one keyword is required');
    }

    // Collect results in memory
    const results: SERPResult[] = [];

    // Configure proxy rotation for Google-safe crawling
    const proxyConfiguration = proxyUrls?.length
        ? new ProxyConfiguration({ proxyUrls })
        : undefined;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: 1, // Sequential for Google safety
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,

        // Browser configuration for stealth / debugging
        launchContext: {
            launchOptions: {
                headless: true, // set to true again for production
                // slowMo: 200,     // slow actions so you can see what's happening
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                ],
            },
        },

        // Pre-navigation hooks for stealth
        preNavigationHooks: [
            async ({ page }) => {
                // Set realistic viewport
                await page.setViewportSize({ width: 1920, height: 1080 });

                // Override navigator.webdriver
                await page.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                });

                // Set realistic headers
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                });
            },
        ],

        async requestHandler({ request, page, log }) {
            const keyword = request.userData.keyword as string;
            log.info(`Crawling SERP for: ${keyword}`);

            // Let the page fully load
            try {
                await page.waitForLoadState('networkidle', { timeout: 45000 });
            } catch {
                log.warning(`Timeout waiting for networkidle for keyword "${keyword}"`);
            }

            // Handle Google consent / cookie screen if present
            await handleGoogleConsent(page);

            // Try to ensure results container exists (but don't fail hard)
            try {
                await page.waitForSelector('#search', { timeout: 30000 });
            } catch {
                log.warning(`No #search container found for keyword "${keyword}"`);
            }

            // Random delay to mimic human behavior
            const delay = Math.random() * (maxDelay - minDelay) + minDelay;
            await new Promise((resolve) => setTimeout(resolve, delay));

            // Extract SERP results
            const pageResults = await extractSerpResults(page, keyword, maxResults);

            // Push to in-memory array (NOT Dataset)
            results.push(...pageResults);

            log.info(`Extracted ${pageResults.length} results for: ${keyword}`);
        },

        failedRequestHandler({ request, log }) {
            log.error(`Request failed: ${request.url}`);
        },
    });

    // Build request queue
    const requests = keywords.map((keyword) => ({
        url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}&num=${maxResults}`,
        userData: { keyword },
    }));

    // Run the crawler
    await crawler.run(requests);

    return results;
}

/**
 * Try to click through Google's consent / cookie page if it appears.
 */
async function handleGoogleConsent(page: Page): Promise<void> {
    try {
        const url = page.url();
        if (!url.includes('consent.google') && !url.includes('consent.') && !url.includes('consent.youtube')) {
            return;
        }

        console.log('Consent page detected, trying to accept…');

        const selectors = [
            'button[aria-label="Accept all"]',
            'button[aria-label="I agree"]',
            'button:has-text("I agree")',
            'button:has-text("Accept all")',
            'button:has-text("Accept")',
        ];

        for (const sel of selectors) {
            const btn = await page.$(sel);
            if (btn) {
                await btn.click();
                await page.waitForLoadState('networkidle', { timeout: 15000 });
                console.log('Consent accepted using selector:', sel);
                break;
            }
        }
    } catch (e) {
        console.warn('Consent handling failed:', e);
    }
}

/**
 * Extract SERP results from the currently loaded Google search page.
 * This version uses more defensive selectors to match current markup.
 */
async function extractSerpResults(
    page: Page,
    keyword: string,
    maxResults: number
): Promise<SERPResult[]> {
    return page.evaluate(
        ({ keyword, maxResults }) => {
            const results: SERPResult[] = [];

            // Different containers Google might use for organic results
            const cards = document.querySelectorAll(
                '#search .g, ' +
                '#search div.MjjYud, ' +
                '#search div[data-sokoban-container]'
            );

            let position = 1;

            for (const card of Array.from(cards)) {
                if (position > maxResults) break;

                const linkElement = card.querySelector('a[href^="http"]');
                const titleElement = card.querySelector('h3');
                const descElement =
                    card.querySelector('[data-sncf]') ||
                    card.querySelector('.VwiC3b') ||
                    card.querySelector('div[style*="-webkit-line-clamp"]');

                if (!linkElement || !titleElement) continue;

                results.push({
                    keyword,
                    position,
                    url: (linkElement as HTMLAnchorElement).href || '',
                    title: titleElement.textContent?.trim() || '',
                    description: descElement?.textContent?.trim() || '',
                    crawledAt: new Date().toISOString(),
                });

                position++;
            }

            return results;
        },
        { keyword, maxResults }
    );
}

export default runSerpCrawler;