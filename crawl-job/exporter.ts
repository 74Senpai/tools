import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { formatFacebookPostUrl, getLocalDateTimeString } from './crawler_engine';
import { exportToGoogleSheet, GoogleSheetsConfig } from './google_exporter';

export interface CrawledPostData {
  author_name: string;
  post_url: string;
  group_url: string;
  matched_keywords: string[];
  snippet: string;
  posted_at: string;
  crawled_at: string;
}

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  'STT': 8,
  'Tác Giả': 25,
  'Link Bài Viết': 65,
  'Từ Khóa Khớp': 28,
  'Nội Dung Bài (Trích Đoạn)': 70,
  'Link Group': 55,
  'Thời Gian Đăng': 28,
  'Thời Gian Cào': 22,
};

const HEADER_NAMES = [
  'STT',
  'Tác Giả',
  'Link Bài Viết',
  'Từ Khóa Khớp',
  'Nội Dung Bài (Trích Đoạn)',
  'Link Group',
  'Thời Gian Đăng',
  'Thời Gian Cào'
];

function applyWorksheetStyles(worksheet: XLSX.WorkSheet, rows: any[]): void {
  // 1. Calculate column widths with minimum bounds
  const colWidths = HEADER_NAMES.map((key) => {
    const minWch = DEFAULT_COLUMN_WIDTHS[key] || 20;
    let maxLen = key.length;
    for (const row of rows) {
      const valStr = String(row[key] || '');
      if (valStr.length > maxLen) maxLen = valStr.length;
    }
    return { wch: Math.min(Math.max(minWch, maxLen + 3), 75) };
  });
  worksheet['!cols'] = colWidths;

  // 2. Format header and data cells (Word Wrap & Styling)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:H1');
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      if (!worksheet[cellAddress]) continue;
      if (R === 0) {
        // Header Row Styling
        worksheet[cellAddress].s = {
          fill: { patternType: 'solid', fgColor: { rgb: '1F4E78' } },
          font: { name: 'Segoe UI', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        };
      } else {
        // Data Cells Styling (Standard text for normal cells, blue underlined link for link columns)
        const isLinkCol = C === 2 || C === 5;
        worksheet[cellAddress].s = {
          fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
          font: {
            name: 'Segoe UI',
            sz: 10,
            bold: false,
            color: { rgb: isLinkCol ? '0563C1' : '000000' },
            underline: isLinkCol,
          },
          alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
        };
      }
    }
  }

  // 3. Calculate dynamic row heights based on content length & line breaks
  const rowHeights: { hpt: number }[] = [];
  rowHeights[0] = { hpt: 28 }; // Header row height (28pt)

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    let maxLinesInRow = 1;

    for (const key of HEADER_NAMES) {
      const text = String(row[key] || '');
      if (!text) continue;
      const colWch = DEFAULT_COLUMN_WIDTHS[key] || 25;
      const paragraphs = text.split('\n');
      let lines = 0;
      for (const p of paragraphs) {
        lines += Math.ceil(Math.max(p.length, 1) / colWch);
      }
      if (lines > maxLinesInRow) {
        maxLinesInRow = lines;
      }
    }

    // Clamp row height: minimum 22pt, ~18pt per line, max 160pt
    const hpt = Math.min(Math.max(22, maxLinesInRow * 18), 160);
    rowHeights[rIdx + 1] = { hpt };
  }

  worksheet['!rows'] = rowHeights;
}

export function initializeEmptySheet(
  excelFilePath: string = 'results.xlsx',
  csvFilePath: string = 'results.csv'
): void {
  const absExcelPath = path.resolve(excelFilePath);
  const absCsvPath = path.resolve(csvFilePath);

  if (!fs.existsSync(absExcelPath)) {
    const worksheet = XLSX.utils.json_to_sheet([], { header: HEADER_NAMES });
    applyWorksheetStyles(worksheet, []);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'FB_Posts');
    XLSX.writeFile(workbook, absExcelPath);

    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    fs.writeFileSync(absCsvPath, '\uFEFF' + csvOutput, 'utf8');
    console.log(`✨ Đã khởi tạo file Excel & CSV mẫu (khi chưa có dữ liệu): ${absExcelPath}`);
  }
}

