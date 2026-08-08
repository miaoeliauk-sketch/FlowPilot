import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseXlsxFile, type ParseResult } from "./xlsx-parser";

const FIXTURE_DIR = path.resolve("lib/__fixtures__/xlsx");

class ArrayBufferFileReader {
  onload: ((event: { target: { result: ArrayBuffer } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(file: Blob) {
    file.arrayBuffer().then(
      result => this.onload?.({ target: { result } }),
      () => this.onerror?.(),
    );
  }
}

Object.defineProperty(globalThis, "FileReader", {
  configurable: true,
  value: ArrayBufferFileReader,
});

async function parseFixture(fileName: string): Promise<ParseResult> {
  const bytes = await readFile(path.join(FIXTURE_DIR, fileName));
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return parseXlsxFile(new File([arrayBuffer], fileName));
}

test("xlsx@0.18.5基线：标准XLSX保留中英文、数字、多工作表及工作表顺序", async () => {
  const result = await parseFixture("standard.xlsx");

  assert.equal(result.error, undefined);
  assert.equal(result.fileName, "standard.xlsx");
  assert.deepEqual(result.sheets.map(sheet => sheet.sheetName), ["概览", "第二页", "空工作表"]);
  assert.deepEqual(result.sheets[0]?.headers, ["名称", "English", "数量"]);
  assert.deepEqual(result.sheets[0]?.rows.slice(0, 2), [
    { 名称: "中文内容", English: "Alpha", 数量: "42" },
    { 名称: "混合 Mixed", English: "Beta", 数量: "3.14" },
  ]);
  assert.deepEqual(result.sheets[1]?.rows, [
    { 项目: "A", 说明: "第一页之后" },
    { 项目: "B", 说明: "保持工作表顺序" },
  ]);
});

test("xlsx@0.18.5基线：空单元格填空字符串、整行空白只留在rawRows、空工作表为空", async () => {
  const result = await parseFixture("standard.xlsx");
  const overview = result.sheets[0];

  assert.deepEqual(overview?.rawRows, [
    ["名称", "English", "数量"],
    ["中文内容", "Alpha", "42"],
    ["混合 Mixed", "Beta", "3.14"],
    ["中间空值", "", "7"],
    ["", "", ""],
    ["尾行", "Omega", "0"],
  ]);
  assert.deepEqual(overview?.rows, [
    { 名称: "中文内容", English: "Alpha", 数量: "42" },
    { 名称: "混合 Mixed", English: "Beta", 数量: "3.14" },
    { 名称: "中间空值", English: "", 数量: "7" },
    { 名称: "尾行", English: "Omega", 数量: "0" },
  ]);
  assert.deepEqual(result.sheets[2], {
    sheetName: "空工作表",
    headers: [],
    rows: [],
    rawRows: [],
  });
});

test("xlsx@0.18.5基线：金额、百分比、前导零和科学计数法返回格式化文本", async () => {
  const result = await parseFixture("formats.xlsx");

  assert.equal(result.error, undefined);
  assert.deepEqual(result.sheets[0]?.rows, [
    { 类型: "金额", 值: "¥1,234.50" },
    { 类型: "百分比", 值: "12.50%" },
    { 类型: "前导零", 值: "000123" },
    { 类型: "科学计数法", 值: "1.23E+08" },
  ]);
});

test("xlsx@0.18.5基线：1900日期系统记录纯日期、日期时间、纯时间及舍入边界", async () => {
  const result = await parseFixture("dates-1900.xlsx");

  // 当前0.18.5在raw:false下把45292.9999999格式化为23:59:00；这是迁移对比基线，不是新期望。
  assert.deepEqual(result.sheets[0]?.rows, [
    { 类型: "纯日期", 值: "2024-01-01" },
    { 类型: "日期时间", 值: "2024-01-01 12:00:00" },
    { 类型: "纯时间", 值: "06:00:00" },
    { 类型: "日期舍入边界", 值: "2024-01-01 23:59:00" },
  ]);
});

test("xlsx@0.18.5基线：1904日期系统记录纯日期、日期时间、纯时间及舍入边界", async () => {
  const result = await parseFixture("dates-1904.xlsx");

  // 当前0.18.5会读取workbookPr.date1904，并同样保留上述舍入行为。
  assert.deepEqual(result.sheets[0]?.rows, [
    { 类型: "纯日期", 值: "1904-01-02" },
    { 类型: "日期时间", 值: "1904-01-02 12:00:00" },
    { 类型: "纯时间", 值: "06:00:00" },
    { 类型: "日期舍入边界", 值: "1904-01-02 23:59:00" },
  ]);
});

test("xlsx@0.18.5基线：UTC和Asia/Shanghai运行时下日期格式化结果相同", async () => {
  const originalTimezone = process.env.TZ;
  try {
    // 当前路径依赖单元格格式化文本，而不是把Date转成ISO字符串；迁移后若变化，应优先核对UTC解释。
    process.env.TZ = "UTC";
    const utcRows = (await parseFixture("dates-1900.xlsx")).sheets[0]?.rows;
    process.env.TZ = "Asia/Shanghai";
    const shanghaiRows = (await parseFixture("dates-1900.xlsx")).sheets[0]?.rows;

    const currentBaseline = [
      { 类型: "纯日期", 值: "2024-01-01" },
      { 类型: "日期时间", 值: "2024-01-01 12:00:00" },
      { 类型: "纯时间", 值: "06:00:00" },
      { 类型: "日期舍入边界", 值: "2024-01-01 23:59:00" },
    ];
    assert.deepEqual(utcRows, currentBaseline);
    assert.deepEqual(shanghaiRows, currentBaseline);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("xlsx@0.18.5基线：UTF-8 BOM CSV保留中文、换行、引号、逗号和空列", async () => {
  const result = await parseFixture("utf8-bom.csv");

  assert.equal(result.error, undefined);
  assert.deepEqual(result.sheets[0]?.headers, ["编号", "中文内容", "备注", "空列"]);
  assert.deepEqual(result.sheets[0]?.rows, [
    { 编号: "001", 中文内容: "普通中文", 备注: "简单备注", 空列: "" },
    { 编号: "002", 中文内容: "含逗号,和值", 备注: "他说\"你好\"", 空列: "" },
    { 编号: "003", 中文内容: "第一行\n第二行", 备注: "换行内容", 空列: "" },
  ]);
});

test("xlsx@0.18.5基线：Excel 97—2003 XLS保留中文编码和特殊字符", async () => {
  const result = await parseFixture("legacy-chinese.xls");

  assert.equal(result.error, undefined);
  assert.deepEqual(result.sheets[0]?.rows, [
    { 类型: "简体中文", 内容: "你好，世界" },
    { 类型: "繁體中文", 内容: "龍馬精神" },
    { 类型: "特殊字符", 内容: "①②③ ￥ © ™" },
    { 类型: "拉丁字符", 内容: "café naïve" },
  ]);
});

test("xlsx@0.18.5基线：损坏的XLSX返回压缩数据错误", async () => {
  const result = await parseFixture("corrupted.xlsx");

  assert.deepEqual(result, {
    fileName: "corrupted.xlsx",
    sheets: [],
    error: "解析失败：Bad compressed size: 0 != 275",
  });
});

test("xlsx@0.18.5基线：密码加密的XLSX返回password-protected错误", async () => {
  const result = await parseFixture("encrypted-password.xlsx");

  assert.deepEqual(result, {
    fileName: "encrypted-password.xlsx",
    sheets: [],
    error: "解析失败：File is password-protected",
  });
});

test("xlsx@0.18.5基线：伪造xlsx扩展名的UTF-8文本会降级解析并产生当前乱码", async () => {
  const result = await parseFixture("forged-extension.xlsx");

  assert.equal(result.error, undefined);
  assert.deepEqual(result.sheets[0]?.headers, ["ä¼ªè£æä»¶", "å®éåå®¹"]);
  assert.deepEqual(result.sheets[0]?.rows, [{
    "ä¼ªè£æä»¶": "ç¬¬ä¸è¡",
    "å®éåå®¹": "æ®éææ¬",
  }]);
});

test("xlsx@0.18.5基线：8MB伪造xlsx没有大小拦截并被解析为单个超长单元格", { timeout: 5_000 }, async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024);
  bytes.fill("A".charCodeAt(0));

  const result = await parseXlsxFile(new File([bytes], "oversized.xlsx"));

  assert.equal(result.error, undefined);
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0]?.rawRows[0]?.[0]?.length, 8 * 1024 * 1024);
});
