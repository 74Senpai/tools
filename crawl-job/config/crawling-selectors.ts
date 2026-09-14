export const FACEBOOK_SELECTORS = {
  feed: '[role="feed"]',
  seeMoreButton: '[role="button"]',
  profileName: '[data-ad-rendering-role="profile_name"]',
  authorAnchor: "span a, b span",
  link: '[role="link"]',
  storyMessage: [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
    '[data-ad-preview="message"]'
  ],
  dirAuto: '[dir="auto"]',
  imageWithSrc: "img[src]",
  loginIndicators: [
    'input[name="email"]',
    'input[name="pass"]',
    'button[name="login"]',
    'form[action*="/login"]',
    '[data-testid="royal_login_button"]',
  ],
  loggedInIndicators: [
    '[aria-label="Home"], [aria-label="Trang chủ"]',
    '[aria-label="Your profile"], [aria-label="Trang cá nhân của bạn"]',
    '[data-testid="comet_nav_home_link"]',
    'a[href*="/me"]',
    '[role="feed"]',
    '[data-testid="blue_bar_profile_link"]',
  ],
  dialogView: '[role="dialog"]',
  dialogCloseButton: '[aria-label="Đóng"][role="button"], [aria-label="Close"][role="button"]',
  tooltip: '[role="tooltip"]',
} as const;



// Block link contains role name
export const ROLE_BLACKLIST: string[] = [
  "người kiểm duyệt",
  "người đóng góp nổi bật",
  "thành viên mới",
  "thành viên nhóm",
  "chuyên gia trong nhóm",
  "tác giả",
] as const;

// Set char to trie match time if can find by regex
export const TIME_SETS: Record<string, Set<string>> = {
  phút: new Set(["p", "h", "ú", "t", "m", "i", "n", "s", "e", "r"]),
  giờ: new Set(["g", "i", "ờ", "h", "r", "o", "u"]),
  ngày: new Set(["n", "g", "à", "y", "d", "a", "s"]),
  tuần: new Set(["t", "u", "ầ", "n", "w", "e", "k", "s"]),
  tháng: new Set(["t", "h", "á", "n", "g", "m", "o", "s"]),
  năm: new Set(["n", "ă", "m", "y", "r", "s", "e"]),
  hômqua: new Set(["h", "ô", "m", "q", "u", "a", "y", "s", "t", "e", "r", "d"]),
  vuamoi: new Set(["v", "ừ", "a", "x", "o", "n", "g", "j", "u", "s", "t", "n", "o", "w"]),
} as const;

export const TIME_REGEX_PATTERNS: RegExp[] = [
  /^vừa\s*xong$/i,
  /^just\s*now$/i,
  /^(?:about\s*)?a\s*few\s*seconds?(?:\s*ago)?$/i,
  /^(?:about\s*)?(?:a|an)\s*(?:minute|min|hour|hr|h|day|d|week|w|month|m|year|y)(?:\s*ago)?$/i,
  /^\d+\s*(giây|s|sec|secs|seconds?)(?:\s*(ago|trước))?$/i,
  /^\d+\s*(phút|min|mins|minutes?)(?:\s*(ago|trước))?$/i,
  /^\d+\s*(giờ|h|hr|hrs|hours?)(?:\s*(ago|trước))?$/i,
  /^\d+\s*(ngày|d|day|days)(?:\s*(ago|trước))?$/i,
  /^\d+\s*(tuần|w|week|weeks)(?:\s*(ago|trước))?$/i,
  /^\d+\s*(tháng|m|month|months)(?:\s*(ago|trước))?$/i,
  /^\d+\s*(năm|y|yr|yrs|year|years)(?:\s*(ago|trước))?$/i,
  /^hôm\s*qua\s*(?:lúc\s*)?\d{1,2}[:\s]\d{2}$/i,
  /^yesterday\s*(?:at\s*)?\d{1,2}[:\s]\d{2}$/i,
  /^\d{1,2}\/\d{1,2}\/\d{4}\s*(?:lúc|at)?\s*\d{1,2}[:\s]\d{2}$/i,
  /^\d{1,2}\s*tháng\s*\d{1,2}(?:\s*năm\s*\d{4})?\s*(?:lúc\s*)?\d{1,2}[:\s]\d{2}$/i,
  /^(?:[A-Za-z]+,?\s*)?\d{1,2}\s*[A-Za-z]+\s*(?:\d{4}\s*)?(?:at\s*)?\d{1,2}[:\s]\d{2}$/i,
  /^\d+\s*(giờ|h|hr|hrs|hours?)\s*-\s*\d+\s*(giờ|h|hr|hrs|hours?)$/i,
] as const;