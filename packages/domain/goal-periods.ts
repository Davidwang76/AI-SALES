export type GoalPeriod = {
  year: number;
  quarter: number;
  month?: number | null;
  ten_day?: number | null;
};
export function goalPeriodLabel(p: GoalPeriod) {
  if (p.month && p.ten_day)
    return `${p.year}年${p.month}月${["上旬", "中旬", "下旬"][p.ten_day - 1]}`;
  if (p.month) return `${p.year}年${p.month}月`;
  return `${p.year}年 第${p.quarter}季度`;
}
export function goalPeriodRange(p: GoalPeriod) {
  const firstMonth = p.month || (p.quarter - 1) * 3 + 1;
  const firstDay = p.ten_day ? (p.ten_day - 1) * 10 + 1 : 1;
  const lastMonth = p.month || p.quarter * 3;
  const lastDay =
    p.ten_day && p.ten_day < 3
      ? p.ten_day * 10
      : new Date(Date.UTC(p.year, lastMonth, 0)).getUTCDate();
  const format = (month: number, day: number) =>
    `${p.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    start: format(firstMonth, firstDay),
    end: format(lastMonth, lastDay),
  };
}
