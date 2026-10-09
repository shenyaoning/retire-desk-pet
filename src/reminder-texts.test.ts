import { describe, expect, it } from "vitest";
import { REMINDER_TEXTS } from "./reminder-texts";

describe("health reminder copy", () => {
  it("keeps the approved 16 lines in image order", () => {
    expect(REMINDER_TEXTS).toEqual([
      "坐太久啦，起来走两分钟",
      "双手举高，伸个大大的懒腰",
      "慢慢转脖子，左右各 5 次",
      "双手叉腰，左右各扭 10 下",
      "放松肩膀，甩甩手臂 20 下",
      "原地踏步 1 分钟，活动活动腿",
      "慢慢做 10 个深蹲，量力而行",
      "站起来靠一靠，放松一下腰背",
      "轻轻拉伸大腿，每侧 20 秒",
      "闭上眼睛，轻揉眼眶一圈",
      "看看远处，让眼睛休息 20 秒",
      "深吸一口气，慢慢呼出来，做 5 次",
      "喝几口水吧",
      "去爬两层楼梯吧",
      "饭后慢慢走一走，10 分钟就好",
      "收拾收拾，该回家啦",
    ]);
  });

  it("contains no medical claims", () => {
    expect(REMINDER_TEXTS.join(" ")).not.toMatch(/治疗|预防疾病|医生/);
  });
});
