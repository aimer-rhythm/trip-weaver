# 服务器部署脚本（Docker Compose 版）
# 用法（在仓库根目录、已安装 Docker + compose v2 插件的 Linux 服务器上）：
#   bash scripts/deploy.sh [选项]
#
# 选项：
#   --skip-pull    跳过 git pull（用当前工作区代码构建）
#   --logs         部署完成后跟随 app 日志
#
# 幂等：可重复执行；数据库数据在 pg_data volume 中持久化。
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_PULL=0
FOLLOW_LOGS=0
for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=1 ;;
    --logs) FOLLOW_LOGS=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

# ---------- 0. 环境检查 ----------
command -v docker >/dev/null || { echo "✗ 未安装 docker，先执行: curl -fsSL https://get.docker.com | sh" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ 缺少 docker compose v2 插件" >&2; exit 1; }

# ---------- 1. 拉取代码 ----------
if [ "$SKIP_PULL" -eq 0 ]; then
  echo "== git pull =="
  git pull --ff-only
fi

# ---------- 2. 准备 .env ----------
if [ ! -f .env ]; then
  cp .env.example .env
  # 自动生成缺省密钥，减少手填项
  sed -i "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
  sed -i "s/^MASTER_KEY=$/MASTER_KEY=$(openssl rand -hex 32)/" .env
  sed -i "s/^REGISTRATION_MODE=$/REGISTRATION_MODE=invite/" .env
  sed -i "s/^INVITE_CODE=$/INVITE_CODE=$(openssl rand -hex 4)/" .env
  echo "== 已生成 .env（POSTGRES_PASSWORD / MASTER_KEY / INVITE_CODE 已随机填充）=="
  echo "!! 请按需编辑 .env 补齐: SITE_DOMAIN / SITE_LLM_API_KEY / AMAP_KEY / GITHUB_* 后重跑本脚本"
  exit 0
fi

# ---------- 3. 构建并启动 ----------
echo "== docker compose up --build -d =="
docker compose up --build -d

# ---------- 4. 等待健康检查 ----------
echo "== 等待 app 健康 =="
for i in $(seq 1 60); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "✓ /api/health 200"
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "✗ app 启动超时，最近日志：" >&2
    docker compose logs --tail 50 app >&2
    exit 1
  fi
done

# ---------- 5. 验收 ----------
echo "== 验收 =="
docker compose exec -T db psql -U postgres -d tripweaver -tAc \
  "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'" \
  | grep -q "canonical_places" \
  && echo "✓ RAG 地基表已建（canonical_places / research_evidence）" \
  || { echo "✗ 表结构不完整" >&2; exit 1; }

if docker compose exec -T db psql -U postgres -d tripweaver -tAc \
  "SELECT count(*) FROM pg_extension WHERE extname='vector'" | grep -q 1; then
  echo "✓ pgvector 扩展可用"
else
  echo "⚠ pgvector 扩展未启用（不影响当前功能，RAG 接入前需排查）"
fi

docker compose exec -T db psql -U postgres -d tripweaver -tAc \
  "SELECT count(*) FROM canonical_places WHERE verified" \
  | { read -r n; echo "✓ canonical_places verified=${n}（0 表示尚未回填金集，可执行: docker compose exec app npx tsx apps/server/scripts/seed-canonical-places.ts）"; }

echo ""
echo "PASS —— 部署完成"
docker compose ps

[ "$FOLLOW_LOGS" -eq 1 ] && docker compose logs -f app
exit 0
