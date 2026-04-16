/**
 * @name 从零开始
 */
import './style.css';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Action, AxureHandle, AxureProps, ConfigItem, DataDesc, EventItem, KeyDesc } from '../../common/axure-types';

const EVENT_LIST: EventItem[] = [
  { name: 'onCreateCustomer', desc: '点击“新增客户”按钮时触发' },
];

const ACTION_LIST: Action[] = [];

const VAR_LIST: KeyDesc[] = [];

const CONFIG_LIST: ConfigItem[] = [];

const DATA_LIST: DataDesc[] = [];

const NAV_ITEMS: Array<{ id: string; label: string; desc: string }> = [
  { id: 'dashboard', label: '仪表盘', desc: '概览与关键指标（占位）' },
  { id: 'customers', label: '客户管理', desc: '客户列表与跟进（占位）' },
  { id: 'projects', label: '项目管理', desc: '项目与资源（占位）' },
  { id: 'analytics', label: '数据分析', desc: '报表与分析（占位）' },
  { id: 'settings', label: '系统设置', desc: '权限与配置（占位）' },
];

const Component = React.forwardRef<AxureHandle, AxureProps>(function FromZeroStart(innerProps, ref) {
  const onEvent = typeof innerProps?.onEvent === 'function' ? innerProps.onEvent : function () {};

  const [authTab, setAuthTab] = useState<'register' | 'login'>('register');
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [user, setUser] = useState<{ userId: string; phone: string; registeredAt: string } | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [navId, setNavId] = useState<string>('dashboard');

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
    const res = await fetch(`${apiBaseUrl}${path}`, {
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

  const handleCreateCustomer = useCallback(function () {
    try {
      onEvent('onCreateCustomer', '{}');
    } catch {}
  }, [onEvent]);

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

  const logout = useCallback(async function () {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {}
    setUser(null);
  }, [fetchJson]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    const id = window.setInterval(function () {
      void loadMe();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadMe]);

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
            <button className={authTab === 'register' ? 'active' : ''} type="button" onClick={() => { setAuthTab('register'); setAuthError(''); }}>
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
              {activeNav.id === 'customers' && (
                <button className="fzs-primary-button dark" type="button" onClick={handleCreateCustomer}>
                  新增客户
                </button>
              )}
            </div>

            <div className="fzs-panel-body">
              {activeNav.id === 'dashboard' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">欢迎回来</div>
                  <div className="fzs-empty-desc">这里将展示你的核心数据与快捷入口。</div>
                </div>
              )}
              {activeNav.id === 'customers' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">客户管理</div>
                  <div className="fzs-empty-desc">客户数据将由你这边定义并接入。</div>
                </div>
              )}
              {activeNav.id === 'projects' && (
                <div className="fzs-empty-block">
                  <div className="fzs-empty-title">项目管理</div>
                  <div className="fzs-empty-desc">后续会在这里扩展项目、成员、资源与里程碑。</div>
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
});

export default Component;

