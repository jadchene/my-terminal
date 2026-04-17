import type { Metrics } from '../types';

type StatusPanelProps = {
  activeSessionId: number | null;
  currentMetrics: Metrics | null;
};

function formatSpeed(value: number): string {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  if (value > 1024) return `${(value / 1024).toFixed(2)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

function formatCapacity(valueGb: number): string {
  const value = Number(valueGb || 0);
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)}TB`;
  }
  return `${value.toFixed(2)}GB`;
}

function renderStatusRow(label: string, value: string) {
  return (
    <div className="status-kv">
      <span className="status-kv-label">{label}</span>
      <span className="status-kv-value">{value || '--'}</span>
    </div>
  );
}

export function StatusPanel({ activeSessionId, currentMetrics }: StatusPanelProps) {
  return (
    <div className={`status-panel panel-content ${activeSessionId && currentMetrics ? '' : 'panel-empty-host'}`}>
      {activeSessionId && currentMetrics ? (
        <>
          <div className="status-group">
            <div className="status-title">系统</div>
            {renderStatusRow('版本', currentMetrics.system.version || '--')}
            {renderStatusRow('架构', currentMetrics.system.arch || '--')}
          </div>
          <div className="status-group">
            <div className="status-title">CPU</div>
            {renderStatusRow('名称', currentMetrics.cpuName || '--')}
            {renderStatusRow('占用', `${currentMetrics.cpu}%`)}
            {renderStatusRow('核心', String(currentMetrics.cpuCores || '--'))}
          </div>
          <div className="status-group">
            <div className="status-title">内存</div>
            {renderStatusRow(
              '占用',
              `${formatCapacity(currentMetrics.memory.usedGb)} / ${formatCapacity(currentMetrics.memory.totalGb)} (${currentMetrics.memory.percent}%)`,
            )}
          </div>
          <div className="status-group">
            <div className="status-title">网络</div>
            {renderStatusRow('IP', currentMetrics.network.ips[0] || '--')}
            {renderStatusRow('上传', formatSpeed(currentMetrics.network.upload))}
            {renderStatusRow('下载', formatSpeed(currentMetrics.network.download))}
          </div>
          <div className="status-group">
            <div className="status-title">硬盘</div>
            {renderStatusRow(
              '占用',
              currentMetrics.disk.totalGb > 0
                ? `${formatCapacity(currentMetrics.disk.usedGb)} / ${formatCapacity(currentMetrics.disk.totalGb)} (${currentMetrics.disk.percent}%)`
                : '--',
            )}
            {renderStatusRow('写入', formatSpeed(currentMetrics.disk.upload))}
            {renderStatusRow('读取', formatSpeed(currentMetrics.disk.download))}
          </div>
          <div className="status-group">
            <div className="status-title">GPU</div>
            {currentMetrics.gpu.available ? (
              <>
                {currentMetrics.gpu.items.map((gpu) => (
                  <div key={`${gpu.index}-${gpu.name}`} className="gpu-item">
                    {renderStatusRow(`GPU${gpu.index}`, gpu.name)}
                    {renderStatusRow('显存', `${gpu.memoryUsedGb}GB / ${gpu.memoryTotalGb}GB (${gpu.memoryPercent}%)`)}
                    {renderStatusRow('负载', `${gpu.load}%`)}
                  </div>
                ))}
              </>
            ) : (
              <div className="status-kv-value">无</div>
            )}
          </div>
        </>
      ) : (
        <div className="panel-empty">暂无活动会话</div>
      )}
    </div>
  );
}
