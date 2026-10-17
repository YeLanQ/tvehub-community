import { describe, expect, it } from "vitest";
import { SceneClient, type SceneChangedEvent, type SceneTransport } from "./SceneClient";
import { Node } from "../prototype/Node";
import { createDefaultRegistry } from "../prototype/PrototypeRegistry";
import { NodeFactory } from "../factory/NodeFactory";

// 图变更事件唯一发射源 = 后端 scene:changed 回显：
// 本地提交只乐观改镜像、不发事件（有后端时），避免「乐观 emit + 回显 emit」
// 双份日志/双份同步（真实现象：单次 node.add 控制台出现两条「创建节点」）。

const hist = {
  canUndo: false,
  canRedo: false,
  depth: 0,
  undoLabel: null,
  redoLabel: null,
  labels: [] as string[],
};

function makeTransport(): SceneTransport {
  return {
    addNode: async () => undefined,
    addTree: async () => undefined,
    removeNodes: async () => undefined,
    reparentNodes: async () => undefined,
    rename: async () => undefined,
    setTransform: async () => undefined,
    patchNodes: async () => undefined,
    undo: async () => hist,
    redo: async () => hist,
    patchNode: async () => undefined,
  };
}

function makeClient(transport: SceneTransport | null, kinds: string[]): SceneClient {
  const client = new SceneClient(new NodeFactory(createDefaultRegistry()));
  client.setTransport(transport);
  client.onChange((c) => kinds.push(c.kind));
  return client;
}

function echo(client: SceneClient, node: Node, kind: SceneChangedEvent["kind"], revision: number): void {
  client.applyEvent({
    root: null,
    rel: "",
    kind,
    nodeId: node.id,
    revision,
    nodes: kind === "remove" ? [] : [node.toJSON() as never],
    history: hist,
    dirty: true,
  });
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("图变更事件：只由后端回显发射", () => {
  it("有后端：add 本地不发事件，回显恰好一次", async () => {
    const kinds: string[] = [];
    const client = makeClient(makeTransport(), kinds);
    const n = new Node({ name: "A" });
    client.add(n);
    await flush();
    expect(kinds).toEqual([]);
    echo(client, n, "add", 1);
    expect(kinds).toEqual(["add"]);
  });

  it("有后端：remove 本地不发事件，回显恰好一次", async () => {
    const kinds: string[] = [];
    const client = makeClient(makeTransport(), kinds);
    const n = new Node({ name: "B" });
    client.add(n);
    await flush();
    echo(client, n, "add", 1);
    kinds.length = 0;
    client.removeNodes([n.id]);
    await flush();
    expect(kinds).toEqual([]);
    echo(client, n, "remove", 2);
    expect(kinds).toEqual(["remove"]);
  });

  it("有后端：属性补丁回显恰好一次", async () => {
    const kinds: string[] = [];
    const client = makeClient(makeTransport(), kinds);
    const n = new Node({ name: "C" });
    client.add(n);
    await flush();
    echo(client, n, "add", 1);
    kinds.length = 0;
    client.commitPatch(n.id, {} as never, n.toJSON() as never, "edit");
    await flush();
    expect(kinds).toEqual([]);
    echo(client, n, "properties", 2);
    expect(kinds).toEqual(["properties"]);
  });

  it("无后端（浏览器直开）：本地提交自行补发事件", () => {
    const kinds: string[] = [];
    const client = makeClient(null, kinds);
    const root = new Node({ name: "Root" });
    client.add(root);
    const n = new Node({ name: "D" });
    client.add(n);
    expect(kinds).toEqual(["add", "add"]);
    client.removeNodes([n.id]);
    expect(kinds).toEqual(["add", "add", "remove"]);
  });
});
