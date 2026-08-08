# xlsx解析回归fixture

这些文件只用于记录`xlsx@0.18.5`经过`parseXlsxFile`真实调用链时的当前行为，不代表产品期望。

- `standard.xlsx`、`formats.xlsx`、`dates-1900.xlsx`：使用独立的`@oai/artifact-tool 2.8.6`生成。
- `dates-1904.xlsx`：在独立生成的OOXML工作簿中设置`workbookPr date1904="1"`。
- `legacy-chinese.xls`：由LibreOffice将独立生成的XLSX转换为Excel 97—2003格式。
- `utf8-bom.csv`、`corrupted.xlsx`、`forged-extension.xlsx`：为对应边界场景构造的固定字节样本。
- `encrypted-password.xlsx`：来自[msoffcrypto-tool公开测试样本](https://github.com/nolze/msoffcrypto-tool/blob/master/tests/inputs/example_password.xlsx)，用于验证真正的密码加密Office文件。

fixture不含用户数据或真实业务数据。
