import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { CrawledPostData } from './exporter';
import { logger } from './utils/logger';

export interface GoogleSheetsConfig {
  enabled?: boolean;
  spreadsheet_id?: string;
  credentials_file?: string;
  sheet_name?: string;
}

const HEADER_NAMES = [
  'Tác Giả',
  'Link Bài Viết',
  'Từ Khóa Khớp',
  'Nội Dung Bài (Trích Đoạn)',
  'Link Group',
  'Thời Gian Đăng',
  'Thời Gian Cào'
];

// Column widths in pixels: [Tác Giả, Link Bài Viết, Từ Khóa, Nội Dung, Link Group, Thời Gian Đăng, Thời Gian Cào]
const COLUMN_PIXEL_WIDTHS = [180, 480, 180, 500, 350, 180, 160];

async function applyGoogleSheetFormatting(
  sheets: any,
  spreadsheetId: string,
  sheetId: number
): Promise<void> {
  const requests: any[] = [
    // 1. Header row styling (Dark Blue background, White text, Bold, Centered)
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: HEADER_NAMES.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.31, blue: 0.47 }, // #1F4E78
            textFormat: {
              foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
              bold: true,
              fontSize: 10,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // 2. Data Cells Base Styling (Reset Background to White, Top Alignment, Word Wrap)
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: HEADER_NAMES.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, // Reset header background fill to white
            verticalAlignment: 'TOP',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,wrapStrategy)',
      },
    },
    // 3. Reset Normal Black Text Format ONLY on non-link columns (0, 2, 3, 5, 6) so hyperlink styles on columns 1 & 4 are preserved!
    ...[0, 2, 3, 5, 6].map((colIdx) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: colIdx,
          endColumnIndex: colIdx + 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 },
              bold: false,
              fontSize: 10,
            },
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    })),
    // 3. Freeze top header row
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // 4. Set column widths in pixels
    ...COLUMN_PIXEL_WIDTHS.map((width, colIdx) => ({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: colIdx,
          endIndex: colIdx + 1,
        },
        properties: {
          pixelSize: width,
        },
        fields: 'pixelSize',
      },
    })),
    // 5. Auto-resize data row heights to fit long multi-line text dynamically
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: 2000,
        },
      },
    },
  ];

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  } catch (err) {
    logger.debug(`Soft format warning: ${err}`);
  }
}

export async function exportToGoogleSheet(
  postsData: CrawledPostData[],
  config?: GoogleSheetsConfig
): Promise<boolean> {
  if (!config || config.enabled === false) {
    return false;
  }

  const spreadsheetId = config.spreadsheet_id;
  const credentialsFile = config.credentials_file || 'credentials.json';
  const targetSheetName = config.sheet_name || 'FB_Posts';

  if (!spreadsheetId || spreadsheetId.trim() === '' || spreadsheetId === 'YOUR_SPREADSHEET_ID') {
    logger.warn('⚠️ Google Sheets export bị bỏ qua: Chưa cấu hình "spreadsheet_id" trong file config');
    return false;
  }

  const absCredPath = path.resolve(credentialsFile);
  if (!fs.existsSync(absCredPath)) {
    logger.warn(`⚠️ Google Sheets export bị bỏ qua: Không tìm thấy file credentials tại ${absCredPath}`);
    return false;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: absCredPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Get spreadsheet metadata to find existing sheet tabs and IDs
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = meta.data.sheets || [];
    
    let targetSheet = sheetsList.find(s => s.properties?.title === targetSheetName);
    let actualSheetName = targetSheetName;
    let targetSheetId = targetSheet?.properties?.sheetId ?? 0;

    if (!targetSheet) {
      // Attempt to auto-create the missing tab
      try {
        const createRes = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: targetSheetName,
                  },
                },
              },
            ],
          },
        });

        actualSheetName = targetSheetName;
        targetSheetId = createRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
        logger.info(`✨ Đã tự động tạo Trang tính (Tab) mới: '${targetSheetName}' trên Google Sheet`);

        // Add Header Row to the new sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${actualSheetName}'!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [HEADER_NAMES],
          },
        });
      } catch (createErr) {
        if (sheetsList.length > 0) {
          actualSheetName = sheetsList[0].properties?.title || 'Sheet1';
          targetSheetId = sheetsList[0].properties?.sheetId || 0;
          logger.warn(`⚠️ Không thể tạo tab '${targetSheetName}', tự động chuyển sang tab hiện tại: '${actualSheetName}'`);
        }
      }
    }

    // Check if header exists in target sheet
    try {
      const headerCheck = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${actualSheetName}'!A1:G1`,
      });
      if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${actualSheetName}'!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [HEADER_NAMES],
          },
        });
      }
    } catch (e) {}

    // Apply header styling, word wrap, frozen row & column widths
    await applyGoogleSheetFormatting(sheets, spreadsheetId, targetSheetId);

    if (!postsData || postsData.length === 0) {
      return true;
    }

    // Format rows to append with clickable HYPERLINK formulas (using ';' delimiter) and timestamp columns at the end
    const values = postsData.map((item) => {
      const keywordsStr = Array.isArray(item.matched_keywords)
        ? item.matched_keywords.join(', ')
        : String(item.matched_keywords || '');

      const postUrlCell = item.post_url ? `=HYPERLINK("${item.post_url.replace(/"/g, '%22')}")` : '';
      const groupUrlCell = item.group_url ? `=HYPERLINK("${item.group_url.replace(/"/g, '%22')}")` : '';

      return [
        item.author_name || 'N/A',
        postUrlCell,
        keywordsStr,
        item.snippet || '',
        groupUrlCell,
        item.posted_at || '',
        item.crawled_at || ''
      ];
    });

    const range = `'${actualSheetName}'!A:G`;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    // Re-apply formatting to format newly inserted rows cleanly
    await applyGoogleSheetFormatting(sheets, spreadsheetId, targetSheetId);

    logger.info(`📊 Đã đẩy thành công ${values.length} bài viết lên Google Sheet (Tab: '${actualSheetName}', ID: ${spreadsheetId})`);
    return true;
  } catch (error: any) {
    logger.error(`❌ Lỗi khi ghi vào Google Sheets: ${error?.message || error}`);
    return false;
  }
}
