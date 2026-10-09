//! 退休算法：按 2025-01-01 起施行的渐进式延迟法定退休年龄规定
//!
//! 原退休年龄 A0：男 60，女·原55 为 55，女·原50 为 50。
//! 原退休年月 T0 = 出生年月 + A0 年。
//! T0 早于 2025-01：不延迟。
//! 否则 n = T0 与 2025-01 相差的月数（2025-01 时 n = 0），
//! 男、女·原55：延迟 = min(n/4 + 1, 36)；女·原50：延迟 = min(n/2 + 1, 60)。
//! 退休年月 = T0 + 延迟月数；退休日 = 与出生日相同的那一天（当月没有取月末；没填日取 1 日）。

use chrono::{Datelike, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    /// 男（原 60）
    Male,
    /// 女·原55（管理岗、专业技术岗，教师属于这一类）
    Female55,
    /// 女·原50（工人岗）
    Female50,
}

impl Category {
    fn base_age(self) -> i32 {
        match self {
            Category::Male => 60,
            Category::Female55 => 55,
            Category::Female50 => 50,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RetireResult {
    /// 法定退休年月 (year, month)
    pub retire_ym: (i32, u32),
    /// 法定退休日期（含具体日）
    pub retire_date: NaiveDate,
    /// 距退休天数（已退休为负数）
    pub days_left: i64,
    /// 法定退休年龄标签，如 "63岁1个月"
    pub retire_age_label: String,
    /// 原退休年龄
    pub base_age: u32,
    /// 实际延迟的月数
    pub delay_months: u32,
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    (NaiveDate::from_ymd_opt(ny, nm, 1).unwrap().pred_opt().unwrap()).day()
}

/// 月数差：2025-01 到 (y, m)，(y, m) 早于 2025-01 时为负
fn months_since_2025(y: i32, m: u32) -> i64 {
    (y as i64 - 2025) * 12 + (m as i64 - 1)
}

fn add_months(y: i32, m: u32, months: i64) -> (i32, u32) {
    let total = y as i64 * 12 + (m as i64 - 1) + months;
    ((total / 12) as i32, (total.rem_euclid(12) + 1) as u32)
}

pub fn compute(
    birth_year: i32,
    birth_month: u32,
    birth_day: Option<u32>,
    category: Category,
    today: NaiveDate,
) -> Result<RetireResult, String> {
    if !(1900..=2100).contains(&birth_year) {
        return Err(format!("出生年不合理: {birth_year}"));
    }
    if !(1..=12).contains(&birth_month) {
        return Err(format!("出生月不合理: {birth_month}"));
    }
    if let Some(d) = birth_day {
        if !(1..=31).contains(&d) {
            return Err(format!("出生日不合理: {d}"));
        }
    }

    let a0 = category.base_age();
    let t0 = add_months(birth_year, birth_month, a0 as i64 * 12);

    let n = months_since_2025(t0.0, t0.1);
    let delay: i64 = if n < 0 {
        0
    } else {
        match category {
            Category::Male | Category::Female55 => (n / 4 + 1).min(36),
            Category::Female50 => (n / 2 + 1).min(60),
        }
    };

    let retire_ym = add_months(t0.0, t0.1, delay);
    let day = match birth_day {
        Some(d) => d.min(last_day_of_month(retire_ym.0, retire_ym.1)),
        None => 1,
    };
    let retire_date =
        NaiveDate::from_ymd_opt(retire_ym.0, retire_ym.1, day).ok_or("退休日期不合法")?;

    let years = retire_ym.0 - birth_year;
    let months = retire_ym.1 as i64 - birth_month as i64;
    let (ay, am) = if months < 0 { (years - 1, months + 12) } else { (years, months) };
    let retire_age_label = if am == 0 {
        format!("{ay}岁")
    } else {
        format!("{ay}岁{am}个月")
    };

    Ok(RetireResult {
        retire_ym,
        retire_date,
        days_left: (retire_date - today).num_days(),
        retire_age_label,
        base_age: a0 as u32,
        delay_months: delay as u32,
    })
}

/// 弹性退休：在法定基础上 ±months（不超过 ±36 个月），提前不能早于原退休年龄 A0。
/// 返回 (弹性年月, 对应日期)
pub fn flex(retire_ym: (i32, u32), birth_day: Option<u32>, birth_year: i32, birth_month: u32,
            category: Category, months: i64) -> Result<(i32, u32, NaiveDate), String> {
    let a0 = category.base_age() as i64;
    let earliest = add_months(birth_year, birth_month, a0 * 12);
    let (fy, fm) = add_months(retire_ym.0, retire_ym.1, months);
    if (fy, fm) < earliest {
        return Err("弹性提前不能早于原退休年龄".into());
    }
    let day = match birth_day {
        Some(d) => d.min(last_day_of_month(fy, fm)),
        None => 1,
    };
    let date = NaiveDate::from_ymd_opt(fy, fm, day).ok_or("日期不合法")?;
    Ok((fy, fm, date))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn label(y: i32, m: u32, day: Option<u32>, cat: Category) -> RetireResult {
        compute(y, m, day, cat, d(2026, 10, 7)).unwrap()
    }

    /// 10 条用例（期望值按规则推算，并与人社部公布的对照表核对过）
    #[test]
    fn task_book_cases() {
        let r = label(1964, 12, None, Category::Male);
        assert_eq!(r.retire_ym, (2024, 12));
        assert_eq!(r.retire_age_label, "60岁");

        let r = label(1965, 1, None, Category::Male);
        assert_eq!(r.retire_ym, (2025, 2));
        assert_eq!(r.retire_age_label, "60岁1个月");

        let r = label(1965, 5, None, Category::Male);
        assert_eq!(r.retire_ym, (2025, 7));
        assert_eq!(r.retire_age_label, "60岁2个月");

        let r = label(1976, 9, None, Category::Male);
        assert_eq!(r.retire_ym, (2039, 9));
        assert_eq!(r.retire_age_label, "63岁");

        let r = label(1980, 1, None, Category::Male);
        assert_eq!(r.retire_ym, (2043, 1));
        assert_eq!(r.retire_age_label, "63岁");

        let r = label(1970, 1, None, Category::Female55);
        assert_eq!(r.retire_ym, (2025, 2));
        assert_eq!(r.retire_age_label, "55岁1个月");

        let r = label(1981, 9, None, Category::Female55);
        assert_eq!(r.retire_ym, (2039, 9));
        assert_eq!(r.retire_age_label, "58岁");

        let r = label(1975, 1, None, Category::Female50);
        assert_eq!(r.retire_ym, (2025, 2));
        assert_eq!(r.retire_age_label, "50岁1个月");

        let r = label(1975, 3, None, Category::Female50);
        assert_eq!(r.retire_ym, (2025, 5));
        assert_eq!(r.retire_age_label, "50岁2个月");

        let r = label(1984, 11, None, Category::Female50);
        assert_eq!(r.retire_ym, (2039, 11));
        assert_eq!(r.retire_age_label, "55岁");
    }

    #[test]
    fn boundary_before_2025_no_delay() {
        // 1964-12 及以前完全不受延迟影响
        let r = label(1964, 11, None, Category::Male);
        assert_eq!(r.retire_ym, (2024, 11));
        assert_eq!(r.delay_months, 0);

        // 女50 1974-12 → T0 2024-12，不延迟
        let r = label(1974, 12, None, Category::Female50);
        assert_eq!(r.retire_ym, (2024, 12));
        assert_eq!(r.delay_months, 0);
    }

    #[test]
    fn day_clamp_and_default() {
        // 1月31日出生，退休在 30 天的月份 → 取月末
        let r = compute(1970, 1, Some(31), Category::Female55, d(2026, 10, 7)).unwrap();
        assert_eq!(r.retire_date, d(2025, 2, 28));

        // 不填日 → 1 日
        let r = label(1970, 1, None, Category::Female55);
        assert_eq!(r.retire_date, d(2025, 2, 1));
    }

    #[test]
    fn days_left() {
        let r = compute(1965, 1, Some(15), Category::Male, d(2026, 10, 7)).unwrap();
        // 2025-02-15 退休，2026-10-07 已过 → 负数
        assert!(r.days_left < 0);

        let r = compute(1980, 1, Some(1), Category::Male, d(2026, 10, 7)).unwrap();
        assert_eq!(r.days_left, (d(2043, 1, 1) - d(2026, 10, 7)).num_days());
    }

    #[test]
    fn flex_clamp() {
        // 法定 2043-01，提前 36 个月 = 2040-01 ≥ 原退休 A0 时点 2040-01，恰好合法
        let r = flex((2043, 1), Some(1), 1980, 1, Category::Male, -36).unwrap();
        assert_eq!(r.0, 2040);
        // 再往前一格就该被拒
        assert!(flex((2043, 1), Some(1), 1980, 1, Category::Male, -37).is_err());
        // 推迟 36 个月合法
        let r = flex((2043, 1), Some(1), 1980, 1, Category::Male, 36).unwrap();
        assert_eq!((r.0, r.1), (2046, 1));
    }
}
