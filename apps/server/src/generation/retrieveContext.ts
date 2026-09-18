// RAG 检索调用点（09-18 地基）：编排前的外部知识检索入口。
// 当前为占位实现，恒返回空数组；后续任务接入 canonical_places / research_evidence 查询与向量检索。
// 刻意不引入抽象接口（YAGNI）：签名稳定后再谈抽象。
export async function retrieveContext(placeIds: string[]): Promise<unknown[]> {
  void placeIds;
  // TODO(09-18 RAG 接入)：查询 canonical_places（city/verified 索引）与 research_evidence，
  // 命中结果注入 plannerUserPrompt；embedding 列落地后叠加向量召回。
  return [];
}
