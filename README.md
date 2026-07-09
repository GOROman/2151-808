# 2151-808 — YM-808 Rhythm Composer

TR-808 スタイルのステップシーケンサーで、**YM2151 (OPM) の FM 音源エミュレーション**を鳴らすリズムマシン Web アプリ。

**▶ https://goroman.github.io/2151-808/**

![YM-808 Rhythm Composer](docs/screenshot.png)

## 特徴

### 音源
- **本物の YM2151 コア**: [ymfm](https://github.com/aaronsgiles/ymfm) (Aaron Giles) を WebAssembly にビルドし、AudioWorklet 内でレジスタ書き込みベースで駆動。チップネイティブレート (3.579545MHz ÷ 64 ≈ 55.93kHz) で生成し、リサンプルして出力
- **9 インストゥルメント**: BD / SD / LT / MT / HT / CB / CP / OH / CH を YM2151 の 8 チャンネルに割り当て (OH/CH は ch7 のノイズを共有、チョーク動作あり)。BD は Dragon Spirit (MXDRV) の音色、SD/CB/CP/OH/CH は 808 風にチューニング
- **マスターフィルター**: ローパス / ハイパス + レゾナンス (TPT ステートバリアブルフィルター)
- **MDX 音色インポート**: MXDRV (X68000) の .mdx ファイルから OPM 音色定義を読み込み、任意のインストにアサイン

### シーケンサー
- **サンプル精度**: AudioWorklet 内のフレームカウンタで駆動。ピッチスイープ (キック/タム) はトリガー後の KC/KF レジスタ自動書き込みで実現
- **シーケンス長 16–64 ステップ** (ステップページ切替)、アクセント (Shift+クリック)、テンポ、スウィング、A/B パターン + AB 交互再生、FILL
- **キーボード操作**: `SPACE` = 再生/一時停止、`Enter` = 頭から再生
- 再生中は鳴ったインストのボタンが光る

### エディット / その他
- **SOUND EDIT**: 各音色の FM パラメータ (ALG/FB/MUL/TL/EG/DT/ノイズ周波数…) をリアルタイム編集。音程は音名+オクターブ+ファインチューン (±50 セント) で指定
- **YM2151 レジスタビューア**: チップへの書き込みを 16×16 の HEX ダンプでライブ表示
- パターン+音色を localStorage に自動保存。**SHARE** で URL 共有 (デフォルトとの差分を deflate 圧縮 — X に貼れる短さ)

## 開発

```bash
git clone --recursive https://github.com/GOROman/2151-808.git
cd 2151-808
npm install
npm run build:wasm   # 要 emscripten (brew install emscripten)
npm run dev
```

`public/ymfm.wasm` はコミット済みなので、emscripten なしでも `npm run dev` だけで動きます。

## ライセンス

- アプリ本体: MIT
- YM2151 エミュレーションコア: [ymfm](https://github.com/aaronsgiles/ymfm) (BSD-3-Clause)
