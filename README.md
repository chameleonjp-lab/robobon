# ロボボン

条件と行動のカードで作戦を組み、ロボットの自動戦闘を観察し、1枚だけ直して再戦する2Dブラウザゲームです。主対象はiPhone 17 Proの縦画面です。

## 現在の状態

GitHub Pagesに試作版を公開済みです。[公開中のロボボン](https://chameleonjp-lab.github.io/robobon/)はmainの内容です。

2026年9月8日のAstra High監査に基づき、ゲームの中心となる戦闘から再建しています。このブランチはR01です。共通の戦闘更新に移動・旋回・射撃・冷却・行動の継続と中断を接続し、画面と検査が同じ計算を使います。旧作戦は元を残し、明示した複製で新ルールへ移します。

- [改善実装計画 5.0（正本）](IMPLEMENTATION_PLAN.md)
- [R01の契約・変更・検証・未確認事項](docs/R01_IMPLEMENTATION.md)
- [従来の検査・受入計画](TEST_PLAN.md)
- [iPhoneでのPR確認・復旧手順](docs/RUNBOOK_IOS.md)

R02以降では、導入戦のバランス、改善効果の証拠と場面再生、実際に異なる任務、装備・機体・敵の拡充、見た目と音を順に仕上げます。既存の合成fixtureやビルド成功を、実機確認・初見試遊の完了として数えません。

## 開発・検査

Node.js 24以降を使用します。

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run check:build
npm run dev -- --host 127.0.0.1
```

PRのCIではテスト、型検査、配信物検査、レビュー用成果物の作成を行います。mainへ直接pushせず、Draft PRで確認します。Pagesはmainの更新時に配信されます。
