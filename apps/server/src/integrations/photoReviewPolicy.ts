/** 滚动 24 小时的地点预算，只计首次启动的地点；显式配置可降低，但不能超过此上限。重试不占用额度，也不能把窗口向后推移。 */
export const DEFAULT_PHOTO_REVIEW_DAILY_PLACES = 50;
