/**
 * @name 从零开始
 */
import './style.css';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const NAV_ITEMS: Array<{ id: string; label: string; desc: string }> = [
  { id: 'dashboard', label: '仪表盘', desc: '概览与关键指标（占位）' },
  { id: 'customers', label: '客户管理', desc: '搜索企业并添加客户（单选）' },
  { id: 'projects', label: '项目管理', desc: '项目与资源（占位）' },
  { id: 'orders', label: '制单管理', desc: '制单与流程（占位）' },
  { id: 'products', label: '产品服务', desc: '产品与服务（占位）' },
  { id: 'analytics', label: '数据分析', desc: '报表与分析（占位）' },
  { id: 'settings', label: '系统设置', desc: '权限与配置（占位）' },
];

type ProductServicePublicRow = {
  name: string;
  wbsCode: string;
  description: string;
  referenceWeeks: number;
  ownerText: string;
  typeId: string;
  typeName: string;
};

type ProductServiceTypePublicRow = {
  typeId: string;
  name: string;
};

type CompanySearchResultRow = {
  keyNo: string;
  name: string;
  status: string;
  creditCode: string;
  regNo: string;
  operName: string;
  address: string;
  startDate: string;
};

type OrdersPaging = {
  pageSize: number;
  pageIndex: number;
  totalRecords: number;
};

type CustomerRow = {
  customerId: string;
  createdAt: string;
  source: string;
  sourceOrderNumber: string;
  company: CompanySearchResultRow;
  activeFollowupCount: number;
  activeProjectCount: number;
  signingProjectCount: number;
};

