import fs from "fs";
import path from "path";
import { logger } from "./utils/logger";
import { CRAWLING_CONFIG, CrawlSource } from "./config/crawling-sources";
import { getBrowser, safeGoto, blockUnnecessaryRequests } from "./lib/browser";
import { Browser, ElementHandle, Page } from "puppeteer";
import {
  ScrapedPost,
  ScrapedPostManager,
} from "./managers/scraped-post-manager";
import {
  FACEBOOK_SELECTORS,
  ROLE_BLACKLIST,
  TIME_SETS,
  TIME_REGEX_PATTERNS,
} from "./config/crawling-selectors";
import { TimeoutManager } from "./managers/timeout-mangager";
import { sleep } from "./utils/helper";
import { exportToSheet } from "./exporter";

export interface RawPost {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceUrl: string;
  postUrl: string;
  authorName: string;
  authorUrl: string;
  crawledAt: Date;
  postTime?: string;
  metadata?: Record<string, any>;
  matchedKeywords?: string[];
}

type ExtractedPostLink = {
  url: string;
  element: Element;
} | null;

const SCROLL_DELAY = 2000;
const MAX_SAME_COUNT_STREAK = 6;
const MAX_LOOP_COUNT = CRAWLING_CONFIG.postThresholdPerPage + 40;

function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchKeywordStandalone(postText: string, keyword: string): boolean {
  if (!postText || !keyword) return false;
  const normPostText = normalizeText(postText);
  const normKw = normalizeText(keyword);
  if (!normKw) return false;

  const escapedKw = escapeRegExp(normKw);
  const regex = new RegExp(`(?<![a-z0-9_])${escapedKw}(?![a-z0-9_])`, 'i');
  return regex.test(normPostText);
}

