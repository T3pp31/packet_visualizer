# Packet Visualizer

ローカルネットワークのパケットキャプチャ（`.pcapng`）を読み込み、端末・ルータ・ブロードキャストなどのトポロジ上でパケットの流れをアニメーション再生する Web アプリです。

## デモ

GitHub Pages: https://t3pp31.github.io/packet_visualizer/

## 機能

- `.pcapng` ファイルのドラッグ＆ドロップ / ファイル選択
- サンプル PCAP の即時読み込み
- ARP / IPv4 基本フレームの解析
- MAC / IP からのトポロジ自動推論と円配置
- ホイール・ボタンによるトポロジ全体のズーム、パン、全体表示
- ノード種別（端末 / ルータ / サーバ / 不明）の変更
- ノード位置のドラッグ固定
- パケット一覧・タイムラインスクラブ・再生速度変更

## 開発

```bash
npm install
npm run dev
npm test
npm run build
```

## 設定

[`config/app.config.json`](config/app.config.json) に再生速度、色、レイアウト、推論しきい値を定義しています。

## 制限事項（MVP）

- 対応形式: `.pcapng` のみ（legacy `.pcap` 非対応）
- 対応プロトコル: ARP / IPv4 基本ヘッダのみ
- TCP / UDP / ICMP 詳細、HTTP、IPv6、ライブキャプチャは未対応
- 大規模 PCAP の最適化は未実装

## ライセンス

MIT
