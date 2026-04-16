# 管理员登录

## 页面目标

提供一个独立的管理员登录页（科技风风格），不支持注册，仅支持手机号 + 密码登录。

## 页面结构

- 背景：与用户登录页一致的科技感背景（渐变 + 网格）
- 登录卡片：
  - 标题：管理员登录
  - 表单：手机号、密码、登录按钮
  - 底部：弱化“返回用户登录”
- 登录后：
  - 显示当前管理员手机号与超管标记（占位）
  - 提供“退出管理员”“返回用户登录”

## 交互说明

- 登录接口：`POST /api/admin/auth/login`
- 登录态读取：`GET /api/admin/auth/me`
- 刷新：`POST /api/admin/auth/refresh`
- 退出：`POST /api/admin/auth/logout`

## 数据库

- 管理员表：`admin_user`
  - `id`：管理员ID
  - `phone`：手机号（唯一）
  - `created_at`：创建时间
  - `last_login_at`：最后登录时间（可空）
  - `is_superadmin`：是否超管
  - 额外字段（内部使用）：`password_salt`、`password_hash`

