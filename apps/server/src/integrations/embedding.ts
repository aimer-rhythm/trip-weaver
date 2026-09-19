// OpenAI 兼容 Embedding 客户端：POST {baseUrl}/embeddings
// 失败一律回 null（网络/4xx/维度不符），不抛错（对齐项目降级哲学）
// BYOK baseUrl 不过 ssrfGuard：embedding 走站长独立配置或 SITE_* 回落，不走用户 BYOK（见 model.ts 注释）
import { env, hasEmbedding } from '../env';

interface EmbeddingResponse {
  data?: { embedding?: number[] }[];
}

const BATCH_LIMIT = 32;

/** 批量取 embedding；返回与入参等长的数组，失败位为 null */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (!hasEmbedding()) return texts.map(() => null);
  if (env.embedding.dims !== 1024) {
    console.warn(`[embedding] EMBEDDING_DIMS=${env.embedding.dims} 与 schema 维度 1024 不符，跳过向量生成`);
    return texts.map(() => null);
  }

  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
    const batch = texts.slice(i, i + BATCH_LIMIT);
    try {
      const res = await fetch(`${env.embedding.baseUrl.replace(/\/+$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.embedding.apiKey}`,
        },
        body: JSON.stringify({ model: env.embedding.model, input: batch }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        console.warn(`[embedding] HTTP ${res.status}，批次 ${i}-${i + batch.length - 1} 置 null`);
        continue;
      }
      const body = (await res.json()) as EmbeddingResponse;
      for (let j = 0; j < batch.length; j++) {
        const vec = body.data?.[j]?.embedding;
        if (Array.isArray(vec) && vec.length === 1024) {
          results[i + j] = vec;
        } else if (vec) {
          console.warn(`[embedding] 返回维度 ${vec.length} ≠ 1024，置 null`);
        }
      }
    } catch (err) {
      console.warn(`[embedding] 批次失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}
