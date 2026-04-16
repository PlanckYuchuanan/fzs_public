# 管理员登录

## 页面目标

提供一个独立的管理员登录页（科技风风格），不支持注册，仅支持手机号 + 密码登录。

## 页面结构

- 背景：与管理员登录后管理后台一致的偏暖色科技感背景（渐变 + 网格），保证风格统一
- 登录卡片：
  - 标题：管理员登录
  - 表单：手机号、密码、登录按钮
  - 底部：弱化“返回用户登录”
- 登录后：
  - 全屏左右布局（不再使用登录卡片容器）
  - 左侧菜单（管理后台偏暖色科技风，与产品端有细微色彩差异）
    - 用户管理
    - 管理员
  - 右侧主内容
    - 顶部：当前管理员信息、退出、返回用户登录
    - 用户管理：展示 `users` 列表，支持启用/停用（停用后不可登录）
    - 管理员：展示 `admin_user` 列表，支持启用/停用、权限范围设置、超管标记切换

## 交互说明

- 登录接口：`POST /api/admin/auth/login`
- 登录态读取：`GET /api/admin/auth/me`
- 刷新：`POST /api/admin/auth/refresh`
- 退出：`POST /api/admin/auth/logout`
- 管理接口：
  - `GET /api/admin/users`
  - `POST /api/admin/users/status`
  - `GET /api/admin/admin-users`
  - `POST /api/admin/admin-users/status`
  - `POST /api/admin/admin-users/permission`
  - 用户分页：`GET /api/admin/users?page=1&pageSize=20` → `users/page/pageSize/total`
- 登录错误提示映射：
  - `INVALID_CREDENTIALS`：手机号或密码错误
  - `DB_UNAVAILABLE`：服务暂不可用，请稍后重试
  - `PHONE_REQUIRED`：手机号不能为空
  - `PHONE_INVALID`：手机号格式不正确（中国大陆 11 位）
  - `PASSWORD_REQUIRED`：密码不能为空

## 数据库

- 管理员表：`admin_user`
  - `id`：管理员ID
  - `phone`：手机号（唯一）
  - `created_at`：创建时间
  - `last_login_at`：最后登录时间（可空）
  - `is_superadmin`：是否超管
  - `is_enabled`：是否启用（停用后不可登录）
  - `permission_scope`：权限范围（字符串，待后续扩展）
  - 额外字段（内部使用）：`password_salt`、`password_hash`

- 用户表：`users`
  - 新增：`is_enabled`（是否启用，停用后不可登录）

## 运维脚本

- 初始化/更新管理员账号：
  - 命令：`npm run seed:admin -- --phone=15823497335 --password=123456 --superadmin=true`
  - 说明：若手机号已存在则更新密码和超管标记，不重复插入
