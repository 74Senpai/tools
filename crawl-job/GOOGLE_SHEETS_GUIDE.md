# Hướng dẫn cấu hình Google Sheets (Service Account API)

Dự án đã tích hợp sẵn tính năng tự động ghi dữ liệu bài viết đã cào khớp từ khóa lên Google Sheets thông qua Service Account chính thức của Google Cloud.

## Các bước cấu hình:

### 1. Thêm File Credentials
- Đặt file JSON chứa Service Account Key của bạn vào thư mục dự án (ví dụ: `credentials.json`).
- Hoặc cập nhật tên file trong `keywords.json`:
  ```json
  "credentials_file": "credentials.json"
  ```

### 2. Cấu hình `keywords.json`
Mở file `keywords.json` và điền `spreadsheet_id` của Trang tính Google Sheets:
```json
"google_sheets": {
  "enabled": true,
  "spreadsheet_id": "ĐIỀN_SPREADSHEET_ID_TẠI_ĐÂY",
  "credentials_file": "credentials.json",
  "sheet_name": "FB_Posts"
}
```

> **Cách lấy `spreadsheet_id`**:
> Trên URL trang tính Google Sheets của bạn:
> `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`
> -> Chuỗi ID là: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

### 3. Chia sẻ quyền truy cập Trang tính
- Mở file `credentials.json`, tìm trường `"client_email"` (dạng: `xxx@yyyy.iam.gserviceaccount.com`).
- Vào trang Google Sheets của bạn -> Chọn nút **Chia sẻ (Share)** -> Dán email của Service Account và cấp quyền **Người chỉnh sửa (Editor)**.

---
Khi chạy cào, các bài viết vừa khớp từ khóa sẽ được xuất song song ra:
1. File Excel (`results.xlsx`)
2. File CSV (`results.csv`)
3. Trang tính Google Sheets (`FB_Posts`)
