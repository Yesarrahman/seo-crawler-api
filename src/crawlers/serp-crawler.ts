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
                headless: false,  // DEBUG: set to true for production
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

            // Allow page to load
            try {
                await page.waitForLoadState('networkidle', { timeout: 45000 });
            } catch {
                log.warning(`Timeout waiting for networkidle for keyword "${keyword}"`);
            }

            // Log URL & title so we know what we actually got
            const currentUrl = page.url();
            const title = await page.title();
            log.info(`Loaded URL: ${currentUrl}`);
            log.info(`Page title: ${title}`);

            if (currentUrl.includes('/sorry/')) {
                log.error('Blocked by Google (sorry page).');
                throw new Error('Blocked by Google (sorry page). Try headless: false or use proxies.');
            }

            // Handle Google consent / cookie screen if present
            await handleGoogleConsent(page);

            // Count result headings (any <h3> inside an <a>)
            const headingsCount = await page.evaluate(
                () => document.querySelectorAll('a h3').length,
            );
            log.info(`Found ${headingsCount} <h3> elements inside <a> tags`);

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
        if (
            !url.includes('consent.google') &&
            !url.includes('consent.') &&
            !url.includes('consent.youtube')
        ) {
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
 * Extract SERP results using the pattern "any <h3> inside an <a>".
 */
async function extractSerpResults(
    page: Page,
    keyword: string,
    maxResults: number,
): Promise<SERPResult[]> {
    return page.evaluate(
        ({ keyword, maxResults }) => {
            const results: SERPResult[] = [];

            // Find all headings that are children of links
            const headingNodes = Array.from(
                document.querySelectorAll<HTMLHeadingElement>('a h3'),
            );

            let position = 1;

            for (const h3 of headingNodes) {
                if (position > maxResults) break;

                const link = h3.closest('a');
                if (!link || !link.href) continue;

                // Try to find a nearby description snippet
                let description = '';
                const container = link.closest('div');

                if (container) {
                    const descEl =
                        container.querySelector<HTMLElement>('.VwiC3b') ??
                        container.querySelector<HTMLElement>('[data-sncf]') ??
                        container.querySelector<HTMLElement>('div[style*="-webkit-line-clamp"]');
                    description = descEl?.textContent?.trim() ?? '';
                }

                results.push({
                    keyword,
                    position,
                    url: link.href,
                    title: h3.textContent?.trim() || '',
                    description,
                    crawledAt: new Date().toISOString(),
                });

                position++;
            }

            return results;
        },
        { keyword, maxResults },
    );
}

export default runSerpCrawler;