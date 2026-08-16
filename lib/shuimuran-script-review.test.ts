import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShuimuranReviewPrompt,
  findShuimuranDeterministicReviewIssues,
  parseShuimuranReview,
} from "./shuimuran-script-review";

const BREAK_SIX_FAILURE_SAMPLE = `大家有没有发现一个很有意思的现象：我们身边很多人，越努力越焦虑，越学习越迷茫。为什么？因为他们一直在“着相”。今天我要告诉你，一个人真正觉醒之前，必须破掉这六种相。这六种相不破，你读再多书、上再多课，都只是在原地打转。

第一种相，叫我相。什么是“我相”？就是太把自己当回事。你总觉得“我”的观点最重要，“我”的感受最真实，“我”的委屈必须被看见。但你有没有想过，这个“我”其实是被环境、被算法、被别人的眼光塑造出来的？你以为你在独立思考，其实你只是在重复别人灌输给你的东西。破掉我相，不是否定自己，而是看清“我”的局限。

第二种相，叫人相。人相就是总拿自己和别人比。别人升职了，你焦虑；别人孩子考了名校，你焦虑；别人买了大房子，你更焦虑。但你有没有发现，这种比较永远没有尽头？你比赢了，还有比你更厉害的；你比输了，就陷入自我怀疑。人相不破，你永远活在别人的评价体系里。破掉人相，就是不再用别人的尺子量自己。

第三种相，叫众生相。什么是众生相？就是你必须合群，必须跟别人一样。大家都考研，你也考研；大家都考公，你也考公；大家都买学区房，你也买。你怕被落下，怕成为异类。但你想过没有，当所有人都挤在同一条路上，那条路还能通向自由吗？破掉众生相，就是敢于做那个少数人，敢于走那条少有人走的路。

第四种相，叫寿者相。寿者相就是你对时间的执念。你总想着“我都这个年纪了，来不及了”“现在开始太晚了”。但你看，姜子牙八十岁才出山，褚时健七十四岁才开始种橙子。时间不是限制，而是礼物。破掉寿者相，就是不再被年龄绑架，任何时候都可以重新开始。

第五种相，叫法相。法相就是你对方法的执念。你总想找一套万能公式，一个速成技巧，一条捷径。但真正的成长，从来不是靠方法，而是靠心法。方法只是术，心法才是道。你学了那么多技巧，为什么还是过不好这一生？因为你的心没变。破掉法相，就是不再迷信方法，而是回归本质。

第六种相，叫非法相。这是最隐蔽的一种相。你以为前面五种相都破了，就觉悟了？不，你可能会陷入另一种执念——执着于“空”。你觉得什么都不重要，什么都不在乎，看破红尘了。但这不是觉醒，这是逃避。真正的觉醒，是看破之后依然热爱生活，是知道一切皆空，却依然认真过好每一天。破掉非法相，就是既不执着于有，也不执着于无。

这六种相，你破了几个？其实，破相不是目的，觉醒才是。当你破掉这些相，你会发现，你不再被外界定义，不再被算法支配，你真正拿回了人生的主动权。这条路不容易，但这是我们唯一的出路。希望你能成为那1%的人。`;

test("破六相失败样本会被程序同时抓住禁用开头、机械清单和通用结尾", () => {
  const issues = findShuimuranDeterministicReviewIssues({
    title: "一个人真正觉醒之前，必须破掉这六种相",
    fullScript: BREAK_SIX_FAILURE_SAMPLE,
  });

  assert.equal(issues.length, 3);
  assert.match(issues.join("\n"), /禁用开头/);
  assert.match(issues.join("\n"), /机械清单/);
  assert.match(issues.join("\n"), /通用结尾/);
});

test("短距离内三类连续枚举都会被判定为机械清单", () => {
  const samples = [
    "第一，先复盘选择。第二，再复盘能力。第三，最后复盘运气。",
    "一是复盘选择，二是复盘能力，三是复盘运气。",
    "首先复盘选择，其次复盘能力，最后复盘运气。",
  ];

  for (const fullScript of samples) {
    const issues = findShuimuranDeterministicReviewIssues({
      title: "创业失败后真正要看清的事",
      fullScript,
    });
    assert.match(issues.join("\n"), /机械清单/);
  }
});

test("句号、分号和具体名词连接的连续序数枚举都会被判定为机械清单", () => {
  const samples = [
    "第一。第二。第三。",
    "第一；第二；第三",
    "第一件事、第二件事、第三件事",
  ];

  for (const fullScript of samples) {
    const issues = findShuimuranDeterministicReviewIssues({
      title: "创业失败后真正要看清的事",
      fullScript,
    });
    assert.match(issues.join("\n"), /机械清单/);
  }
});

test("序数词分散在文章不同位置时不误判为机械清单", () => {
  const issues = findShuimuranDeterministicReviewIssues({
    title: "创业失败后真正要看清的事",
    fullScript: `第一，创业初期最先暴露的是现金流问题。

但现金流只是结果，真正要追问的是当初为什么做出那个选择。

很多人失败后急着找方法，却没有回到决策发生的现场。

只有看清当时掌握的信息，复盘才不是事后聪明。

第二，三年后的环境已经改变，同一个选择不能脱离时间评价。

这也是为什么别人的成功经验不能直接搬过来。

判断一次创业，既要看个人能力，也要看当时的行业周期。

如果忽略环境，所有结论都会变成对结果的倒推。

第三，真正有价值的复盘，是知道下一次遇到相似局面时该怎样判断。`,
  });

  assert.doesNotMatch(issues.join("\n"), /机械清单/);
});

