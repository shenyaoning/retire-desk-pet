//! 工作日计算：扣除周末和法定节假日，加回调休上班日。
//! 内置 2025、2026 年国务院办公厅公布的放假安排；没有官方安排的年份按每年 13 天法定假日估算。

use chrono::{Datelike, Duration, NaiveDate, Weekday};

/// (起始年月日, 结束年月日) 放假区间（含两端）
const OFF_2025: &[(u32, u32, u32, u32)] = &[
    (1, 1, 1, 1),     // 元旦
    (1, 28, 2, 4),    // 春节
    (4, 4, 4, 6),     // 清明
    (5, 1, 5, 5),     // 劳动节
    (5, 31, 6, 2),    // 端午
    (10, 1, 10, 8),   // 国庆+中秋
];
const MAKEUP_2025: &[(u32, u32)] = &[(1, 26), (2, 8), (4, 27), (9, 28), (10, 11)];

const OFF_2026: &[(u32, u32, u32, u32)] = &[
    (1, 1, 1, 3),     // 元旦
    (2, 15, 2, 23),   // 春节（连休9天）
    (4, 4, 4, 6),     // 清明
    (5, 1, 5, 5),     // 劳动节
    (6, 19, 6, 21),   // 端午
    (9, 25, 9, 27),   // 中秋
    (10, 1, 10, 7),   // 国庆
];
const MAKEUP_2026: &[(u32, u32)] = &[(1, 4), (2, 14), (2, 28), (5, 9), (9, 20), (10, 10)];

/// 法定假日名称表（用于「下一个法定假日」展示）
pub const HOLIDAY_NAMES_2025: &[(&str, (u32, u32))] = &[
    ("元旦", (1, 1)),
    ("春节", (1, 28)),
    ("清明节", (4, 4)),
    ("劳动节", (5, 1)),
    ("端午节", (5, 31)),
    ("国庆节·中秋", (10, 1)),
];
pub const HOLIDAY_NAMES_2026: &[(&str, (u32, u32))] = &[
    ("元旦", (1, 1)),
    ("春节", (2, 15)),
    ("清明节", (4, 4)),
    ("劳动节", (5, 1)),
    ("端午节", (6, 19)),
    ("中秋节", (9, 25)),
    ("国庆节", (10, 1)),
];

fn md(year: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, m, d).unwrap()
}

fn is_off_in(year: i32, date: NaiveDate, table: &[(u32, u32, u32, u32)]) -> bool {
    table.iter().any(|&(m1, d1, m2, d2)| date >= md(year, m1, d1) && date <= md(year, m2, d2))
}

fn is_makeup_in(year: i32, date: NaiveDate, table: &[(u32, u32)]) -> bool {
    table.iter().any(|&(m, d)| date == md(year, m, d))
}

fn has_official(year: i32) -> bool {
    year == 2025 || year == 2026
}

/// 某天是不是工作日（官方表内年份按表；其他年份按「周一至周五」近似）
pub fn is_workday(date: NaiveDate) -> bool {
    let y = date.year();
    let weekend = matches!(date.weekday(), Weekday::Sat | Weekday::Sun);
    match y {
        2025 => {
            if is_makeup_in(y, date, MAKEUP_2025) {
                return true;
            }
            !weekend && !is_off_in(y, date, OFF_2025)
        }
        2026 => {
            if is_makeup_in(y, date, MAKEUP_2026) {
                return true;
            }
            !weekend && !is_off_in(y, date, OFF_2026)
        }
        _ => !weekend,
    }
}

#[derive(Debug, serde::Serialize)]
pub struct WorkdayCount {
    pub days: i64,
    /// true = 没有官方安排、按比例估算
    pub estimated: bool,
}

/// [from, to] 两端都算的工作日数。to < from 时返回 0。
pub fn count_workdays(from: NaiveDate, to: NaiveDate) -> WorkdayCount {
    if to < from {
        return WorkdayCount { days: 0, estimated: false };
    }
    let y1 = from.year();
    let y2 = to.year();
    let estimated = y1 != y2 || !has_official(y1) || !has_official(y2);
    let mut days = 0i64;
    let mut cur = from;
    while cur <= to {
        if is_workday(cur) {
            days += 1;
        }
        cur += Duration::days(1);
    }
    if estimated {
        // 无官方安排的年份按每年 13 天法定假日估算：
        // 一年约 260.9 个工作日，扣 13 天 → 95% 左右
        let weekdays = days;
        days = (weekdays as f64 * (1.0 - 13.0 / 260.9)).round() as i64;
    }
    WorkdayCount { days, estimated }
}

