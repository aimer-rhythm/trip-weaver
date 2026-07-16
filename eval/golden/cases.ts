// 评测金集（M0-B）：固定 GenerateForm 用例，覆盖多城 × 天数 × 出行方式 × 预算/住宿组合
// 上线门槛口径：全部用例 hard violation = 0（见 .trellis/spec/server/backend/generation-guidelines.md）
import type { GenerateForm } from '@tripweaver/shared';

export interface GoldenCase {
  id: string;        // 快照文件名（eval/snapshots/<id>.json）
  note: string;      // 用例设计意图
  form: GenerateForm;
}

const base = { startDate: '', totalBudget: 0, extraNotes: '' } as const;

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: 'shanghai-3d-transit',
    note: '基线：一线城市 3 日公共交通，最常见请求形态',
    form: { ...base, destination: '上海', days: 3, budgetLevel: '舒适', preferences: ['美食', '文化'], partySize: 2, transportMode: 'transit' },
  },
  {
    id: 'beijing-5d-family',
    note: '长行程 + 亲子：景点分散（市区/郊区长城），易触发 transit_infeasible 与 overpacked',
    form: { ...base, destination: '北京', days: 5, budgetLevel: '舒适', preferences: ['文化', '亲子'], partySize: 3, transportMode: 'transit', totalBudget: 8000 },
  },
  {
    id: 'chengdu-3d-food',
    note: '美食主题 + 指定住宿锚点：验证 lodging 解析与住宿哨兵 leg',
    form: { ...base, destination: '成都', days: 3, budgetLevel: '经济', preferences: ['美食', '小众'], partySize: 2, transportMode: 'transit', lodging: '春熙路' },
  },
  {
    id: 'xian-2d-culture',
    note: '短行程高密度：兵马俑在远郊，单日往返时间压力大',
    form: { ...base, destination: '西安', days: 2, budgetLevel: '经济', preferences: ['文化'], partySize: 1, transportMode: 'transit' },
  },
  {
    id: 'guangzhou-1d-walk',
    note: '单日步行模式：验证 softWalkMeters（15km）步行超限判定',
    form: { ...base, destination: '广州', days: 1, budgetLevel: '经济', preferences: ['美食'], partySize: 2, transportMode: 'walk' },
  },
  {
    id: 'hangzhou-3d-drive',
    note: '自驾模式 + 自然偏好：西湖周边与郊区景区混排',
    form: { ...base, destination: '杭州', days: 3, budgetLevel: '舒适', preferences: ['自然', '文化'], partySize: 4, transportMode: 'drive', totalBudget: 6000 },
  },
  {
    id: 'chongqing-4d-night',
    note: '山城立体地形 + 夜生活：坐标近但通勤久，直线估算最易失真的城市',
    form: { ...base, destination: '重庆', days: 4, budgetLevel: '舒适', preferences: ['美食', '夜生活'], partySize: 2, transportMode: 'transit' },
  },
  {
    id: 'suzhou-2d-luxury',
    note: '豪华档 + 明确总预算：验证预算一致性偏离度',
    form: { ...base, destination: '苏州', days: 2, budgetLevel: '豪华', preferences: ['文化', '购物'], partySize: 2, totalBudget: 10000, transportMode: 'transit', lodging: '金鸡湖' },
  },
  {
    id: 'qingdao-7d-slow',
    note: '7 日慢行程：验证长行程不空天、节奏不塌缩为重复模板',
    form: { ...base, destination: '青岛', days: 7, budgetLevel: '舒适', preferences: ['自然', '美食'], partySize: 2, transportMode: 'transit' },
  },
];
