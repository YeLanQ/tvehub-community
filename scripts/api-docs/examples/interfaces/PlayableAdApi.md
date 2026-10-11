```ts tve
import { engine } from "tve";

// 试玩广告宿主契约（playable 渠道产物激活；其他产物/预览安全空转）
engine.playableAd.host; // => "web"（非广告环境：编辑器预览 / 本机自测导出）
engine.playableAd.isViewable(); // => true

// 结束卡（EndCard）「下载」按钮的点击处理里调用：
// 运行时自动映射所在平台宿主（mraid.open / FbPlayableAd / ExitApi.exit /
// window.install），商店跳转由广告宿主接管；无宿主环境空转并在控制台提示，
// 不抛错
engine.playableAd.cta();

// 订阅广告位可见性变化（mraid 广告位滚出屏幕等；返回解绑函数）
const unbind = engine.playableAd.onViewableChange((viewable) => {
  if (!viewable) engine.tween.pauseAll();
  else engine.tween.resumeAll();
});
unbind();

// 生命周期打点上报（转发平台宿主通道 + 控制台留痕）：
// gameStart 由运行时在宿主落定后自动上报一次；结束/重玩按时机手动调，
// 自定义事件名与附加数据也接受（无宿主环境仅在控制台留痕）
engine.playableAd.report("gameOver", { score: 100 });
engine.playableAd.report("level_complete", { level: 3 });
```
