import { FakeApi, fakeGroupOut, fakeSessionOut } from "./api/fake";
import { createApiaryStore } from "./store";

function setup() {
  const api = new FakeApi(
    [
      fakeSessionOut({ id: "a1", title: "Refactor auth", status: "live", groups: ["repo:a"] }),
      fakeSessionOut({ id: "a2", title: "Review PR 9", score: 20, groups: ["repo:a"] }),
      fakeSessionOut({ id: "b1", title: "Docs", repo_name: "b", groups: ["repo:b", "swarm:x"] }),
    ],
    [fakeGroupOut("swarm:x", "Billing", "custom", 300, ["b1"]), fakeGroupOut("repo:b", "b", "repo", 152, ["b1"]), fakeGroupOut("repo:a", "a", "repo", 22, ["a1", "a2"])],
  );
  api.stored = { world: "#182230", threshold: 40, collapsed: { "group:repo:a": true } };
  const store = createApiaryStore(api);
  return { api, store };
}

test("load fills sessions, groups in hive-then-swarm order, and settings", async () => {
  const { store } = setup();
  await store.getState().load();
  const st = store.getState();
  expect(Object.keys(st.sessions)).toEqual(["a1", "a2", "b1"]);
  expect(st.groupOrder).toEqual(["repo:a", "repo:b", "swarm:x"]);
  expect(st.sessions.a1.active).toBe(true);
  expect([st.world, st.threshold, st.collapsed]).toEqual(["#182230", 40, { "group:repo:a": true }]);
  expect(st.conn).toBe("live");
});

test("events update, flip, remove and reshape the mirror", async () => {
  const { api, store } = setup();
  await store.getState().load();
  api.emit({ type: "session.updated", session: fakeSessionOut({ id: "a2", title: "Renamed", score: 33 }) });
  expect(store.getState().sessions.a2.title).toBe("Renamed");
  api.emit({ type: "session.live", id: "a1", live: false });
  expect(store.getState().sessions.a1.active).toBe(false);
  api.emit({ type: "session.updated", session: fakeSessionOut({ id: "a2", status: "purged" }) });
  expect(store.getState().sessions.a2).toBeUndefined();
  api.emit({ type: "group.updated", group: fakeGroupOut("swarm:y", "Alpha", "custom", 10) });
  expect(store.getState().groupOrder).toEqual(["repo:a", "repo:b", "swarm:y", "swarm:x"]);
  api.emit({ type: "group.deleted", id: "swarm:x" });
  expect(store.getState().groupOrder).toEqual(["repo:a", "repo:b", "swarm:y"]);
  expect(store.getState().sessions.b1.swarms).toEqual([]);
  api.emit({ type: "settings.updated", settings: { world: "#ffffff", threshold: 12 } });
  expect([store.getState().world, store.getState().threshold]).toEqual(["#ffffff", 12]);
});

test("swarm and tag mutations go through the api and refresh the sessions involved", async () => {
  const { store } = setup();
  await store.getState().load();
  const gid = await store.getState().createSwarm("Task force", null, ["a1", "a2"]);
  expect(store.getState().groups[gid].name).toBe("Task force");
  expect(store.getState().sessions.a1.swarms).toEqual([gid]);
  await store.getState().removeMember(gid, "a2");
  expect(store.getState().sessions.a2.swarms).toEqual([]);
  await store.getState().addTag("a1", "billing");
  expect(store.getState().sessions.a1.tags).toEqual(["billing"]);
  await store.getState().removeTag("a1", "billing");
  expect(store.getState().sessions.a1.tags).toEqual([]);
  await store.getState().deleteGroup(gid);
  expect(store.getState().groups[gid]).toBeUndefined();
  expect(store.getState().sessions.a1.swarms).toEqual([]);
});

test("keeper: decide, apply marks, restore, purge", async () => {
  const { store } = setup();
  await store.getState().load();
  await store.getState().decide("a2", "summarize_archive");
  expect(store.getState().sessions.a2.decision).toBe("summarize_archive");
  const report = await store.getState().applyMarks();
  expect(report.archived).toEqual(["a2"]);
  expect(store.getState().sessions.a2.status).toBe("archived");
  expect(store.getState().sessions.a2.hasHoney).toBe(true);
  await store.getState().restore("a2");
  expect(store.getState().sessions.a2.status).toBe("ok");
  await store.getState().decide("a2", "archive");
  await store.getState().applyMarks();
  await store.getState().purge("a2");
  expect(store.getState().sessions.a2).toBeUndefined();
});

test("selection and persisted view settings", async () => {
  vi.useFakeTimers();
  const { api, store } = setup();
  await store.getState().load();
  store.getState().select("a1", false);
  store.getState().select("a2", true);
  expect([...store.getState().selected]).toEqual(["a1", "a2"]);
  store.getState().select("a1", true);
  expect([...store.getState().selected]).toEqual(["a2"]);
  store.getState().clearSelection();
  expect(store.getState().selected.size).toBe(0);
  store.getState().toggleCollapsed("group:repo:b");
  store.getState().setWorld("#ffffff");
  await vi.runAllTimersAsync();
  expect(api.stored.collapsed).toEqual({ "group:repo:a": true, "group:repo:b": true });
  expect(api.stored.world).toBe("#ffffff");
  expect(api.calls.filter((c) => c === "putSettings")).toHaveLength(1);
  vi.useRealTimers();
});
