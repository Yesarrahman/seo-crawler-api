// ===================== SERP CRAWLER TYPES =====================
export interface SerpCrawlerConfig {
    keywords: string[];
    maxResults?: number;
    proxyUrls?: string[];
    minDelay?: number;
    maxDelay?: number;
}

export interface SERPResult {
    keyword: string;
    position: number;
    url: string;
    title: string;
    description: string;
    crawledAt: string;
}

// ===================== COMPETITOR CRAWLER TYPES =====================
export interface CompetitorCrawlerConfig {
    urls: string[];
    includeSnapshots?: boolean;
}

export interface PageContent {
    url: string;
    h1: string[];
    h2: string[];
    h3: string[];
    wordCount: number;
    contentHash: string;
    paragraphs: string[];
    images: number;
    internalLinks: number;
    externalLinks: number;
    crawledAt: string;
}

export interface ContentChange {
    headingsChanged: boolean;
    contentChanged: boolean;
    wordCountDiff: number;
    structureChanged: boolean;
}

export interface CompetitorResult {
    url: string;
    previousSnapshot: PageContent | null;
    currentSnapshot: PageContent;
    changes: ContentChange;
    hasChanges: boolean;
}

// ===================== REVIEW CRAWLER TYPES =====================
export type ReviewSourceType = 'google' | 'trustpilot' | 'g2';

export interface ReviewSource {
    type: ReviewSourceType;
    url: string;
    businessName: string;
}

export interface ReviewCrawlerConfig {
    sources: ReviewSource[];
    maxReviewsPerSource?: number;
}

export interface Review {
    source: ReviewSourceType;
    businessName: string;
    reviewerName: string;
    rating: number;
    reviewText: string;
    reviewDate: string;
    crawledAt: string;
}

export interface ReviewResult {
    source: ReviewSourceType;
    businessName: string;
    reviews: Review[];
    averageRating: number;
    totalReviews: number;
}

// ===================== API RESPONSE TYPES =====================
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    executionTime?: number;
}
