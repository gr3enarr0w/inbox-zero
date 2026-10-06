import useSWR from "swr";
import type { GetFoldersResponse } from "@/app/api/user/folders/route";
import { getEmailProviderCapabilities } from "@/utils/email/capabilities";

export function useFolders(provider: string) {
  const enabled = getEmailProviderCapabilities(provider).folders;
  const { data, error, isLoading, mutate } = useSWR<GetFoldersResponse>(
    enabled ? "/api/user/folders" : null,
  );
  return {
    folders: data || [],
    isLoading: enabled ? !!isLoading : false,
    error,
    mutate,
  };
}
