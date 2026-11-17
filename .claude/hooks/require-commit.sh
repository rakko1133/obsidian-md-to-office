#!/usr/bin/env bash
# Stop hook: 未コミットの変更が残っていたら、Claude に応答を終える前のコミットを指示する。
# コミットメッセージは Claude が docs/process/git-rules.md の書式で書く（自動の機械的なメッセージは使わない）。

input=$(cat)

# この hook の指示で Claude がすでに続行中なら、二重にブロックしない（無限ループ防止）
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changes=$(git status --porcelain)
[ -z "$changes" ] && exit 0

# 改行を JSON 用に \n へ、" と \ をエスケープ
files=$(printf '%s' "$changes" | head -n 30 | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{printf "%s\\n", $0}')

cat <<EOF
{"decision":"block","reason":"未コミットの変更があります。docs/process/git-rules.md のルール（Conventional Commits、日本語の要約、1コミット=1つの論理的な変更、要件番号）に従ってコミットしてから応答を終えてください。変更が複数の論理的なまとまりに分かれる場合はコミットを分けてください。ユーザが Obsidian で編集した変更が含まれる場合も、内容を確認してコミットしてください。push はしないでください。\\n\\n変更ファイル:\\n${files}"}
EOF
exit 0
