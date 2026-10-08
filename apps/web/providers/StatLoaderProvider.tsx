"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSWRConfig } from "swr";
import { toastSuccess } from "@/components/Toast";
import { loadEmailStatsAction } from "@/utils/actions/stats";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  StatsLoader,
  isStatsImportCacheKey,
  type StatLoaderState,
} from "@/providers/stat-loader";

type Options = { loadBefore: boolean; showToast: boolean };
type Context = StatLoaderState & {
  onLoad: (options: Options) => Promise<void>;
  onLoadBatch: (options: Options) => Promise<void>;
  onCancelLoadBatch: () => void;
};
const initialState: StatLoaderState = {
  isLoading: false,
  error: null,
  progress: null,
};
const StatLoaderContext = createContext<Context>({
  ...initialState,
  onLoad: async () => {},
  onLoadBatch: async () => {},
  onCancelLoadBatch: () => {},
});
export const useStatLoader = () => useContext(StatLoaderContext);

export function StatLoaderProvider(props: { children: React.ReactNode }) {
  const [states, setStates] = useState<Record<string, StatLoaderState>>({});
  const { emailAccountId } = useAccount();
  const currentAccountId = useRef(emailAccountId);
  currentAccountId.current = emailAccountId;
  const { mutate } = useSWRConfig();
  const loader = useRef<StatsLoader | null>(null);
  if (!loader.current)
    loader.current = new StatsLoader(
      loadEmailStatsAction,
      (accountId, update) => {
        setStates((previous) => ({
          ...previous,
          [accountId]: { ...(previous[accountId] ?? initialState), ...update },
        }));
        if (update.progress && currentAccountId.current === accountId) {
          mutate((key) => isStatsImportCacheKey(key, accountId)).catch(
            () => undefined,
          );
        }
      },
    );
  useEffect(() => {
    loader.current!.cancelOtherAccounts(emailAccountId);
  }, [emailAccountId]);
  const onLoad = useCallback(
    async (options: Options) => {
      const complete = await loader.current!.load(
        emailAccountId,
        options.loadBefore,
      );
      if (
        complete &&
        options.showToast &&
        currentAccountId.current === emailAccountId
      )
        toastSuccess({ description: "Mailbox import finished." });
    },
    [emailAccountId],
  );
  const onLoadBatch = useCallback(
    async (options: Options) => {
      const complete = await loader.current!.load(
        emailAccountId,
        options.loadBefore,
        50,
      );
      if (
        complete &&
        options.showToast &&
        currentAccountId.current === emailAccountId
      )
        toastSuccess({ description: "Mailbox import finished." });
    },
    [emailAccountId],
  );
  const onCancelLoadBatch = useCallback(() => {
    loader.current!.cancel(emailAccountId);
  }, [emailAccountId]);
  return (
    <StatLoaderContext.Provider
      value={{
        ...(states[emailAccountId] ?? initialState),
        onLoad,
        onLoadBatch,
        onCancelLoadBatch,
      }}
    >
      {props.children}
    </StatLoaderContext.Provider>
  );
}

export function LoadStats({ loadBefore, showToast }: Options) {
  const { onLoad } = useStatLoader();
  useEffect(() => {
    onLoad({ loadBefore, showToast });
  }, [onLoad, loadBefore, showToast]);
  return null;
}
