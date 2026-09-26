// 天地图接口的 HTTP 失败描述（geocoder / drive·walk·bus / v2 search 三个适配器共用）。
//
// 天地图是「HTTP 状态码 + JSON body」双通道报错，且不同码的语义完全不同（09-25 实测）：
//   400 + code 308011「请求参数非法长度或不合规」 → 某参数长度/格式不合规，**最常见是 tk 不是 32 位**
//   403 + code 301001「非法key」                 → tk 长度对但无效/未生效
//   418（CloudWAF 的 HTML 拦截页，非 JSON）       → 请求被 WAF 判为异常，例如 tk 为空
// 只回 "HTTP 400" 会把这三类彻底混作一谈，而设置页自检卡片是直接显示给用户的 —— 必须带上 body。
const MAX_DETAIL_CHARS = 200;

/** 非 2xx 响应 → 可诊断的 Error：body 压平换行并截断；响应体是错误码与说明，不含凭据 */
export async function describeHttpFailure(res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_CHARS);
  } catch {
    detail = '';   // body 读不出来也不能掩盖状态码本身
  }
  return new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
}
