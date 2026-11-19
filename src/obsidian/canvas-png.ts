// canvas を PNG のバイト列にする（Mermaid 図・画像の変換・数式・他プラグインの図の画像化で共用）。
// canvas.toBlob は使わない。Chromium の toBlob は PNG の符号化をアイドル時間に回し、アイドル時間が来ないと
// 約 1 秒待ってから始めるため、1 回ごとに約 1 秒かかっていた（2026-11-19 の計測: docs/design/performance.md）。
// toDataURL はその場で符号化する。tainted canvas では toBlob と同じく SecurityError を投げる。
import { pngDataUrlToBytes } from "../core/png";
import { timedSync } from "../core/profile";

export function canvasToPng(canvas: HTMLCanvasElement): Uint8Array {
	return timedSync("image/encodePng", () => pngDataUrlToBytes(canvas.toDataURL("image/png")));
}
