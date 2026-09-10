import os
import re
import time
import json
import unicodedata
from datetime import datetime
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from exporter import export_to_sheet

def normalize_text(text):
    """Bỏ dấu tiếng Việt và đưa về chữ thường để so sánh linh hoạt."""
    if not text:
        return ""
    text = text.lower()
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return text

def clean_facebook_url(url):
    """Làm sạch URL Facebook, xóa các tham số ref, tracking không cần thiết."""
    if not url:
        return ""
    # Cắt bỏ phần query param nếu có ?ref= hoặc ?__cft__
    clean = url.split('?')[0].split('&')[0]
    if not clean.startswith('http'):
        clean = 'https://www.facebook.com' + clean
    return clean

def extract_post_link(post_element):
    """Tìm link trực tiếp (permalink) của bài viết từ HTML bài đăng."""
    # Các pattern link bài viết phổ biến trên Facebook Group
    links = post_element.find_all('a', href=True)
    for a in links:
        href = a['href']
        if '/posts/' in href or '/permalink/' in href or 'pfbid' in href:
            return clean_facebook_url(href)
        if '/groups/' in href and ('/user/' not in href and '/member/' not in href):
            # Kiểm tra nếu href chứa ID số của bài đăng
            if re.search(r'/groups/[^/]+/posts/\d+', href) or re.search(r'/permalink/\d+', href):
                return clean_facebook_url(href)
    
    # Backup: kiểm tra thuộc tính href trong bất kỳ thẻ a có chứa mốc thời gian / timestamp
    for a in links:
        href = a['href']
        if href.startswith('/groups/') and len(href.split('/')) >= 4:
            return clean_facebook_url(href)

    return None

