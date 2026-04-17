type TransferRow = {
  key: string;
  batchId: string;
  sessionId: number;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  name: string;
  percent: number;
  transferred: number;
  total: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
};

type TransferListProps = {
  rows: TransferRow[];
  onCancel: (row: TransferRow) => void;
};

export function TransferList({ rows, onCancel }: TransferListProps) {
  if (rows.length === 0) return null;
  return (
    <div className="transfer-list">
      {rows.map((row) => (
        <div key={row.key} className={`transfer-row transfer-${row.status}`} title={row.name}>
          <div className="transfer-title">
            <span>{row.direction === 'upload' ? '上传' : '下载'}</span>
            <span>{row.totalCount === 0 || row.name.includes('正在统计文件数量') ? '准备中' : row.name}</span>
            <span>{row.percent.toFixed(0)}%</span>
          </div>
          <div className="transfer-meta-row">
            <div className="transfer-meta">
              {row.totalCount > 0
                ? `共 ${row.totalCount} 项，当前 ${Math.min(row.index + 1, row.totalCount)}/${row.totalCount}`
                : '正在统计文件数量...'}
            </div>
            <button
              type="button"
              className="transfer-cancel-btn"
              title={row.status === 'running' ? '取消传输' : row.status === 'cancelled' ? '已取消' : '已完成'}
              disabled={row.status === 'cancelled'}
              onClick={() => onCancel(row)}
            >
              取消
            </button>
          </div>
          <div className="transfer-bar">
            <div className="transfer-fill" style={{ width: `${row.percent}%`, backgroundColor: '#ffffff' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
