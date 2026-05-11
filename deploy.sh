#!/usr/bin/env bash
# jun7680/blog deploy script
# - Hugo 빌드 후 public submodule (jun7680.github.io)과 blog source 양쪽을 push
# - detached HEAD, 작업 파일 유출, 원격 divergence를 안전하게 처리
# 사용법: bash deploy.sh "커밋 메시지"  (메시지 생략 시 "rebuilding site <date>")

set -e

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { printf "${GREEN}[deploy]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[deploy]${NC} %s\n" "$*"; }
fail() { printf "${RED}[deploy]${NC} %s\n" "$*"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# 1) 사전 점검
command -v hugo >/dev/null 2>&1 || fail "hugo not found in PATH"
[ -d public/.git ] || [ -f public/.git ] || fail "public submodule not initialized. Run: git submodule update --init --recursive"

# 2) Hugo 빌드
log "building site..."
hugo --gc --minify

# 3) public submodule push
cd public

# 작업 추적 파일이 public 디렉토리에 흘러들어왔으면 제거 (.omc, *.bak 등)
[ -d .omc ] && { warn "stripping .omc/ from public"; rm -rf .omc; }
shopt -s nullglob
for f in *.bak; do
  warn "stripping $f from public"
  rm -f "$f"
done
shopt -u nullglob

# .gitignore 보장
if [ ! -f .gitignore ] || ! grep -q '^\.omc/$' .gitignore 2>/dev/null; then
  printf ".omc/\n*.bak\n.DS_Store\n" > .gitignore
fi

# detached HEAD → master 브랜치로 보장
if ! git symbolic-ref -q HEAD >/dev/null; then
  warn "public: detached HEAD detected, attaching to master branch"
  git checkout -B master
fi

# 변경 사항 stage + commit
git add .
msg="rebuilding site $(date)"
[ $# -eq 1 ] && msg="$1"
if git diff --staged --quiet; then
  log "public: no changes to commit"
else
  git commit -m "$msg"
fi

# 원격 동기화: 우리가 뒤처졌으면 rebase
log "public: fetching origin/master..."
git fetch origin master --quiet

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse origin/master 2>/dev/null || echo "")
BASE=$(git merge-base @ origin/master 2>/dev/null || echo "")

if [ -z "$REMOTE" ]; then
  warn "public: no origin/master yet (first push)"
elif [ "$LOCAL" = "$REMOTE" ]; then
  log "public: already up to date with origin/master"
elif [ "$LOCAL" = "$BASE" ]; then
  warn "public: local is behind origin/master, fast-forwarding"
  git reset --hard origin/master
elif [ "$REMOTE" = "$BASE" ]; then
  log "public: local is ahead of origin/master"
else
  warn "public: diverged from origin/master, rebasing"
  git pull --rebase origin master || fail "public: rebase failed, resolve manually"
fi

log "public: pushing to origin/master..."
git push origin master

cd "$ROOT"

# 4) blog source push (테마/콘텐츠 + 갱신된 submodule pointer)
git add .
msg2="rebuilding site $(date)"
[ $# -eq 1 ] && msg2="$1"
if git diff --staged --quiet; then
  log "blog: no changes to commit"
else
  git commit -m "$msg2"
fi

log "blog: fetching origin/master..."
git fetch origin master --quiet

LOCAL_B=$(git rev-parse @)
REMOTE_B=$(git rev-parse origin/master 2>/dev/null || echo "")
BASE_B=$(git merge-base @ origin/master 2>/dev/null || echo "")

if [ -z "$REMOTE_B" ]; then
  warn "blog: no origin/master yet (first push)"
elif [ "$LOCAL_B" = "$REMOTE_B" ]; then
  log "blog: already up to date with origin/master"
elif [ "$LOCAL_B" = "$BASE_B" ]; then
  warn "blog: local is behind origin/master, fast-forwarding"
  git reset --hard origin/master
elif [ "$REMOTE_B" = "$BASE_B" ]; then
  log "blog: local is ahead of origin/master"
else
  warn "blog: diverged from origin/master, rebasing"
  git pull --rebase origin master || fail "blog: rebase failed, resolve manually"
fi

log "blog: pushing to origin/master..."
git push origin master

log "deploy complete. Live URL: https://jun7680.github.io/"
log "GitHub Pages typically takes 1~2 minutes to publish."
