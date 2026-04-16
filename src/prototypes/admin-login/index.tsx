import '../from-zero-start/style.css';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Action, AxureHandle, AxureProps, ConfigItem, DataDesc, EventItem, KeyDesc } from '../../common/axure-types';

const EVENT_LIST: EventItem[] = [];

const ACTION_LIST: Action[] = [];

const VAR_LIST: KeyDesc[] = [];

const CONFIG_LIST: ConfigItem[] = [];

const DATA_LIST: DataDesc[] = [];

type AdminProfile = {
  adminId: string;
  phone: string;
  isSuperadmin: boolean;
  isEnabled: boolean;
  permissionScope: string;
  lastLoginAt: string | null;
  createdAt: string;
};

type UserRow = {
  userId: string;
  phone: string;
  registeredAt: string;
  isEnabled: boolean;
};

function mapAdminLoginError(res: Response, json: any): string {
  const code = typeof json?.code === 'string' ? json.code : '';
  if (code === 'INVALID_CREDENTIALS') return '手机号或密码错误';
  if (code === 'DB_UNAVAILABLE') return '服务暂不可用，请稍后重试';
  if (code === 'PHONE_REQUIRED') return '手机号不能为空';
  if (code === 'PHONE_INVALID') return '手机号格式不正确（中国大陆 11 位）';
  if (code === 'PASSWORD_REQUIRED') return '密码不能为空';
  if (res.status >= 500) return '服务异常，请稍后重试';
  return typeof json?.message === 'string' && json.message ? json.message : '登录失败';
}

function mapAdminApiError(res: Response, json: any, fallback: string): string {
  if (res.status === 404 && json?.message === 'not_found') return '接口不存在（后端可能未更新或 /api 未正确代理）';
  if (typeof json?.message === 'string' && json.message) return json.message;
  return fallback;
}

