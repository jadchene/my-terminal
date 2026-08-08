import type { RefObject } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import type { Settings } from '../types';

type SettingsTab = 'appearance' | 'behavior' | 'system';

type SettingsModalProps = {
  show: boolean;
  draft: Settings | null;
  tab: SettingsTab;
  cursorStyleMenuOpen: boolean;
  cursorStyleMenuRef: RefObject<HTMLDivElement | null>;
  runtimeInfo: {
    runtimeDir: string;
    userDataPath: string;
    settingsStorage: string;
    dbPath: string;
    os: string;
  } | null;
  onSwitchTab: (tab: SettingsTab) => void;
  onToggleCursorMenu: () => void;
  onCloseCursorMenu: () => void;
  onUpdateDraft: (next: Settings) => void;
  onPickDefaultDownloadDir: () => Promise<void>;
  onCancel: () => void;
  onSave: () => Promise<void>;
};

const SettingGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="settings-group">
    <h3>{title}</h3>
    <div className="settings-group-body">{children}</div>
  </section>
);

const RuntimePath = ({ label, value }: { label: string; value?: string }) => (
  <div className="runtime-path-row">
    <span>{label}</span>
    <Typography.Text ellipsis={{ tooltip: value }}>{value || '--'}</Typography.Text>
  </div>
);

export const SettingsModal = (props: SettingsModalProps) => {
  const {
    show,
    draft,
    tab,
    runtimeInfo,
    onSwitchTab,
    onUpdateDraft,
    onPickDefaultDownloadDir,
    onCancel,
    onSave,
  } = props;

  if (!draft) return null;
  const updateTheme = (next: Partial<Settings['theme']>) => onUpdateDraft({
    ...draft,
    theme: { ...draft.theme, ...next },
  });
  const updateBehavior = (next: Partial<Settings['behavior']>) => onUpdateDraft({
    ...draft,
    behavior: { ...draft.behavior, ...next },
  });

  const appearance = (
    <div className="settings-scroll">
      <SettingGroup title="界面">
        <Form layout="horizontal" colon={false} labelCol={{ span: 6 }} wrapperCol={{ span: 18 }}>
          <Form.Item label="主题">
            <Segmented
              className="theme-segmented"
              block
              value={draft.theme.mode}
              options={[{ label: '深色', value: 'dark' }, { label: '浅色', value: 'light' }]}
              onChange={(value) => updateTheme({ mode: value as Settings['theme']['mode'] })}
            />
          </Form.Item>
          <Form.Item label="界面字号">
            <InputNumber min={11} max={24} value={draft.theme.uiFontSize} suffix="px" onChange={(value) => updateTheme({ uiFontSize: value ?? 13 })} />
          </Form.Item>
        </Form>
      </SettingGroup>
      <SettingGroup title="终端">
        <Form layout="horizontal" colon={false} labelCol={{ span: 6 }} wrapperCol={{ span: 18 }}>
          <Form.Item label="终端字体">
            <Input value={draft.theme.terminalFontFamily} onChange={(event) => updateTheme({ terminalFontFamily: event.target.value })} />
          </Form.Item>
          <Form.Item label="终端字号">
            <InputNumber min={10} max={36} value={draft.theme.terminalFontSize} suffix="px" onChange={(value) => updateTheme({ terminalFontSize: value ?? 16 })} />
          </Form.Item>
          <Form.Item label="光标样式">
            <Select
              value={draft.theme.terminalCursorStyle}
              options={[
                { label: '块', value: 'block' },
                { label: '下划线', value: 'underline' },
                { label: '竖线', value: 'bar' },
              ]}
              onChange={(value) => updateTheme({ terminalCursorStyle: value })}
            />
          </Form.Item>
          <Form.Item label="光标闪烁">
            <Switch checked={draft.theme.terminalCursorBlink} onChange={(checked) => updateTheme({ terminalCursorBlink: checked })} />
          </Form.Item>
          <Form.Item label="竖线宽度">
            <InputNumber min={1} max={8} value={draft.theme.terminalCursorWidth} suffix="px" onChange={(value) => updateTheme({ terminalCursorWidth: value ?? 2 })} />
          </Form.Item>
        </Form>
      </SettingGroup>
    </div>
  );

  const behavior = (
    <div className="settings-scroll">
      <SettingGroup title="会话行为">
        <div className="switch-list">
          {[
            ['单实例运行', draft.behavior.singleInstance, (checked: boolean) => updateBehavior({ singleInstance: checked })],
            ['选中内容后自动复制', draft.behavior.autoCopySelection, (checked: boolean) => updateBehavior({ autoCopySelection: checked })],
            ['右键粘贴', draft.behavior.rightClickPaste, (checked: boolean) => updateBehavior({ rightClickPaste: checked })],
            ['粘贴多行内容前确认', draft.behavior.multilineWarning, (checked: boolean) => updateBehavior({ multilineWarning: checked })],
            ['聚焦终端时切换英文输入法', draft.behavior.autoSwitchEnglishInputMethod, (checked: boolean) => updateBehavior({ autoSwitchEnglishInputMethod: checked })],
          ].map(([label, checked, action]) => (
            <div className="switch-row" key={String(label)}>
              <span>{String(label)}</span>
              <Switch checked={Boolean(checked)} onChange={action as (checked: boolean) => void} />
            </div>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="文件传输">
        <Form layout="vertical" colon={false}>
          <Form.Item label="默认下载目录">
            <Input
              value={draft.behavior.defaultDownloadDir}
              placeholder="留空时使用系统下载目录"
              onChange={(event) => updateBehavior({ defaultDownloadDir: event.target.value })}
              addonAfter={<Button type="text" size="small" onClick={() => void onPickDefaultDownloadDir()}>选择</Button>}
            />
          </Form.Item>
        </Form>
      </SettingGroup>
    </div>
  );

  const system = (
    <div className="settings-scroll">
      <SettingGroup title="运行环境">
        <RuntimePath label="运行目录" value={runtimeInfo?.runtimeDir} />
        <RuntimePath label="用户数据" value={runtimeInfo?.userDataPath} />
        <RuntimePath label="数据库" value={runtimeInfo?.dbPath} />
      </SettingGroup>
    </div>
  );

  return (
    <Modal
      className="settings-modal"
      open={show}
      title="设置"
      width={760}
      centered
      mask={{ closable: false }}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button key="save" type="primary" onClick={() => void onSave()}>保存</Button>,
      ]}
    >
      <Tabs
        activeKey={tab}
        onChange={(key) => onSwitchTab(key as SettingsTab)}
        items={[
          { key: 'appearance', label: '外观', children: appearance },
          { key: 'behavior', label: '行为', children: behavior },
          { key: 'system', label: '系统', children: system },
        ]}
      />
    </Modal>
  );
};
