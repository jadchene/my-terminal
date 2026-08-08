import { CloseOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Progress, Tooltip } from 'antd';

type TransferRow = {
  key: string;
  batchId: string;
  sessionId: number;
  direction: 'upload' | 'download';
  index: number;
  totalCount: number;
  completedCount: number;
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

export const TransferList = ({ rows, onCancel }: TransferListProps) => {
  if (rows.length === 0) return null;
  const row = rows[0];
  const summary = row.totalCount === 0 || row.name.includes('正在统计文件数量')
    ? '准备中'
    : row.totalCount > 1
      ? `${Math.min(row.completedCount, row.totalCount)} / ${row.totalCount}`
      : row.name;

  return (
    <div className={`transfer-strip transfer-${row.status}`} title={row.name}>
      <span className="transfer-direction">
        {row.direction === 'upload' ? <UploadOutlined /> : <DownloadOutlined />}
      </span>
      <div className="transfer-summary">
        <div className="transfer-title">
          <span>{row.direction === 'upload' ? '上传' : '下载'}</span>
          <span className="transfer-name">{summary}</span>
          <span>{row.percent.toFixed(0)}%</span>
        </div>
        <Progress percent={row.percent} showInfo={false} size="small" status={row.status === 'error' ? 'exception' : undefined} />
      </div>
      <Tooltip title={row.status === 'running' ? '取消传输' : '移除记录'}>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => onCancel(row)} />
      </Tooltip>
      {rows.length > 1 && <span className="transfer-count">+{rows.length - 1}</span>}
    </div>
  );
};