const Component = React.forwardRef<AxureHandle, AxureProps>(function AdminLogin(innerProps, ref) {
  const [navId, setNavId] = useState<'users' | 'admins'>('users');
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersPage, setUsersPage] = useState<number>(1);
  const [usersPageSize, setUsersPageSize] = useState<number>(20);
  const [usersTotal, setUsersTotal] = useState<number>(0);
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [panelBusy, setPanelBusy] = useState<boolean>(false);

  const apiBaseUrl = useMemo(function () {
    const configured = (innerProps?.config && typeof (innerProps.config as any).apiBaseUrl === 'string')
      ? (innerProps.config as any).apiBaseUrl
      : '';

    if (configured) return configured.replace(/\/$/, '');

    const envApiBase = typeof import.meta !== 'undefined' && (import.meta as any).env
      ? ((import.meta as any).env.VITE_API_BASE_URL as string | undefined)
      : undefined;
    if (typeof envApiBase === 'string' && envApiBase.trim()) return envApiBase.trim().replace(/\/$/, '');

    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      return isLocal ? 'http://localhost:32123' : '';
    }

    return '';
  }, [innerProps?.config]);

  const fetchJson = useCallback(async function (path: string, options?: RequestInit) {
    const normalizedBase = apiBaseUrl.replace(/\/$/, '');
    const normalizedPath = normalizedBase.endsWith('/api') && path.startsWith('/api/')
      ? path.replace(/^\/api/, '')
      : path;

    const res = await fetch(`${normalizedBase}${normalizedPath}`, {
      credentials: 'include',
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  }, [apiBaseUrl]);

  const loadMe = useCallback(async function () {
    try {
      const { res, json } = await fetchJson('/api/admin/auth/me', { method: 'GET' });
      if (res.ok && json?.success && json?.admin) {
        setAdmin(json.admin);
        return;
      }
      if (res.status === 401) {
        const refreshed = await fetchJson('/api/admin/auth/refresh', { method: 'POST', body: '{}' });
        if (refreshed.res.ok && refreshed.json?.success) {
          const retry = await fetchJson('/api/admin/auth/me', { method: 'GET' });
          if (retry.res.ok && retry.json?.success && retry.json?.admin) {
            setAdmin(retry.json.admin);
            return;
          }
        }
        setAdmin(null);
      }
    } catch {}
  }, [fetchJson]);

  const submit = useCallback(async function () {
    const trimmedPhone = phone.trim().replace(/[\s-]/g, '').replace(/^\+?86/, '');
    const pwd = password;

    if (!trimmedPhone) {
      setError('请输入手机号');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      setError('手机号格式不正确（中国大陆 11 位）');
      return;
    }
    if (!pwd) {
      setError('请输入密码');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ phone: trimmedPhone, password: pwd }) });
      if (!res.ok || !json?.success) {
        setError(mapAdminLoginError(res, json));
        return;
      }
      setAdmin(json.admin);
      setPassword('');
      setError('');
    } catch (e: any) {
      setError(e?.message || '网络错误');
    } finally {
      setBusy(false);
    }
  }, [fetchJson, password, phone]);

  const logout = useCallback(async function () {
    try {
      await fetchJson('/api/admin/auth/logout', { method: 'POST', body: '{}' });
    } catch {}
    setAdmin(null);
  }, [fetchJson]);

  const loadUsers = useCallback(async function (page: number, pageSize: number) {
    const qp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const { res, json } = await fetchJson(`/api/admin/users?${qp.toString()}`, { method: 'GET' });
    if (res.ok && json?.success && Array.isArray(json.users)) {
      setUsers(json.users);
      setUsersPage(typeof json?.page === 'number' ? json.page : page);
      setUsersPageSize(typeof json?.pageSize === 'number' ? json.pageSize : pageSize);
      setUsersTotal(typeof json?.total === 'number' ? json.total : 0);
      return;
    }
    throw new Error(mapAdminApiError(res, json, '加载用户失败'));
  }, [fetchJson]);

  const loadAdmins = useCallback(async function () {
    const { res, json } = await fetchJson('/api/admin/admin-users', { method: 'GET' });
    if (res.ok && json?.success && Array.isArray(json.admins)) {
      setAdmins(json.admins);
      return;
    }
    throw new Error(mapAdminApiError(res, json, '加载管理员失败'));
  }, [fetchJson]);

  const refreshPanel = useCallback(async function (target: 'users' | 'admins') {
    if (!admin) return;
    setPanelBusy(true);
    setError('');
    try {
      if (target === 'users') await loadUsers(usersPage, usersPageSize);
      if (target === 'admins') await loadAdmins();
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setPanelBusy(false);
    }
  }, [admin, loadAdmins, loadUsers, usersPage, usersPageSize]);

  const goUsersPage = useCallback(async function (nextPage: number) {
    if (!admin) return;
    setPanelBusy(true);
    setError('');
    try {
      await loadUsers(nextPage, usersPageSize);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setPanelBusy(false);
    }
  }, [admin, loadUsers, usersPageSize]);

  const changeUsersPageSize = useCallback(async function (nextPageSize: number) {
    if (!admin) return;
    setPanelBusy(true);
    setError('');
    try {
      await loadUsers(1, nextPageSize);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setPanelBusy(false);
    }
  }, [admin, loadUsers]);

  const toggleUserEnabled = useCallback(async function (target: UserRow) {
    setPanelBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/users/status', {
        method: 'POST',
        body: JSON.stringify({ userId: target.userId, isEnabled: !target.isEnabled }),
      });
      if (!res.ok || !json?.success) throw new Error(json?.message || '操作失败');
      await loadUsers(usersPage, usersPageSize);
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setPanelBusy(false);
    }
  }, [fetchJson, loadUsers, usersPage, usersPageSize]);

  const toggleAdminEnabled = useCallback(async function (target: AdminProfile) {
    setPanelBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/admin-users/status', {
        method: 'POST',
        body: JSON.stringify({ adminId: target.adminId, isEnabled: !target.isEnabled }),
      });
      if (!res.ok || !json?.success) throw new Error(json?.message || '操作失败');
      await loadAdmins();
      await loadMe();
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setPanelBusy(false);
    }
  }, [fetchJson, loadAdmins, loadMe]);

  const cyclePermission = useCallback(async function (target: AdminProfile) {
    const scopes = ['basic', 'operator', 'manager'];
    const currentIndex = scopes.indexOf(target.permissionScope || 'basic');
    const nextScope = scopes[(currentIndex + 1) % scopes.length];
    setPanelBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/admin-users/permission', {
        method: 'POST',
        body: JSON.stringify({ adminId: target.adminId, permissionScope: nextScope }),
      });
      if (!res.ok || !json?.success) throw new Error(json?.message || '操作失败');
      await loadAdmins();
      await loadMe();
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setPanelBusy(false);
    }
  }, [fetchJson, loadAdmins, loadMe]);

  const toggleSuperadmin = useCallback(async function (target: AdminProfile) {
    setPanelBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/admin-users/permission', {
        method: 'POST',
        body: JSON.stringify({ adminId: target.adminId, permissionScope: target.permissionScope || 'basic', isSuperadmin: !target.isSuperadmin }),
      });
      if (!res.ok || !json?.success) throw new Error(json?.message || '操作失败');
      await loadAdmins();
      await loadMe();
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setPanelBusy(false);
    }
  }, [fetchJson, loadAdmins, loadMe]);

  const backToUser = useCallback(function () {
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    window.location.href = isLocal ? '/prototypes/from-zero-start' : '/prototypes/from-zero-start.html';
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!admin) return;
    void refreshPanel(navId);
  }, [admin, navId, refreshPanel]);

  React.useImperativeHandle(ref, function () {
    return {
      getVar: function () {
        return undefined;
      },
      fireAction: function () {
        return undefined;
      },
      eventList: EVENT_LIST,
      actionList: ACTION_LIST,
      varList: VAR_LIST,
      configList: CONFIG_LIST,
      dataList: DATA_LIST,
    };
  }, []);

  if (admin) {
    const usersTotalPages = Math.max(1, Math.ceil(usersTotal / usersPageSize));
    const canUsersPrev = usersPage > 1;
    const canUsersNext = usersPage < usersTotalPages;

    return (
      <div className="fzs-app-root fzs-admin-root">
        <aside className="fzs-side fzs-admin-side">
          <div className="fzs-side-top">
            <div className="fzs-side-brand">
              <div className="fzs-auth-logo">ADM</div>
              <div className="fzs-side-brand-text">
                <div className="fzs-side-title">管理后台</div>
                <div className="fzs-side-subtitle">Admin Console</div>
              </div>
            </div>
          </div>
          <nav className="fzs-side-nav" aria-label="管理员导航">
            <button className={navId === 'users' ? 'fzs-nav-item active' : 'fzs-nav-item'} type="button" onClick={() => setNavId('users')}>
              <div className="fzs-nav-label">用户管理</div>
              <div className="fzs-nav-desc">管理 user 表账号状态</div>
            </button>
            <button className={navId === 'admins' ? 'fzs-nav-item active' : 'fzs-nav-item'} type="button" onClick={() => setNavId('admins')}>
              <div className="fzs-nav-label">管理员</div>
              <div className="fzs-nav-desc">管理 admin_user 状态与权限</div>
            </button>
          </nav>
        </aside>

        <div className="fzs-main">
          <header className="fzs-main-topbar fzs-admin-topbar">
            <div className="fzs-main-title">
              <div className="fzs-main-title-text">{navId === 'users' ? '用户管理' : '管理员'}</div>
              <div className="fzs-main-title-sub">{admin.phone}{admin.isSuperadmin ? '（超管）' : ''}</div>
            </div>
            <div className="fzs-user-area">
              <button className="fzs-admin-entry" type="button" onClick={backToUser}>返回用户登录</button>
              <button className="fzs-primary-button dark" type="button" onClick={logout}>退出管理员</button>
            </div>
          </header>

          <main className="fzs-main-content">
            <div className="fzs-panel fzs-admin-panel">
              <div className="fzs-panel-head">
                <div className="fzs-panel-head-left">
                  <div className="fzs-panel-title">{navId === 'users' ? '用户管理' : '管理员管理'}</div>
                  <div className="fzs-panel-desc">{navId === 'users' ? '可启用/停用普通用户，停用后不可登录' : '可启用/停用管理员，并设置权限范围'}</div>
                </div>
                <button className="fzs-primary-button dark" type="button" onClick={() => void refreshPanel(navId)} disabled={panelBusy}>
                  {panelBusy ? '刷新中...' : '刷新'}
                </button>
              </div>

              <div className="fzs-panel-body">
                {error && <div className="fzs-error">{error}</div>}

                {navId === 'users' && (
                  <div className="fzs-admin-table users">
                    <div className="fzs-admin-pager">
                      <div className="fzs-admin-pager-left">
                        <span>共 {usersTotal} 条</span>
                        <span>第 {usersPage}/{usersTotalPages} 页</span>
                      </div>
                      <div className="fzs-admin-actions">
                        <select className="fzs-admin-select" value={usersPageSize} onChange={(e) => void changeUsersPageSize(Number(e.target.value))} disabled={panelBusy}>
                          <option value={20}>20/页</option>
                          <option value={50}>50/页</option>
                          <option value={100}>100/页</option>
                        </select>
                        <button className="fzs-admin-mini" type="button" onClick={() => void goUsersPage(usersPage - 1)} disabled={panelBusy || !canUsersPrev}>
                          上一页
                        </button>
                        <button className="fzs-admin-mini" type="button" onClick={() => void goUsersPage(usersPage + 1)} disabled={panelBusy || !canUsersNext}>
                          下一页
                        </button>
                      </div>
                    </div>
                    <div className="fzs-admin-row header">
                      <div>手机号</div><div>注册时间</div><div>状态</div><div>操作</div>
                    </div>
                    {users.map((u) => (
                      <div key={u.userId} className="fzs-admin-row">
                        <div>{u.phone}</div>
                        <div>{u.registeredAt}</div>
                        <div>{u.isEnabled ? '启用' : '停用'}</div>
                        <div>
                          <button className="fzs-admin-mini" type="button" onClick={() => void toggleUserEnabled(u)} disabled={panelBusy}>
                            {u.isEnabled ? '停用' : '启用'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {navId === 'admins' && (
                  <div className="fzs-admin-table admins">
                    <div className="fzs-admin-row header">
                      <div>手机号</div><div>角色</div><div>权限范围</div><div>状态</div><div>操作</div>
                    </div>
                    {admins.map((a) => (
                      <div key={a.adminId} className="fzs-admin-row">
                        <div>{a.phone}</div>
                        <div>{a.isSuperadmin ? '超管' : '管理员'}</div>
                        <div>{a.permissionScope || 'basic'}</div>
                        <div>{a.isEnabled ? '启用' : '停用'}</div>
                        <div className="fzs-admin-actions">
                          <button className="fzs-admin-mini" type="button" onClick={() => void toggleAdminEnabled(a)} disabled={panelBusy}>
                            {a.isEnabled ? '停用' : '启用'}
                          </button>
                          <button className="fzs-admin-mini" type="button" onClick={() => void cyclePermission(a)} disabled={panelBusy}>
                            切换权限
                          </button>
                          <button className="fzs-admin-mini" type="button" onClick={() => void toggleSuperadmin(a)} disabled={panelBusy}>
                            {a.isSuperadmin ? '降级超管' : '升为超管'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="fzs-auth-root fzs-admin-auth-root">
      <div className="fzs-auth-bg">
        <div className="fzs-auth-orb a" />
        <div className="fzs-auth-orb b" />
        <div className="fzs-auth-grid" />
      </div>

      <div className="fzs-auth-card">
        <div className="fzs-auth-brand">
          <div className="fzs-auth-logo">FZS</div>
          <div className="fzs-auth-title">管理员登录</div>
          <div className="fzs-auth-subtitle">Admin Access</div>
        </div>

        <div className="fzs-auth-form">
          <div className="fzs-field">
            <div className="fzs-label">手机号</div>
            <input className="fzs-input dark" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="请输入手机号" />
          </div>
          <div className="fzs-field">
            <div className="fzs-label">密码</div>
            <input className="fzs-input dark" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" type="password" />
          </div>
          {error && <div className="fzs-error">{error}</div>}
          <button className="fzs-auth-submit" type="button" onClick={submit} disabled={busy}>
            {busy ? '登录中...' : '登录'}
          </button>
        </div>

        <div className="fzs-auth-foot">
          <div className="fzs-auth-hint">仅管理员可登录，不支持注册。</div>
          <button className="fzs-admin-entry" type="button" onClick={backToUser}>返回用户登录</button>
        </div>
      </div>
    </div>
  );
});

export default Component;