def start_facebook_crawler(config_path="keywords.json", user_data_dir="./user_profile"):
    """
    Khởi chạy trình duyệt, chờ người dùng đăng nhập và thêm /### vào URL Group để kích hoạt cào dữ liệu.
    """
    if not os.path.exists(config_path):
        print(f"❌ Không tìm thấy file cấu hình {config_path}")
        return

    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    keywords = config.get("keywords", [])
    max_posts = config.get("max_posts", 20)
    check_interval = config.get("check_interval_seconds", 2)

    print("==================================================")
    print("🚀 BẮT ĐẦU CÔNG CỤ CÀO BÀI VIẾT FACEBOOK GROUP")
    print(f"📌 Danh sách từ khóa ({len(keywords)}): {', '.join(keywords)}")
    print(f"🎯 Số lượng bài viết tối đa cần cào: {max_posts}")
    print("==================================================")
    print("\n👉 HƯỚNG DẪN SỬ DỤNG:")
    print("1. Trình duyệt Chrome sẽ bật lên.")
    print("2. Đăng nhập tài khoản Facebook của bạn và thao tác thoải mái.")
    print("3. Di chuyển đến Group muốn cào bài viết.")
    print("4. Thêm '/###' hoặc '###' vào cuối đường dẫn trên thanh địa chỉ URL rồi ấn Enter.")
    print("   Ví dụ: https://www.facebook.com/groups/123456789/###")
    print("5. Tool sẽ tự động phát hiện và cào bài viết theo từ khóa!\n")

    os.makedirs(user_data_dir, exist_ok=True)

    with sync_playwright() as p:
        # Chạy trình duyệt Chrome với profile cố định để giữ session đăng nhập
        context = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=False,
            channel="chrome" if os.path.exists("/usr/bin/google-chrome") else "chromium",
            args=[
                "--disable-notifications",
                "--start-maximized",
                "--no-sandbox"
            ],
            viewport=None
        )

        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.facebook.com", wait_until="domcontentloaded")

        print("🔍 Đang giám sát thanh địa chỉ URL trình duyệt...")

        target_group_url = None
        
        # Vòng lặp chờ người dùng thêm /### hoặc ### vào URL
        while True:
            try:
                current_url = page.url
                if "###" in current_url:
                    # Bắt được tín hiệu ###
                    clean_url = current_url.replace("###", "").rstrip("/")
                    target_group_url = clean_url
                    print(f"\n⚡ ĐÃ PHÁT HIỆN TÍN HIỆU ###!")
                    print(f"🌐 Group được chọn: {target_group_url}")
                    
                    # Chuyển trang về URL sạch (không có ###)
                    page.goto(target_group_url, wait_until="domcontentloaded")
                    time.sleep(3)
                    break
            except Exception as e:
                pass

            time.sleep(check_interval)

        # BẮT ĐẦU QUÁ TRÌNH CÀO BÀI VIẾT TRONG GROUP
        print(f"\n🔄 Đang tiến hành cuộn trang và lọc bài viết chứa từ khóa...")

        crawled_posts = []
        seen_urls = set()
        seen_texts = set()
        scroll_attempts = 0
        max_scroll_attempts = 150

        # Chuẩn hóa danh sách từ khóa để so sánh
        norm_keywords = [(kw, normalize_text(kw)) for kw in keywords]

        while len(crawled_posts) < max_posts and scroll_attempts < max_scroll_attempts:
            scroll_attempts += 1
            
            # Lấy HTML hiện tại của trang
            content = page.content()
            soup = BeautifulSoup(content, 'html.parser')

            # Tìm các thẻ chứa bài đăng trong Facebook Group
            # Facebook dùng thẻ div với role="article" hoặc feed container
            post_cards = soup.find_all('div', attrs={'role': 'article'})
            if not post_cards:
                # Backup tìm theo thẻ div chứa đoạn văn bản có dir="auto"
                post_cards = soup.find_all('div', attrs={'data-ad-preview': 'message'})
                if not post_cards:
                    post_cards = soup.find_all('div', attrs={'dir': 'auto'})

            new_found_in_scroll = 0

            for card in post_cards:
                text_content = card.get_text(separator=' ', strip=True)
                if not text_content or len(text_content) < 15:
                    continue

                norm_card_text = normalize_text(text_content)

                # Kiểm tra từ khóa khớp
                matched_kws = []
                for original_kw, norm_kw in norm_keywords:
                    if norm_kw in norm_card_text:
                        matched_kws.append(original_kw)

                if matched_kws:
                    # Trích xuất link bài viết
                    post_url = extract_post_link(card)
                    
                    # Nếu không trích xuất được URL riêng, dùng ID bài hoặc hash nội dung để nhận diện
                    text_hash = str(hash(text_content[:100]))
                    if text_hash in seen_texts:
                        continue
                    seen_texts.add(text_hash)

                    if not post_url:
                        post_url = f"{target_group_url} (Bài viết không có link trực tiếp - Snippet: {text_content[:30]}...)"
                    elif post_url in seen_urls:
                        continue

                    if post_url.startswith("http"):
                        seen_urls.add(post_url)

                    snippet = text_content[:300] + ("..." if len(text_content) > 300 else "")
                    
                    post_data = {
                        "post_url": post_url,
                        "group_url": target_group_url,
                        "matched_keywords": matched_kws,
                        "snippet": snippet,
                        "crawled_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    }

                    crawled_posts.append(post_data)
                    new_found_in_scroll += 1

                    print(f"   ✨ [{len(crawled_posts)}/{max_posts}] Tìm thấy bài viết khớp từ khóa {matched_kws}:")
                    print(f"      🔗 Link: {post_url}")
                    print(f"      📝 Nội dung: {snippet[:80]}...\n")

                    # Xuất lưu tạm thời ngay khi cào được bài mới
                    export_to_sheet(crawled_posts)

                    if len(crawled_posts) >= max_posts:
                        break

            # Tự động cuộn trang xuống để tải thêm bài viết mới
            page.evaluate("window.scrollBy(0, 1000)")
            time.sleep(2.5)

            # Thỉnh thoảng bấm các nút "Xem thêm" / "See more" nếu có
            try:
                see_more_buttons = page.query_selector_all("text='Xem thêm'") or page.query_selector_all("text='See more'")
                for btn in see_more_buttons[:3]:
                    if btn.is_visible():
                        btn.click()
            except Exception:
                pass

        print("\n==================================================")
        print(f"🎉 HOÀN THÀNH CÀO DỮ LIỆU!")
        print(f"📊 Tổng số bài viết thỏa điều kiện thu thập được: {len(crawled_posts)}")
        export_to_sheet(crawled_posts)
        print("==================================================")
        
        print("\nTrình duyệt sẽ giữ nguyên để bạn kiểm tra. Nhấn Enter trong terminal để đóng ứng dụng...")
        input()

if __name__ == "__main__":
    start_facebook_crawler()
