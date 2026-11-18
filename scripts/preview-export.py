"""変換結果（.docx / .xlsx）を Word / Excel で開かずに確認するための一覧ページを作る。

手順:
  1. Word / Excel を COM オートメーションで画面に出さずに起動し、ExportAsFixedFormat で PDF にする
     （Word / Excel 自身のレイアウトエンジンで描画するので、アプリで開いたときとほぼ同じ見た目になる）
  2. PyMuPDF で PDF をページごとに PNG にする
  3. 基準画像（baseline）とピクセル単位で比べ、変わったページ・新しいページ・なくなったページを調べる
  4. 結果を .preview/index.html（一覧ページ）と .preview/summary.json にまとめる

使い方:
  python scripts/preview-export.py            # 生成して基準画像と比べる（npm run preview:export）
  python scripts/preview-export.py --approve  # 今回の PNG を基準画像として登録する（npm run preview:approve）
  python scripts/preview-export.py --only word3b --open

必要なもの: Windows、Microsoft Word（.xlsx があれば Excel）、Python の pywin32・PyMuPDF・Pillow・numpy
"""

from __future__ import annotations

import argparse
import html
import json
import os
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "test-vault" / "_export"
OUT = ROOT / ".preview"
PDF_DIR = OUT / "pdf"
CURRENT_DIR = OUT / "current"
BASELINE_DIR = OUT / "baseline"
DIFF_DIR = OUT / "diff"

# Word の WdExportFormat.wdExportFormatPDF / Excel の XlFixedFormatType.xlTypePDF
WD_EXPORT_FORMAT_PDF = 17
XL_TYPE_PDF = 0
# 1 チャンネルあたりこの値以下の差は、アンチエイリアスの揺れとして無視する
PIXEL_TOLERANCE = 16

sys.stdout.reconfigure(encoding="utf-8")


@dataclass
class PageResult:
    page: int
    status: str  # same / changed / new / removed
    current: str | None = None
    baseline: str | None = None
    diff: str | None = None
    changed_pixels: int = 0


@dataclass
class FileResult:
    rel: str
    status: str  # same / changed / new / error
    pages: list[PageResult] = field(default_factory=list)
    error: str | None = None


# ---------------------------------------------------------------- PDF 化（COM）


class OfficeExporter:
    """Word / Excel を必要になったときだけ起動し、最後にまとめて終了する。

    DispatchEx で新しいインスタンスを作るので、ユーザが開いている Word / Excel には触らない。
    """

    def __init__(self) -> None:
        self._word = None
        self._excel = None

    def _word_app(self):
        if self._word is None:
            import win32com.client

            self._word = win32com.client.DispatchEx("Word.Application")
            self._word.Visible = False
            self._word.DisplayAlerts = 0  # wdAlertsNone
        return self._word

    def _excel_app(self):
        if self._excel is None:
            import win32com.client

            self._excel = win32com.client.DispatchEx("Excel.Application")
            self._excel.Visible = False
            self._excel.DisplayAlerts = False
        return self._excel

    def export(self, src: Path, pdf: Path) -> None:
        pdf.parent.mkdir(parents=True, exist_ok=True)
        if pdf.exists():
            pdf.unlink()
        if src.suffix.lower() == ".docx":
            # Documents.Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
            doc = self._word_app().Documents.Open(str(src), False, True, False)
            try:
                doc.ExportAsFixedFormat(str(pdf), WD_EXPORT_FORMAT_PDF)
            finally:
                doc.Close(0)  # wdDoNotSaveChanges
        else:
            # Workbooks.Open(FileName, UpdateLinks, ReadOnly)
            wb = self._excel_app().Workbooks.Open(str(src), 0, True)
            try:
                wb.ExportAsFixedFormat(XL_TYPE_PDF, str(pdf))
            finally:
                wb.Close(False)

    def close(self) -> None:
        for app in (self._word, self._excel):
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
        self._word = self._excel = None


# ---------------------------------------------------------------- PNG 化と比較


def render_pages(pdf: Path, dest: Path, zoom: float) -> list[Path]:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    pages = []
    with fitz.open(pdf) as doc:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            out = dest / f"p{i:03d}.png"
            pix.save(out)
            pages.append(out)
    return pages


