type TransferProgress = {
  totalCount: number;
  completedCount: number;
  transferred: number;
  total: number;
};

export const calculateSftpTransferPercent = (progress: TransferProgress): number => {
  const ratio = progress.totalCount > 1
    ? progress.completedCount / progress.totalCount
    : progress.total > 0
      ? progress.transferred / progress.total
      : 0;
  return Math.min(100, Number((ratio * 100).toFixed(1)));
};
