// ---------------------------------------------------------------------------
// RHI three 后端 · WebGPU 设备：three/webgpu 的 WebGPURenderer 适配。
// 动态加载（构建体积大，仅选中 WebGPU 时进入页面）；init 失败抛错由
// registry 兜底回退 WebGL。渲染目标与 WebGL 设备共用（three core 互用）。
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { ThreeRenderTarget } from "./renderTarget";
import { toTopLeftRect } from "./viewportOrigin";
import { RHIDeviceCreationError } from "../../types";
import type {
  RHIDevice,
  RHIDeviceOptions,
  RHIDisplayConfig,
  RHIRect,
  RHIRenderStats,
  RHIRenderTarget,
  RHIRenderTargetDesc,
} from "../../types";

/** WebGPURenderer 的结构化最小面（three/webgpu 无公开类型，按使用面声明） */
interface WebGPURendererLike {
  readonly domElement: HTMLCanvasElement;
  toneMapping: number;
  autoClearColor: boolean;
  autoClearDepth: boolean;
  shadowMap: {
    enabled: boolean;
    type: number;
    autoUpdate?: boolean;
    needsUpdate?: boolean;
  };
  info?: {
    render?: { calls?: number; triangles?: number; lines?: number; points?: number };
    memory?: { geometries?: number; textures?: number };
    programs?: unknown[];
  };
  init(): Promise<void>;
  setPixelRatio(value?: number): void;
  getPixelRatio(): number;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  /** 画布逻辑尺寸（CSS 像素；视口原点换算用，与像素比无关） */
  getSize(target: THREE.Vector2): THREE.Vector2;
  /** 后端实例（含 GPUDevice；启动分段计时在设备就绪后包装其创建方法） */
  readonly backend?: { device?: GPUDeviceLike; isWebGPUBackend?: boolean };
  render(scene: object, camera: object): void;
  compileAsync(scene: object, camera: object): Promise<unknown>;
  setRenderTarget(target: unknown): void;
  setViewport(x: number, y: number, w: number, h: number): void;
  setScissor(x: number, y: number, w: number, h: number): void;
  setScissorTest(test: boolean): void;
  dispose(): void;
}

/** WebGPU 设备初试化上限：适配器请求/设备创建偶发挂起时不能让整页停在启动期 */
const GPU_INIT_TIMEOUT_MS = 6000;

/** 软件适配器特征（SwiftShader/llvmpipe/WARP 等）：此类 WebGPU 的着色器编译
 *  可达数十秒，启动远慢于经典 WebGL——直接判定不可用走 WebGL 兜底 */
const SOFTWARE_ADAPTER_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|warp/i;

interface GPUAdapterLike {
  readonly isFallbackAdapter?: boolean;
  readonly info?: {
    readonly vendor?: string;
    readonly architecture?: string;
    readonly device?: string;
    readonly description?: string;
  };
}

/**
 * WebGPU 启动分段计时（诊断面）：适配器协商 / 设备初始化 / 着色器模块 / 管线。
 * 时间戳为 performance.now() 绝对值（同一页面时钟），消费方按自己的 t0 求差。
 * 挂在 globalThis.__tveGpuTiming 上，player 首帧汇总时读取（编辑器同源可查）。
 */
export interface WebGPUTiming {
  /** requestAdapter 用时（我们的预检，不含 three 内部的二次请求） */
  adapterMs: number;
  /** renderer.init() 用时（three 内部 requestAdapter + requestDevice + 后端初始化） */
  initMs: number;
  /** createShaderModule：次数 / 累计同步耗时 / 着色器源码字节 / 最后一次完成时刻 */
  shaderModules: { count: number; totalMs: number; bytes: number; lastAt: number | null };
  /** createRenderPipeline[Async]：次数 / 累计耗时 / 其中异步管线数 / 最后一次就绪时刻 */
  renderPipelines: {
    count: number;
    totalMs: number;
    asyncCount: number;
    lastAt: number | null;
  };
  /** createComputePipeline[Async]：同上 */
  computePipelines: {
    count: number;
    totalMs: number;
    asyncCount: number;
    lastAt: number | null;
  };
  /** 诊断：计时是否成功挂到 GPUDevice（false = 拿不到 device，模块/管线计数为 0） */
  countersInstalled?: boolean;
}

