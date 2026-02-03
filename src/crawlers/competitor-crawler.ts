import { PlaywrightCrawler, KeyValueStore } from 'crawlee';
import { Page } from 'playwright';
import crypto from 'crypto';
import type { CompetitorCrawlerConfig, CompetitorResult, PageContent, ContentChange } from '../types/index.js';

/**
 * Runs the competitor crawler and returns results in-memory
 */
export async function runCompetitorCrawler(config: CompetitorCrawlerConfig): Promise<CompetitorResult[]> {
    const { urls, includeSnapshots = true } = config;

    // Validate input
    if (!urls || urls.length === 0) {
        throw new Error('At least one URL is required');
    }

    // Collect results in memory
    const results: CompetitorResult[] = [];

    // Open snapshot store for comparison
    const snapshotStore = await KeyValueStore.open('competitor-snapshots');

    const crawler = new PlaywrightCrawler({
        maxConcurrency: 2,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,

        launchContext: {
            launchOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage'],
            },
        },

        async requestHandler({ request, page, log }) {
            const url = request.url;
            log.info(`Crawling competitor: ${url}`);

            // Wait for main content
            await page.waitForLoadState('domcontentloaded');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Extract page content
            const currentSnapshot = await extractPageContent(page, url);

            // Get previous snapshot
            const snapshotKey = createSnapshotKey(url);
            const previousSnapshot = await snapshotStore.getValue<PageContent>(snapshotKey);

            // Detect changes
            const changes = detectChanges(previousSnapshot, currentSnapshot);

            // Store current snapshot for future comparison
            if (includeSnapshots) {
                await snapshotStore.setValue(snapshotKey, currentSnapshot);
            }

            // Push to in-memory array (NOT Dataset)
            results.push({
                url,
                previousSnapshot: previousSnapshot || null,
                currentSnapshot,
                changes,
                hasChanges: Object.values(changes).some(v =>
                    typeof v === 'boolean' ? v : v !== 0
                ),
            });

            log.info(`Completed: ${url} - Changes detected: ${JSON.stringify(changes)}`);
        },

        failedRequestHandler({ request, log }) {
            log.error(`Failed to crawl: ${request.url}`);
        },
    });

    const requests = urls.map(url => ({ url }));
    await crawler.run(requests);

    return results;
}

async function extractPageContent(page: Page, url: string): Promise<PageContent> {
    const content = await page.evaluate((url) => {
        const getText = (selector: string): string[] => {
            return Array.from(document.querySelectorAll(selector))
                .map(el => el.textContent?.trim() || '')
                .filter(Boolean);
        };

        const bodyText = document.body?.innerText || '';
        const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const currentHost = window.location.hostname;

        let internalLinks = 0;
        let externalLinks = 0;

        allLinks.forEach(link => {
            try {
                const linkUrl = new URL((link as HTMLAnchorElement).href);
                if (linkUrl.hostname === currentHost) {
                    internalLinks++;
                } else {
                    externalLinks++;
                }
            } catch { }
        });

        return {
            url,
            h1: getText('h1'),
            h2: getText('h2'),
            h3: getText('h3'),
            wordCount,
            contentHash: '', // Will be computed server-side
            paragraphs: getText('p').slice(0, 10),
            images: document.querySelectorAll('img').length,
            internalLinks,
            externalLinks,
            crawledAt: new Date().toISOString(),
        };
    }, url);

    // Compute content hash server-side
    return {
        ...content,
        contentHash: crypto.createHash('md5')
            .update(JSON.stringify([content.h1, content.h2, content.h3, content.paragraphs]))
            .digest('hex'),
    };
}

function createSnapshotKey(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
}

function detectChanges(
    previous: PageContent | null | undefined,
    current: PageContent
): ContentChange {
    if (!previous) {
        return {
            headingsChanged: false,
            contentChanged: false,
            wordCountDiff: 0,
            structureChanged: false,
        };
    }

    const headingsChanged =
        JSON.stringify([previous.h1, previous.h2, previous.h3]) !==
        JSON.stringify([current.h1, current.h2, current.h3]);

    const contentChanged = previous.contentHash !== current.contentHash;
    const wordCountDiff = current.wordCount - previous.wordCount;

    const structureChanged =
        previous.images !== current.images ||
        Math.abs(previous.internalLinks - current.internalLinks) > 5;

    return {
        headingsChanged,
        contentChanged,
        wordCountDiff,
        structureChanged,
    };
}

export default runCompetitorCrawler;