#[derive(Debug, serde::Serialize)]
pub struct NextHoliday {
    pub name: String,
    pub date: NaiveDate,
}

/// 今天（含）之后的下一个法定假日
pub fn next_holiday(today: NaiveDate) -> Option<NextHoliday> {
    for &(year, names) in &[(2025, HOLIDAY_NAMES_2025), (2026, HOLIDAY_NAMES_2026)] {
        for &(name, (m, d)) in names.iter() {
            let start = md(year, m, d);
            if start >= today {
                return Some(NextHoliday { name: name.to_string(), date: start });
            }
        }
    }
    // 表外的年份：估算下一年的元旦
    let y = today.year() + 1;
    Some(NextHoliday { name: format!("{y}年元旦（估算）"), date: md(y, 1, 1) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn holidays_2025_not_workdays() {
        for &(m1, d1, m2, d2) in OFF_2025 {
            let mut cur = md(2025, m1, d1);
            let end = md(2025, m2, d2);
            while cur <= end {
                assert!(!is_workday(cur), "2025-{:02}-{:02} 应为假日", cur.month(), cur.day());
                cur += Duration::days(1);
            }
        }
    }

    #[test]
    fn makeup_days_2025_are_workdays() {
        for &(m, day) in MAKEUP_2025 {
            assert!(is_workday(md(2025, m, day)), "2025-{:02}-{:02} 调休应上班", m, day);
        }
        // 2026 同样
        for &(m, day) in MAKEUP_2026 {
            assert!(is_workday(md(2026, m, day)), "2026-{:02}-{:02} 调休应上班", m, day);
        }
    }

    #[test]
    fn holidays_2026_not_workdays() {
        for &(m1, d1, m2, d2) in OFF_2026 {
            let mut cur = md(2026, m1, d1);
            let end = md(2026, m2, d2);
            while cur <= end {
                assert!(!is_workday(cur), "2026-{:02}-{:02} 应为假日", cur.month(), cur.day());
                cur += Duration::days(1);
            }
        }
    }

    #[test]
    fn spot_checks() {
        // 官方通知核对：2025-10-09（调休后第一天上班）与 2025-10-11（周六调休上班）
        assert!(is_workday(d(2025, 10, 9)));
        assert!(is_workday(d(2025, 10, 11)));
        assert!(!is_workday(d(2025, 10, 12)));
        // 2026-01-04（周日调休上班）；2026-02-14（周六上班）、2026-02-28（周六上班）
        assert!(is_workday(d(2026, 1, 4)));
        assert!(is_workday(d(2026, 2, 14)));
        assert!(is_workday(d(2026, 2, 28)));
        assert!(!is_workday(d(2026, 1, 3)));
        // 普通周末
        assert!(!is_workday(d(2026, 3, 7))); // 周六
        assert!(is_workday(d(2026, 3, 9)));  // 周一
    }

    #[test]
    fn count_range() {
        // 单周：2026-03-02(周一)~03-08(周日) = 5 个工作日
        assert_eq!(count_workdays(d(2026, 3, 2), d(2026, 3, 8)).days, 5);
        // 同一天
        assert_eq!(count_workdays(d(2026, 3, 2), d(2026, 3, 2)).days, 1);
        // 逆序为 0
        assert_eq!(count_workdays(d(2026, 3, 8), d(2026, 3, 2)).days, 0);
        // 跨春节：2026-02-09(周一)~02-27(周五)：工作日 = 2/9~2/13(5) + 2/14(调休) + 2/24~2/27(4) = 10
        assert_eq!(count_workdays(d(2026, 2, 9), d(2026, 2, 27)).days, 10);
    }

    #[test]
    fn estimate_marked() {
        let c = count_workdays(d(2027, 3, 1), d(2027, 3, 5));
        assert!(c.estimated);
        assert!(c.days > 0 && c.days <= 5);
    }

    #[test]
    fn next_holiday_works() {
        let n = next_holiday(d(2026, 2, 10)).unwrap();
        assert_eq!(n.name, "春节");
        assert_eq!(n.date, d(2026, 2, 15));
        let n = next_holiday(d(2027, 6, 1)).unwrap();
        assert!(n.name.contains("估算"));
    }
}