interface GPUDeviceLike {
  createShaderModule?: (desc: { code?: string }) => unknown;
  createRenderPipeline?: (...args: unknown[]) => unknown;
  createRenderPipelineAsync?: (...args: unknown[]) => Promise<unknown>;
  createComputePipeline?: (...args: unknown[]) => unknown;
  createComputePipelineAsync?: (...args: unknown[]) => Promise<unknown>;
}

/** 给 GPUDevice 的模块/管线创建方法装计时（实例级包装；计数与累计耗时） */
function installGpuCounters(device: GPUDeviceLike | null | undefined, timing: WebGPUTiming): void {
  timing.countersInstalled = false;
  if (!device) return;
  const now = () => performance.now();
  if (typeof device.createShaderModule === "function") {
    const orig = device.createShaderModule.bind(device);
    device.createShaderModule = (desc: { code?: string }) => {
      const t = now();
      const mod = orig(desc);
      timing.shaderModules.count++;
      timing.shaderModules.totalMs += now() - t;
      if (typeof desc?.code === "string") timing.shaderModules.bytes += desc.code.length;
      timing.shaderModules.lastAt = now();
      return mod;
    };
  }
  const wrapPipeline = (
    name: "createRenderPipeline" | "createComputePipeline",
    asyncName: "createRenderPipelineAsync" | "createComputePipelineAsync",
    bucket: WebGPUTiming["renderPipelines"],
  ) => {
    const sync = device[name]?.bind(device);
    if (sync) {
      device[name] = (...args: unknown[]) => {
        const t = now();
        const out = sync(...args);
        bucket.count++;
        bucket.totalMs += now() - t;
        bucket.lastAt = now();
        return out;
      };
    }
    const asyncFn = device[asyncName]?.bind(device);
    if (asyncFn) {
      device[asyncName] = (...args: unknown[]) => {
        const t = now();
        return asyncFn(...args).then((out: unknown) => {
          bucket.count++;
          bucket.asyncCount++;
          bucket.totalMs += now() - t;
          bucket.lastAt = now();
          return out;
        });
      };
    }
  };
  wrapPipeline("createRenderPipeline", "createRenderPipelineAsync", timing.renderPipelines);
  wrapPipeline("createComputePipeline", "createComputePipelineAsync", timing.computePipelines);
  timing.countersInstalled = true;
}

/**
 * 探测适配器可用性（不取设备）：返回 null = 无 WebGPU/无适配器。
 * 软件适配器抛不可重试错误——重试只会把启动时间越拖越长。
 * 导出供单测覆盖（jsdom 里桩 navigator.gpu）。
 */
export async function assertHardwareAdapter(): Promise<void> {
  const gpu = (
    navigator as unknown as {
      gpu?: { requestAdapter?: (opts?: unknown) => Promise<GPUAdapterLike | null> };
    }
  ).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    throw new RHIDeviceCreationError("当前环境不提供 WebGPU（navigator.gpu 缺失）", false);
  }
  let adapter: GPUAdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter({ featureLevel: "compatibility" });
  } catch (e) {
    throw new RHIDeviceCreationError(
      `WebGPU 适配器请求失败: ${e instanceof Error ? e.message : String(e)}`,
      false,
    );
  }
  if (!adapter) {
    throw new RHIDeviceCreationError("WebGPU 适配器不可用（requestAdapter 返回 null）", false);
  }
  const info = adapter.info ?? {};
  const desc = [info.vendor, info.architecture, info.device, info.description]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
  if (adapter.isFallbackAdapter === true || SOFTWARE_ADAPTER_RE.test(desc)) {
    throw new RHIDeviceCreationError(
      `WebGPU 仅有软件适配器（${desc || "fallback"}），已回退 WebGL 以避免启动卡顿`,
      false,
    );
  }
}

