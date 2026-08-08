import { Empty, Progress, Tag } from 'antd';
import type { Metrics } from '../types';

type StatusPanelProps = {
  activeSessionId: number | null;
  currentMetrics: Metrics | null;
};

const formatSpeed = (value: number): string => {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  if (value > 1024) return `${(value / 1024).toFixed(2)} KB/s`;
  return `${value.toFixed(0)} B/s`;
};

const formatCapacity = (valueGb: number): string => {
  const value = Number(valueGb || 0);
  return value >= 1024 ? `${(value / 1024).toFixed(2)} TB` : `${value.toFixed(2)} GB`;
};

const StatusRow = ({ label, value }: { label: string; value: string }) => (
  <div className="status-kv">
    <span className="status-kv-label">{label}</span>
    <span className="status-kv-value">{value || '--'}</span>
  </div>
);

const Meter = ({ percent }: { percent: number }) => (
  <Progress percent={Math.max(0, Math.min(100, percent))} showInfo={false} size="small" />
);

export const StatusPanel = ({ activeSessionId, currentMetrics }: StatusPanelProps) => {
  if (!activeSessionId || !currentMetrics) {
    return <div className="panel-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活动会话" /></div>;
  }

  return (
    <div className="status-panel panel-content">
      {currentMetrics.stale && <Tag color="warning">数据已过期</Tag>}
      <section className="status-group">
        <h3>系统</h3>
        <StatusRow label="版本" value={currentMetrics.system.version} />
        <StatusRow label="架构" value={currentMetrics.system.arch} />
      </section>
      <section className="status-group">
        <h3>CPU</h3>
        <StatusRow label="名称" value={currentMetrics.cpuName} />
        <StatusRow label="占用" value={`${currentMetrics.cpu}%`} />
        <Meter percent={currentMetrics.cpu} />
        <StatusRow label="温度" value={currentMetrics.cpuTemp == null ? '--' : `${currentMetrics.cpuTemp}°C`} />
        <StatusRow label="核心" value={`${currentMetrics.cpuPhysicalCores || '--'}核心/${currentMetrics.cpuLogicalCores || '--'}线程`} />
      </section>
      <section className="status-group">
        <h3>内存</h3>
        <StatusRow label="占用" value={`${formatCapacity(currentMetrics.memory.usedGb)} / ${formatCapacity(currentMetrics.memory.totalGb)}`} />
        <Meter percent={currentMetrics.memory.percent} />
      </section>
      <section className="status-group">
        <h3>网络</h3>
        <StatusRow label="IP" value={currentMetrics.network.ips.join(', ') || '--'} />
        <StatusRow label="上传" value={formatSpeed(currentMetrics.network.upload)} />
        <StatusRow label="下载" value={formatSpeed(currentMetrics.network.download)} />
      </section>
      <section className="status-group">
        <h3>硬盘</h3>
        <StatusRow
          label="占用"
          value={currentMetrics.disk.totalGb > 0
            ? `${formatCapacity(currentMetrics.disk.usedGb)} / ${formatCapacity(currentMetrics.disk.totalGb)}`
            : '--'}
        />
        <Meter percent={currentMetrics.disk.percent} />
        <StatusRow label="写入" value={formatSpeed(currentMetrics.disk.upload)} />
        <StatusRow label="读取" value={formatSpeed(currentMetrics.disk.download)} />
      </section>
      <section className="status-group">
        <h3>GPU</h3>
        {currentMetrics.gpu.available ? currentMetrics.gpu.items.map((gpu) => (
          <div key={`${gpu.index}-${gpu.name}`} className="gpu-item">
            <StatusRow label={`GPU ${gpu.index}`} value={gpu.name} />
            <StatusRow label="温度" value={`${gpu.temperature}°C`} />
            <StatusRow label="显存" value={`${gpu.memoryUsedGb} GB / ${gpu.memoryTotalGb} GB`} />
            <Meter percent={gpu.memoryPercent} />
            <StatusRow label="负载" value={`${gpu.load}%`} />
            <StatusRow label="功耗" value={`${gpu.powerDraw ?? '--'} W / ${gpu.powerLimit ?? '--'} W`} />
          </div>
        )) : <StatusRow label="设备" value="未检测到" />}
      </section>
    </div>
  );
};
