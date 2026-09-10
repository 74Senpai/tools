import os
import pandas as pd
from datetime import datetime

def export_to_sheet(posts_data, excel_filepath="results.xlsx", csv_filepath="results.csv"):
    """
    Exports crawled posts data to Excel (.xlsx) and CSV (.csv).
    
    :param posts_data: List of dicts, e.g. [
        {
            "post_url": "https://facebook.com/groups/123/posts/456",
            "group_url": "https://facebook.com/groups/123",
            "matched_keywords": ["khuyến mãi", "giảm giá"],
            "snippet": "Nội dung bài viết...",
            "crawled_at": "2026-09-10 16:30:00"
        }
    ]
    """
    if not posts_data:
        print("⚠️ Không có dữ liệu bài viết mới để lưu.")
        return

    formatted_rows = []
    for item in posts_data:
        keywords_str = ", ".join(item.get("matched_keywords", [])) if isinstance(item.get("matched_keywords"), list) else str(item.get("matched_keywords", ""))
        formatted_rows.append({
            "STT": 0,  # Sẽ tự đánh số sau
            "Link Bài Viết": item.get("post_url", ""),
            "Từ Khóa Khớp": keywords_str,
            "Nội Dung Bài (Trích Đoạn)": item.get("snippet", ""),
            "Link Group": item.get("group_url", ""),
            "Thời Gian Cào": item.get("crawled_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        })

    df_new = pd.DataFrame(formatted_rows)

    # Đọc file cũ nếu đã tồn tại để gộp (tránh trùng lặp Link Bài Viết)
    if os.path.exists(excel_filepath):
        try:
            df_old = pd.read_excel(excel_filepath)
            df_combined = pd.concat([df_old, df_new], ignore_index=True)
            df_combined.drop_duplicates(subset=["Link Bài Viết"], keep="first", inplace=True)
        except Exception as e:
            print(f"⚠️ Không thể đọc file Excel cũ, tạo file mới. Lỗi: {e}")
            df_combined = df_new
    else:
        df_combined = df_new

    # Đánh lại STT
    df_combined["STT"] = range(1, len(df_combined) + 1)

    # Xuất ra file Excel
    try:
        with pd.ExcelWriter(excel_filepath, engine="openpyxl") as writer:
            df_combined.to_excel(writer, index=False, sheet_name="FB_Posts")
            worksheet = writer.sheets["FB_Posts"]
            # Tự động chỉnh độ rộng cột
            for col in worksheet.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = col[0].column_letter
                worksheet.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 60)
        print(f"✅ Đã xuất kết quả thành công ra file Excel: {os.path.abspath(excel_filepath)}")
    except Exception as e:
        print(f"❌ Lỗi khi ghi file Excel: {e}")

    # Xuất ra file CSV
    try:
        df_combined.to_csv(csv_filepath, index=False, encoding="utf-8-sig")
        print(f"✅ Đã xuất kết quả thành công ra file CSV: {os.path.abspath(csv_filepath)}")
    except Exception as e:
        print(f"❌ Lỗi khi ghi file CSV: {e}")

    return len(df_combined)

if __name__ == "__main__":
    # Test thử module exporter
    test_data = [
        {
            "post_url": "https://www.facebook.com/groups/123/posts/9999",
            "group_url": "https://www.facebook.com/groups/123",
            "matched_keywords": ["khuyến mãi", "giảm giá"],
            "snippet": "Chương trình khuyến mãi giảm giá cực sốc hôm nay!",
            "crawled_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    ]
    export_to_sheet(test_data)
