import "server-only";
import * as mock from "@/lib/mock/dhpo";

/**
 * SEAL's only connection to the post office. The mock runs in-process, but SEAL passes and
 * receives nothing except eClaimLink XML strings and transaction ids — the same contract a real
 * DHPO connection would have — so replacing it touches this file only.
 */
export const dhpo = {
  uploadTransaction: mock.uploadTransaction,
  getNewTransactions: mock.getNewTransactions,
  downloadTransactionFile: mock.downloadTransactionFile,
  setTransactionDownloaded: mock.setTransactionDownloaded,
};
