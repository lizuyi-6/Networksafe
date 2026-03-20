# IEEE Access 投稿使用说明

如果你不熟 LaTeX，就按下面 4 步走，不要乱改别的文件。

## 你只需要改这 1 个文件

打开：

- `author-metadata.tex`

只改这里面的内容：

- 作者姓名
- 单位
- 邮箱
- 通讯作者信息
- ORCID
- 三位作者的 biography

主稿正文 `aetherguard_ieee_access.tex` 我已经接好了，正常情况下你不用碰。

## 最简单的操作顺序

在这个目录打开 PowerShell，然后执行：

```powershell
.\package-submission.ps1
```

这个命令会自动做两件事：

1. 重新生成最新 PDF
2. 整理出一个干净的 `upload-package` 文件夹，并同时打一个 `ieee-access-upload-package.zip`

## 你最后看哪个文件夹

只看：

- `upload-package`

里面已经分好类了：

- `01_PDF`：投稿 PDF
- `02_SOURCE`：LaTeX 源文件
- `03_EXTRAS`：cover letter、data availability、graphical abstract、检查清单

## 投稿时怎么传

一般按这个顺序：

1. 上传 `01_PDF/aetherguard_ieee_access.pdf`
2. 按期刊系统要求上传 `02_SOURCE` 里的源文件
3. 如果系统有 cover letter，就上传 `03_EXTRAS/cover-letter.txt`
4. 如果系统要 supplementary/supporting file，可以按需要上传 `data-availability.txt`
5. 如果系统允许 graphical abstract，再上传 `graphical-abstract.svg`

## 你现在最该做的事

先打开这两个文件：

- `author-metadata.tex`
- `upload-package/01_PDF/aetherguard_ieee_access.pdf`

确认作者信息替换正确，PDF 里作者、页眉、通讯作者和文末 biography 都变了，就可以提交。
