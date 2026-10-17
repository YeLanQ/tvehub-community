# 逻辑运行器（状态机 / 行为树）

逻辑资产（`.fsm` 状态机 / `.bt` 行为树）在编辑器「逻辑」分组的运行器节点上绑定；脚本侧统一经 `engine.logic`（按实体寻址）读取运行态与施加控制。本页全部代码块随文档测试套件逐块验证（`pnpm docs:test`）。

两类运行器节点：

| 节点类型 | 绑定资产 | 脚本句柄 |
| --- | --- | --- |
| `fsmRunnerNode`（状态机运行器） | `.fsm` | `FsmRunnerNode`（Entity 子类） |
| `btRunnerNode`（行为树运行器） | `.bt` | `BtRunnerNode`（Entity 子类） |

运行态（当前状态/黑板/运行记忆）不序列化——每次预览/加载从资产定义重新开始。

## 状态机

状态机 = 状态 + 过渡（事件触发 / 条件满足）。脚本侧三类入口：**发射事件**（事件过渡的触发器）、**写运行参数**（条件过渡的黑板）、**订阅状态变化**。

```ts tve
import { Component, property, FsmRunnerNode, engine, LogicStateInfo } from "tve";

export default class GuardBrain extends Component {
  @property({ type: FsmRunnerNode, label: "守卫状态机" })
  brain: FsmRunnerNode | null = null;

  private offEnter?: () => void;

  onStart() {
    if (!this.brain) return;
    // 订阅状态进入（match = 状态 id 或显示名；空串 = 任意状态）
    // 返回解绑函数；回调里可安全操作实体（engine.animation.play 等）
    this.offEnter = engine.logic.onFsmEnter(this.brain, "Chase", (s: LogicStateInfo) => {
      engine.log("进入追击", s.name, "已停留", s.time, "秒");
    });
  }

  onUpdate() {
    if (!this.brain) return;
    // 当前状态快照（未绑定/未启动为 null）
    const st = engine.logic.fsmState(this.brain); // {id, name, time}
    // 写黑板：条件过渡的输入（布尔按 0/1 参与比较）
    engine.logic.setFsmParam(this.brain, "distance", 4.5);
    void engine.logic.getFsmParam(this.brain, "distance");
    // 玩家进入视野 → 发射事件（进入当前状态以来的首次发射有效）
    if (this.canSeePlayer()) engine.logic.fire(this.brain, "onSeen");
    // 追击超时 → 强制切状态（不经触发器；stateId 或状态名）
    if (st && st.time > 10) engine.logic.forceFsmState(this.brain, "Patrol");
  }

  canSeePlayer() { return Math.random() < 0.01; }

  onDisable() {
    this.offEnter?.(); // 解绑防悬挂
  }
}
```

订阅族速查：

| 订阅 | 时机 | 参数 |
| --- | --- | --- |
| `onFsmEnter(entity, match, cb)` | 进入状态（含初始进入） | `LogicStateInfo` |
| `onFsmExit(entity, match, cb)` | 退出状态 | `LogicStateInfo` |
| `onFsmTransition(entity, cb)` | 任意过渡 | `(from, to)` 两个 `LogicStateInfo` |

均返回解绑函数；`match` 空串匹配任意状态。

## 行为树

行为树每帧求值（tick）；叶子分**条件**（读黑板）与**动作**（脚本注册处理器执行）。动作处理器返回三值状态：

| 状态 | 语义 |
| --- | --- |
| `"success"` | 完成（缺省返回值视为成功） |
| `"failure"` | 失败 |
| `"running"` | 进行中——下一帧**再次调用同一叶子**（续行） |

```ts tve
import { Component, property, BtRunnerNode, engine } from "tve";

export default class HunterBrain extends Component {
  @property({ type: BtRunnerNode, label: "猎人行为树" })
  brain: BtRunnerNode | null = null;

  private lastSeq = -1;
  private step = 0;

  onStart() {
    if (!this.brain) return;
    // 写黑板（条件叶子的求值对象）
    engine.logic.setBtParam(this.brain, "hunger", 80);
    // 注册动作叶处理器（按动作名；未注册的动作按成功处理）
    engine.logic.onAction(this.brain, "walkTo", (leaf, session) => {
      // seq = 求值代际：动作全新开始（首次/完成后重入/被中断重入）自增；
      // running 续行不变——有状态的动作据此复位内部计数
      if (session.seq !== this.lastSeq) {
        this.lastSeq = session.seq;
        this.step = 0;
      }
      return ++this.step >= 10 ? "success" : "running";
    });
  }

  onUpdate() {
    if (!this.brain) return;
    // 整树最近一次 tick 结果（未就绪 null）
    const status = engine.logic.btStatus(this.brain);
    void engine.logic.getBtParam(this.brain, "hunger");
    // 树整体失败 → 重启（黑板回默认）
    if (status === "failure") engine.logic.restart(this.brain);
  }
}
```

`onAction` 处理器入参：`leaf`（`{id, action}`——同动作名多处使用时用 `leaf.id` 区分实例）与 `session`（`{seq}` 代际号）。返回 `void` 等价 `"success"`。

## 通用控制

```ts tve
import { Component, property, FsmRunnerNode, engine } from "tve";

export default class LogicSwitch extends Component {
  @property({ type: FsmRunnerNode, label: "状态机" })
  fsm: FsmRunnerNode | null = null;

  pause(on: boolean) {
    if (!this.fsm) return;
    // 暂停/恢复（恢复时未启动则从入口开始）
    engine.logic.setRunning(this.fsm, !on);
  }

  reset() {
    if (!this.fsm) return;
    // 重启：状态回入口 / 黑板回默认 / 清运行记忆
    engine.logic.restart(this.fsm);
  }
}
```

## 无宿主空转（doctest 实测）

未绑定资产或未注入宿主时全部读取安全降级、不抛错：

```ts tve
import { engine, Entity } from "tve";

const anyEntity = {} as Entity;
engine.logic.fsmState(anyEntity);   // => null
engine.logic.btStatus(anyEntity);   // => null
engine.logic.getFsmParam(anyEntity, "x"); // => undefined
engine.logic.getBtParam(anyEntity, "x");  // => undefined
```

## 与其他系统的联动

- **状态进入驱动动画**：`onFsmEnter` 回调里 `engine.animation.play(entity, "run")`（回调里操作实体安全）；
- **场景图模式**：脚本组件的 `onGraphInput` / `this.graphInput` 接收原型卡「接入」口的实体集与数据——AI 目标选择可由图计算后推给脚本（见 [SDK 总览](overview.md)）；
- **黑板与数据中心**：短期决策量放黑板（随 restart 重置），跨系统持久量放 `dataCenter`（见[通用设施](utils.md)）。
