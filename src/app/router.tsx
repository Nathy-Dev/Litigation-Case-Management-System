import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { ComponentType } from 'react';
import type { Permission } from '@/types';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth, RequirePermission } from './guards';

// The first screens a reviewer sees are bundled eagerly; everything else is a
// separate chunk fetched on first navigation, so the initial load stays small.
import { SignInPage } from '@/features/auth/SignInPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { CaseListPage } from '@/features/cases/CaseListPage';

/**
 * Builds a React Router `lazy` loader that code-splits a page and keeps its
 * permission gate. The module is fetched once and cached by the router.
 */
function page(
  load: () => Promise<Record<string, unknown>>,
  name: string,
  anyOf?: Permission[],
) {
  return async () => {
    const module = await load();
    const Page = module[name] as ComponentType;
    if (!anyOf) return { Component: Page };
    return {
      Component: () => (
        <RequirePermission anyOf={anyOf}>
          <Page />
        </RequirePermission>
      ),
    };
  };
}

const CASE_VIEW: Permission[] = ['case.view.all', 'case.view.assigned'];

export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignInPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },

      {
        path: 'cases',
        element: (
          <RequirePermission anyOf={CASE_VIEW}>
            <CaseListPage />
          </RequirePermission>
        ),
      },
      {
        path: 'cases/new',
        lazy: page(() => import('@/features/cases/CaseFormPage'), 'CaseFormPage', ['case.create']),
      },
      {
        path: 'cases/:caseId',
        lazy: page(() => import('@/features/cases/CaseDetailPage'), 'CaseDetailPage', CASE_VIEW),
      },
      {
        path: 'cases/:caseId/edit',
        lazy: page(() => import('@/features/cases/CaseFormPage'), 'CaseFormPage', ['case.edit']),
      },

      {
        path: 'calendar',
        lazy: page(() => import('@/features/calendar/CalendarPage'), 'CalendarPage', ['courtdate.view']),
      },
      {
        path: 'documents',
        lazy: page(() => import('@/features/documents/DocumentsPage'), 'DocumentsPage', ['document.view']),
      },
      {
        path: 'tasks',
        lazy: page(() => import('@/features/tasks/TasksPage'), 'TasksPage', ['task.view']),
      },
      {
        path: 'reports',
        lazy: page(() => import('@/features/reports/ReportsPage'), 'ReportsPage', ['report.view']),
      },
      {
        path: 'reports/builder',
        lazy: page(
          () => import('@/features/reports/ReportBuilderPage'),
          'ReportBuilderPage',
          ['report.build'],
        ),
      },

      {
        path: 'admin',
        lazy: page(() => import('@/features/admin/AdminLayout'), 'AdminLayout', [
          'user.manage',
          'user.view',
          'role.manage',
          'config.manage',
          'audit.view',
          'system.manage',
        ]),
        children: [
          { index: true, element: <Navigate to="/admin/users" replace /> },
          {
            path: 'users',
            lazy: page(() => import('@/features/admin/AdminUsersPage'), 'AdminUsersPage'),
          },
          {
            path: 'roles',
            lazy: page(() => import('@/features/admin/AdminRolesPage'), 'AdminRolesPage'),
          },
          {
            path: 'configuration',
            lazy: page(() => import('@/features/admin/AdminConfigPage'), 'AdminConfigPage'),
          },
          {
            path: 'audit',
            lazy: page(() => import('@/features/admin/AdminAuditPage'), 'AdminAuditPage'),
          },
          {
            path: 'system',
            lazy: page(() => import('@/features/admin/AdminSystemPage'), 'AdminSystemPage'),
          },
        ],
      },

      {
        path: 'notifications',
        lazy: page(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage'),
      },
      { path: 'profile', lazy: page(() => import('@/features/profile/ProfilePage'), 'ProfilePage') },
      {
        path: 'search',
        lazy: page(() => import('@/features/search/SearchResultsPage'), 'SearchResultsPage'),
      },
      { path: '*', lazy: page(() => import('@/features/search/NotFoundPage'), 'NotFoundPage') },
    ],
  },
]);
