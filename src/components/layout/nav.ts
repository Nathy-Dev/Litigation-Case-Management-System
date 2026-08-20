import {
  Bell,
  CalendarDays,
  Cog,
  FileText,
  Folder,
  LayoutDashboard,
  ListChecks,
  PieChart,
  Scale,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Permission } from '@/types';

export interface NavItem {
  label: string;
  to: string;
  icon: typeof Scale;
  /** Any one of these grants access; omit for always-visible items. */
  permissions?: Permission[];
  /** Matches child routes for the active state. */
  match?: string;
}

/** Primary left navigation — the order is set by TOR §35. */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  {
    label: 'Cases',
    to: '/cases',
    icon: Folder,
    match: '/cases',
    permissions: ['case.view.all', 'case.view.assigned'],
  },
  { label: 'Calendar', to: '/calendar', icon: CalendarDays, permissions: ['courtdate.view'] },
  { label: 'Documents', to: '/documents', icon: FileText, permissions: ['document.view'] },
  { label: 'Tasks', to: '/tasks', icon: ListChecks, permissions: ['task.view'] },
  { label: 'Reports', to: '/reports', icon: PieChart, match: '/reports', permissions: ['report.view'] },
  {
    label: 'Admin',
    to: '/admin',
    icon: Cog,
    match: '/admin',
    permissions: ['user.manage', 'role.manage', 'config.manage', 'audit.view', 'system.manage'],
  },
];

/** Secondary items pinned below the divider. */
export const SECONDARY_NAV: NavItem[] = [
  { label: 'Notifications', to: '/notifications', icon: Bell },
];

export interface AdminSection {
  label: string;
  to: string;
  icon: typeof Scale;
  description: string;
  permissions: Permission[];
}

/** Tabs inside the admin panel — TOR §§26–31. */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    label: 'Users',
    to: '/admin/users',
    icon: Users,
    description: 'Accounts, invitations, bulk import and account status.',
    permissions: ['user.manage', 'user.view'],
  },
  {
    label: 'Roles & permissions',
    to: '/admin/roles',
    icon: ShieldCheck,
    description: 'Edit what each role may see and do.',
    permissions: ['role.manage'],
  },
  {
    label: 'Configuration',
    to: '/admin/configuration',
    icon: Cog,
    description: 'Case types, courts, document types, tags and the status flow.',
    permissions: ['config.manage'],
  },
  {
    label: 'Audit trail',
    to: '/admin/audit',
    icon: Scale,
    description: 'Every action, with user, timestamp and IP address.',
    permissions: ['audit.view'],
  },
  {
    label: 'System & backups',
    to: '/admin/system',
    icon: ShieldCheck,
    description: 'Storage, sessions, retention policy and backup history.',
    permissions: ['system.manage', 'retention.manage'],
  },
];
