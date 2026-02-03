import { PlaywrightCrawler } from 'crawlee';
import { Page } from 'playwright';
import type { ReviewCrawlerConfig, ReviewResult, Review, ReviewSource } from '../types/index.js';

/**
 * Runs the review crawler and returns results in-memory
 */
export async function runReviewCrawler(config: ReviewCrawlerConfig): Promise<ReviewResult[]> {
    const { sources, maxReviewsPerSource = 50 } = config;

    // Validate input
    if (!sources || sources.length === 0) {
        throw new Error('At least one review source is required');
    }

    // Collect results in memory
    const results: ReviewResult[] = [];

    const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 90,

        launchContext: {
            launchOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage'],
            },
        },

        async requestHandler({ request, page, log }) {
            const source = request.userData as ReviewSource;
            log.info(`Crawling ${source.type} reviews for: ${source.businessName}`);

            await page.waitForLoadState('networkidle');
            await new Promise(resolve => setTimeout(resolve, 3000));

            let reviews: Review[] = [];

            switch (source.type) {
                case 'trustpilot':
                    reviews = await extractTrustpilotReviews(page, source.businessName, maxReviewsPerSource);
                    break;
                case 'g2':
                    reviews = await extractG2Reviews(page, source.businessName, maxReviewsPerSource);
                    break;
                case 'google':
                    reviews = await extractGoogleReviews(page, source.businessName, maxReviewsPerSource);
                    break;
            }

            // Calculate stats
            const totalReviews = reviews.length;
            const averageRating = totalReviews > 0
                ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
                : 0;

            // Push to in-memory array (NOT Dataset)
            results.push({
                source: source.type,
                businessName: source.businessName,
                reviews,
                averageRating: Math.round(averageRating * 100) / 100,
                totalReviews,
            });

            log.info(`Extracted ${reviews.length} reviews from ${source.type}`);
        },

        failedRequestHandler({ request, log }) {
            log.error(`Failed: ${request.url}`);
        },
    });

    const requests = sources.map(source => ({
        url: source.url,
        userData: source,
    }));

    await crawler.run(requests);

    return results;
}

async function extractTrustpilotReviews(
    page: Page,
    businessName: string,
    maxReviews: number
): Promise<Review[]> {
    // Scroll to load more reviews
    await autoScroll(page);

    return page.evaluate(({ businessName, maxReviews }) => {
        const reviews: Review[] = [];
        const reviewCards = document.querySelectorAll('[data-service-review-card-paper]');

        reviewCards.forEach((card, index) => {
            if (index >= maxReviews) return;

            const reviewerEl = card.querySelector('[data-consumer-name-typography]');
            const ratingEl = card.querySelector('[data-service-review-rating]');
            const textEl = card.querySelector('[data-service-review-text-typography]');
            const dateEl = card.querySelector('time');

            if (reviewerEl && textEl) {
                const ratingAttr = ratingEl?.getAttribute('data-service-review-rating');
                reviews.push({
                    source: 'trustpilot',
                    businessName,
                    reviewerName: reviewerEl.textContent?.trim() || 'Anonymous',
                    rating: ratingAttr ? parseInt(ratingAttr) : 0,
                    reviewText: textEl.textContent?.trim() || '',
                    reviewDate: dateEl?.getAttribute('datetime') || '',
                    crawledAt: new Date().toISOString(),
                });
            }
        });

        return reviews;
    }, { businessName, maxReviews });
}

async function extractG2Reviews(
    page: Page,
    businessName: string,
    maxReviews: number
): Promise<Review[]> {
    await autoScroll(page);

    return page.evaluate(({ businessName, maxReviews }) => {
        const reviews: Review[] = [];
        const reviewCards = document.querySelectorAll('[itemprop="review"]');

        reviewCards.forEach((card, index) => {
            if (index >= maxReviews) return;

            const reviewerEl = card.querySelector('[itemprop="author"]');
            const ratingEl = card.querySelector('[itemprop="ratingValue"]');
            const textEl = card.querySelector('[itemprop="reviewBody"]');
            const dateEl = card.querySelector('[itemprop="datePublished"]');

            if (textEl) {
                reviews.push({
                    source: 'g2',
                    businessName,
                    reviewerName: reviewerEl?.textContent?.trim() || 'Anonymous',
                    rating: ratingEl ? parseFloat(ratingEl.getAttribute('content') || '0') : 0,
                    reviewText: textEl.textContent?.trim() || '',
                    reviewDate: dateEl?.getAttribute('content') || '',
                    crawledAt: new Date().toISOString(),
                });
            }
        });

        return reviews;
    }, { businessName, maxReviews });
}

async function extractGoogleReviews(
    page: Page,
    businessName: string,
    maxReviews: number
): Promise<Review[]> {
    // Click to expand reviews if needed
    const moreButton = await page.$('[aria-label="More reviews"]');
    if (moreButton) {
        await moreButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await autoScroll(page);

    return page.evaluate(({ businessName, maxReviews }) => {
        const reviews: Review[] = [];
        const reviewCards = document.querySelectorAll('[data-review-id]');

        reviewCards.forEach((card, index) => {
            if (index >= maxReviews) return;

            const reviewerEl = card.querySelector('[class*="reviewer"]') ||
                card.querySelector('[aria-label*="Photo of"]');
            const ratingEl = card.querySelector('[aria-label*="stars"]');
            const textEl = card.querySelector('[class*="review-text"], .review-full-text');
            const dateEl = card.querySelector('[class*="review-date"]');

            if (textEl) {
                const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/(\d)/);
                reviews.push({
                    source: 'google',
                    businessName,
                    reviewerName: reviewerEl?.textContent?.trim() || 'Anonymous',
                    rating: ratingMatch ? parseInt(ratingMatch[1]) : 0,
                    reviewText: textEl.textContent?.trim() || '',
                    reviewDate: dateEl?.textContent?.trim() || '',
                    crawledAt: new Date().toISOString(),
                });
            }
        });

        return reviews;
    }, { businessName, maxReviews });
}

async function autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 300;
            const maxScrolls = 10;
            let scrollCount = 0;

            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                scrollCount++;

                if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });
}

export default runReviewCrawler;