def compare(current: Path, baseline: Path, diff_out: Path) -> int:
    """違うピクセルの数を返す。違いがあれば、違う箇所を赤く塗った画像を diff_out に保存する。"""
    a = np.asarray(Image.open(current).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(baseline).convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        # 用紙サイズが変わった。全体を変化として扱う
        diff_out.parent.mkdir(parents=True, exist_ok=True)
        Image.open(current).save(diff_out)
        return a.shape[0] * a.shape[1]
    mask = (np.abs(a - b) > PIXEL_TOLERANCE).any(axis=2)
    count = int(mask.sum())
    if count:
        # 今回の画像を薄くし、違う箇所を赤で重ねる
        faded = (a * 0.35 + 255 * 0.65).astype(np.uint8)
        faded[mask] = (220, 30, 30)
        diff_out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(faded).save(diff_out)
    return count


def rel_url(path: Path) -> str:
    return path.relative_to(OUT).as_posix()


def process_file(rel: str, pdf: Path, zoom: float) -> FileResult:
    cur_dir = CURRENT_DIR / rel
    base_dir = BASELINE_DIR / rel
    diff_dir = DIFF_DIR / rel
    current_pages = render_pages(pdf, cur_dir, zoom)
    if diff_dir.exists():
        shutil.rmtree(diff_dir)

    if not base_dir.exists():
        pages = [PageResult(i, "new", current=rel_url(p)) for i, p in enumerate(current_pages, 1)]
        return FileResult(rel, "new", pages)

    baseline_pages = sorted(base_dir.glob("p*.png"))
    pages: list[PageResult] = []
    for i in range(1, max(len(current_pages), len(baseline_pages)) + 1):
        cur = current_pages[i - 1] if i <= len(current_pages) else None
        base = baseline_pages[i - 1] if i <= len(baseline_pages) else None
        if cur and base:
            diff = diff_dir / f"p{i:03d}.png"
            n = compare(cur, base, diff)
            pages.append(
                PageResult(
                    i,
                    "changed" if n else "same",
                    current=rel_url(cur),
                    baseline=rel_url(base),
                    diff=rel_url(diff) if n else None,
                    changed_pixels=n,
                )
            )
        elif cur:
            pages.append(PageResult(i, "new", current=rel_url(cur)))
        else:
            pages.append(PageResult(i, "removed", baseline=rel_url(base)))
    status = "same" if all(p.status == "same" for p in pages) else "changed"
    return FileResult(rel, status, pages)


# ---------------------------------------------------------------- 一覧ページ

STATUS_LABEL = {
    "same": "変化なし",
    "changed": "変化あり",
    "new": "基準なし",
    "removed": "ページ削除",
    "error": "エラー",
}

CSS = """
:root { --bg:#f6f7f9; --card:#fff; --fg:#1d2330; --muted:#667085; --line:#d9dde3;
  --same:#2e7d32; --changed:#c62828; --new:#1565c0; --error:#8e24aa; }
@media (prefers-color-scheme: dark) { :root { --bg:#16181d; --card:#20232a; --fg:#e6e8ec;
  --muted:#9aa3b2; --line:#353a44; --same:#66bb6a; --changed:#ef5350; --new:#64b5f6; --error:#ce93d8; } }
* { box-sizing:border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg);
  font:14px/1.5 "Segoe UI","Yu Gothic UI",sans-serif; }
header { position:sticky; top:0; background:var(--bg); padding:8px 0 12px; z-index:1;
  border-bottom:1px solid var(--line); margin-bottom:16px; }
h1 { font-size:18px; margin:0 0 6px; }
.summary span { margin-right:14px; }
.controls { margin-top:6px; color:var(--muted); }
.controls label { margin-right:14px; cursor:pointer; }
section { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:14px; }
section h2 { font-size:15px; margin:0 0 8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.badge { font-size:12px; padding:1px 8px; border-radius:10px; border:1px solid currentColor; }
.s-same{color:var(--same)} .s-changed{color:var(--changed)} .s-new{color:var(--new)}
.s-removed{color:var(--changed)} .s-error{color:var(--error)}
.pages { display:flex; flex-wrap:wrap; gap:12px; }
figure { margin:0; }
figure img { display:block; width:var(--thumb,260px); height:auto; border:1px solid var(--line); background:#fff; }
figcaption { font-size:12px; color:var(--muted); }
.trio { display:flex; gap:6px; flex-wrap:wrap; padding:6px; border:2px solid var(--changed); border-radius:6px; }
body.only-changed section[data-status="same"] { display:none; }
body.only-changed figure[data-status="same"] { display:none; }
pre { white-space:pre-wrap; color:var(--error); }
"""

JS = """
const body = document.body;
const only = document.getElementById('only');
const size = document.getElementById('size');
try { only.checked = localStorage.getItem('only') !== '0'; size.value = localStorage.getItem('size') || '260'; } catch (e) {}
function apply() {
  body.classList.toggle('only-changed', only.checked);
  body.style.setProperty('--thumb', size.value + 'px');
  try { localStorage.setItem('only', only.checked ? '1' : '0'); localStorage.setItem('size', size.value); } catch (e) {}
}
only.addEventListener('change', apply); size.addEventListener('input', apply); apply();
"""


def img(url: str | None, caption: str, status: str = "") -> str:
    if not url:
        return ""
    u = html.escape(url)
    attr = f" data-status='{status}'" if status else ""
    return f'<figure{attr}><a href="{u}" target="_blank"><img src="{u}" loading="lazy" alt=""></a><figcaption>{html.escape(caption)}</figcaption></figure>'


def write_html(results: list[FileResult], src: Path) -> Path:
    counts = {k: 0 for k in STATUS_LABEL}
    for r in results:
        counts[r.status] += 1
    parts = [
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        f"<title>変換結果の一覧</title><style>{CSS}</style></head><body>",
        "<header><h1>変換結果の一覧</h1><div class='summary'>",
        f"<span>対象: {html.escape(display_path(src))}</span>",
        f"<span>{len(results)} ファイル</span>",
    ]
    for k in ("changed", "new", "error", "same"):
        parts.append(f"<span class='s-{k}'>{STATUS_LABEL[k]}: {counts[k]}</span>")
    parts.append(f"<span>{time.strftime('%Y-%m-%d %H:%M:%S')}</span></div>")
    parts.append(
        "<div class='controls'><label><input type='checkbox' id='only' checked> 変化のあったものだけ表示</label>"
        "<label>サムネイルの幅 <input type='range' id='size' min='140' max='800' step='20' value='260'></label></div></header>"
    )
    order = {"error": 0, "changed": 1, "new": 2, "same": 3}
    for r in sorted(results, key=lambda r: (order[r.status], r.rel)):
        parts.append(f"<section data-status='{r.status}'><h2>{html.escape(r.rel)}")
        parts.append(f"<span class='badge s-{r.status}'>{STATUS_LABEL[r.status]}</span>")
        if r.pages:
            parts.append(f"<small>{len(r.pages)} ページ</small>")
        parts.append("</h2>")
        if r.error:
            parts.append(f"<pre>{html.escape(r.error)}</pre>")
        parts.append("<div class='pages'>")
        for p in r.pages:
            label = f"p.{p.page}"
            if p.status == "changed":
                parts.append("<div class='trio' data-status='changed'>")
                parts.append(img(p.baseline, f"{label} 基準"))
                parts.append(img(p.current, f"{label} 今回"))
                parts.append(img(p.diff, f"{label} 差分（赤: {p.changed_pixels:,} px）"))
                parts.append("</div>")
            elif p.status == "removed":
                parts.append(f"<div class='trio' data-status='removed'>{img(p.baseline, f'{label} 基準にだけある')}</div>")
            else:
                cap = label if p.status == "same" else f"{label}（{STATUS_LABEL[p.status]}）"
                parts.append(img(p.current, cap, p.status))
        parts.append("</div></section>")
    parts.append(f"<script>{JS}</script></body></html>")
    out = OUT / "index.html"
    out.write_text("".join(parts), encoding="utf-8")
    return out


# ---------------------------------------------------------------- 入口


def display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def describe_error(e: Exception) -> str:
    """COM のエラーは (hresult, 説明, (…, アプリ名, アプリの説明, …), …) の形なので、アプリの説明を取り出す。"""
    args = getattr(e, "args", ())
    if len(args) >= 3 and isinstance(args[2], tuple) and len(args[2]) >= 3 and args[2][2]:
        return f"{args[2][1]}: {args[2][2]}"
    return f"{type(e).__name__}: {e}"


def approve() -> None:
    if not CURRENT_DIR.exists():
        sys.exit("まだ PNG がありません。先に npm run preview:export を実行してください。")
    if BASELINE_DIR.exists():
        shutil.rmtree(BASELINE_DIR)
    shutil.copytree(CURRENT_DIR, BASELINE_DIR)
    if DIFF_DIR.exists():
        shutil.rmtree(DIFF_DIR)
    n = sum(1 for _ in BASELINE_DIR.rglob("*.png"))
    print(f"基準画像を更新しました: {n} ページ → {BASELINE_DIR.relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="変換結果のフォルダ（既定: test-vault/_export）")
    ap.add_argument("--only", default="", help="相対パスにこの文字列を含むファイルだけ処理する")
    ap.add_argument("--zoom", type=float, default=1.0, help="PNG の倍率（1.0 = 72 dpi）")
    ap.add_argument("--force", action="store_true", help="PDF が新しくても作り直す")
    ap.add_argument("--approve", action="store_true", help="今回の PNG を基準画像にする")
    ap.add_argument("--open", action="store_true", help="終わったら一覧ページを既定のブラウザで開く")
    args = ap.parse_args()

    if args.approve:
        approve()
        return

    src = args.src.resolve()
    files = sorted(
        p for p in src.rglob("*") if p.suffix.lower() in (".docx", ".xlsx") and not p.name.startswith("~$")
    )
    if args.only:
        files = [p for p in files if args.only in p.relative_to(src).as_posix()]
    if not files:
        sys.exit(f"{src} に .docx / .xlsx がありません。")

    exporter = OfficeExporter()
    results: list[FileResult] = []
    started = time.time()
    try:
        for i, f in enumerate(files, 1):
            rel = f.relative_to(src).as_posix()
            pdf = PDF_DIR / (rel + ".pdf")
            try:
                if args.force or not pdf.exists() or pdf.stat().st_mtime < f.stat().st_mtime:
                    exporter.export(f, pdf)
                    how = "PDF 化"
                else:
                    how = "PDF 再利用"
                r = process_file(rel, pdf, args.zoom)
            except Exception as e:  # 1 ファイルの失敗で全体を止めない
                r = FileResult(rel, "error", error=describe_error(e))
                how = "失敗"
            results.append(r)
            print(f"[{i}/{len(files)}] {STATUS_LABEL[r.status]:<5} {how:<6} {rel}")
            if r.error:
                print(f"    {r.error}")
    finally:
        exporter.close()

    # --only のときは、処理しなかったファイルの結果を一覧から消さないよう前回の結果と合わせる
    summary_path = OUT / "summary.json"
    if args.only and summary_path.exists():
        prev = json.loads(summary_path.read_text(encoding="utf-8"))
        done = {r.rel for r in results}
        for d in prev.get("files", []):
            if d["rel"] not in done:
                results.append(FileResult(d["rel"], d["status"], [PageResult(**p) for p in d["pages"]], d.get("error")))

    summary = {
        "src": str(src),
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "files": [
            {"rel": r.rel, "status": r.status, "error": r.error, "pages": [p.__dict__ for p in r.pages]} for r in results
        ],
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    out = write_html(results, src)

    counts = {k: sum(1 for r in results if r.status == k) for k in STATUS_LABEL}
    print(
        f"\n{time.time() - started:.1f} 秒 / 変化あり {counts['changed']}・基準なし {counts['new']}・"
        f"エラー {counts['error']}・変化なし {counts['same']}"
    )
    print(f"一覧ページ: {out}")
    if counts["new"] or counts["changed"]:
        print("見た目を確かめて問題なければ、npm run preview:approve で基準画像にしてください。")
    if args.open:
        os.startfile(out)


if __name__ == "__main__":
    main()
