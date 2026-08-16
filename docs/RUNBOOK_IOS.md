# iPhone運用手順（Draft）

## 目的と状態

この手順は、PCを前提にせず、iPhoneのGitHub画面からPR、CI、配信物の照合、復旧判断を行うためのものです。現在は手順を追加しただけで、実際のiPhone操作・Preview実行・復旧操作は未実施です。実施者は結果、日時（日本時間）、確認したコミットの完全なSHA、残る危険を記録してください。

P0〜P6ではGitHub Pagesを有効化しません。Actionsの成果物はビルドと配信パスを確認するためのZIPであり、Safariでそのまま動くPreviewとは限りません。ZIPを開けたことだけで、iPhone実機受入や利用者テストを合格にしないでください。

## PagesをActions配信へ切り替える場合

Pagesの公開元が「Deploy from a branch」のままだと、リポジトリの`index.html`がそのまま配信され、`/src/main.ts`や未ビルドの素材を参照して画面が表示されません。`Deploy GitHub Pages`ワークフローで`dist`を配信する場合は、次の順に操作します。

1. GitHubの`Settings`→`Pages`→`Build and deployment`→`Source`を`GitHub Actions`へ変更する。
2. `Deploy GitHub Pages`ワークフローをmainへマージする。
3. `Actions`→`Deploy GitHub Pages`→`Run workflow`→`main`→`Run workflow`を選ぶ。
4. `build`と`deploy`が成功してから、`https://chameleonjp-lab.github.io/robobon/`を開く。
5. Safariで古いHTMLが残る場合は、ページを再読み込みし、`/robobon/manifest.webmanifest`が404でないことを確認する。

Sourceを切り替えずにワークフローだけ実行しても、Pagesの公開元は変わりません。公開を続けるか停止するかは、名称・独自性・手動受入の判定後に所有者が決めます。

## PRを確認する（5操作以内の目安）

1. GitHubアプリまたはSafariで対象PRを開き、baseが`main`、headが作業ブランチであることを確認する。
2. PR上部のChecksから`CI / build`を開き、全ステップが成功していること、失敗時は再実行リンクが表示されていることを確認する。
3. PRのheadに表示された完全なコミットSHAと、workflow runの`head_sha`が一致することを照合する。短縮SHAだけで承認しない。
4. CIのSummaryから`robobon-dist-<workflowのgithub.sha>`という名前の成果物をダウンロードし、Filesへ保存する。PRイベントではこの成果物名のSHAが合成マージSHAになるため、PR head SHAと同じでなくても直ちに不一致とはしない。成果物の保存期間はActionsに表示された期限を記録する。
5. `dist/review-manifest.json`の`headSha`、`baseSha`、`workflowSha`、`artifactName`、`basePath`をActions Summaryと照合する。そのうえで`dist/index.html`と生成物のURLが`/robobon/`を使うこと、404・旧slugの配信パス・外部scriptの読み込みがないことを記録する。ZIPの閲覧だけでは、Canvas、音、入力、Safariのメモリを検査したことにならない。

## 実機Previewを使う場合

名称・独自性・素材・公開条件の承認前に、一般公開URLを作らない。認証付きのPreviewまたは期限付きテストURLを所有者が用意した場合だけ、URL、期限、対象SHA、アクセスできる参加者、終了後の停止方法を手動受入表へ記録する。「検索除外」「URLを知らない」は非公開の保証ではない。

実機確認は`docs/P4_MANUAL_ACCEPTANCE.md`の未記入欄を順に埋める。P4-20、P4-21、P4-22の参加者を混ぜず、同じ人の再確認は別行にする。外部送信、氏名・連絡先の保存、結果の水増しを行わない。

## 承認・マージ

名称調査、独自性比較、素材台帳、コードCI、手動受入、実機性能の所有者承認がそろうまで、PRをマージしてもPages公開は行わない。未達項目が一つでもあれば、PR本文へ残る危険と次の判断（修正・縮小・作り直し・停止）を追記する。

## 復旧・公開停止

- 未マージのPR: PRを閉じ、成果物を削除または期限切れまで保管し、公開URLを作らない。
- マージ後・Pages未公開: GitHubの対象コミットから`Revert`を作り、CI成功を確認してからmainへ反映する。
- Pages公開後に誤公開を発見: まずPagesの設定で公開元を停止し、URLが旧版を返さないことを確認する。次に対象コミットをRevertし、停止日時・実施者・確認SHAを記録する。Pagesの停止権限がない場合は操作を続けず、所有者へエスカレーションする。

復旧時も既存のセーブや手動記録を削除しない。原因、影響範囲、停止・復旧の時刻、再公開を許可する判断者を記録し、Pages再公開は名称・独自性・完成ゲートを再確認してから行う。
