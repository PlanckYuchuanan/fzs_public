这是项目FZS的文档；
端：用户端；
共享：同一 MySQL+同一后端 server/index.mjs；路由前缀：/api vs /api/admin

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

- 客户管理：点击“新增客户”为预留入口（后续接入具体交互）
- 注册：
  - 手机号作为创建账号的唯一依据
  - 手机号校验：符合中国大陆手机号规则（11 位，`^1[3-9]\\d{9}$`）
  - 密码至少 6 位，任意字符（纯数字也可）
  - 重复手机号提示“已注册”
  - 若平台关闭注册：点击“注册”提示“系统暂未开放注册，请联系管理员获取自己的账号”
- 登录：手机号 + 密码校验通过即登录成功
- 登录态失效：任意接口返回 401 时尝试 `refresh` 并重试一次；失败则返回登录页
- 退出登录：调用 `/api/auth/logout`，并返回登录页
- 导航：
  - 默认选中“仪表盘”
  - 菜单项约 7 个占位，后续可扩展
  - “客户管理”页：
    - 主体为客户列表（尽量展示完整企业信息，隐藏内部 id/创建时间等辅助字段）
    - 客户列表支持分页（page/pageSize，默认 20/页）
    - 顶部提供“客户登记”按钮
    - 客户登记弹窗：
      - 顶部为第三方查询输入框（按公司名称查询企业列表）
      - 查询结果仅允许单选一条企业信息
      - 点击“提交”登记成功，并写入 MySQL（仅持久化用户最终选择的一条）
  - “产品服务”页展示已启用的产品服务列表（只读）
  - “制单管理”页：占位（待后续定义）

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

- 客户表：`customers`
  - `id`：客户ID
  - `user_id`：用户ID
  - 去重规则：同一用户 `company_name` 唯一（暂按企业名称去重）
  - 企业信息（来自第三方查询结果，持久化用户最终选择的一条）：
    - `company_key_no`：KeyNo
    - `company_name`：企业名称
    - `company_status`：企业状态（存续等）
    - `credit_code`：统一社会信用代码
    - `reg_no`：注册号（No）
    - `oper_name`：法人
    - `address`：地址
    - `start_date`：成立日期
  - 统计字段（初始为 0，后续由其它动作维护；页面以可点击按钮展示）：
    - `active_followup_count`：活跃跟进记录数
    - `active_project_count`：活跃项目个数
    - `signing_project_count`：签约中项目个数
  - 来源字段：
    - `source`：固定 `tripartite_company_search`
    - `source_order_number`：第三方 OrderNumber（可空）
  - `created_at`：创建时间

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

- `POST /api/company-search`
  - 说明：按公司名称查询企业列表（服务端代理第三方 companySearch）
  - body：`{ companyName: string, pageSize: number, pageIndex: number }`
  - 成功：`{ success: true, orderNumber: string, paging: { pageSize, pageIndex, totalRecords }, results: Array<{ keyNo, name, status, creditCode, regNo, operName, address, startDate }> }`
  - 失败：`{ success: false, code, message }`

- `GET /api/customers`
  - 说明：获取当前用户已添加客户列表（仅返回当前用户自己的数据）
  - query：`?page=1&pageSize=20`
  - 成功：`{ success: true, customers: Array<{ customerId, createdAt, source, sourceOrderNumber, activeFollowupCount, activeProjectCount, signingProjectCount, company: { keyNo, name, status, creditCode, regNo, operName, address, startDate } }>, paging: { page, pageSize, total, totalPages } }`

- `POST /api/customers/create`
  - 说明：添加客户（仅持久化用户最终选择的一条企业信息；暂按企业名称去重）
  - body：`{ orderNumber?: string, company: { keyNo, name, status?, creditCode?, regNo?, operName?, address?, startDate? } }`
  - 成功：`{ success: true, customer: { customerId, createdAt, source, sourceOrderNumber, company } }`
  - 失败：重复添加返回 `409`，code 为 `CUSTOMER_EXISTS`

## 第三方接口（Tripartite）

### 对接信息

- 测试地址：`http://tr.yeyeku.com/gs_tripartite_web/openapi/service/<servicePath>`
- 请求类型：`POST`
- Content-Type：`application/json;charset=utf-8`
- 公共参数（body）：
  - `clientId`：客户端 id（string）
  - `requestId`：请求ID（string，不可重复，推荐 uuid）
  - `scene`：场景（string，业务方自定义）
  - `timestamp`：时间戳（long）
  - `signType`：默认 `RSA2`
  - `sign`：签名（string，Base64）
  - `data`：json 字符串（string，具体字段见各 service 的文档）

### 签名规则（RSA2）

- 将参数按参数名称升序排序，拼成 `key=value&key=value` 得到 `sortStr`
- 使用开发者中心的 RSA 私钥对 `sortStr` 做 `SHA256WithRSA` 签名，结果 Base64 作为 `sign`

### 本项目调用方式（服务端代理）

- 管理端调用接口：`POST /api/admin/tripartite/call`
- body：
  - `servicePath`：第三方 service 路径（如 `xxx/yyy`）
  - `scene`：场景
  - `data`：对象或字符串；对象会在服务端 `JSON.stringify` 后参与签名并透传
  - `requestId` / `timestamp` / `clientId` / `signType`：可选；不传则由服务端生成或读取配置
- 返回：
  - 成功：`{ success: true, upstream: { statusCode, data } }`
  - 失败：`{ success: false, code, message, upstream? }`

### 配置项（环境变量）

- `TRIPARTITE_BASE_URL`：第三方 base url（默认 `http://tr.yeyeku.com/gs_tripartite_web/openapi/service`）
- `TRIPARTITE_CLIENT_ID`：第三方 clientId
- `TRIPARTITE_SIGN_TYPE`：默认 `RSA2`
- `TRIPARTITE_RSA_PRIVATE_KEY`：开发者 RSA 私钥（PKCS8，支持 PEM 或 base64）
- `TRIPARTITE_RSA_PRIVATE_KEY_FILE`：开发者 RSA 私钥文件路径（优先级低于 `TRIPARTITE_RSA_PRIVATE_KEY`）
- `TRIPARTITE_PLATFORM_PUBLIC_KEY`：平台公钥（base64，预留用于验签）
- `TRIPARTITE_PLATFORM_PUBLIC_KEY_FILE`：平台公钥文件路径（优先级低于 `TRIPARTITE_PLATFORM_PUBLIC_KEY`）
