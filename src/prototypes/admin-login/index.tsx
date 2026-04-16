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

type ProductServiceTypeRow = {
  typeId: string;
  name: string;
  wbsCode: string;
  createdAt: string;
};

type ProductServiceRow = {
  serviceId: string;
  typeId: string;
  name: string;
  wbsCode: string;
  description: string;
  referenceWeeks: number;
  ownerText: string;
  isEnabled: boolean;
  createdAt: string;
};

const ADMIN_NAV_ITEMS: Array<{ id: 'customers' | 'products' | 'users' | 'admins'; label: string; desc: string }> = [
  { id: 'customers', label: '客户管理', desc: '客户与线索（待定义）' },
  { id: 'products', label: '产品和服务管理', desc: '产品、服务与配置（待定义）' },
  { id: 'users', label: '用户管理', desc: '管理 user 表账号状态' },
  { id: 'admins', label: '管理员', desc: '管理 admin_user 状态与权限' },
];

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
  const [navId, setNavId] = useState<'customers' | 'products' | 'users' | 'admins'>('users');
  const [productsTabId, setProductsTabId] = useState<'services' | 'types'>('services');
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
  const [productServiceTypes, setProductServiceTypes] = useState<ProductServiceTypeRow[]>([]);
  const [productServices, setProductServices] = useState<ProductServiceRow[]>([]);
  const [serviceModalOpen, setServiceModalOpen] = useState<boolean>(false);
  const [serviceModalMode, setServiceModalMode] = useState<'create' | 'edit'>('create');
  const [serviceModalBusy, setServiceModalBusy] = useState<boolean>(false);
  const [serviceIdEditing, setServiceIdEditing] = useState<string>('');
  const [serviceTypeId, setServiceTypeId] = useState<string>('');
  const [serviceName, setServiceName] = useState<string>('');
  const [serviceWbsCode, setServiceWbsCode] = useState<string>('');
  const [serviceDescription, setServiceDescription] = useState<string>('');
  const [serviceReferenceWeeks, setServiceReferenceWeeks] = useState<string>('0');
  const [serviceOwnerText, setServiceOwnerText] = useState<string>('');
  const [serviceIsEnabled, setServiceIsEnabled] = useState<boolean>(true);
  const [typeModalOpen, setTypeModalOpen] = useState<boolean>(false);
  const [typeModalMode, setTypeModalMode] = useState<'create' | 'edit'>('create');
  const [typeModalBusy, setTypeModalBusy] = useState<boolean>(false);
  const [typeIdEditing, setTypeIdEditing] = useState<string>('');
  const [typeName, setTypeName] = useState<string>('');
  const [typeWbsCode, setTypeWbsCode] = useState<string>('');
  const [panelBusy, setPanelBusy] = useState<boolean>(false);
  const [createAdminOpen, setCreateAdminOpen] = useState<boolean>(false);
  const [createAdminPhone, setCreateAdminPhone] = useState<string>('');
  const [createAdminPassword, setCreateAdminPassword] = useState<string>('');
  const [createAdminBusy, setCreateAdminBusy] = useState<boolean>(false);

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

  const loadProductServiceTypes = useCallback(async function () {
    const { res, json } = await fetchJson('/api/admin/product-service-types', { method: 'GET' });
    if (res.ok && json?.success && Array.isArray(json.types)) {
      setProductServiceTypes(json.types);
      return;
    }
    throw new Error(mapAdminApiError(res, json, '加载产品服务类型失败'));
  }, [fetchJson]);

  const loadProductServices = useCallback(async function () {
    const { res, json } = await fetchJson('/api/admin/product-services', { method: 'GET' });
    if (res.ok && json?.success && Array.isArray(json.services)) {
      setProductServices(json.services);
      return;
    }
    throw new Error(mapAdminApiError(res, json, '加载产品服务失败'));
  }, [fetchJson]);

  const refreshPanel = useCallback(async function (target: 'customers' | 'products' | 'users' | 'admins') {
    if (!admin) return;
    setPanelBusy(true);
    setError('');
    try {
      if (target === 'users') await loadUsers(usersPage, usersPageSize);
      if (target === 'admins') await loadAdmins();
      if (target === 'products' && productsTabId === 'types') await loadProductServiceTypes();
      if (target === 'products' && productsTabId === 'services') {
        await Promise.all([loadProductServices(), loadProductServiceTypes()]);
      }
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setPanelBusy(false);
    }
  }, [admin, loadAdmins, loadProductServiceTypes, loadProductServices, loadUsers, productsTabId, usersPage, usersPageSize]);

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

  const openCreateType = useCallback(function () {
    setTypeModalMode('create');
    setTypeIdEditing('');
    setTypeName('');
    setTypeWbsCode('');
    setTypeModalOpen(true);
  }, []);

  const openEditType = useCallback(function (row: ProductServiceTypeRow) {
    setTypeModalMode('edit');
    setTypeIdEditing(row.typeId);
    setTypeName(row.name);
    setTypeWbsCode(row.wbsCode || '');
    setTypeModalOpen(true);
  }, []);

  const openCreateService = useCallback(async function () {
    setServiceModalMode('create');
    setServiceIdEditing('');
    setServiceTypeId('');
    setServiceName('');
    setServiceWbsCode('');
    setServiceDescription('');
    setServiceReferenceWeeks('0');
    setServiceOwnerText('');
    setServiceIsEnabled(true);
    setServiceModalOpen(true);
    try {
      await loadProductServiceTypes();
    } catch {}
  }, [loadProductServiceTypes]);

  const openEditService = useCallback(async function (row: ProductServiceRow) {
    setServiceModalMode('edit');
    setServiceIdEditing(row.serviceId);
    setServiceTypeId(row.typeId || '');
    setServiceName(row.name);
    setServiceWbsCode(row.wbsCode);
    setServiceDescription(row.description || '');
    setServiceReferenceWeeks(String(row.referenceWeeks ?? 0));
    setServiceOwnerText(row.ownerText || '');
    setServiceIsEnabled(Boolean(row.isEnabled));
    setServiceModalOpen(true);
    try {
      await loadProductServiceTypes();
    } catch {}
  }, [loadProductServiceTypes]);

  const submitServiceModal = useCallback(async function () {
    const name = serviceName.trim();
    const wbsCode = serviceWbsCode.trim();
    const description = serviceDescription.trim();
    const ownerText = serviceOwnerText.trim();
    const referenceWeeks = Number.parseInt(serviceReferenceWeeks.trim() || '0', 10);

    if (!name) {
      setError('请输入产品服务名称');
      return;
    }
    if (name.length > 128) {
      setError('产品服务名称过长（最多 128 字符）');
      return;
    }
    if (!wbsCode) {
      setError('请输入WBS编码');
      return;
    }
    if (wbsCode.length > 64) {
      setError('WBS编码过长（最多 64 字符）');
      return;
    }
    if (!Number.isFinite(referenceWeeks) || referenceWeeks < 0) {
      setError('参考时间（周）不合法');
      return;
    }
    if (ownerText.length > 128) {
      setError('责任方过长（最多 128 字符）');
      return;
    }

    setServiceModalBusy(true);
    setError('');
    try {
      const payload = {
        typeId: serviceTypeId,
        name,
        wbsCode,
        description,
        referenceWeeks,
        ownerText,
        isEnabled: serviceIsEnabled,
      };

      if (serviceModalMode === 'create') {
        const { res, json } = await fetchJson('/api/admin/product-services/create', { method: 'POST', body: JSON.stringify(payload) });
        if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '添加失败'));
      } else {
        const { res, json } = await fetchJson('/api/admin/product-services/update', { method: 'POST', body: JSON.stringify({ serviceId: serviceIdEditing, ...payload }) });
        if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '保存失败'));
      }

      await loadProductServices();
      setServiceModalOpen(false);
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setServiceModalBusy(false);
    }
  }, [fetchJson, loadProductServices, serviceDescription, serviceIdEditing, serviceIsEnabled, serviceModalMode, serviceName, serviceOwnerText, serviceReferenceWeeks, serviceTypeId, serviceWbsCode]);

  const deleteService = useCallback(async function (row: ProductServiceRow) {
    if (!window.confirm(`确定删除产品服务「${row.name}」吗？`)) return;
    setPanelBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/product-services/delete', { method: 'POST', body: JSON.stringify({ serviceId: row.serviceId }) });
      if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '删除失败'));
      await loadProductServices();
    } catch (e: any) {
      setError(e?.message || '删除失败');
    } finally {
      setPanelBusy(false);
    }
  }, [fetchJson, loadProductServices]);
  const submitTypeModal = useCallback(async function () {
    const name = typeName.trim();
    const wbsCode = typeWbsCode.trim();
    if (!name) {
      setError('请输入类型名称');
      return;
    }
    if (name.length > 64) {
      setError('类型名称过长（最多 64 字符）');
      return;
    }
    if (wbsCode.length > 64) {
      setError('WBS代码过长（最多 64 字符）');
      return;
    }

    setTypeModalBusy(true);
    setError('');
    try {
      if (typeModalMode === 'create') {
        const { res, json } = await fetchJson('/api/admin/product-service-types/create', { method: 'POST', body: JSON.stringify({ name, wbsCode }) });
        if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '添加失败'));
      } else {
        const { res, json } = await fetchJson('/api/admin/product-service-types/update', { method: 'POST', body: JSON.stringify({ typeId: typeIdEditing, name, wbsCode }) });
        if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '保存失败'));
      }
      await loadProductServiceTypes();
      setTypeModalOpen(false);
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setTypeModalBusy(false);
    }
  }, [fetchJson, loadProductServiceTypes, typeIdEditing, typeModalMode, typeName, typeWbsCode]);

  const deleteType = useCallback(async function (row: ProductServiceTypeRow) {
    if (!window.confirm(`确定删除产品服务类型「${row.name}」吗？`)) return;
    setPanelBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/product-service-types/delete', { method: 'POST', body: JSON.stringify({ typeId: row.typeId }) });
      if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '删除失败'));
      await loadProductServiceTypes();
    } catch (e: any) {
      setError(e?.message || '删除失败');
    } finally {
      setPanelBusy(false);
    }
  }, [fetchJson, loadProductServiceTypes]);

  const submitCreateAdmin = useCallback(async function () {
    const trimmedPhone = createAdminPhone.trim().replace(/[\s-]/g, '').replace(/^\+?86/, '');
    const pwd = createAdminPassword;
    if (!trimmedPhone) {
      setError('请输入管理员手机号');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      setError('手机号格式不正确（中国大陆 11 位）');
      return;
    }
    if (!pwd || pwd.length < 6) {
      setError('密码至少 6 位');
      return;
    }

    setCreateAdminBusy(true);
    setError('');
    try {
      const { res, json } = await fetchJson('/api/admin/admin-users/create', {
        method: 'POST',
        body: JSON.stringify({ phone: trimmedPhone, password: pwd }),
      });
      if (!res.ok || !json?.success) throw new Error(mapAdminApiError(res, json, '添加管理员失败'));
      setCreateAdminOpen(false);
      setCreateAdminPhone('');
      setCreateAdminPassword('');
      await loadAdmins();
    } catch (e: any) {
      setError(e?.message || '添加管理员失败');
    } finally {
      setCreateAdminBusy(false);
    }
  }, [createAdminPassword, createAdminPhone, fetchJson, loadAdmins]);

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
    const activeNav = ADMIN_NAV_ITEMS.find((x) => x.id === navId) ?? ADMIN_NAV_ITEMS[0];
    const typeNameById = new Map(productServiceTypes.map((t) => [t.typeId, t.name] as const));

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
            {ADMIN_NAV_ITEMS.map((item) => (
              <button key={item.id} className={navId === item.id ? 'fzs-nav-item active' : 'fzs-nav-item'} type="button" onClick={() => setNavId(item.id)}>
                <div className="fzs-nav-label">{item.label}</div>
                <div className="fzs-nav-desc">{item.desc}</div>
              </button>
            ))}
          </nav>
        </aside>

        <div className="fzs-main">
          <header className="fzs-main-topbar fzs-admin-topbar">
            <div className="fzs-main-title">
              <div className="fzs-main-title-text">{activeNav.label}</div>
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
                  <div className="fzs-panel-title">{activeNav.label}</div>
                  <div className="fzs-panel-desc">{activeNav.desc}</div>
                  {navId === 'products' && (
                    <div className="fzs-admin-tabs" role="tablist" aria-label="产品和服务管理">
                      <button
                        className={productsTabId === 'services' ? 'fzs-admin-tab active' : 'fzs-admin-tab'}
                        type="button"
                        role="tab"
                        aria-selected={productsTabId === 'services'}
                        onClick={() => setProductsTabId('services')}
                      >
                        产品服务
                      </button>
                      <button
                        className={productsTabId === 'types' ? 'fzs-admin-tab active' : 'fzs-admin-tab'}
                        type="button"
                        role="tab"
                        aria-selected={productsTabId === 'types'}
                        onClick={() => setProductsTabId('types')}
                      >
                        产品服务类型
                      </button>
                    </div>
                  )}
                </div>
                <div className="fzs-admin-actions">
                  {navId === 'admins' && admin.isSuperadmin && (
                    <button className="fzs-primary-button dark" type="button" onClick={() => setCreateAdminOpen(true)} disabled={panelBusy}>
                      添加管理员
                    </button>
                  )}
                  {navId === 'products' && productsTabId === 'services' && (
                    <button className="fzs-primary-button dark" type="button" onClick={() => void openCreateService()} disabled={panelBusy}>
                      添加产品服务
                    </button>
                  )}
                  {navId === 'products' && productsTabId === 'types' && (
                    <button className="fzs-primary-button dark" type="button" onClick={openCreateType} disabled={panelBusy}>
                      添加类型
                    </button>
                  )}
                  <button className="fzs-primary-button dark" type="button" onClick={() => void refreshPanel(navId)} disabled={panelBusy}>
                    {panelBusy ? '刷新中...' : '刷新'}
                  </button>
                </div>
              </div>

              <div className="fzs-panel-body">
                {error && <div className="fzs-error">{error}</div>}

                {navId === 'customers' && (
                  <div className="fzs-empty-block">
                    <div className="fzs-empty-title">客户管理</div>
                    <div className="fzs-empty-desc">内容区域待你定义接入。</div>
                  </div>
                )}

                {navId === 'products' && (
                  <>
                    {productsTabId === 'services' && (
                      <div className="fzs-admin-table psservices">
                        <div className="fzs-admin-row header">
                          <div>ID</div><div>产品服务名称</div><div>WBS编码</div><div>类型</div><div>参考时间（周）</div><div>状态</div><div>操作</div>
                        </div>
                        {productServices.map((s) => (
                          <div key={s.serviceId} className="fzs-admin-row">
                            <div>{s.serviceId}</div>
                            <div>{s.name}</div>
                            <div>{s.wbsCode}</div>
                            <div>{s.typeId ? (typeNameById.get(s.typeId) || s.typeId) : '-'}</div>
                            <div>{s.referenceWeeks}</div>
                            <div>{s.isEnabled ? '启用' : '停用'}</div>
                            <div className="fzs-admin-actions">
                              <button className="fzs-admin-mini" type="button" onClick={() => void openEditService(s)} disabled={panelBusy}>
                                编辑
                              </button>
                              <button className="fzs-admin-mini" type="button" onClick={() => void deleteService(s)} disabled={panelBusy}>
                                删除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {productsTabId === 'types' && (
                      <div className="fzs-admin-table pstypes">
                        <div className="fzs-admin-row header">
                          <div>ID</div><div>名称</div><div>WBS代码</div><div>创建时间</div><div>操作</div>
                        </div>
                        {productServiceTypes.map((t) => (
                          <div key={t.typeId} className="fzs-admin-row">
                            <div>{t.typeId}</div>
                            <div>{t.name}</div>
                            <div>{t.wbsCode || '-'}</div>
                            <div>{t.createdAt}</div>
                            <div className="fzs-admin-actions">
                              <button className="fzs-admin-mini" type="button" onClick={() => openEditType(t)} disabled={panelBusy}>
                                编辑
                              </button>
                              <button className="fzs-admin-mini" type="button" onClick={() => void deleteType(t)} disabled={panelBusy}>
                                删除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

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
        {createAdminOpen && (
          <div className="fzs-modal-backdrop fzs-admin-modal-backdrop" role="dialog" aria-modal="true">
            <div className="fzs-modal fzs-admin-modal">
              <div className="fzs-modal-header">
                <div className="fzs-modal-title">添加管理员</div>
                <button className="fzs-modal-close" type="button" onClick={() => setCreateAdminOpen(false)} disabled={createAdminBusy}>×</button>
              </div>
              <div className="fzs-modal-body">
                <div className="fzs-field">
                  <div className="fzs-label">管理员手机号</div>
                  <input className="fzs-input dark" value={createAdminPhone} onChange={(e) => setCreateAdminPhone(e.target.value)} placeholder="请输入手机号" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">密码</div>
                  <input className="fzs-input dark" value={createAdminPassword} onChange={(e) => setCreateAdminPassword(e.target.value)} placeholder="请输入密码（至少 6 位）" type="password" />
                </div>
              </div>
              <div className="fzs-modal-footer">
                <button className="fzs-admin-mini" type="button" onClick={() => setCreateAdminOpen(false)} disabled={createAdminBusy}>取消</button>
                <button className="fzs-primary-button dark" type="button" onClick={() => void submitCreateAdmin()} disabled={createAdminBusy}>
                  {createAdminBusy ? '添加中...' : '确认添加'}
                </button>
              </div>
            </div>
          </div>
        )}
        {typeModalOpen && (
          <div className="fzs-modal-backdrop fzs-admin-modal-backdrop" role="dialog" aria-modal="true">
            <div className="fzs-modal fzs-admin-modal">
              <div className="fzs-modal-header">
                <div className="fzs-modal-title">{typeModalMode === 'create' ? '添加产品服务类型' : '编辑产品服务类型'}</div>
                <button className="fzs-modal-close" type="button" onClick={() => setTypeModalOpen(false)} disabled={typeModalBusy}>×</button>
              </div>
              <div className="fzs-modal-body">
                <div className="fzs-field">
                  <div className="fzs-label">类型名称</div>
                  <input className="fzs-input dark" value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="请输入名称" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">WBS代码</div>
                  <input className="fzs-input dark" value={typeWbsCode} onChange={(e) => setTypeWbsCode(e.target.value)} placeholder="可重复" />
                </div>
              </div>
              <div className="fzs-modal-footer">
                <button className="fzs-admin-mini" type="button" onClick={() => setTypeModalOpen(false)} disabled={typeModalBusy}>取消</button>
                <button className="fzs-primary-button dark" type="button" onClick={() => void submitTypeModal()} disabled={typeModalBusy}>
                  {typeModalBusy ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
        {serviceModalOpen && (
          <div className="fzs-modal-backdrop fzs-admin-modal-backdrop" role="dialog" aria-modal="true">
            <div className="fzs-modal fzs-admin-modal">
              <div className="fzs-modal-header">
                <div className="fzs-modal-title">{serviceModalMode === 'create' ? '添加产品服务' : '编辑产品服务'}</div>
                <button className="fzs-modal-close" type="button" onClick={() => setServiceModalOpen(false)} disabled={serviceModalBusy}>×</button>
              </div>
              <div className="fzs-modal-body">
                <div className="fzs-field">
                  <div className="fzs-label">产品服务名称</div>
                  <input className="fzs-input dark" value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="请输入名称（不可重复）" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">WBS编码</div>
                  <input className="fzs-input dark" value={serviceWbsCode} onChange={(e) => setServiceWbsCode(e.target.value)} placeholder="请输入WBS编码（不可重复）" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">产品服务类型</div>
                  <select className="fzs-admin-select" value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
                    <option value="">未设置</option>
                    {productServiceTypes.map((t) => (
                      <option key={t.typeId} value={t.typeId}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">描述</div>
                  <input className="fzs-input dark" value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} placeholder="可选" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">参考时间（周）</div>
                  <input className="fzs-input dark" value={serviceReferenceWeeks} onChange={(e) => setServiceReferenceWeeks(e.target.value)} placeholder="例如：4" inputMode="numeric" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">责任方</div>
                  <input className="fzs-input dark" value={serviceOwnerText} onChange={(e) => setServiceOwnerText(e.target.value)} placeholder="仅文本描述" />
                </div>
                <div className="fzs-field">
                  <div className="fzs-label">启用状态</div>
                  <select className="fzs-admin-select" value={serviceIsEnabled ? '1' : '0'} onChange={(e) => setServiceIsEnabled(e.target.value === '1')}>
                    <option value="1">启用</option>
                    <option value="0">停用</option>
                  </select>
                </div>
              </div>
              <div className="fzs-modal-footer">
                <button className="fzs-admin-mini" type="button" onClick={() => setServiceModalOpen(false)} disabled={serviceModalBusy}>取消</button>
                <button className="fzs-primary-button dark" type="button" onClick={() => void submitServiceModal()} disabled={serviceModalBusy}>
                  {serviceModalBusy ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
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