export function formatFacebookPostUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  let url = rawUrl.trim();
  if (url.startsWith("/")) {
    url = "https://www.facebook.com" + url;
  } else if (!url.startsWith("http")) {
    url = "https://www.facebook.com/" + url;
  }

  const postsRegex = /^(https?:\/\/(?:www\.|web\.|m\.)?facebook\.com\/(?:[^\/]+\/)?posts\/[^\/?#]+)/i;
  const match = url.match(postsRegex);
  if (match) {
    return match[1] + "/";
  }

  try {
    const parsed = new URL(url);
    const storyFbid = parsed.searchParams.get("story_fbid");
    const groupId = parsed.searchParams.get("id");
    if (storyFbid && groupId) {
      return `https://www.facebook.com/groups/${groupId}/posts/${storyFbid}/`;
    }
  } catch (e) {}

  const cleanBase = url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return cleanBase + "/";
}

export function getLocalDateTimeString(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export class PostCrawlerService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sources: CrawlSource[] = [];
  private keywords: string[] = [];
  private maxPostsPerSource = 20;
  private maxCrawlTimeMinutes = 30;
  private configPath: string;
  private scrapedPostManager: ScrapedPostManager;
  private timeoutManager: TimeoutManager;
  private headlessMode: boolean = false;
  private googleSheetsConfig?: any;

  constructor(configPath = "config.json") {
    this.configPath = path.resolve(configPath);
    this.scrapedPostManager = new ScrapedPostManager();
    this.timeoutManager = new TimeoutManager(500, 6000);
  }

  async initialize(headless: boolean = false): Promise<void> {
    try {
      logger.info(`🔧 Initializing Puppeteer browser (headless: ${headless})...`);
      this.browser = await getBrowser(headless);
      const pages = await this.browser.pages();
      this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
      this.page.setDefaultTimeout(0);
      this.page.setDefaultNavigationTimeout(0);
      await blockUnnecessaryRequests(this.page);
    } catch (error) {
      logger.error("❌ Browser launch failed:", error);
    }
  }

  async initScript(page: Page | null) {
    if (!page) return;
    const serializableData = {
      FACEBOOK_SELECTORS,
      ROLE_BLACKLIST,
      TIME_SETS: Object.entries(TIME_SETS).reduce(
        (acc, [key, set]) => {
          acc[key] = Array.from(set);
          return acc;
        },
        {} as Record<string, string[]>,
      ),
      TIME_REGEX_PATTERNS: TIME_REGEX_PATTERNS.map((r) => r.source),

      DELAYS: {
        EXPAND_CONTENT_DELAY: 200,
        HOVER_LINK_DELAY: 500,
        SCROLL_POST_TO_VIEW: 300,
        CHANGE_DOM_DELAY: 150,
      },
    };

    await page.evaluateOnNewDocument(
      ({
        FACEBOOK_SELECTORS,
        ROLE_BLACKLIST,
        TIME_SETS,
        TIME_REGEX_PATTERNS,
        DELAYS,
      }) => {
        //@ts-ignore
        window.__crawler__ = (() => {
          const crawlingUtils = {
            isDescendantUntil(
              el: Element,
              stopSelector: string,
              matchSelector: string,
            ): boolean {
              let current: Element | null = el;
              while (current) {
                if (current.matches(stopSelector)) return false;
                if (current.matches(matchSelector)) return true;
                current = current.parentElement;
              }
              return false;
            },

            isFacebookTime(text: string, isStrict: boolean = false): boolean {
              const regexList = TIME_REGEX_PATTERNS.map(
                (p) => new RegExp(p, "i"),
              );
              const raw = text.trim().toLowerCase();

              if (regexList.some((p) => p.test(raw))) return true;

              if (isStrict) {
                const chars = new Set<string>(raw.replace(/[0-9\s]+/g, ""));
                for (const arr of Object.values(TIME_SETS)) {
                  if ([...chars].every((c) => arr.includes(c))) return true;
                }
              }

              return false;
            },

            extractTextFromElement(root: Element | null): string {
              if (!root) return "";
              const walker: TreeWalker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
              );
              const zeroOffsetElements: HTMLElement[] = [];
              let current: Node | null = walker.nextNode();
              while (current) {
                const el = current as HTMLElement;
                if (el.offsetTop === 0) zeroOffsetElements.push(el);
                current = walker.nextNode();
              }
              zeroOffsetElements.sort((a, b) => a.offsetLeft - b.offsetLeft);
              const text: string = zeroOffsetElements
                .map((el) => el.textContent?.trim() || "")
                .join("");
              return text || (root as HTMLElement).innerText || "";
            },
          };

          const PostExtractor = {
            getAuthor(el: Element) {
              const profile = el.querySelector(FACEBOOK_SELECTORS.profileName);
              const anchor = profile?.querySelector(
                FACEBOOK_SELECTORS.authorAnchor,
              );
              const authorName: string | undefined =
                anchor?.textContent?.trim();
              const authorLink: string = anchor?.getAttribute("href") || "";
              return authorName ? { authorName, authorLink } : null;
            },

            async getPostText(el: Element): Promise<string | null> {
              const contentEl: Element | null =
                el.querySelector(FACEBOOK_SELECTORS.storyMessage[0]) ??
                el.querySelector(FACEBOOK_SELECTORS.storyMessage[1]);
              if (!contentEl) return null;

              const seeMoreButton: Element | null = contentEl.querySelector(
                FACEBOOK_SELECTORS.seeMoreButton,
              );
              if (seeMoreButton) {
                (seeMoreButton as HTMLElement).click();
                await new Promise<void>((r) =>
                  setTimeout(r, DELAYS.EXPAND_CONTENT_DELAY),
                );
              }

              const dialog: Element | null = document.querySelector(
                FACEBOOK_SELECTORS.dialogView,
              );
              if (dialog) {
                const closeBtn: Element | null = dialog.querySelector(
                  FACEBOOK_SELECTORS.dialogCloseButton,
                );
                (closeBtn as HTMLElement | null)?.click();
                await new Promise<void>((r) =>
                  setTimeout(r, DELAYS.CHANGE_DOM_DELAY),
                );
              }

              // Hide interactive buttons ("See more", "See less", "Ẩn bớt") so they are not included in innerText
              const buttons = contentEl.querySelectorAll(
                FACEBOOK_SELECTORS.seeMoreButton,
              );
              buttons.forEach((btn) => {
                const text = btn.textContent?.toLowerCase() || "";
                if (
                  text.includes("see more") ||
                  text.includes("see less") ||
                  text.includes("xem thêm") ||
                  text.includes("ẩn bớt")
                ) {
                  (btn as HTMLElement).style.display = "none";
                }
              });

              return (contentEl as HTMLElement).innerText?.trim() || null;
            },

            filterPostLinks(linksArray: Element[]): Element[] {
              return linksArray.filter((ele) => {
                const text: string = (ele.textContent || "").toLowerCase();
                const href: string = ele.getAttribute("href") || "";
                return (
                  href &&
                  !href.includes("user") &&
                  !href.includes("photo") &&
                  !href.includes("hashtag") &&
                  !href.includes("reel") &&
                  !href.includes("videos") &&
                  !href.includes("stories") &&
                  !ROLE_BLACKLIST.some((role) => text.includes(role))
                );
              });
            },

            findTimeElement(postLinks: Element[]): Element | undefined {
              for (const ele of postLinks) {
                const text = ele.textContent?.trim() || "";
                if (
                  text &&
                  //@ts-ignore
                  window.__crawler__.crawlingUtils.isFacebookTime(text)
                )
                  return ele;

                const zeroOffsetText =
                  //@ts-ignore
                  window.__crawler__.crawlingUtils.extractTextFromElement(ele);
                if (
                  zeroOffsetText &&
                  //@ts-ignore
                  window.__crawler__.crawlingUtils.isFacebookTime(
                    zeroOffsetText,
                  )
                )
                  return ele;
              }
              return postLinks[0];
            },

            async extractPostLink(
              postLinkEle: Element | undefined,
              linksArray: Element[],
            ): Promise<ExtractedPostLink> {
              if (!postLinkEle) {
                return null;
              }

              let href = postLinkEle.getAttribute("href");

              if (!href?.includes("/posts/") && !href?.includes("permalink")) {
                const postLink = linksArray.find((el) => {
                  const linkHref = el.getAttribute("href");

                  return (
                    linkHref?.includes("/posts/") ||
                    linkHref?.includes("permalink")
                  );
                });

                if (!postLink) {
                  return null;
                }

                href = postLink.getAttribute("href");

                if (!href) {
                  return null;
                }

                return {
                  url: href,
                  element: postLink,
                };
              }

              return {
                url: href,
                element: postLinkEle,
              };
            },
          };

          const CrawlManager = {
            markElement(
              element: Element,
              options: {
                visited?: number;
                crawled?: boolean;
                halfCrawled?: boolean;
                pass?: boolean;
              },
            ) {
              if (options.crawled) element.setAttribute("data-crawled", "true");
              if (options.pass) element.setAttribute("pass", "true");
            },

            // Chỉ đánh dấu bài viết là đã duyệt, KHÔNG xóa hay thay thế DOM
            markVisited(element: Element) {
              element.setAttribute("data-crawled", "true");
            },
          };

          return {
            DELAYS,
            crawlingUtils,
            PostExtractor,
            CrawlManager,
          };
        })();
      },
      serializableData,
    );
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
      logger.info("🔒 Page closed");
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      logger.info("🔒 Browser closed");
    }
  }

  /**
   * ĐỌC NGUỒN CÀO & TỪ KHÓA TỪ FILE JSON (config.json)
   */
  async fetchCrawlSources(): Promise<CrawlSource[]> {
    let resolvedPath = this.configPath;
    if (!fs.existsSync(resolvedPath)) {
      if (fs.existsSync(path.resolve("config.json"))) {
        resolvedPath = path.resolve("config.json");
      } else if (fs.existsSync(path.resolve("keywords.json"))) {
        resolvedPath = path.resolve("keywords.json");
      } else {
        throw new Error(`❌ Không tìm thấy file cấu hình: ${this.configPath}`);
      }
    }

    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const config = JSON.parse(raw);

    const rawSources = config.sources || [];
    this.keywords = config.keywords || [];
    this.maxPostsPerSource = config.max_posts_per_source || config.max_posts || 20;
    this.maxCrawlTimeMinutes = config.max_crawl_time_minutes || 30;
    this.headlessMode = config.headless_mode ?? false;
    this.googleSheetsConfig = config.google_sheets;

    this.sources = rawSources.map((src: any, idx: number) => {
      if (typeof src === "string") {
        return {
          name: `Nguồn #${idx + 1}: ${src}`,
          url: src,
          enabled: true,
        };
      }
      return {
        name: src.name || `Nguồn #${idx + 1}: ${src.url}`,
        url: src.url,
        enabled: src.enabled !== undefined ? src.enabled : true,
      };
    });

    logger.info(`📋 Đã nạp ${this.sources.length} nguồn cào và ${this.keywords.length} từ khóa lọc từ ${this.configPath}`);
    return this.sources;
  }

  async setUp(headless: boolean = false): Promise<void> {
    if (!this.browser || !this.browser.connected || !this.page) {
      await this.initialize(headless);
    }
    if (!this.browser) throw new Error("Browser not initialized");
    if (!this.page) throw new Error("Page not initialized");

    if (this.sources.length === 0) {
      await this.fetchCrawlSources();
    }

    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    );

    await this.page.setViewport({
      width: 1280,
      height: 1024,
      deviceScaleFactor: 0.75,
    });

    await this.initScript(this.page);
  }

  async checkUrlTrigger(): Promise<string | null> {
    if (!this.page) return null;
    try {
      return await this.page.evaluate(() => {
        const href = window.location.href || "";
        const hash = window.location.hash || "";
        const url = document.URL || "";
        if (href.includes("###")) return href;
        if (hash.includes("###")) return hash;
        if (url.includes("###")) return url;
        return null;
      });
    } catch (e) {
      return null;
    }
  }

  async *crawlAllSources(): AsyncGenerator<RawPost[], void, unknown> {
    try {
      await this.fetchCrawlSources();

      // Trường hợp 1: Cấu hình "headless_mode": true trong config.json -> Chạy trực tiếp Headless không cần chờ trigger
      if (this.headlessMode) {
        logger.info("🚀 CHẾ ĐỘ HEADLESS TỰ ĐỘNG ĐƯỢC BẬT (headless_mode: true trong config.json)...");
        await this.setUp(true);

        for (let idx = 0; idx < this.sources.length; idx++) {
          const source = this.sources[idx];
          if (!source || !source.enabled) continue;

          this.scrapedPostManager.clear();
          try {
            logger.info(`🕷️ [Headless] Crawling source: ${source.name} (${source.url})`);
            await this.crawlSource(source);
          } catch (error) {
            logger.error(`❌ Failed to crawl source ${source.name}:`, error);
          }

          const sizeScrap = this.scrapedPostManager.size();
          if (sizeScrap > 0) {
            logger.info(`✅ Crawled & saved ${sizeScrap} matched posts from ${source.name}.`);
            const transFormPosts = this.transformToRawPosts(
              this.scrapedPostManager.getAllIncludingPending(),
              source,
            );
            yield transFormPosts;
          } else {
            logger.warn(`No matched posts crawled from ${source.name}`);
            yield [];
          }

          this.scrapedPostManager.clear();
          if (idx < this.sources.length - 1) {
            await sleep(3000 + Math.floor(Math.random() * 2000));
          }
        }
        logger.info("\n🎉 ĐÃ HOÀN THÀNH CÀO TẤT CẢ CÁC NGUỒN TRONG CHẾ ĐỘ HEADLESS!");
        return;
      }

      // Trường hợp 2: Mở trình duyệt giao diện cho người dùng thao tác / trigger /###
      await this.setUp(false);

      const startTime = Date.now();
      this.page = await safeGoto(this.page!, "https://www.facebook.com");
      this.timeoutManager.updateNetworkSpeed(Date.now() - startTime);

      logger.info("==================================================");
      logger.info("👉 HƯỚNG DẪN KÍCH HOẠT CÀO DỮ LIỆU:");
      logger.info("1. Cửa sổ trình duyệt Chrome đã mở.");
      logger.info("2. Đăng nhập Facebook (nếu chưa có session trong user_profile).");
      logger.info("3. Khi đăng nhập xong & muốn chạy cào: Thêm '/###' vào cuối thanh địa chỉ URL rồi bấm Enter.");
      logger.info("   (Ví dụ: https://www.facebook.com/###)");
      logger.info("   -> Trình duyệt có giao diện sẽ tự đóng và CHUYỂN SANG HEADLESS CHẠY ẨN!");
      logger.info("==================================================");
      logger.info("🔍 ĐANG GIÁM SÁT THANH ĐỊA CHỈ TRÌNH DUYỆT (CHỜ BẠN THÊM /###)...");

      while (true) {
        const triggerUrl = await this.checkUrlTrigger();
        if (triggerUrl) {
          logger.info(`⚡ ĐÃ PHÁT HIỆN TÍN HIỆU TRIGGER /### TẠI: ${triggerUrl}`);
          logger.info("🙈 Đang đóng trình duyệt hiện tại và chuyển sang trình duyệt HEADLESS (chạy ẩn)...");

          // Đóng trình duyệt có giao diện
          await this.close();

          // Mở trình duyệt mới ở chế độ HEADLESS (sử dụng lại user_profile đã có)
          await this.setUp(true);

          logger.info(`🔄 BẮT ĐẦU CÀO LẦN LƯỢT ${this.sources.length} NGUỒN TRONG config.json...\n`);

          const sources = this.sources;
          for (let idx = 0; idx < sources.length; idx++) {
            const source = sources[idx];
            if (!source || !source.enabled) continue;

            this.scrapedPostManager.clear();

            try {
              logger.info(`🕷️ [Headless] Crawling source: ${source.name} (${source.url})`);
              await this.crawlSource(source);
            } catch (error) {
              logger.error(`❌ Failed to crawl source ${source.name}:`, error);
            }

            const sizeScrap = this.scrapedPostManager.size();
            if (sizeScrap > 0) {
              logger.info(`✅ Crawled & saved ${sizeScrap} matched posts from ${source.name}.`);
              const transFormPosts = this.transformToRawPosts(
                this.scrapedPostManager.getAllIncludingPending(),
                source,
              );
              yield transFormPosts;
            } else {
              logger.warn(`No matched posts crawled from ${source.name}`);
              yield [];
            }

            this.scrapedPostManager.clear();
            const isLast = idx === sources.length - 1;
            if (!isLast) {
              await sleep(3000 + Math.floor(Math.random() * 2000));
            }
          }

          logger.info("\n🎉 ĐÃ HOÀN THÀNH CÀO TẤT CẢ CÁC NGUỒN TRONG CHẾ ĐỘ HEADLESS!");

          // Đóng trình duyệt headless và khôi phục trình duyệt giao diện để tiếp tục chờ trigger
          await this.close();
          logger.info("🖥️ Đang mở lại trình duyệt có giao diện để tiếp tục giám sát trigger /###...");
          await this.setUp(false);
          this.page = await safeGoto(this.page!, "https://www.facebook.com");
          logger.info("🔍 ĐANG GIÁM SÁT THANH ĐỊA CHỈ TRÌNH DUYỆT (THÊM /### ĐỂ CHẠY LẠI)...");
        }

        await sleep(1000);
      }
    } finally {
      await this.close();
    }
  }

  private async crawlSource(source: CrawlSource): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");
    let page = this.page;

    try {
      const cleanUrl = source.url.replace("###", "").replace(/\/$/, "");
      page = await safeGoto(page, cleanUrl);
      await sleep(5000);

      let sameCountStreak = { value: 0 };
      let loopCount = 0;
      const startTime = Date.now();

      logger.info(`🔄 Scraping source: ${source.name} | Goal: ${this.maxPostsPerSource} posts | Max time: ${this.maxCrawlTimeMinutes} mins`);

      let matchedPostsCount = 0;

      for (let i = 0; i < this.maxPostsPerSource; ) {
        const elapsedMinutes = (Date.now() - startTime) / (1000 * 60);
        if (elapsedMinutes >= this.maxCrawlTimeMinutes) {
          logger.warn(`⏰ Max crawl time reached (${this.maxCrawlTimeMinutes} mins) for ${source.name}. Stopping.`);
          break;
        }

        loopCount++;

        // 1. Get the next post element starting at index 1
        const post = await this.getPostElement(page);

        if (!post) {
          logger.debug(
            `⚠️ [Loop ${loopCount}] No more post elements found. Scrolling to load more...`,
          );
          await this.scrollAndWaitElements(page);
          sameCountStreak.value++;
          if (sameCountStreak.value >= MAX_SAME_COUNT_STREAK) {
            logger.debug(
              `⚠️ No new posts after ${sameCountStreak.value} attempts. Stopping.`,
            );
            break;
          }
          continue;
        }

        // 2. Scroll post into view
        try {
          await post.scrollIntoView();
        } catch (scrollErr) {}

        // 3. Expand post content
        await this.expandPostContent(post);

        // 4. Extract post data
        const scrapedPost = await this.extractPostData(post, page);

        // 5. CÀO CÓ CHỌN LỌC: Kiểm tra từ khóa lọc trước khi lưu
        if (scrapedPost && scrapedPost.postText) {
          const matchedKws: string[] = [];

          for (const kw of this.keywords) {
            if (matchKeywordStandalone(scrapedPost.postText, kw)) {
              matchedKws.push(kw);
            }
          }

          if (matchedKws.length > 0) {
            // LƯU BÀI VIẾT NẾU KHỚP TỪ KHÓA
            scrapedPost.matchedKeywords = matchedKws;
            const added = this.scrapedPostManager.addStrict(scrapedPost);

            if (added) {
              matchedPostsCount++;
              i++;
              sameCountStreak.value = 0;

              const cleanPreview = scrapedPost.postText.replace(/\s+/g, " ");
              const charsHead = cleanPreview.substring(0, 80) + (cleanPreview.length > 80 ? "..." : "");

              logger.info(`✨ [${matchedPostsCount}/${this.maxPostsPerSource}] KHỚP TỪ KHÓA [${matchedKws.join(", ")}] | Tác giả: '${scrapedPost.authorName}'`);
              logger.info(`   🔗 Link: ${scrapedPost.postLink}`);
              logger.info(`   📝 Nội dung (${scrapedPost.postText.length} ký tự): "${charsHead}"\n`);

              // Xuất ngay lập tức ra Excel, CSV & Google Sheets
              exportToSheet(
                [
                  {
                    author_name: scrapedPost.authorName,
                    post_url: scrapedPost.postLink,
                    group_url: source.url,
                    matched_keywords: matchedKws,
                    snippet: scrapedPost.postText.substring(0, 300) + (scrapedPost.postText.length > 300 ? "..." : ""),
                    posted_at: scrapedPost.postedAt || "",
                    crawled_at: getLocalDateTimeString(),
                  },
                ],
                'results.xlsx',
                'results.csv',
                this.googleSheetsConfig
              );
            }
          } else {
            const cleanPreview = scrapedPost.postText.replace(/\s+/g, " ");
            const charsHead = cleanPreview.substring(0, 60) + (cleanPreview.length > 60 ? "..." : "");
            logger.debug(`🔍 [Duyệt bài] Tác giả: '${scrapedPost.authorName}' | ${scrapedPost.postText.length} ký tự ("${charsHead}") -> Không khớp từ khóa, bỏ qua.`);
          }
        }

        // 6. Đánh dấu bài đã duyệt (KHÔNG xóa DOM), sau đó cuộn bài tiếp theo lên view
        await this.markPostAsVisited(post);
        await this.scrollToNextPost(page);
        await post.dispose().catch(() => {});

        if (loopCount >= MAX_LOOP_COUNT) {
          logger.warn(`⚠️ Reached maximum loop count (${MAX_LOOP_COUNT}). Stopping crawl.`);
          break;
        }
      }

      logger.info(`🏁 Finished crawling source: ${source.name} | Matched posts saved: ${matchedPostsCount}`);
    } catch (err) {
      logger.error("❌ [crawlSource] failed:", err);
      throw err;
    }
  }

  private transformToRawPosts(posts: ScrapedPost[], source: CrawlSource): RawPost[] {
    const now = Date.now();
    return posts.map((post, i) => {
      return {
        id: `crawled_${now}_${i}`,
        title: post.authorName || "",
        content: post.postText || "",
        source: source.name,
        sourceUrl: source.url,
        postUrl: post.postLink,
        authorName: post.authorName,
        authorUrl: post.authorLink || "",
        crawledAt: new Date(now),
        postTime: post.postedAt || undefined,
        matchedKeywords: post.matchedKeywords,
        metadata: {
          ...post.metadata,
          authorName: post.authorName,
          authorLink: post.authorLink,
          timestamp: now,
        },
        area: (source.area as any) || "DEFAULT",
      };
    });
  }

  private async scrollAndWaitElements(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
      });
      await sleep(SCROLL_DELAY);
    } catch (error: any) {}
  }

  async removeTooltips(page: Page): Promise<void> {
    try {
      await page.$$eval(FACEBOOK_SELECTORS.tooltip, (tooltips) => {
        for (const tooltip of tooltips) {
          tooltip.remove();
        }
      });
    } catch (e) {}
  }

  async getPostElement(page: Page): Promise<ElementHandle<Element> | null> {
    const feedContainer = await page.$(FACEBOOK_SELECTORS.feed);
    if (!feedContainer) return null;

    const children = await feedContainer.$$(":scope > *");
    await feedContainer.dispose().catch(() => {});

    let selectedChild: ElementHandle<Element> | null = null;

    // Bỏ qua children[0] (header / pinned)
    if (children[0]) {
      await children[0].dispose().catch(() => {});
    }

    for (let idx = 1; idx < children.length; idx++) {
      const child = children[idx];
      if (!child) continue;

      if (selectedChild) {
        await child.dispose().catch(() => {});
        continue;
      }

      const shouldCrawl = await child
        .evaluate((el) => !el.hasAttribute("data-crawled") && !el.hasAttribute("pass"))
        .catch(() => false);

      if (shouldCrawl) {
        // *** BƯỚC 2 ***: Đánh dấu NGAY trước khi return để vòng lặp tiếp theo không nhận lại element này
        await child
          .evaluate((el) => el.setAttribute("data-crawled", "pending"))
          .catch(() => {});
        selectedChild = child as ElementHandle<Element>;
      } else {
        await child.dispose().catch(() => {});
      }
    }

    return selectedChild;
  }

  async expandPostContent(postElement: ElementHandle<Element>): Promise<void> {
    const links = await postElement.$$('[role="link"]');

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!link) continue;
      try {
        const isVisible = await link
          .evaluate((el) => {
            const htmlEl = el as HTMLElement;
            return el.isConnected && htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0;
          })
          .catch(() => false);

        if (!isVisible) continue;

        const validLink = await link.evaluate((el, roleBlacklist) => {
          const href = el.getAttribute("href")?.toLowerCase() || "";
          const text = (el.textContent || "").toLowerCase();
          return (
            href &&
            !href.includes("user") &&
            !href.includes("photo") &&
            !href.includes("hashtag") &&
            !href.includes("reel") &&
            !href.includes("videos") &&
            !href.includes("stories") &&
            !roleBlacklist.some((role: string) => text.includes(role)) &&
            !href.includes("comment") &&
            !href.includes("share")
          );
        }, ROLE_BLACKLIST);

        if (!validLink) continue;

        await link.scrollIntoView();
        await link.hover();
        await link.focus();
        await sleep(350);
      } catch (err) {
        continue;
      }
    }

    await Promise.all(links.map((link) => link?.dispose().catch(() => {})));

    if (this.page) {
      await this.removeTooltips(this.page);
    }
  }

  async extractPostData(
    postElement: ElementHandle<Element>,
    page: Page,
  ): Promise<ScrapedPost | null> {
    const POST_LINK_MARKER = "data-crawler-post-link";

    const postData = await postElement.evaluate(async (el, selectors) => {
      // @ts-ignore
      const postExtractor = window.__crawler__.PostExtractor;
      // @ts-ignore
      const crawlingUtils = window.__crawler__.crawlingUtils;

      const authorData = postExtractor.getAuthor(el);
      const linksArray = Array.from(el.querySelectorAll(selectors.link)) as Element[];
      const filteredLinks = await postExtractor.filterPostLinks(linksArray);
      const timeLinkEle = postExtractor.findTimeElement(filteredLinks);
      const postLinkData = await postExtractor.extractPostLink(timeLinkEle, filteredLinks);

      if (!postLinkData) return null;

      const postLink = postLinkData.element;
      const postLinkUrl = postLinkData.url;
      const postText = await postExtractor.getPostText(el);
      let time = crawlingUtils.extractTextFromElement(postLink);

      if (!time || !crawlingUtils.isFacebookTime(time)) {
        const ariaLabel = postLink.getAttribute("aria-label") || postLink.getAttribute("title");
        if (ariaLabel && crawlingUtils.isFacebookTime(ariaLabel)) {
          time = ariaLabel;
        } else {
          const timeChild = postLink.querySelector("time, [aria-label], [title]");
          const childText = timeChild?.getAttribute("aria-label") || timeChild?.getAttribute("title") || timeChild?.textContent?.trim() || "";
          if (childText && crawlingUtils.isFacebookTime(childText)) {
            time = childText;
          }
        }
      }

      if (!authorData || !postLink || !postText) return null;

      postLink.setAttribute("data-crawler-post-link", "true");

      return {
        authorName: authorData.authorName,
        authorLink: authorData.authorLink,
        postedAt: time || null,
        postLink: postLinkUrl,
        postText,
      };
    }, FACEBOOK_SELECTORS);

    if (!postData) return null;

    const postLinkElement = await postElement.$(`[${POST_LINK_MARKER}="true"]`);
    let tooltipTime: string | null = null;

    if (postLinkElement) {
      await this.removeTooltips(page);
      await postLinkElement.scrollIntoView();
      await postLinkElement.hover();
      await page.mouse.move(0, 0);
      await postLinkElement.hover();

      try {
        await page.waitForSelector(FACEBOOK_SELECTORS.tooltip, { visible: true, timeout: 2000 });
        tooltipTime = await page.$$eval(FACEBOOK_SELECTORS.tooltip, (tooltips) => {
          const last = tooltips[tooltips.length - 1];
          return last?.getAttribute("title") || last?.textContent?.trim() || null;
        });
      } catch (error) {
        tooltipTime = null;
      }

      await postLinkElement.evaluate((el) => {
        el.removeAttribute("data-crawler-post-link");
      });
      await postLinkElement.dispose().catch(() => {});
    }

    const cleanPostLink = formatFacebookPostUrl(postData.postLink);

    return {
      ...postData,
      postLink: cleanPostLink,
      postedAt: postData.postedAt || tooltipTime || "",
      metadata: {
        tooltipTime: tooltipTime,
      },
    } as ScrapedPost;
  }

  /**
   * Hoàn tất đánh dấu bài viết: đổi data-crawled="pending" → "true".
   * "pending" đã được set trong getPostElement để ngăn double-pick.
   * KHÔNG xóa hay thay thế phần tử khỏi DOM.
   */
  async markPostAsVisited(postElement: ElementHandle<Element>): Promise<void> {
    try {
      await postElement.evaluate((el) => {
        el.setAttribute("data-crawled", "true");
      });
    } catch (error) {
      logger.error("❌ Failed to mark post as visited:", error);
    }
  }

  /**
   * Cuộn phần tử bài viết TIẾP THEO chưa duyệt vào giữa màn hình.
   * Nếu không tìm thấy, cuộn xuống một màn hình để Facebook nạp thêm bài mới.
   */
  async scrollToNextPost(page: Page): Promise<void> {
    try {
      const scrolled = await page.evaluate((feedSelector: string) => {
        const feed = document.querySelector(feedSelector);
        if (!feed) return false;

        // Tìm bài tiếp theo chưa được đánh dấu là đã duyệt (bỏ qua children[0])
        const children = Array.from(feed.children);
        for (let i = 1; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const attr = child.getAttribute("data-crawled");
          if (attr === null && !child.hasAttribute("pass")) {
            child.scrollIntoView({ behavior: "smooth", block: "center" });
            return true;
          }
        }
        return false;
      }, FACEBOOK_SELECTORS.feed);

      if (!scrolled) {
        // Không còn bài nào chưa duyệt trong viewport -> cuộn xuống để tải thêm
        await page.evaluate(() => {
          window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
        });
      }

      await sleep(1500);
    } catch (e) {}
  }

  async start(): Promise<void> {
    await this.fetchCrawlSources();
    const generator = this.crawlAllSources();
    for await (const posts of generator) {
      logger.info(`📦 Batch yields ${posts.length} matched RawPosts`);
    }
  }
}

if (require.main === module) {
  const crawler = new PostCrawlerService();
  crawler.start().catch((err) => {
    logger.error("❌ Crawler execution failed:", err);
  });
}