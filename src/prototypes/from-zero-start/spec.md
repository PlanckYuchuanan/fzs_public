# 从零开始

## 页面目标

登录态无效时显示独立登录页。登录态有效时进入登录后工作台，提供左侧可扩展导航与主内容区。

## 页面结构

- 登录页：科技风格登录/注册卡片（手机号 + 密码）
- 登录页弱入口：右下角“管理员入口”（弱化按钮），跳转到独立管理员登录页
- 登录后页：
  - 左侧：菜单栏（支持后续扩展）
  - 右侧：主内容区
    - 顶部栏：当前模块标题 + 右上角用户信息与退出
    - 内容区：按当前菜单展示占位内容

## 交互说明

- 点击“新增客户”触发事件：`onCreateCustomer`
- 事件 payload：`{}`（JSON 字符串）
- 注册：
  - 手机号作为创建账号的唯一依据
  - 手机号校验：符合中国大陆手机号规则（11 位，`^1[3-9]\\d{9}$`）
  - 密码至少 6 位，任意字符（纯数字也可）
  - 重复手机号提示“已注册”
- 登录：手机号 + 密码校验通过即登录成功
- 登录态失效：`/api/auth/me` 返回 401 时尝试 `refresh`，失败则返回登录页
- 退出登录：调用 `/api/auth/logout`，并返回登录页
- 导航：
  - 默认选中“仪表盘”
  - 菜单项约 7 个占位，后续可扩展
  - “客户管理”页提供“新增客户”按钮入口
  - “产品服务”页展示已启用的产品服务列表（只读）

## Axure 接口

- 事件：`onCreateCustomer`
- 动作：无
- 变量：无

## 后端与数据库

- 前端开发服务：Vite 固定端口 `51720`
- 后端：独立 Node 服务，端口 `32123`
- 健康检查：`GET http://localhost:32123/health`
- 联调方式：
  - 本地开发默认直连后端：`http://localhost:32123`
  - 部署到服务器时建议前后端同域，通过 Nginx 反代访问 `/api/*`
  - 支持环境变量覆盖：`VITE_API_BASE_URL`
    - 本地调本地：不设置（默认 `http://localhost:32123`）
    - 本地调 ECS：设置为 `http://8.137.174.210/api`
- 启动命令：
  - 前端：`npm run dev`
  - 后端：`npm run dev:api`
  - 前后端一键启动：`npm run dev:all`
- 数据库：MySQL（关系型）
- 用户表：`users`
  - `id`：用户ID
  - `phone`：手机号（唯一）
  - `created_at`：注册时间
  - 额外字段（内部使用）：`password_salt`、`password_hash`
- 管理员表：`admin_user`
  - `id`：管理员ID
  - `phone`：手机号（唯一）
  - `created_at`：创建时间
  - `last_login_at`：最后登录时间（可空）
  - `is_superadmin`：是否超管标记
  - 额外字段（内部使用）：`password_salt`、`password_hash`
- Refresh Token 表：`refresh_tokens`
  - `id`：Refresh Token 记录ID
  - `user_id`：用户ID
  - `token_hash`：Refresh Token 哈希（不存明文）
  - `device_id`：设备ID（与客户端设备关联）
  - `created_at`：创建时间
  - `expires_at`：过期时间
  - `revoked_at`：撤销时间（注销/轮换）
  - `replaced_by`：轮换后的新记录ID
  - `ip`：客户端IP（可空）
  - `user_agent`：客户端 UA（可空）

## 登录态方案

- 采用 JWT + Refresh Token 双令牌
- Access Token（JWT）
  - 不存放敏感信息
  - 字段：`user_id`、`username`（本项目用手机号代替）、`scope`、`exp`
  - 存储：HttpOnly Cookie（同站点策略 `SameSite=Lax`）
- Refresh Token
  - 服务端持久化：存 `refresh_tokens`（仅存哈希）
  - 与 `user_id` + `device_id` 关联
  - 存储：HttpOnly Cookie（同站点策略 `SameSite=Lax`）

## 接口设计

- `POST /api/auth/register`
  - body：`{ phone: string, password: string }`
  - 规则：手机号唯一；密码 >= 6
  - 成功：`{ success: true, user: { userId, phone, registeredAt } }`
  - 失败：手机号已存在返回 `409`，message 为“已注册”
- `POST /api/auth/login`
  - body：`{ phone: string, password: string }`
  - 成功：`{ success: true, user: { userId, phone, registeredAt } }`
  - 失败：`401`，message 为“手机号或密码错误”
- `POST /api/auth/refresh`
  - 说明：使用 Refresh Token 轮换并签发新 Access Token
  - 成功：`{ success: true }`
  - 失败：`401`，message 为“未登录”
- `POST /api/auth/logout`
  - 说明：撤销 Refresh Token，并清理 Cookie
  - 成功：`{ success: true }`
- `GET /api/auth/me`
  - 说明：读取 Access Token（JWT）并返回当前用户
  - 成功：`{ success: true, user: { userId, phone, registeredAt } }`
  - 失败：`401`，message 为“未登录”

- `GET /api/product-services`
  - 说明：仅返回启用状态（is_enabled=1）的产品服务列表（产品端只读展示）
  - 成功：`{ success: true, services: Array<{ name, wbsCode, description, referenceWeeks, ownerText, typeId, typeName }>, types: Array<{ typeId, name }> }`
  - 失败：`401`，message 为“未登录”
