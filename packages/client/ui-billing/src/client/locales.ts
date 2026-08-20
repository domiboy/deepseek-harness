/** `billing-deepseek` namespace dictionaries for the plugin settings card. */

/** Dictionary namespace owned by this plugin (mirrors the host settings section key). */
export const NS = 'billing-deepseek'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': 'DeepSeek API 消费',
  'card.loading': '加载中…',
  'card.error': '获取失败：',
  'card.empty': '暂无计费数据',
  'card.pollHint': '每 30 秒自动刷新',
  'card.refresh': '刷新',
  'card.refreshedAt': '更新于',
  'field.available': '账户状态',
  'field.availableYes': '可用',
  'field.availableNo': '不可用',
  'field.balance': '当前余额',
  'field.granted': '赠送余额',
  'field.toppedUp': '充值余额',
  'field.lifetime': '平台累计消费',
  'field.today': '今日消费',
  'field.week': '本周消费',
  'field.month': '本月消费',
  'field.snapshots': '快照数',
  'value.snapshotsUnit': '条',
  'value.na': '—',
} satisfies Record<string, string>

/** The billing namespace key union. */
export type BillingKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'DeepSeek API usage',
  'card.loading': 'Loading…',
  'card.error': 'Failed to load: ',
  'card.empty': 'No billing data yet',
  'card.pollHint': 'Auto-refreshes every 30s',
  'card.refresh': 'Refresh',
  'card.refreshedAt': 'Updated',
  'field.available': 'Account',
  'field.availableYes': 'available',
  'field.availableNo': 'unavailable',
  'field.balance': 'Current balance',
  'field.granted': 'Granted balance',
  'field.toppedUp': 'Topped-up balance',
  'field.lifetime': 'Lifetime consumption',
  'field.today': 'Today',
  'field.week': 'This week',
  'field.month': 'This month',
  'field.snapshots': 'Snapshots',
  'value.snapshotsUnit': '',
  'value.na': '—',
} satisfies Record<BillingKey, string>
