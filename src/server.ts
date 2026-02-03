import express, { Request, Response, NextFunction } from 'express';
import { runSerpCrawler } from './crawlers/serp-crawler.js';
import { runCompetitorCrawler } from './crawlers/competitor-crawler.js';
import { runReviewCrawler } from './crawlers/review-crawler.js';
import type {
    SerpCrawlerConfig,
    CompetitorCrawlerConfig,
    ReviewCrawlerConfig,
    ApiResponse,
    SERPResult,
    CompetitorResult,
    ReviewResult,
} from './types/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ===================== POST /serp =====================
interface SerpRequestBody {
    keywords: string[];
    maxResults?: number;
    proxyUrls?: string[];
    minDelay?: number;
    maxDelay?: number;
}

app.post('/serp', async (req: Request<{}, ApiResponse<SERPResult[]>, SerpRequestBody>, res: Response) => {
    const startTime = Date.now();

    try {
        const { keywords, maxResults, proxyUrls, minDelay, maxDelay } = req.body;

        // Validation
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: "keywords" must be a non-empty array of strings',
            });
        }

        if (!keywords.every(k => typeof k === 'string')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: all keywords must be strings',
            });
        }

        // Build config with defaults
        const config: SerpCrawlerConfig = {
            keywords,
            maxResults: maxResults ?? 10,
            proxyUrls: proxyUrls ?? undefined,
            minDelay: minDelay ?? 3000,
            maxDelay: maxDelay ?? 8000,
        };

        console.log(`Starting SERP crawl for ${keywords.length} keywords`);

        const data = await runSerpCrawler(config);

        const executionTime = Date.now() - startTime;
        console.log(`SERP crawl completed in ${executionTime}ms, found ${data.length} results`);

        return res.json({
            success: true,
            data,
            executionTime,
        });
    } catch (error) {
        console.error('SERP crawler error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            executionTime: Date.now() - startTime,
        });
    }
});

// ===================== POST /competitor =====================
interface CompetitorRequestBody {
    urls: string[];
    includeSnapshots?: boolean;
}

app.post('/competitor', async (req: Request<{}, ApiResponse<CompetitorResult[]>, CompetitorRequestBody>, res: Response) => {
    const startTime = Date.now();

    try {
        const { urls, includeSnapshots } = req.body;

        // Validation
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: "urls" must be a non-empty array of URL strings',
            });
        }

        // Validate URLs
        for (const url of urls) {
            try {
                new URL(url);
            } catch {
                return res.status(400).json({
                    success: false,
                    error: `Invalid URL: "${url}"`,
                });
            }
        }

        const config: CompetitorCrawlerConfig = {
            urls,
            includeSnapshots: includeSnapshots ?? true,
        };

        console.log(`Starting competitor crawl for ${urls.length} URLs`);

        const data = await runCompetitorCrawler(config);

        const executionTime = Date.now() - startTime;
        console.log(`Competitor crawl completed in ${executionTime}ms`);

        return res.json({
            success: true,
            data,
            executionTime,
        });
    } catch (error) {
        console.error('Competitor crawler error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            executionTime: Date.now() - startTime,
        });
    }
});

// ===================== POST /reviews =====================
interface ReviewsRequestBody {
    sources: Array<{
        type: 'google' | 'trustpilot' | 'g2';
        url: string;
        businessName: string;
    }>;
    maxReviewsPerSource?: number;
}

app.post('/reviews', async (req: Request<{}, ApiResponse<ReviewResult[]>, ReviewsRequestBody>, res: Response) => {
    const startTime = Date.now();

    try {
        const { sources, maxReviewsPerSource } = req.body;

        // Validation
        if (!sources || !Array.isArray(sources) || sources.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: "sources" must be a non-empty array',
            });
        }

        // Validate each source
        for (const source of sources) {
            if (!source.type || !['google', 'trustpilot', 'g2'].includes(source.type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid source type. Must be "google", "trustpilot", or "g2"',
                });
            }
            if (!source.url || typeof source.url !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Each source must have a valid "url" string',
                });
            }
            if (!source.businessName || typeof source.businessName !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Each source must have a valid "businessName" string',
                });
            }
        }

        const config: ReviewCrawlerConfig = {
            sources,
            maxReviewsPerSource: maxReviewsPerSource ?? 50,
        };

        console.log(`Starting review crawl for ${sources.length} sources`);

        const data = await runReviewCrawler(config);

        const executionTime = Date.now() - startTime;
        console.log(`Review crawl completed in ${executionTime}ms`);

        return res.json({
            success: true,
            data,
            executionTime,
        });
    } catch (error) {
        console.error('Review crawler error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            executionTime: Date.now() - startTime,
        });
    }
});

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
    });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Crawler API server running on port ${PORT}`);
    console.log(`📍 Endpoints available:`);
    console.log(`   POST /serp       - SERP crawler`);
    console.log(`   POST /competitor - Competitor crawler`);
    console.log(`   POST /reviews    - Review crawler`);
    console.log(`   GET  /health     - Health check`);
});

export default app;