function App() {
  const [authTab, setAuthTab] = useState<'register' | 'login'>('login');
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [user, setUser] = useState<{ userId: string; phone: string; registeredAt: string } | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [userRegistrationEnabled, setUserRegistrationEnabled] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [navId, setNavId] = useState<string>('dashboard');
  const [productServices, setProductServices] = useState<ProductServicePublicRow[]>([]);
  const [productServiceTypes, setProductServiceTypes] = useState<ProductServiceTypePublicRow[]>([]);
  const [productServiceTypeSelected, setProductServiceTypeSelected] = useState<string>('all');
  const [productServicesBusy, setProductServicesBusy] = useState<boolean>(false);
  const [productServicesError, setProductServicesError] = useState<string>('');

  const [companyNameInput, setCompanyNameInput] = useState<string>('');
  const [companySearchBusy, setCompanySearchBusy] = useState<boolean>(false);
  const [companySearchError, setCompanySearchError] = useState<string>('');
  const [companySearchResults, setCompanySearchResults] = useState<CompanySearchResultRow[]>([]);
  const [companySearchPaging, setCompanySearchPaging] = useState<OrdersPaging | null>(null);
  const [companySearchOrderNumber, setCompanySearchOrderNumber] = useState<string>('');
  const [companySelectedKeyNo, setCompanySelectedKeyNo] = useState<string>('');

  const [customerRegisterOpen, setCustomerRegisterOpen] = useState<boolean>(false);

  const [ordersBusy, setOrdersBusy] = useState<boolean>(false);
  const [ordersError, setOrdersError] = useState<string>('');
  const [orders, setOrders] = useState<CustomerRow[]>([]);
  const [customersPage, setCustomersPage] = useState<number>(1);
  const [customersPageSize, setCustomersPageSize] = useState<number>(20);
  const [customersTotal, setCustomersTotal] = useState<number>(0);
  const [orderCreateBusy, setOrderCreateBusy] = useState<boolean>(false);
  const [orderCreateError, setOrderCreateError] = useState<string>('');

  const apiBaseUrl = useMemo(function () {
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
  }, []);

  const fetchJson = useCallback(async function (path: string, options?: RequestInit) {
    const normalizedBase = apiBaseUrl.replace(/\/$/, '');
    const normalizedPath = normalizedBase.endsWith('/api') && path.startsWith('/api/')
      ? path.replace(/^\/api/, '')
      : path;

    const canRetry = options?.body == null || typeof options?.body === 'string';
    const refreshable = path !== '/api/auth/refresh' && !path.startsWith('/api/auth/');

    async function requestOnce(requestPath: string, requestOptions?: RequestInit) {
      const normalizedRequestPath = normalizedBase.endsWith('/api') && requestPath.startsWith('/api/')
        ? requestPath.replace(/^\/api/, '')
        : requestPath;

      return fetch(`${normalizedBase}${normalizedRequestPath}`, {
        credentials: 'include',
        ...requestOptions,
        headers: {
          'content-type': 'application/json',
          ...(requestOptions?.headers || {}),
        },
      });
    }

    const res = await requestOnce(normalizedPath, options);
    if (res.status === 401 && canRetry && refreshable) {
      const refreshRes = await requestOnce('/api/auth/refresh', { method: 'POST', body: '{}' });
      const refreshJson = await refreshRes.json().catch(() => null);
      if (refreshRes.ok && refreshJson?.success) {
        const retryRes = await requestOnce(normalizedPath, options);
        const retryJson = await retryRes.json().catch(() => null);
        return { res: retryRes, json: retryJson };
      }
    }

    const json = await res.json().catch(() => null);
    return { res, json };
  }, [apiBaseUrl]);

  const customersTotalPages = useMemo(function () {
    return Math.max(1, Math.ceil(customersTotal / Math.max(1, customersPageSize)));
  }, [customersPageSize, customersTotal]);

  const loadOrders = useCallback(async function (targetPage?: number) {
    if (!user) return;
    const page = Math.max(1, targetPage || customersPage);
    setOrdersBusy(true);
    setOrdersError('');
    try {
      const { res, json } = await fetchJson(`/api/customers?page=${page}&pageSize=${customersPageSize}`, { method: 'GET' });
      if (!res.ok || !json?.success) {
        setOrdersError(json?.message || '获取客户失败');
        return;
      }
      const rows = Array.isArray(json.customers) ? json.customers : [];
      const normalized = rows.map((c: any) => ({
        customerId: c?.customerId || '',
        createdAt: c?.createdAt || '',
        company: c?.company || {},
        activeFollowupCount: Number(c?.activeFollowupCount || 0),
        activeProjectCount: Number(c?.activeProjectCount || 0),
        signingProjectCount: Number(c?.signingProjectCount || 0),
        source: c?.source || '',
        sourceOrderNumber: c?.sourceOrderNumber || '',
      }));
      setOrders(normalized);
      setCustomersTotal(Number(json?.paging?.total || 0));
      setCustomersPage(Number(json?.paging?.page || page));
    } catch (e: any) {
      setOrdersError(e?.message || '网络错误');
    } finally {
      setOrdersBusy(false);
    }
  }, [customersPage, customersPageSize, fetchJson, user]);

  const goCustomersPage = useCallback(async function (nextPage: number) {
    const safePage = Math.min(Math.max(1, nextPage), customersTotalPages);
    setCustomersPage(safePage);
    await loadOrders(safePage);
  }, [customersTotalPages, loadOrders]);

  const changeCustomersPageSize = useCallback(async function (nextSize: number) {
    setCustomersPageSize(nextSize);
    setCustomersPage(1);
    await loadOrders(1);
  }, [loadOrders]);

  const searchCompanies = useCallback(async function (pageIndex: number) {
    if (!user) return;
    const companyName = companyNameInput.trim();
    if (!companyName) {
      setCompanySearchError('请输入公司名称');
      return;
    }

    setCompanySearchBusy(true);
    setCompanySearchError('');
    setCompanySearchResults([]);
    setCompanySelectedKeyNo('');
    setCompanySearchOrderNumber('');
    try {
      const { res, json } = await fetchJson('/api/company-search', {
        method: 'POST',
        body: JSON.stringify({ companyName, pageSize: 10, pageIndex }),
      });
      if (!res.ok || !json) {
        setCompanySearchError('查询失败');
        return;
      }
      if (!json.success) {
        setCompanySearchError(json.message || '查询失败');
        return;
      }
      setCompanySearchResults(Array.isArray(json.results) ? json.results : []);
      setCompanySearchPaging(json.paging || null);
      setCompanySearchOrderNumber(typeof json.orderNumber === 'string' ? json.orderNumber : '');
    } catch (e: any) {
      setCompanySearchError(e?.message || '网络错误');
    } finally {
      setCompanySearchBusy(false);
    }
  }, [companyNameInput, fetchJson, user]);

  const openCustomerRegister = useCallback(function () {
    setCompanySearchError('');
    setOrderCreateError('');
    setCompanySearchResults([]);
    setCompanySearchPaging(null);
    setCompanySelectedKeyNo('');
    setCompanySearchOrderNumber('');
    setCustomerRegisterOpen(true);
  }, []);

  const createOrder = useCallback(async function (company: CompanySearchResultRow) {
    if (!user) return;

    setOrderCreateBusy(true);
    setOrderCreateError('');
    try {
      const { res, json } = await fetchJson('/api/customers/create', {
        method: 'POST',
        body: JSON.stringify({ orderNumber: companySearchOrderNumber, company }),
      });
      if (!res.ok || !json?.success) {
        setOrderCreateError(json?.message || '添加失败');
        return;
      }

      setCompanySelectedKeyNo('');
      setCompanySearchResults([]);
      setCompanySearchPaging(null);
      setCompanySearchOrderNumber('');
      setCompanyNameInput('');
      setCustomerRegisterOpen(false);
      setCustomersPage(1);
      await loadOrders(1);
    } catch (e: any) {
      setOrderCreateError(e?.message || '网络错误');
    } finally {
      setOrderCreateBusy(false);
    }
  }, [companySearchOrderNumber, fetchJson, loadOrders, user]);

  const registerSelectedCompany = useCallback(function () {
    const found = companySearchResults.find((r) => r.keyNo === companySelectedKeyNo);
    if (!found) {
      setOrderCreateError('请先选择一家企业');
      return;
    }
    void createOrder(found);
  }, [companySearchResults, companySelectedKeyNo, createOrder]);

  const loadMe = useCallback(async function () {
    try {
      const { res, json } = await fetchJson('/api/auth/me', { method: 'GET' });
      if (res.ok && json?.success && json?.user) {
        setUser(json.user);
        return;
      }
      if (res.status === 401) {
        const refreshed = await fetchJson('/api/auth/refresh', { method: 'POST', body: '{}' });
        if (refreshed.res.ok && refreshed.json?.success) {
          const retry = await fetchJson('/api/auth/me', { method: 'GET' });
          if (retry.res.ok && retry.json?.success && retry.json?.user) {
            setUser(retry.json.user);
            return;
          }
        }
        setUser(null);
      }
    } catch {}
  }, [fetchJson]);

  const submitAuth = useCallback(async function () {
    const trimmedPhone = phone.trim().replace(/[\s-]/g, '').replace(/^\+?86/, '');
    const pwd = password;

    if (!trimmedPhone) {
      setAuthError('请输入手机号');
      return;
    }

    if (authTab === 'register') {
      if (!userRegistrationEnabled) {
        setToastMessage('系统暂未开放注册，请联系管理员获取自己的账号');
        window.setTimeout(() => setToastMessage(''), 2400);
        return;
      }
      if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
        setAuthError('手机号格式不正确（中国大陆 11 位）');
        return;
      }
      if (pwd.length < 6) {
        setAuthError('密码至少 6 位，任意字符均可');
        return;
      }
    } else {
      if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
        setAuthError('手机号格式不正确（中国大陆 11 位）');
        return;
      }
      if (!pwd) {
        setAuthError('请输入密码');
        return;
      }
    }

    setAuthBusy(true);
    setAuthError('');
    try {
      const { res, json } = await fetchJson(`/api/auth/${authTab}`, { method: 'POST', body: JSON.stringify({ phone: trimmedPhone, password: pwd }) });
      if (!res.ok || !json?.success) {
        setAuthError(json?.message || '操作失败');
        return;
      }

      setUser(json.user);
      setPassword('');
      setAuthError('');
    } catch (e: any) {
      setAuthError(e?.message || '网络错误');
    } finally {
      setAuthBusy(false);
    }
  }, [authTab, fetchJson, password, phone]);

  useEffect(() => {
    (async () => {
      try {
        const { res, json } = await fetchJson('/api/public/settings', { method: 'GET' });
        if (res.ok && json?.success) {
          setUserRegistrationEnabled(!!json.userRegistrationEnabled);
        }
      } catch {}
    })();
  }, [fetchJson]);

  const logout = useCallback(async function () {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {}
    setUser(null);
  }, [fetchJson]);

  useEffect(() => {
    if (!user) return;
    if (navId !== 'customers') return;
    void loadOrders(customersPage);
  }, [customersPage, loadOrders, navId, user]);

  const loadProductServices = useCallback(async function () {
    setProductServicesBusy(true);
    setProductServicesError('');
    try {
      const { res, json } = await fetchJson('/api/product-services', { method: 'GET' });
      if (res.ok && json?.success && Array.isArray(json.services)) {
        setProductServices(json.services);
        if (Array.isArray(json.types)) setProductServiceTypes(json.types);
        return;
      }
      if (res.status === 401) {
        const refreshed = await fetchJson('/api/auth/refresh', { method: 'POST', body: '{}' });
        if (refreshed.res.ok && refreshed.json?.success) {
          const retry = await fetchJson('/api/product-services', { method: 'GET' });
          if (retry.res.ok && retry.json?.success && Array.isArray(retry.json.services)) {
            setProductServices(retry.json.services);
            return;
          }
        }
        setUser(null);
        return;
      }
      setProductServicesError(typeof json?.message === 'string' && json.message ? json.message : '加载失败');
    } catch (e: any) {
      setProductServicesError(e?.message || '网络错误');
    } finally {
      setProductServicesBusy(false);
    }
  }, [fetchJson]);

  const filteredProductServices = useMemo(function () {
    if (productServiceTypeSelected === 'all') return productServices;
    return productServices.filter((s) => s.typeId === productServiceTypeSelected);
  }, [productServices, productServiceTypeSelected]);

  useEffect(() => {
    if (productServiceTypeSelected === 'all') return;
    const exists = productServiceTypes.some((t) => t.typeId === productServiceTypeSelected);
    if (!exists) setProductServiceTypeSelected('all');
  }, [productServiceTypeSelected, productServiceTypes]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    const id = window.setInterval(function () {
      void loadMe();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadMe]);

  useEffect(() => {
    if (!user) return;
    if (navId !== 'products') return;
    void loadProductServices();
  }, [loadProductServices, navId, user]);

  if (!user) {
    const goAdmin = () => {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      window.location.href = isLocal ? '/prototypes/admin-login' : '/prototypes/admin-login.html';
    };

    return (
      <div className="fzs-auth-root">
        <div className="fzs-auth-bg">
          <div className="fzs-auth-orb a" />
          <div className="fzs-auth-orb b" />
          <div className="fzs-auth-grid" />
        </div>

        <div className="fzs-auth-card">
          <div className="fzs-auth-brand">
            <div className="fzs-auth-logo">FZS</div>
            <div className="fzs-auth-title">从零开始</div>
            <div className="fzs-auth-subtitle">Secure Access</div>
          </div>

          <div className="fzs-auth-tabs">
            <button className={authTab === 'login' ? 'active' : ''} type="button" onClick={() => { setAuthTab('login'); setAuthError(''); }}>
              登录
            </button>
            <button
              className={authTab === 'register' ? 'active' : ''}
              type="button"
              onClick={() => {
                if (!userRegistrationEnabled) {
                  setToastMessage('系统暂未开放注册，请联系管理员获取自己的账号');
                  window.setTimeout(() => setToastMessage(''), 2400);
                  setAuthTab('login');
                  setAuthError('');
                  return;
                }
                setAuthTab('register');
                setAuthError('');
              }}
            >
              注册
            </button>
          </div>

          <div className="fzs-auth-form">
            <div className="fzs-field">
              <div className="fzs-label">手机号</div>
              <input className="fzs-input dark" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="请输入手机号" />
            </div>
            <div className="fzs-field">
              <div className="fzs-label">密码</div>
              <input className="fzs-input dark" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={authTab === 'register' ? '至少 6 位' : '请输入密码'} type="password" />
            </div>
            {authError && <div className="fzs-error">{authError}</div>}
            <button className="fzs-auth-submit" type="button" onClick={submitAuth} disabled={authBusy}>
              {authBusy ? '处理中...' : (authTab === 'register' ? '注册并进入' : '登录并进入')}
            </button>
          </div>

          <div className="fzs-auth-foot">
            <div className="fzs-auth-hint">
              {authTab === 'register' ? '手机号需为中国大陆 11 位；密码至少 6 位。' : '请输入手机号与密码。'}
            </div>
            <button className="fzs-admin-entry" type="button" onClick={goAdmin}>管理员入口</button>
          </div>
        </div>

        {toastMessage && <div className="fzs-toast">{toastMessage}</div>}
      </div>
    );
  }

  const activeNav = NAV_ITEMS.find((x) => x.id === navId) ?? NAV_ITEMS[0];

  return (
    <div className="fzs-app-root">
      <div className="fzs-auth-bg">
        <div className="fzs-auth-orb a" />
        <div className="fzs-auth-orb b" />
        <div className="fzs-auth-grid" />
      </div>

      <aside className="fzs-side">
        <div className="fzs-side-top">
          <div className="fzs-side-brand">
            <div className="fzs-auth-logo">FZS</div>
            <div className="fzs-side-brand-text">
              <div className="fzs-side-title">从零开始</div>
              <div className="fzs-side-subtitle">Workspace</div>
            </div>
          </div>
        </div>

        <nav className="fzs-side-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={item.id === activeNav.id ? 'fzs-nav-item active' : 'fzs-nav-item'}
              type="button"
              onClick={() => setNavId(item.id)}
            >
              <div className="fzs-nav-label">{item.label}</div>
              <div className="fzs-nav-desc">{item.desc}</div>
            </button>
          ))}
        </nav>
      </aside>

      <div className="fzs-main">
        <header className="fzs-main-topbar">
          <div className="fzs-main-title">
            <div className="fzs-main-title-text">{activeNav.label}</div>
            <div className="fzs-main-title-sub">{activeNav.desc}</div>
          </div>
          <div className="fzs-user-area">
            <div className="fzs-user-chip dark">
              <span className="fzs-user-phone">{user.phone}</span>
            </div>
            <button className="fzs-link dark" type="button" onClick={logout}>退出</button>
          </div>
        </header>

        <main className="fzs-main-content">
          <div className="fzs-panel">
            <div className="fzs-panel-head">
              <div className="fzs-panel-head-left">
                <div className="fzs-panel-title">{activeNav.label}</div>
                <div className="fzs-panel-desc">{activeNav.desc}</div>
              </div>
              <div className="fzs-panel-head-right">
                {activeNav.id === 'customers' && (
                  <button className="fzs-primary-button dark" type="button" onClick={openCustomerRegister}>
                    客户登记
                  </button>
                )}
              </div>
            </div>

            <div className="fzs-panel-body">
              {activeNav.id === 'dashboard' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">欢迎回来</div>
                  <div className="fzs-empty-desc">这里将展示你的核心数据与快捷入口。</div>
                </div>
              )}
              {activeNav.id === 'customers' && (
                <div className="fzs-customer-root">
                  <div className="fzs-customer-grid">
                    <div className="fzs-customer-card main">
                      {ordersError && <div className="fzs-error">{ordersError}</div>}
                      {ordersBusy ? (
                        <div className="fzs-empty-block">
                          <div className="fzs-empty-title">加载中...</div>
                          <div className="fzs-empty-desc">正在获取客户列表。</div>
                        </div>
                      ) : orders.length === 0 ? (
                        <div className="fzs-empty-block">
                          <div className="fzs-empty-title">暂无客户</div>
                          <div className="fzs-empty-desc">点击右上角“客户登记”添加客户。</div>
                        </div>
                      ) : (
                        <>
                          <div className="fzs-customer-table">
                            <div className="fzs-customer-table-row header">
                              <div>企业名称</div>
                              <div>状态</div>
                              <div>统一社会信用代码</div>
                              <div>法人</div>
                              <div>活跃进展信息</div>
                              <div>成立日期</div>
                              <div>地址</div>
                              <div>操作</div>
                            </div>
                            {orders.map((c) => (
                              <div key={c.customerId} className="fzs-customer-table-row">
                                <div className="name">{c.company.name}</div>
                                <div>{c.company.status || '-'}</div>
                                <div>{c.company.creditCode || '-'}</div>
                                <div>{c.company.operName || '-'}</div>
                                <div className="fzs-customer-metrics">
                                  <button className={c.activeFollowupCount > 0 ? 'fzs-metric-button active' : 'fzs-metric-button'} type="button">
                                    跟进数 {c.activeFollowupCount}
                                  </button>
                                  <button className={c.signingProjectCount > 0 ? 'fzs-metric-button active' : 'fzs-metric-button'} type="button">
                                    签约数 {c.signingProjectCount}
                                  </button>
                                  <button className={c.activeProjectCount > 0 ? 'fzs-metric-button active' : 'fzs-metric-button'} type="button">
                                    项目数 {c.activeProjectCount}
                                  </button>
                                </div>
                                <div>{c.company.startDate || '-'}</div>
                                <div className="addr">{c.company.address || '-'}</div>
                                <div className="fzs-customer-actions">
                                  <button className="fzs-secondary-button" type="button">
                                    查看详情
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="fzs-customer-footer">
                            <div className="fzs-customer-page-size">
                              <button
                                className={customersPageSize === 10 ? 'fzs-secondary-button active' : 'fzs-secondary-button'}
                                type="button"
                                disabled={ordersBusy}
                                onClick={() => void changeCustomersPageSize(10)}
                              >
                                10/页
                              </button>
                              <button
                                className={customersPageSize === 20 ? 'fzs-secondary-button active' : 'fzs-secondary-button'}
                                type="button"
                                disabled={ordersBusy}
                                onClick={() => void changeCustomersPageSize(20)}
                              >
                                20/页
                              </button>
                              <button
                                className={customersPageSize === 50 ? 'fzs-secondary-button active' : 'fzs-secondary-button'}
                                type="button"
                                disabled={ordersBusy}
                                onClick={() => void changeCustomersPageSize(50)}
                              >
                                50/页
                              </button>
                            </div>

                            <div className="fzs-customer-paging">
                              <button
                                className="fzs-secondary-button"
                                type="button"
                                disabled={ordersBusy || customersPage <= 1}
                                onClick={() => void goCustomersPage(customersPage - 1)}
                              >
                                上一页
                              </button>
                              <div className="fzs-customer-page-text">
                                {customersPage} / {customersTotalPages}（共 {customersTotal} 条）
                              </div>
                              <button
                                className="fzs-secondary-button"
                                type="button"
                                disabled={ordersBusy || customersPage >= customersTotalPages}
                                onClick={() => void goCustomersPage(customersPage + 1)}
                              >
                                下一页
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {customerRegisterOpen && (
                    <div
                      className="fzs-modal-mask"
                      role="dialog"
                      aria-modal="true"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setCustomerRegisterOpen(false);
                      }}
                    >
                      <div className="fzs-modal">
                        <div className="fzs-modal-head">
                          <div className="fzs-modal-title">客户登记</div>
                          <button className="fzs-modal-close" type="button" onClick={() => setCustomerRegisterOpen(false)}>
                            ×
                          </button>
                        </div>

                        <div className="fzs-modal-body">
                          <div className="fzs-order-row">
                            <input
                              className="fzs-input"
                              value={companyNameInput}
                              placeholder="输入公司名称（例如：重庆）"
                              onChange={(e) => setCompanyNameInput(e.target.value)}
                            />
                            <button
                              className="fzs-primary-button dark"
                              type="button"
                              disabled={companySearchBusy}
                              onClick={() => searchCompanies(1)}
                            >
                              {companySearchBusy ? '查询中...' : '查询'}
                            </button>
                          </div>
                          {companySearchError && <div className="fzs-error">{companySearchError}</div>}

                          {companySearchBusy ? (
                            <div className="fzs-empty-block">
                              <div className="fzs-empty-title">加载中...</div>
                              <div className="fzs-empty-desc">正在查询企业列表。</div>
                            </div>
                          ) : companySearchResults.length === 0 ? (
                            <div className="fzs-empty-block">
                              <div className="fzs-empty-title">暂无结果</div>
                              <div className="fzs-empty-desc">输入公司名称后点击查询。</div>
                            </div>
                          ) : (
                            <>
                              <div className="fzs-order-tip">请选择一家企业（单选），点击“提交”完成登记。</div>
                              <div className="fzs-order-table">
                                <div className="fzs-order-table-row header">
                                  <div />
                                  <div>企业名称</div>
                                  <div>状态</div>
                                  <div>统一社会信用代码</div>
                                  <div>法人</div>
                                  <div>成立日期</div>
                                </div>
                                {companySearchResults.map((r) => (
                                  <div key={r.keyNo} className="fzs-order-table-row">
                                    <div>
                                      <input
                                        type="radio"
                                        name="companySelect"
                                        checked={companySelectedKeyNo === r.keyNo}
                                        onChange={() => setCompanySelectedKeyNo(r.keyNo)}
                                      />
                                    </div>
                                    <div className="fzs-order-company-name">{r.name}</div>
                                    <div>{r.status || '-'}</div>
                                    <div>{r.creditCode || '-'}</div>
                                    <div>{r.operName || '-'}</div>
                                    <div>{r.startDate || '-'}</div>
                                  </div>
                                ))}
                              </div>

                              <div className="fzs-order-actions">
                                <button
                                  className="fzs-primary-button dark"
                                  type="button"
                                  disabled={!companySelectedKeyNo || orderCreateBusy}
                                  onClick={registerSelectedCompany}
                                >
                                  {orderCreateBusy ? '提交中...' : '提交'}
                                </button>
                                <button
                                  className="fzs-secondary-button"
                                  type="button"
                                  disabled={companySearchBusy || orderCreateBusy}
                                  onClick={() => {
                                    setCompanySelectedKeyNo('');
                                  }}
                                >
                                  清空选择
                                </button>
                                {companySearchPaging && (
                                  <div className="fzs-order-paging">
                                    <button
                                      className="fzs-secondary-button"
                                      type="button"
                                      disabled={companySearchPaging.pageIndex <= 1 || companySearchBusy || orderCreateBusy}
                                      onClick={() => searchCompanies(companySearchPaging.pageIndex - 1)}
                                    >
                                      上一页
                                    </button>
                                    <div className="fzs-order-page-text">
                                      {companySearchPaging.pageIndex} / {Math.max(1, Math.ceil(companySearchPaging.totalRecords / Math.max(1, companySearchPaging.pageSize)))}
                                    </div>
                                    <button
                                      className="fzs-secondary-button"
                                      type="button"
                                      disabled={companySearchPaging.pageIndex >= Math.ceil(companySearchPaging.totalRecords / Math.max(1, companySearchPaging.pageSize)) || companySearchBusy || orderCreateBusy}
                                      onClick={() => searchCompanies(companySearchPaging.pageIndex + 1)}
                                    >
                                      下一页
                                    </button>
                                  </div>
                                )}
                              </div>
                              {orderCreateError && <div className="fzs-error">{orderCreateError}</div>}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeNav.id === 'projects' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">项目管理</div>
                  <div className="fzs-empty-desc">后续会在这里扩展项目、成员、资源与里程碑。</div>
                </div>
              )}
              {activeNav.id === 'orders' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">制单管理</div>
                  <div className="fzs-empty-desc">功能与数据将由你这边定义并接入。</div>
                </div>
              )}
              {activeNav.id === 'products' && (
                <div className="fzs-ps-root">
                  {productServicesError && <div className="fzs-error">{productServicesError}</div>}
                  <div className="fzs-ps-filter">
                    <div className="fzs-ps-filter-label">产品服务类型</div>
                    <div className="fzs-ps-filter-list">
                      <button
                        className={productServiceTypeSelected === 'all' ? 'fzs-ps-chip active' : 'fzs-ps-chip'}
                        type="button"
                        onClick={() => setProductServiceTypeSelected('all')}
                      >
                        全部
                      </button>
                      {productServiceTypes.map((t) => (
                        <button
                          key={t.typeId}
                          className={productServiceTypeSelected === t.typeId ? 'fzs-ps-chip active' : 'fzs-ps-chip'}
                          type="button"
                          onClick={() => setProductServiceTypeSelected(t.typeId)}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fzs-ps-table">
                    <div className="fzs-ps-row header">
                      <div>产品服务名称</div><div>WBS编码</div><div>描述</div><div>参考时间</div><div>责任方</div>
                    </div>
                    {productServicesBusy ? (
                      <div className="fzs-empty-block">
                        <div className="fzs-empty-title">加载中...</div>
                        <div className="fzs-empty-desc">正在获取已启用的产品服务。</div>
                      </div>
                    ) : filteredProductServices.length === 0 ? (
                      <div className="fzs-empty-block">
                        <div className="fzs-empty-title">暂无数据</div>
                        <div className="fzs-empty-desc">当前没有启用状态的产品服务。</div>
                      </div>
                    ) : (
                      filteredProductServices.map((s, idx) => (
                        <div key={`${s.wbsCode}-${idx}`} className="fzs-ps-row">
                          <div className="fzs-ps-name">{s.name}</div>
                          <div>{s.wbsCode}</div>
                          <div className="fzs-ps-desc">{s.description || '-'}</div>
                          <div>{`${s.referenceWeeks} 周`}</div>
                          <div>{s.ownerText || '-'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {activeNav.id === 'analytics' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">数据分析</div>
                  <div className="fzs-empty-desc">后续会在这里扩展报表、趋势与洞察。</div>
                </div>
              )}
              {activeNav.id === 'settings' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">系统设置</div>
                  <div className="fzs-empty-desc">后续会在这里扩展权限、配置与安全策略。</div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function mount() {
  if (typeof window === 'undefined') return;
  const bootstrap = (window as any).HtmlTemplateBootstrap;
  if (bootstrap?.renderComponent) bootstrap.renderComponent(App);
}

mount();

export default App;
