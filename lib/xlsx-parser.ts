/**
 * lib/xlsx-parser.ts
 * 浏览器端 xlsx/csv 解析工具，基于 SheetJS。
 * 不依赖服务端，纯客户端解析，不上传文件到任何地方。
 */

import * as XLSX from "xlsx";

export interface SheetData {
  sheetName: string;
  headers: string[];          // 第一行的列名
  rows: Record<string, string>[]; // 每行数据，key=列名，value=单元格文本
  rawRows: string[][];        // 原始二维数组（含第一行）
}

export interface ParseResult {
  fileName: string;
  sheets: SheetData[];
  error?: string;
}

/**
 * 解析 xlsx/xls/csv 文件，返回所有Sheet的结构化数据。
 * 调用方式：传入 File 对象（来自 <input type="file"> 或拖拽）
 */
export function parseXlsxFile(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) { resolve({ fileName: file.name, sheets: [], error: "文件读取失败" }); return; }

        const workbook = XLSX.read(data, { type: "array", cellText: true, cellDates: true });
        const sheets: SheetData[] = workbook.SheetNames.map(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          // sheet_to_json 返回的每行都是对象，但header:1模式返回二维数组更安全
          const rawRows: string[][] = XLSX.utils.sheet_to_json<string[]>(worksheet, {
            header: 1,
            raw: false,        // 全部转成字符串
            defval: "",        // 空单元格填空字符串
          });

          if (rawRows.length === 0) {
            return { sheetName, headers: [], rows: [], rawRows: [] };
          }

          const headers = (rawRows[0] ?? []).map(h => String(h ?? "").trim());
          const dataRows = rawRows.slice(1);

          const rows = dataRows
            .filter(row => row.some(cell => String(cell ?? "").trim() !== ""))
            .map(row => {
              const obj: Record<string, string> = {};
              headers.forEach((h, i) => {
                obj[h] = String(row[i] ?? "").trim();
              });
              return obj;
            });

          return { sheetName, headers, rows, rawRows };
        });

        resolve({ fileName: file.name, sheets });
      } catch (err) {
        resolve({ fileName: file.name, sheets: [], error: `解析失败：${err instanceof Error ? err.message : "未知错误"}` });
      }
    };

    reader.onerror = () => resolve({ fileName: file.name, sheets: [], error: "文件读取出错" });
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 从SheetData中提取某一列的所有非空值
 */
export function extractColumn(sheet: SheetData, columnName: string): string[] {
  return sheet.rows
    .map(row => row[columnName] ?? "")
    .filter(v => v.trim() !== "");
}

/**
 * 猜测哪一列最可能是"评论内容"列
 * 策略：列名包含"评论"/"内容"/"comment"/"text"/"正文"，且该列平均字数 > 5
 */
export function guessCommentColumn(sheet: SheetData): string | null {
  const COMMENT_KEYWORDS = ["评论", "内容", "正文", "comment", "text", "回复", "留言"];
  const match = sheet.headers.find(h =>
    COMMENT_KEYWORDS.some(k => h.toLowerCase().includes(k.toLowerCase()))
  );
  if (match) return match;

  // 退回：找平均字数最长的列（最可能是文本内容列）
  let maxAvgLen = 0;
  let bestCol = null;
  for (const header of sheet.headers) {
    const vals = extractColumn(sheet, header);
    if (vals.length === 0) continue;
    const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length;
    if (avgLen > maxAvgLen) { maxAvgLen = avgLen; bestCol = header; }
  }
  return maxAvgLen > 5 ? bestCol : null;
}
