import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FakeApi, fakeGroupOut, fakeSessionOut } from "../api/fake";
import { StoreContext } from "../hooks";
import { createApiaryStore } from "../store";
import { Tray } from "./Tray";

async function mount() {
  const api = new FakeApi(
    [
      fakeSessionOut({ id: "a1", title: "Refactor auth", status: "live", score: 100, last_active_at: Date.now() / 1000 }),
      fakeSessionOut({ id: "a2", title: "Review PR 9", score: 20, last_active_at: Date.now() / 1000 - 40 * 86400, parent_id: "a1" }),
      fakeSessionOut({ id: "b1", title: "Docs", repo_name: "b", groups: ["repo:b", "swarm:x"], score: 55, tags: ["needs-review"] }),
      fakeSessionOut({ id: "old", title: "Archived thing", status: "archived", has_honey: true }),
    ],
    [fakeGroupOut("repo:a", "a", "repo", 22, ["a1", "a2"]), fakeGroupOut("repo:b", "b", "repo", 152, ["b1"]), fakeGroupOut("swarm:x", "Billing", "custom", 300, ["b1"])],
  );
  const store = createApiaryStore(api);
  await store.getState().load();
  render(<StoreContext.Provider value={store}><Tray /></StoreContext.Provider>);
  return { api, store };
}

test("hive sections list their rows, swarm members show under the swarm and as ghosts at home", async () => {
  await mount();
  const a = screen.getByTestId("section-group:repo:a");
  expect(within(a).getByText("Refactor auth")).toBeInTheDocument();
  expect(within(a).getByText("Review PR 9")).toBeInTheDocument();
  const b = screen.getByTestId("section-group:repo:b");
  expect(within(b).getByText("Docs").closest(".row")).toHaveClass("ghost");
  const x = screen.getByTestId("section-group:swarm:x");
  expect(within(x).getByText("Docs").closest(".row")).not.toHaveClass("ghost");
  expect(screen.getAllByText("needs-review")).toHaveLength(2); // in its swarm and as a ghost at home
  expect(screen.getByText("Archived thing")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Honey" })).toBeInTheDocument();
});

test("clicking rows selects them and the selection bar appears", async () => {
  const { store } = await mount();
  const user = userEvent.setup();
  await user.click(screen.getByText("Refactor auth"));
  expect([...store.getState().selected]).toEqual(["a1"]);
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  await user.keyboard("{Shift>}");
  await user.click(screen.getByText("Review PR 9"));
  await user.keyboard("{/Shift}");
  expect([...store.getState().selected]).toEqual(["a1", "a2"]);
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  await user.click(screen.getByTitle("Clear selection"));
  expect(store.getState().selected.size).toBe(0);
});

test("the keeper lists candidates below the threshold, not the running one, and applies marks", async () => {
  const { store } = await mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Keeper/ }));
  expect(screen.getByText("Review PR 9")).toBeInTheDocument();
  expect(screen.queryByText("Refactor auth")).not.toBeInTheDocument();
  expect(screen.getByText("1 candidate")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Archive" }));
  expect(store.getState().sessions.a2.decision).toBe("archive");
  await user.click(screen.getByRole("button", { name: "Apply 1 mark" }));
  await screen.findByText("Nothing to collect at this threshold.");
  expect(store.getState().sessions.a2.status).toBe("archived");
});