test("单换行分段且序数词相隔较远时不误判为机械清单", () => {
  const issues = findShuimuranDeterministicReviewIssues({
    title: "创业失败后真正要看清的事",
    fullScript: `第一，创业初期最先暴露的是现金流问题。
但现金流只是结果，真正要追问的是当初为什么做出那个选择。
很多人失败后急着找方法，却没有回到决策发生的现场。
只有看清当时掌握的信息，复盘才不是事后聪明。
第二，三年后的环境已经改变，同一个选择不能脱离时间评价。
这也是为什么别人的成功经验不能直接搬过来。
判断一次创业，既要看个人能力，也要看当时的行业周期。
如果忽略环境，所有结论都会变成对结果的倒推。
第三，真正有价值的复盘，是知道下一次遇到相似局面时该怎样判断。`,
  });

  assert.doesNotMatch(issues.join("\n"), /机械清单/);
});

test("水木然生成后内容质量检查必须十二项全部通过", () => {
  const result = parseShuimuranReview(JSON.stringify({
    checks: {
      titleKeepsAnswer: true,
      openingBuildsSuspense: true,
      concreteEntry: true,
      classicExplainsReality: true,
      risesToPattern: true,
      conciseWithoutRepetition: true,
      staleHotspotReframed: true,
      titleOpeningEndingClosed: true,
      soundsLikeTeacher: true,
      singleCoreIdea: true,
      reasoningSupported: true,
      endingClosesSpecificLoop: true,
    },
    issues: [],
  }));

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("水木然生成后内容质量检查任一项失败时返回具体重写原因", () => {
  const result = parseShuimuranReview(JSON.stringify({
    checks: {
      titleKeepsAnswer: false,
      openingBuildsSuspense: true,
      concreteEntry: true,
      classicExplainsReality: true,
      risesToPattern: true,
      conciseWithoutRepetition: false,
      staleHotspotReframed: true,
      titleOpeningEndingClosed: true,
      soundsLikeTeacher: true,
      singleCoreIdea: true,
      reasoningSupported: false,
      endingClosesSpecificLoop: true,
    },
    issues: ["标题直接公布了答案", "正文存在重复解释", "判断句缺少事实、案例或因果桥梁"],
  }));

  assert.equal(result.passed, false);
  assert.deepEqual(result.issues, ["标题直接公布了答案", "正文存在重复解释", "判断句缺少事实、案例或因果桥梁"]);
});

test("水木然生成后检查提示词包含单一思想、推理支撑和具体闭环三项独立判断", () => {
  const prompt = buildShuimuranReviewPrompt({
    title: "胖东来的真正秘密，藏在《道德经》里",
    fullScript: "完整口播正文",
    pendingVerification: [],
    reviewedAt: "2026-08-14T12:00:00.000Z",
    sourceReferences: [
      {
        sourceTitle: "老师课程原文",
        kind: "claim",
        originalExcerpt: "真正重要的不是规模，而是人与人之间的信任。",
        extractionStatus: "人工确认",
      },
    ],
    caseEvidence: {
      title: "胖东来案例",
      content: "案例内容",
      verificationStatus: "人工已核实",
      sourceUrl: "https://example.com/source",
    },
  });

  assert.match(prompt, /观点是否属于水木然本人由生成后的独立归属审计判断/);
  assert.match(prompt, /事实核验由生成后的独立审计判断/);
  assert.doesNotMatch(prompt, /正文中的人物、时间、数据、热点和古籍原文/);
  assert.match(prompt, /开头是否在15秒内形成悬念/);
  assert.match(prompt, /过期热点是否已经转为长期认知内容/);
  assert.match(prompt, /是否只围绕一个核心思想展开/);
  assert.match(prompt, /缺少事实案例或因果桥梁的具体句子/);
  assert.match(prompt, /结尾是否回答标题悬念/);
  assert.match(prompt, /老师课程原文/);
  assert.match(prompt, /真正重要的不是规模/);
  assert.match(prompt, /核实状态：人工已核实/);
  assert.match(prompt, /审查时间：2026-08-14T12:00:00.000Z/);
  assert.match(prompt, /没有明确发生时间时，不得把案例判断为24小时内热点/);
  assert.match(prompt, /不要改写文案/);
});

test("水木然终审不能同时声称十二项全过又返回问题", () => {
  assert.throws(() => parseShuimuranReview(JSON.stringify({
    checks: {
      titleKeepsAnswer: true,
      openingBuildsSuspense: true,
      concreteEntry: true,
      classicExplainsReality: true,
      risesToPattern: true,
      conciseWithoutRepetition: true,
      staleHotspotReframed: true,
      titleOpeningEndingClosed: true,
      soundsLikeTeacher: true,
      singleCoreIdea: true,
      reasoningSupported: true,
      endingClosesSpecificLoop: true,
    },
    issues: ["仍有一处没有解决"],
  })), /自相矛盾/);
});