export function exportToSheet(
  postsData: CrawledPostData[],
  excelFilePath: string = 'results.xlsx',
  csvFilePath: string = 'results.csv',
  googleSheetsConfig?: GoogleSheetsConfig
): number {
  const absExcelPath = path.resolve(excelFilePath);
  const absCsvPath = path.resolve(csvFilePath);

  if (!postsData || postsData.length === 0) {
    console.log('⚠️ Không có dữ liệu bài viết mới để lưu.');
    initializeEmptySheet(excelFilePath, csvFilePath);
    return 0;
  }

  const formattedRows: any[] = postsData.map((item) => {
    const keywordsStr = Array.isArray(item.matched_keywords)
      ? item.matched_keywords.join(', ')
      : String(item.matched_keywords || '');

    const cleanPostUrl = formatFacebookPostUrl(item.post_url);

    return {
      'STT': 0,
      'Tác Giả': item.author_name || 'N/A',
      'Link Bài Viết': cleanPostUrl,
      'Từ Khóa Khớp': keywordsStr,
      'Nội Dung Bài (Trích Đoạn)': item.snippet || '',
      'Link Group': item.group_url || '',
      'Thời Gian Đăng': item.posted_at || '',
      'Thời Gian Cào': item.crawled_at || getLocalDateTimeString()
    };
  });

  let existingRows: any[] = [];
  if (fs.existsSync(absExcelPath)) {
    try {
      const workbook = XLSX.readFile(absExcelPath);
      const sheetName = workbook.SheetNames[0];
      if (sheetName) {
        existingRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      }
    } catch (err) {
      console.log(`⚠️ Không thể đọc file Excel cũ, sẽ tạo mới. Lỗi: ${err}`);
    }
  }

  // Deduplicate by "Link Bài Viết"
  const seenUrls = new Set<string>();
  const combinedRows: any[] = [];

  for (const row of existingRows) {
    if (row['Link Bài Viết']) {
      row['Link Bài Viết'] = formatFacebookPostUrl(row['Link Bài Viết']);
    }
    const link = row['Link Bài Viết'];
    if (link && !seenUrls.has(link)) {
      seenUrls.add(link);
      combinedRows.push(row);
    }
  }

  for (const row of formattedRows) {
    const link = row['Link Bài Viết'];
    if (!link || !seenUrls.has(link)) {
      if (link) seenUrls.add(link);
      combinedRows.push(row);
    }
  }

  // Update STT
  combinedRows.forEach((row, index) => {
    row['STT'] = index + 1;
  });

  // Write Excel
  try {
    const worksheet = XLSX.utils.json_to_sheet(combinedRows, { header: HEADER_NAMES });
    applyWorksheetStyles(worksheet, combinedRows);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'FB_Posts');
    XLSX.writeFile(workbook, absExcelPath);
    console.log(`✅ Đã xuất kết quả thành công ra file Excel: ${absExcelPath}`);
  } catch (err) {
    console.error(`❌ Lỗi khi ghi file Excel: ${err}`);
  }

  // Write CSV
  try {
    const csvWorksheet = XLSX.utils.json_to_sheet(combinedRows, { header: HEADER_NAMES });
    const csvOutput = XLSX.utils.sheet_to_csv(csvWorksheet);
    fs.writeFileSync(absCsvPath, '\uFEFF' + csvOutput, 'utf8'); // BOM for UTF-8 Excel compatibility
    console.log(`✅ Đã xuất kết quả thành công ra file CSV: ${absCsvPath}`);
  } catch (err) {
    console.error(`❌ Lỗi khi ghi file CSV: ${err}`);
  }

  // Export to Google Sheets if configured
  if (googleSheetsConfig && googleSheetsConfig.enabled !== false) {
    exportToGoogleSheet(postsData, googleSheetsConfig).catch(() => {});
  }

  return combinedRows.length;
}
