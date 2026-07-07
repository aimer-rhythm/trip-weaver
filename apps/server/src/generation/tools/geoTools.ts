// 编排 Agent 的地理编码工具：Nominatim 封装（限流与缓存在 integrations/geocode.ts）
import { Type } from 'typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { defineTool } from './defineTool';
import { geocode } from '../../integrations/geocode';

export function buildGeoTools(destination: string): AgentTool[] {
  const geocodeTool = defineTool({
    name: 'geocode_place',
    label: '查询地点坐标',
    description: '查询一个地点的经纬度坐标。只对每天最重要的 2~3 个地点使用，次要地点留空坐标即可。',
    parameters: Type.Object({
      name: Type.String({ description: '地点名称，如「浅草寺」' }),
    }),
    execute: async (_id, params) => {
      // 拼接目的地消歧（「浅草寺」→「东京 浅草寺」）
      const point = (await geocode(`${destination} ${params.name}`)) ?? (await geocode(params.name));
      if (!point) {
        return {
          content: [{ type: 'text' as const, text: `未查到「${params.name}」的坐标，请将该活动坐标留空（不要编造）。` }],
          details: { found: false },
        };
      }
      return {
        content: [{ type: 'text' as const, text: `「${params.name}」坐标：lat=${point.lat}, lng=${point.lng}` }],
        details: { found: true, ...point },
      };
    },
  });
  return [geocodeTool];
}
