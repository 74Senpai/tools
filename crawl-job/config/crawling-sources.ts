export interface CrawlSource {
  name: string;
  url: string;
  enabled: boolean;
  sport?: string;
  area?: string;
}

export const CRAWLING_CONFIG = {
  postThresholdPerPage: 20,
  maxCrawlTimeMinutes: 30,
  checkIntervalSeconds: 2,
};