/** 创建 WebGPU 设备（three/webgpu 的 WebGPURenderer；失败抛错→registry 回退） */
export async function createThreeWebGPUDevice(options: RHIDeviceOptions): Promise<RHIDevice> {
  // —— 启动分段计时（设备协商 / 模块 / 管线；首帧提交与可见由 player 记录）——
  const adapterStart = performance.now();
  await assertHardwareAdapter();
  const adapterMs = performance.now() - adapterStart;
  const mod = (await import("three/webgpu")) as unknown as {
    WebGPURenderer?: unknown;
    default?: unknown;
  };
  const Ctor = mod.WebGPURenderer ?? mod.default;
  if (typeof Ctor !== "function") throw new Error("WebGPURenderer not exported");
  // powerPreference 仅在 macOS/Linux 被采纳；Windows 上 requestAdapter 忽略
  // （Chromium crbug.com/369219127），仍传递以求在支持的平台生效
  // GPUPowerPreference 只接受 "low-power" | "high-performance"；"default" 不是合法
  // 枚举——Chromium 会直接抛 TypeError，three 捕获后**静默回退 WebGL2 兼容层**
  // （启动慢数倍且丢 WebGPU 特性）。未指定 = 浏览器默认策略，故这里必须归一化。
  const gpuPower =
    options.powerPreference === "low-power" || options.powerPreference === "high-performance"
      ? options.powerPreference
      : undefined;
  const renderer = new (Ctor as new (params?: {
    forceWebGL?: boolean;
    antialias?: boolean;
    samples?: number;
    powerPreference?: string;
  }) => WebGPURendererLike)({
    forceWebGL: false,
    antialias: options.antialias === true,
    samples: options.antialias === true ? (options.msaaSamples ?? 0) : 0,
    powerPreference: gpuPower,
  });
  // WebGPU 后端为异步初始化：必须先 await init() 再 render()（WebGL 无此要求）。
  // 适配器/设备请求挂起时按超时判失败（不可重试）→ registry 立刻回退 WebGL，
  // 否则页面会一直停在启动态直到入口页看门狗报「启动超时」。
  const initStart = performance.now();
  let initTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      renderer.init(),
      new Promise<never>((_resolve, reject) => {
        initTimer = setTimeout(
          () =>
            reject(
              new RHIDeviceCreationError(
                `WebGPU 初始化超时（${GPU_INIT_TIMEOUT_MS}ms）`,
                false,
              ),
            ),
          GPU_INIT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(initTimer);
  }
  // three 在 WebGPU 后端失败时会**静默回退到自己的 WebGL2 兼容层**（isWebGLBackend）。
  // 该兼容层启动慢数倍且缺少部分 WebGPU 能力，却让 RHI 继续报告 "webgpu"——
  // 检测到就判不可重试失败，由 registry 回退到经典 WebGLRenderer（快得多的兜底）。
  const backendImpl = renderer.backend as
    | { isWebGLBackend?: boolean; device?: GPUDeviceLike }
    | undefined;
  if (backendImpl?.isWebGLBackend === true) {
    try {
      renderer.dispose();
    } catch {
      /* 释放失败不影响回退 */
    }
    throw new RHIDeviceCreationError(
      "three WebGPU 后端初始化失败（已回退其 WebGL2 兼容层），改用经典 WebGL",
      false,
    );
  }
  // —— 设备丢失 / GPU 错误诊断面 ——
  // three 在 WebGPUBackend 里挂了 device.lost.then() 与 onuncapturederror，默认只
  // 打控制台并置 _isDeviceLost（渲染变空操作 = 视口停在最后/清屏帧，用户看到
  // 白/黑屏且无任何提示）。这里包一层：先保留 three 的默认处理，再把事件接给
  // 上层（RendererManager 据此停循环 + 重建设备）。
  const hooks = renderer as unknown as {
    onDeviceLost?: (info: { message?: string; reason?: string | null }) => void;
    onError?: (info: { type?: string; message?: string }) => void;
  };
  const prevLost = hooks.onDeviceLost;
  hooks.onDeviceLost = (info) => {
    try {
      prevLost?.call(renderer, info);
    } catch {
      /* three 默认处理失败不影响上报 */
    }
    options.onDeviceLost?.({
      backend: "webgpu",
      message: info?.message || "WebGPU 设备已丢失",
      reason: info?.reason ?? null,
    });
  };
  const prevError = hooks.onError;
  hooks.onError = (info) => {
    try {
      prevError?.call(renderer, info);
    } catch {
      /* 同上 */
    }
    options.onGpuError?.({
      backend: "webgpu",
      type: info?.type || "GPUError",
      message: info?.message || "未知 GPU 错误",
    });
  };

  // 启动分段计时：release 构建（traceStartup=false）不创建计时对象、不包装 GPU
  // 创建方法、不挂全局——零采集零输出（预热/首帧热路径无额外开销）
  if (options.traceStartup !== false) {    const timing: WebGPUTiming = {
      adapterMs,
      initMs: performance.now() - initStart,
      shaderModules: { count: 0, totalMs: 0, bytes: 0, lastAt: null },
      renderPipelines: { count: 0, totalMs: 0, asyncCount: 0, lastAt: null },
      computePipelines: { count: 0, totalMs: 0, asyncCount: 0, lastAt: null },
    };
    (globalThis as unknown as { __tveGpuTiming?: WebGPUTiming }).__tveGpuTiming = timing;
    // 设备就绪后再装计时：模块/管线创建主要发生在预热与首帧，init 内部的一次性
    // 创建不计入（量级可忽略）
    installGpuCounters(backendImpl?.device, timing);
  }
  let pixelRatio = renderer.getPixelRatio();
  /** 视口原点换算的复用缓冲（画中画回贴每帧调用，避免每次分配） */
  const canvasSize = new THREE.Vector2();

  const device: RHIDevice = {
    kind: "webgpu",
    // three/webgpu 的离屏纹理按上左角采样（其内置 QuadMesh 的 UV 即为 v=0 在顶），
    // 标准 PlaneGeometry 的 UV 会上下镜像（WebGPU 与内部 WebGL2 回退同源）
    rtTextureFlipY: true,
    domElement: renderer.domElement,
    native: renderer,
    configureDisplay(config: RHIDisplayConfig): void {
      if (config.pixelRatio !== undefined) {
        pixelRatio = config.pixelRatio;
        renderer.setPixelRatio(pixelRatio);
      }
      if (config.toneMapping !== undefined) {
        renderer.toneMapping =
          config.toneMapping === "aces-filmic" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      }
      if (config.shadowMapEnabled !== undefined) renderer.shadowMap.enabled = config.shadowMapEnabled;
      if (config.shadowFilter !== undefined) renderer.shadowMap.type = THREE.PCFShadowMap;
    },
    setPixelRatio(value: number): void {
      pixelRatio = value;
      renderer.setPixelRatio(value);
    },
    getPixelRatio(): number {
      return pixelRatio;
    },
    setSize(width: number, height: number, updateStyle?: boolean): void {
      renderer.setSize(width, height, updateStyle);
    },
    render(scene: object, camera: object): void {
      renderer.render(scene, camera);
    },
    warmupShaders(scene: object, camera: object): Promise<unknown> {
      return renderer.compileAsync(scene, camera);
    },
    setAutoClear(color: boolean, depth: boolean): void {
      renderer.autoClearColor = color;
      renderer.autoClearDepth = depth;
    },
    setShadowMapEnabled(enabled: boolean): void {
      renderer.shadowMap.enabled = enabled;
    },
    setShadowMapOnDemand(needsUpdate: boolean): void {
      // three/webgpu 的阴影刷新表无 autoUpdate 细粒度开关时按需重画标记
      if (renderer.shadowMap.autoUpdate !== undefined) renderer.shadowMap.autoUpdate = false;
      if (renderer.shadowMap.needsUpdate !== undefined) renderer.shadowMap.needsUpdate = needsUpdate;
    },
    createRenderTarget(desc: RHIRenderTargetDesc): RHIRenderTarget {
      const rt = new THREE.RenderTarget(desc.width, desc.height, {
        type: desc.format === "half-float" ? THREE.HalfFloatType : THREE.UnsignedByteType,
        samples: desc.samples ?? 0,
        depthBuffer: desc.depthBuffer !== false,
      });
      return new ThreeRenderTarget(rt);
    },
    setRenderTarget(target: RHIRenderTarget | null): void {
      renderer.setRenderTarget(target ? target.handle : null);
    },
    setViewport(rect: RHIRect): void {
      const r = toTopLeftRect(rect, renderer.getSize(canvasSize).y);
      renderer.setViewport(r.x, r.y, r.width, r.height);
    },
    setScissor(rect: RHIRect): void {
      const r = toTopLeftRect(rect, renderer.getSize(canvasSize).y);
      renderer.setScissor(r.x, r.y, r.width, r.height);
    },
    setScissorTest(test: boolean): void {
      renderer.setScissorTest(test);
    },
    getStats(): RHIRenderStats {
      const info = renderer.info;
      return {
        drawCalls: info?.render?.calls ?? 0,
        triangles: info?.render?.triangles ?? 0,
        lines: info?.render?.lines ?? 0,
        points: info?.render?.points ?? 0,
        geometries: info?.memory?.geometries ?? 0,
        textures: info?.memory?.textures ?? 0,
        programs: info?.programs?.length ?? 0,
      };
    },
    dispose(): void {
      renderer.dispose();
    },
  };
  return device;
}
