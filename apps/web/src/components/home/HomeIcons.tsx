// 首页线性图标（09-26 改版）：统一 24x24 视框、currentColor 描边，颜色与尺寸由父级类决定。
// 装饰性图标一律 aria-hidden，避免读屏重复朗读；图标按钮的 aria-label 由调用方提供。
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** 目的地 */
export const PinIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 21.4c3.9-3.7 6.6-6.9 6.6-10.4a6.6 6.6 0 1 0-13.2 0c0 3.5 2.7 6.7 6.6 10.4Z" />
    <circle cx="12" cy="10.8" r="2.5" />
  </Icon>
);

/** 出行日期 */
export const CalendarIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3.6" y="5.2" width="16.8" height="15.2" rx="3.2" />
    <path d="M8 3.2v3.6M16 3.2v3.6M3.6 10.2h16.8" />
    <path d="m9 15.4 1.9 1.9 3.6-3.8" />
  </Icon>
);

/** 节奏与同行 */
export const GaugeIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 13.6 15.4 8" />
    <circle cx="12" cy="14.6" r="1.5" />
  </Icon>
);

/** 偏好与出行 */
export const ScissorsIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="6.4" cy="6.6" r="2.4" />
    <circle cx="6.4" cy="17.4" r="2.4" />
    <path d="M8.6 7.9 19.4 17.4M8.6 16.1 19.4 6.6" />
  </Icon>
);

/** 提交（开始规划） */
export const CompassIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M20.4 3.6 3.8 11.2l6.4 2.3 2.4 6.4Z" />
  </Icon>
);

/** 面板底栏的已选摘要 */
export const ClockIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2V12l3.2 2" />
  </Icon>
);

export const CloseIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
  </Icon>
);

export const ChevronDownIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
);

export const ChevronUpIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m6 14.5 6-6 6 6" />
  </Icon>
);

/** 地图缩放胶囊 */
export const PlusIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 5.2v13.6M5.2 12h13.6" />
  </Icon>
);

export const MinusIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M5.2 12h13.6" />
  </Icon>
);

export const ResetIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2" />
  </Icon>
);

