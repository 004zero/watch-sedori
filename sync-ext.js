// data.js / core.js を拡張機能フォルダへコピーする（Webツールと拡張で同じDB・判定ロジックを使うため）
// 使い方: node sync-ext.js
const fs = require('fs'), path = require('path');
for (const f of ['data.js', 'core.js']) {
  fs.copyFileSync(path.join(__dirname, f), path.join(__dirname, 'extension', f));
  console.log('copied', f);
}
