import '../from-zero-start/style.css';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Action, AxureHandle, AxureProps, ConfigItem, DataDesc, EventItem, KeyDesc } from '../../common/axure-types';

const EVENT_LIST: EventItem[] = [];

const ACTION_LIST: Action[] = [];

const VAR_LIST: KeyDesc[] = [];

const CONFIG_LIST: ConfigItem[] = [];

const DATA_LIST: DataDesc[] = [];

const Component = React.forwardRef<AxureHandle, AxureProps>(function AdminLogin(innerProps, ref) {
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [admin, setAdmin] = useState<{ adminId: string; phone: string; isSuperadmin: boolean; lastLoginAt: string | null; createdAt: string } | null>(null);

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
        setError(json?.message || '登录失败');
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

  const backToUser = useCallback(function () {
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    window.location.href = isLocal ? '/prototypes/from-zero-start' : '/prototypes/from-zero-start.html';
  }, []);

  useEffect(() => {
    void loadMe();
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
          <div className="fzs-auth-title">管理员登录</div>
          <div className="fzs-auth-subtitle">Admin Access</div>
        </div>

        {admin ? (
          <>
            <div className="fzs-empty-block">
              <div className="fzs-empty-title">已登录</div>
              <div className="fzs-empty-desc">
                {admin.phone}{admin.isSuperadmin ? '（超管）' : ''}
              </div>
            </div>
            <div className="fzs-auth-foot">
              <button className="fzs-admin-entry" type="button" onClick={backToUser}>返回用户登录</button>
              <button className="fzs-auth-submit" type="button" onClick={logout}>退出管理员</button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
});

export default Component;
