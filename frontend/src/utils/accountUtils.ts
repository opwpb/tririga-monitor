export type AccountType = 'internal' | 'external' | 'oslc';
export type AccountTypeFilterValue = 'all' | 'internal' | 'external' | 'oslc';

export interface AccountTypeInfo {
  type: AccountType;
  label: string;
  shortLabel: string;
  tagClass: string;
  badgeClass: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  description: string;
}

const OSLC_KEYWORDS = [
  'oslc',
  'api_',
  'api-',
  'api.',
  'svc_',
  'svc-',
  'svc.',
  'service_',
  'service-',
  'integration',
  'integrator',
  'batch_',
  'batch-',
  'daemon',
  'sync_',
  'sync-',
  'ws_',
  'ws-',
  'connect_',
  'connect-',
  'interface',
  'bot_',
  'bot-',
  'rest_',
  'rest-',
  'crawler',
  'system_',
  'sys_int',
  'tririga_int',
  'tri_int',
];

const EXTERNAL_KEYWORDS = [
  'ext_',
  'ext-',
  'ext.',
  'ext/',
  '(ext)',
  '[ext]',
  'external',
  'vendor',
  'contractor',
  'consultant',
  'partner',
  'supplier',
  'guest',
  'visitor',
  'temp_',
  'temp-',
  '3rdparty',
  'thirdparty',
  '@vendor',
  '@contractor',
  '@external',
  '@partner',
  '@supplier',
];

/**
 * Classifies a user/account into 'internal', 'external', or 'oslc'.
 */
export function getAccountType(user?: {
  account_type?: string;
  user_name?: string;
  user_id?: string | number;
  user_account?: string;
  spec_name?: string;
  assigned_licenses?: string[];
  assigned_pids?: number[];
  product_id?: number | string;
  business_connect?: boolean | number | string;
  [key: string]: any;
}): AccountType {
  if (!user) return 'internal';

  // 1. Explicit backend-provided account_type
  const rawType = user.account_type || user.ACCOUNT_TYPE;
  if (rawType === 'oslc' || rawType === 'external' || rawType === 'internal') {
    return rawType;
  }

  const name = String(user.user_name || user.spec_name || user.USER_NAME || user.SPEC_NAME || '').toLowerCase();
  const acc = String(user.user_account || user.SYS_USERACCOUNT || user.sys_useraccount || '').toLowerCase();
  const uid = String(user.user_id || user.USER_ID || '').toLowerCase();
  const lics = (user.assigned_licenses || user.ASSIGNED_LICENSES || []).join(' ').toLowerCase();
  const pids = user.assigned_pids || user.ASSIGNED_PIDS || (user.product_id || user.PRODUCT_ID ? [Number(user.product_id || user.PRODUCT_ID)] : []);
  const bc = user.business_connect !== undefined ? user.business_connect : (user.BUSINESS_CONNECT_USER !== undefined ? user.BUSINESS_CONNECT_USER : user.business_connect_user);

  // 2. OSLC / API Checks
  if (user.business_connect === true || user.business_connect === 1 || user.business_connect === '1' || user.business_connect === 'Y') {
    return 'oslc';
  }
  if (pids.some(p => p === 3021 || p === 3047 || p === 3022)) {
    return 'oslc';
  }
  if (
    lics.includes('api integration') ||
    lics.includes('connector for business apps') ||
    lics.includes('mobile integration') ||
    lics.includes('business connect') ||
    lics.includes('oslc')
  ) {
    return 'oslc';
  }
  if (OSLC_KEYWORDS.some(k => name.includes(k) || acc.includes(k) || uid.includes(k))) {
    return 'oslc';
  }

  // 3. External Contractor / Vendor Checks
  if (EXTERNAL_KEYWORDS.some(k => name.includes(k) || acc.includes(k) || uid.includes(k))) {
    return 'external';
  }

  // 4. Default to Internal
  return 'internal';
}

/**
 * Returns visual styling and metadata for a given AccountType.
 */
export function getAccountTypeMeta(type: AccountType): AccountTypeInfo {
  switch (type) {
    case 'oslc':
      return {
        type: 'oslc',
        label: 'OSLC / API Integration',
        shortLabel: 'OSLC / API',
        tagClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
        badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        bgClass: 'bg-purple-950/30',
        textClass: 'text-purple-300',
        borderClass: 'border-purple-500/30',
        description: 'System-to-system automated integrations, REST APIs, OSLC connectors, and service daemon accounts',
      };
    case 'external':
      return {
        type: 'external',
        label: 'External Account',
        shortLabel: 'External',
        tagClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        bgClass: 'bg-amber-950/30',
        textClass: 'text-amber-300',
        borderClass: 'border-amber-500/30',
        description: 'External third-party contractors, vendors, partners, suppliers, and external guest accounts',
      };
    case 'internal':
    default:
      return {
        type: 'internal',
        label: 'Internal Account',
        shortLabel: 'Internal',
        tagClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
        badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        bgClass: 'bg-cyan-950/30',
        textClass: 'text-cyan-300',
        borderClass: 'border-cyan-500/30',
        description: 'Standard company employees, corporate users, and internal platform personnel',
      };
  }
}
