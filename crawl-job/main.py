#!/usr/bin/env python3
import os
import sys
import json

def check_environment():
    """Kiểm tra và tạo file cấu hình nếu chưa tồn tại."""
    config_file = "keywords.json"
    if not os.path.exists(config_file):
        default_config = {
            "keywords": [
                "khuyến mãi",
                "giảm giá",
                "tuyển dụng",
                "cần tìm",
                "pass lại",
                "bán"
            ],
            "max_posts": 20,
            "check_interval_seconds": 2
        }
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(default_config, f, ensure_ascii=False, indent=2)
        print(f"⚙️ Đã tạo file cấu hình mặc định: {config_file}")

def main():
    print("==================================================")
    print("      FACEBOOK GROUP POST KEYWORD CRAWLER        ")
    print("==================================================")
    
    check_environment()
    
    # Import crawler engine
    try:
        from crawler_engine import start_facebook_crawler
        start_facebook_crawler()
    except Exception as e:
        print(f"❌ Xảy ra lỗi khi chạy ứng dụng: {e}")

if __name__ == "__main__":
    main()
