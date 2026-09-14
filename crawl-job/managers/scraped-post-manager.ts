export interface ScrapedPost {
  authorName: string;
  authorLink?: string;
  postedAt?: string | null;
  postLink: string;
  postText: string;
  metadata?: Record<string, any>;
  matchedKeywords?: string[];
}

export class ScrapedPostManager {
  private posts: ScrapedPost[] = [];
  private seenLinks = new Set<string>();

  addStrict(post: ScrapedPost): boolean {
    if (!post || !post.postText) return false;
    if (post.postLink && this.seenLinks.has(post.postLink)) return false;
    if (post.postLink) this.seenLinks.add(post.postLink);
    this.posts.push(post);
    return true;
  }

  size(): number {
    return this.posts.length;
  }

  clear(): void {
    this.posts = [];
    this.seenLinks.clear();
  }

  getAllIncludingPending(): ScrapedPost[] {
    return [...this.posts];
  }
}
