import React from 'react';
import { Building2, Globe, Zap } from 'lucide-react';
import { AccountType, getAccountTypeMeta } from '../../utils/accountUtils';

interface AccountTypeBadgeProps {
  type: AccountType;
  showIcon?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}

export const AccountTypeBadge: React.FC<AccountTypeBadgeProps> = ({
  type,
  showIcon = true,
  size = 'xs',
  className = '',
}) => {
  const meta = getAccountTypeMeta(type);
  const isXs = size === 'xs';
  const iconSize = isXs ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const textPadding = isXs ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs';

  const renderIcon = () => {
    switch (type) {
      case 'oslc':
        return <Zap className={`${iconSize} text-purple-400 shrink-0`} />;
      case 'external':
        return <Globe className={`${iconSize} text-amber-400 shrink-0`} />;
      case 'internal':
      default:
        return <Building2 className={`${iconSize} text-cyan-400 shrink-0`} />;
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-md border ${textPadding} ${meta.tagClass} ${className}`}
      title={`${meta.label}: ${meta.description}`}
    >
      {showIcon && renderIcon()}
      <span>{meta.shortLabel}</span>
    </span>
  );
};
