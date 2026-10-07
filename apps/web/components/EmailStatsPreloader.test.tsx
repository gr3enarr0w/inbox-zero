// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailStatsPreloader } from "./EmailStatsPreloader";
import { StatLoaderProvider } from "@/providers/StatLoaderProvider";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  success: vi.fn(),
  mutate: vi.fn(),
  accountId: "a",
}));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock("@/utils/actions/stats", () => ({ loadEmailStatsAction: mocks.load }));
vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => ({ emailAccountId: mocks.accountId }),
}));
vi.mock("@/components/Toast", () => ({ toastSuccess: mocks.success }));
const completed = {
  data: {
    pages: 1,
    loadedAfterMessages: 0,
    loadedBeforeMessages: 0,
    hasMoreAfter: false,
    hasMoreBefore: false,
    complete: true,
    totalImported: 0,
  },
};
function subject() {
  return (
    <StatLoaderProvider>
      <EmailStatsPreloader />
    </StatLoaderProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountId = "a";
  mocks.mutate.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe("stats import visibility", () => {
  it("imports once when React repeats mount effects in strict mode", async () => {
    mocks.load.mockResolvedValue(completed);
    render(<StrictMode>{subject()}</StrictMode>);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows import failures and allows retry instead of silently treating the mailbox as empty", async () => {
    mocks.load
      .mockResolvedValueOnce({ serverError: "Unsupported import" })
      .mockResolvedValueOnce(completed);
    render(subject());
    await screen.findByRole("alert");
    expect(screen.getByText("Email import failed")).toBeTruthy();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("marks incomplete counts and offers continuation when another import holds the cursor", async () => {
    mocks.load.mockResolvedValue({
      data: {
        ...completed.data,
        pages: 0,
        complete: false,
        hasMoreAfter: true,
        totalImported: 7,
      },
    });
    render(subject());
    await screen.findByRole("button", { name: "Continue import" });
    expect(screen.getByText("Email import is incomplete")).toBeTruthy();
    expect(screen.getByText(/7 messages imported so far/)).toBeTruthy();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it("does not show a previous account's import failure after switching mailboxes", async () => {
    const previous = Promise.withResolvers<unknown>();
    mocks.load.mockImplementation((id: string) =>
      id === "a" ? previous.promise : Promise.resolve(completed),
    );
    const view = render(subject());
    await waitFor(() =>
      expect(mocks.load).toHaveBeenCalledWith("a", { loadBefore: false }),
    );
    mocks.accountId = "b";
    view.rerender(subject());
    await waitFor(() =>
      expect(mocks.load).toHaveBeenCalledWith("b", { loadBefore: false }),
    );
    previous.resolve({ serverError: "Old account failure" });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
