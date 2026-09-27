import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ApiaryState, ApiaryStore } from "./store";

export const StoreContext = createContext<ApiaryStore | null>(null);

export function useApiaryStore(): ApiaryStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext missing");
  return store;
}
export function useApiary<T>(selector: (st: ApiaryState) => T): T {
  return useStore(useApiaryStore(), selector);
}
