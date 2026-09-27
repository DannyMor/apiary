import { useEffect, useMemo } from "react";
import { HttpApi } from "./api/client";
import { StoreContext } from "./hooks";
import { createApiaryStore } from "./store";
import { Tray } from "./components/Tray";
import { World } from "./world/World";
import { Dialogs } from "./components/dialogs/Dialogs";

export function App() {
  const store = useMemo(() => createApiaryStore(new HttpApi()), []);
  useEffect(() => {
    void store.getState().load();
    const clock = setInterval(() => store.setState({ now: Date.now() }), 60_000);
    return () => clearInterval(clock);
  }, [store]);
  return (
    <StoreContext.Provider value={store}>
      <div id="app">
        <Tray />
        <World />
      </div>
      <Dialogs />
    </StoreContext.Provider>
  );
}
